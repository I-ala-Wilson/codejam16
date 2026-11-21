"""Streaming evaluation (ml/PROTOCOL.md section 6): decode model probabilities into events the way the engine will,
then score them against the cue windows of a take.

The decoder here is the reference for the engine's classifier post-processing; keep the two in step.
"""

from collections import Counter
from dataclasses import dataclass

import numpy as np
import torch

from data import Session
from dataset import CLASSES, STRIDE_FRAMES, WINDOW_FRAMES, lead_in_floor
from features import excess_db, frame_centers, spectrogram_db
from train import predict_proba

DEFAULT_THRESHOLDS = {name: 0.7 for name in CLASSES[1:]}
#: Average this many consecutive evaluations, fire after this many in a row above threshold, then hold off.
SMOOTH_EVALS = 3
CONFIRM_EVALS = 2
REFRACTORY_S = 0.6
#: A wave is long, so it holds off the strokes that follow it for longer.
WAVE_REFRACTORY_S = 1.2
#: An event belongs to a cue window when it falls from a little before it to a while after it (decision latency).
MATCH_HEAD_S = 0.15
MATCH_TAIL_S = 0.8


@dataclass(frozen=True)
class Event:
    cls: str
    t_s: float


@dataclass(frozen=True)
class EvalReport:
    n_reps: dict[str, int]
    #: Per label, the share of cue windows in which the right class fired.
    recall: dict[str, float]
    #: Per label, what fired instead (first event in the window) or "none".
    confusion: dict[str, dict[str, int]]
    #: Events on NONE takes, per minute; None when no NONE take was scored.
    false_alarms_per_minute: float | None
    #: Events in gesture takes that fall in no cue window.
    stray_events: int


def decode_events(
    probs: np.ndarray,
    times_s: np.ndarray,
    thresholds: dict[str, float] = DEFAULT_THRESHOLDS,
    smooth: int = SMOOTH_EVALS,
    confirm: int = CONFIRM_EVALS,
    refractory_s: float = REFRACTORY_S,
    wave_refractory_s: float = WAVE_REFRACTORY_S,
) -> list[Event]:
    events: list[Event] = []
    hold_until = -np.inf
    streak, previous = 0, None
    for i in range(len(probs)):
        mean = probs[max(0, i - smooth + 1) : i + 1].mean(axis=0)
        best = int(np.argmax(mean[1:])) + 1
        candidate = best if mean[best] >= thresholds[CLASSES[best]] and int(np.argmax(mean)) == best else None
        if times_s[i] < hold_until:
            streak, previous = 0, None
            continue
        streak = streak + 1 if candidate is not None and candidate == previous else (1 if candidate is not None else 0)
        previous = candidate
        if candidate is not None and streak >= confirm:
            events.append(Event(CLASSES[candidate], float(times_s[i])))
            hold_until = times_s[i] + (wave_refractory_s if CLASSES[candidate] == "WAVE" else refractory_s)
            streak, previous = 0, None
    return events


def stream_probs(model: torch.nn.Module, session: Session, device: str) -> tuple[np.ndarray, np.ndarray]:
    """Probabilities for a window ending every STRIDE_FRAMES frames, and the time (s) each window ends."""
    spec = spectrogram_db(session.samples, session.sample_rate, session.tone_hz)
    if spec.shape[0] < WINDOW_FRAMES:
        return np.zeros((0, len(CLASSES))), np.zeros(0)
    excess = excess_db(spec, lead_in_floor(session, spec))
    starts = list(range(0, spec.shape[0] - WINDOW_FRAMES + 1, STRIDE_FRAMES))
    windows = np.stack([excess[s : s + WINDOW_FRAMES] for s in starts]).astype(np.float32)
    ends = frame_centers(spec.shape[0])[[s + WINDOW_FRAMES - 1 for s in starts]] / session.sample_rate
    return predict_proba(model, windows, device), ends


def evaluate_takes(
    model: torch.nn.Module,
    sessions: list[Session],
    device: str,
    thresholds: dict[str, float] = DEFAULT_THRESHOLDS,
) -> EvalReport:
    reps: Counter[str] = Counter()
    hits: Counter[str] = Counter()
    confusion: dict[str, Counter[str]] = {}
    stray = 0
    none_events, none_seconds = 0, 0.0
    for session in sessions:
        probs, times = stream_probs(model, session, device)
        events = decode_events(probs, times, thresholds)
        if session.meta.get("takeKind") == "none":
            none_events += len(events)
            none_seconds += float(times[-1] - times[0]) if len(times) > 1 else 0.0
            continue
        windows = [
            (start / session.sample_rate - MATCH_HEAD_S, end / session.sample_rate + MATCH_TAIL_S, label)
            for start, end, label in session.reps
        ]
        for lo, hi, label in windows:
            inside = [e for e in events if lo <= e.t_s <= hi]
            reps[label] += 1
            hit = any(e.cls == label for e in inside)
            hits[label] += int(hit)
            said = label if hit else (inside[0].cls if inside else "none")
            confusion.setdefault(label, Counter())[said] += 1
        stray += sum(1 for e in events if not any(lo <= e.t_s <= hi for lo, hi, _ in windows))
    return EvalReport(
        n_reps=dict(reps),
        recall={label: hits[label] / n for label, n in reps.items()},
        confusion={label: dict(c) for label, c in confusion.items()},
        false_alarms_per_minute=(none_events / (none_seconds / 60.0)) if none_seconds > 0 else None,
        stray_events=stray,
    )
