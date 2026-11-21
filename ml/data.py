"""Load recordings (contracts/recording.md) and turn them into labelled training windows (ml/PROTOCOL.md)."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from features import frame_centers

NONE = "NONE"
IGNORE = "IGNORE"
#: Every take starts with this much hands-off time; it is the floor and the NONE examples from gesture takes.
LEAD_IN_S = 3.0
#: Frames this close to the first cue are IGNORE (the hand may already be moving).
LEAD_IN_MARGIN_S = 0.3
#: Frames this close to a cue-window edge are IGNORE (reaction time and the return stroke).
CUE_EDGE_S = 0.2


@dataclass(frozen=True)
class Session:
    name: str
    person: str
    gesture: str
    laptop: str
    sample_rate: int
    tone_hz: float
    samples: np.ndarray
    reps: list[tuple[int, int, str]]
    meta: dict[str, Any]


#: Folders that hold other experiments' recordings (the breathing takes), not gesture sessions.
NON_GESTURE_FOLDERS = frozenset({"breath"})
#: Folders whose name starts with this hold live-check takes: the presenter's own takes, kept OUT of every training run
#: so a candidate model can be scored on data it has never seen (ml/experiments/RESULTS.md, shipping rule).
HELD_OUT_PREFIX = "livecheck-"


def find_sessions(root: Path) -> list[Path]:
    """Every <name>.json under root that has a sibling <name>.wav, in a stable order.

    Breathing takes and live-check (`livecheck-*`) takes are skipped: neither is training data."""
    return sorted(
        p
        for p in root.rglob("*.json")
        if p.with_suffix(".wav").exists()
        and not NON_GESTURE_FOLDERS & set(p.relative_to(root).parts[:-1])
        and not any(part.startswith(HELD_OUT_PREFIX) for part in p.relative_to(root).parts[:-1])
    )


def find_held_out_sessions(root: Path) -> list[Path]:
    """The live-check takes under root (every take inside a `livecheck-*` folder), in a stable order."""
    return sorted(
        p
        for p in root.rglob("*.json")
        if p.with_suffix(".wav").exists()
        and any(part.startswith(HELD_OUT_PREFIX) for part in p.relative_to(root).parts[:-1])
    )


def load_session(json_path: Path) -> Session:
    meta = json.loads(json_path.read_text())
    audio, sample_rate = sf.read(json_path.with_suffix(".wav"), dtype="float32", always_2d=True)
    if audio.shape[1] != 1:
        raise ValueError(f"{json_path.name}: expected a mono recording, got {audio.shape[1]} channels")
    if sample_rate != int(meta["sampleRate"]):
        raise ValueError(
            f"{json_path.name}: WAV sample rate {sample_rate} differs from the JSON's {meta['sampleRate']}"
        )
    reps = [(int(r["start"]), int(r["end"]), str(r["label"])) for r in meta.get("reps", [])]
    return Session(
        name=json_path.stem,
        person=str(meta.get("person", "")).lower(),  # logins differ only in case between batteries (I-ala-Wilson, I-ala-wilson)
        gesture=str(meta.get("gesture", "")),
        laptop=str(meta.get("laptop", "")),
        sample_rate=int(sample_rate),
        tone_hz=float(meta["toneHz"]),
        samples=audio[:, 0],
        reps=reps,
        meta=meta,
    )


def frame_labels(n_frames: int, reps: list[tuple[int, int, str]], none_label: str = NONE) -> list[str]:
    """Label each frame by the rep whose [start, end] contains the frame's centre sample, else none_label."""
    centres = frame_centers(n_frames)
    labels = [none_label] * n_frames
    for start, end, label in reps:
        for i in np.nonzero((centres >= start) & (centres <= end))[0]:
            labels[int(i)] = label
    return labels


def protocol_labels(session: Session, n_frames: int, lead_in_clean: bool = True) -> list[str]:
    """ml/PROTOCOL.md section 3: cue windows give the labels, the lead-in is NONE, everything else is IGNORE.

    A lead-in the person did not keep still (lead_in_clean=False) is IGNORE too: it is not a reliable NONE example."""
    if session.meta.get("takeKind") == "none":
        return [NONE] * n_frames
    seconds = frame_centers(n_frames) / session.sample_rate
    first_cue = min((start for start, _, _ in session.reps), default=int(LEAD_IN_S * session.sample_rate))
    lead_in_end = first_cue / session.sample_rate - LEAD_IN_MARGIN_S
    labels = [IGNORE] * n_frames
    for i, t in enumerate(seconds):
        if t < lead_in_end and lead_in_clean:
            labels[i] = NONE
    for start, end, label in session.reps:
        inside = (seconds >= start / session.sample_rate + CUE_EDGE_S) & (seconds <= end / session.sample_rate - CUE_EDGE_S)
        for i in np.nonzero(inside)[0]:
            labels[int(i)] = label
    return labels


def make_windows(
    excess: np.ndarray,
    labels: list[str],
    length: int = 48,
    stride: int = 4,
    skip: frozenset[str] = frozenset({IGNORE}),
) -> tuple[np.ndarray, list[str]]:
    """Sliding windows of `length` frames, each labelled by its centre frame; windows labelled in `skip` are dropped."""
    n_frames, n_bins = excess.shape
    windows: list[np.ndarray] = []
    window_labels: list[str] = []
    for start in range(0, n_frames - length + 1, stride):
        label = labels[start + length // 2]
        if label in skip:
            continue
        windows.append(excess[start : start + length])
        window_labels.append(label)
    if not windows:
        return np.zeros((0, length, n_bins), dtype=np.float32), []
    return np.stack(windows).astype(np.float32), window_labels
