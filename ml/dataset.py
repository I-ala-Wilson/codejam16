"""Labelled model-input windows from recordings, per ml/PROTOCOL.md section 4."""

from dataclasses import dataclass

import numpy as np

from data import LEAD_IN_MARGIN_S, LEAD_IN_S, Session, make_windows, protocol_labels
from features import excess_db, frame_centers, spectrogram_db, still_floor

CLASSES = ("NONE", "PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO")
CLASS_INDEX = {name: i for i, name in enumerate(CLASSES)}
#: One model input: 48 frames, about 1.0 s at 47 frames per second.
WINDOW_FRAMES = 48
STRIDE_FRAMES = 4
MIN_LEAD_IN_FRAMES = 10


@dataclass(frozen=True)
class Windows:
    x: np.ndarray  # (N, WINDOW_FRAMES, bins) dB over the lead-in floor, clipped to [-10, 60]
    y: np.ndarray  # (N,) class indices into CLASSES
    person: np.ndarray  # (N,) person of each window
    take: np.ndarray  # (N,) take (session name) of each window


def empty_windows(bins: int = 87) -> Windows:
    return Windows(
        np.zeros((0, WINDOW_FRAMES, bins), dtype=np.float32),
        np.zeros(0, dtype=np.int64),
        np.zeros(0, dtype=object),
        np.zeros(0, dtype=object),
    )


def concat(parts: list[Windows]) -> Windows:
    if not parts:
        return empty_windows()
    return Windows(
        np.concatenate([p.x for p in parts]),
        np.concatenate([p.y for p in parts]),
        np.concatenate([p.person for p in parts]),
        np.concatenate([p.take for p in parts]),
    )


def lead_in_floor(session: Session, spec: np.ndarray) -> np.ndarray:
    """The floor is learned from the hands-off lead-in, exactly like the engine's auto-calibration."""
    first_cue = min((s for s, _, _ in session.reps), default=int(LEAD_IN_S * session.sample_rate)) / session.sample_rate
    seconds = frame_centers(spec.shape[0]) / session.sample_rate
    lead_in = seconds < first_cue - LEAD_IN_MARGIN_S
    if lead_in.sum() < MIN_LEAD_IN_FRAMES:
        raise ValueError(f"{session.name}: the hands-off lead-in is too short to learn a floor")
    return still_floor(spec[lead_in])


def session_windows(session: Session, length: int = WINDOW_FRAMES, stride: int = STRIDE_FRAMES) -> Windows:
    """Windows of one take. Labels outside CLASSES (for example FREE) are dropped; IGNORE gaps are never windows."""
    spec = spectrogram_db(session.samples, session.sample_rate, session.tone_hz)
    if spec.shape[0] < length:
        return empty_windows(spec.shape[1])
    excess = excess_db(spec, lead_in_floor(session, spec))
    x, names = make_windows(excess, protocol_labels(session, spec.shape[0]), length, stride)
    keep = [i for i, name in enumerate(names) if name in CLASS_INDEX]
    if not keep:
        return empty_windows(spec.shape[1])
    n = len(keep)
    return Windows(
        x[keep],
        np.array([CLASS_INDEX[names[i]] for i in keep], dtype=np.int64),
        np.array([session.person] * n, dtype=object),
        np.array([session.name] * n, dtype=object),
    )
