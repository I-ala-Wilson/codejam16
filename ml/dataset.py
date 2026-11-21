"""Labelled model-input windows from recordings, per ml/PROTOCOL.md section 4."""

from dataclasses import dataclass

import numpy as np

from data import LEAD_IN_MARGIN_S, LEAD_IN_S, Session, make_windows, protocol_labels
from features import GUARD_BINS, excess_db, frame_centers, motion_energy, spectrogram_db, still_floor

CLASSES = ("NONE", "PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO")
CLASS_INDEX = {name: i for i, name in enumerate(CLASSES)}
#: One model input: 48 frames, about 1.0 s at 47 frames per second.
WINDOW_FRAMES = 48
STRIDE_FRAMES = 4
MIN_LEAD_IN_FRAMES = 10
#: A frame counts as motion when some non-guard bin is this far above the floor (ml/PROTOCOL.md section 3).
MOTION_DB = 6.0
MAX_LEAD_IN_MOTION_FRACTION = 0.10
#: When the lead-in is not still, the floor comes from this share of the quietest frames of the take.
QUIET_FRACTION = 0.30


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


def _quietest_frames(spec: np.ndarray) -> np.ndarray:
    """Indices of the quietest frames by power outside the carrier's main lobe: the hand is not moving in them."""
    centre = spec.shape[1] // 2
    keep = np.abs(np.arange(spec.shape[1]) - centre) > GUARD_BINS
    power = (10.0 ** (spec[:, keep] / 10.0)).sum(axis=1)
    count = max(MIN_LEAD_IN_FRAMES, int(QUIET_FRACTION * len(power)))
    return np.argsort(power)[:count]


def take_floor(session: Session, spec: np.ndarray) -> tuple[np.ndarray, bool]:
    """The still-room floor of a take, and whether its hands-off lead-in was clean.

    A still lead-in gives the floor, exactly like the engine's auto-calibration. If the person moved during it (more than
    10% of its frames show motion) the floor is learned from the take's quietest frames instead, so the cue windows of the
    take stay usable; the caller then drops that lead-in from the NONE examples."""
    if spec.shape[0] < MIN_LEAD_IN_FRAMES:
        raise ValueError(f"{session.name}: the recording is too short to learn a floor")
    first_cue = min((s for s, _, _ in session.reps), default=int(LEAD_IN_S * session.sample_rate)) / session.sample_rate
    seconds = frame_centers(spec.shape[0]) / session.sample_rate
    lead_in = seconds < first_cue - LEAD_IN_MARGIN_S
    if lead_in.sum() >= MIN_LEAD_IN_FRAMES:
        floor = still_floor(spec[lead_in])
        moving = motion_energy(excess_db(spec[lead_in], floor)) > MOTION_DB
        if float(moving.mean()) <= MAX_LEAD_IN_MOTION_FRACTION:
            return floor, True
    return still_floor(spec[_quietest_frames(spec)]), False


def session_windows(session: Session, length: int = WINDOW_FRAMES, stride: int = STRIDE_FRAMES) -> Windows:
    """Windows of one take. Labels outside CLASSES (for example FREE) are dropped; IGNORE gaps are never windows."""
    spec = spectrogram_db(session.samples, session.sample_rate, session.tone_hz)
    if spec.shape[0] < length:
        return empty_windows(spec.shape[1])
    floor, lead_in_clean = take_floor(session, spec)
    excess = excess_db(spec, floor)
    x, names = make_windows(excess, protocol_labels(session, spec.shape[0], lead_in_clean), length, stride)
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
