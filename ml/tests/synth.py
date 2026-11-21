"""Synthetic protocol-format takes for testing the training pipeline (never used for real training).

Each gesture is a different time-frequency pattern of Doppler echoes around a 20 kHz tone:
PUSH +117 Hz burst, PULL -117 Hz burst, WAVE alternating swings, OPEN_CLOSE short two-sided bursts, UNDO two small taps toward.
"""

import json
from pathlib import Path

import numpy as np
import soundfile as sf

from data import Session

FS = 48000
TONE = 20000.0
LEAD_IN_S = 3.0
CUE_S = 1.5
PERIOD_S = 3.0
NONE_TAKE_S = 20.0


def amp(db: float) -> float:
    return 10 ** (db / 20)


def _burst(x: np.ndarray, t: np.ndarray, start_s: float, length_s: float, doppler_hz: float, db: float) -> None:
    a, b = int(start_s * FS), int((start_s + length_s) * FS)
    x[a:b] += amp(db) * np.sin(2 * np.pi * (TONE + doppler_hz) * t[a:b])


def _gesture(x: np.ndarray, t: np.ndarray, label: str, cue_s: float, rng: np.random.Generator) -> None:
    start = cue_s + rng.uniform(0.15, 0.45)
    db = rng.uniform(-62, -52)
    if label == "PUSH":
        _burst(x, t, start, 0.4, rng.uniform(90, 140), db)
    elif label == "PULL":
        _burst(x, t, start, 0.4, -rng.uniform(90, 140), db)
    elif label == "WAVE":
        for k in range(4):
            _burst(x, t, start + 0.25 * k, 0.25, (1 if k % 2 == 0 else -1) * rng.uniform(80, 120), db)
    elif label == "OPEN_CLOSE":
        for k in range(3):
            s = start + 0.22 * k
            _burst(x, t, s, 0.12, rng.uniform(40, 70), db - 4)
            _burst(x, t, s, 0.12, -rng.uniform(40, 70), db - 4)
    elif label == "UNDO":
        _burst(x, t, start, 0.12, rng.uniform(60, 90), db)
        _burst(x, t, start + 0.32, 0.12, rng.uniform(60, 90), db)
    else:
        raise ValueError(f"unknown gesture {label}")


def write_take(session: Session, folder: Path) -> Path:
    """Save a take the way the Record page does: 16-bit WAV plus JSON with sample-index reps. Returns the JSON path."""
    folder.mkdir(parents=True, exist_ok=True)
    sf.write(folder / f"{session.name}.wav", session.samples, session.sample_rate, subtype="PCM_16")
    meta = {
        **session.meta, "person": session.person, "gesture": session.gesture, "laptop": session.laptop,
        "note": "", "sampleRate": session.sample_rate, "toneHz": int(session.tone_hz), "toneDbfs": -36,
        "reps": [{"start": s, "end": e, "label": label} for s, e, label in session.reps],
        "createdAt": "2026-11-20T23:10:00-05:00",
    }
    path = folder / f"{session.name}.json"
    path.write_text(json.dumps(meta))
    return path


def make_take(
    label: str,
    person: str = "ana",
    n_cues: int = 8,
    seed: int = 0,
    noise_db: float = -100.0,
    lead_in_motion: bool = False,
) -> Session:
    """A synthetic take: 3 s hands-off lead-in, then a cue every 3 s. label 'NONE' makes a still NONE take.

    lead_in_motion=True puts a hand wave into the lead-in, like a person who did not keep still."""
    rng = np.random.default_rng(seed)
    is_none = label == "NONE"
    seconds = NONE_TAKE_S if is_none else LEAD_IN_S + n_cues * PERIOD_S + 1.0
    t = np.arange(int(seconds * FS)) / FS
    x = amp(-36) * np.sin(2 * np.pi * TONE * t) + rng.uniform(-1, 1, t.size) * amp(noise_db)
    reps: list[tuple[int, int, str]] = []
    if lead_in_motion:
        for k in range(4):
            _burst(x, t, 0.4 + 0.5 * k, 0.4, (1 if k % 2 == 0 else -1) * 100.0, -52.0)
    if not is_none:
        for k in range(n_cues):
            cue = LEAD_IN_S + PERIOD_S * k
            _gesture(x, t, label, cue, rng)
            reps.append((int(cue * FS), int((cue + CUE_S) * FS), label))
    return Session(
        name=f"{person}_{label}_{seed}", person=person, gesture=label, laptop="synthetic", sample_rate=FS,
        tone_hz=TONE, samples=x.astype(np.float32), reps=reps,
        meta={"takeKind": "none" if is_none else "gesture", "cueWindowMs": 1500, "periodMs": 3000, "leadInMs": 3000},
    )
