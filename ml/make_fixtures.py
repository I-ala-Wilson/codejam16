"""Generate the cross-language test fixtures the engine's classifier runtime is checked against.

    ml/.venv/bin/python ml/make_fixtures.py

Writes into engine/src/fixtures/ (seeded, so re-running gives the same files):
  decoder-cases.json  probability sequences and the events the Python reference decoder (evaluate.decode_events) fires
  parity.onnx         a small randomly initialised GestureCNN exported with train.export_onnx
  parity.json         one input window and the logits PyTorch gives for it
"""

import json
from pathlib import Path

import numpy as np
import torch

from dataset import CLASSES, WINDOW_FRAMES
from evaluate import DEFAULT_THRESHOLDS, decode_events
from features import HOP, WINDOW, spectrogram_db
from model import GestureCNN
from train import ONNX_BINS, export_onnx

OUT = Path(__file__).resolve().parent.parent / "engine" / "src" / "fixtures"
EVAL_PERIOD_S = 0.085


def _sequence(rng: np.random.Generator, plan: list[tuple[str, int]]) -> np.ndarray:
    """A noisy probability sequence: each (class, evaluations) piece leans toward that class."""
    rows = []
    for name, n in plan:
        for _ in range(n):
            logits = rng.normal(0.0, 0.6, len(CLASSES))
            logits[CLASSES.index(name)] += rng.uniform(1.5, 4.5)
            e = np.exp(logits - logits.max())
            rows.append(e / e.sum())
    return np.array(rows)


def decoder_cases() -> list[dict]:
    rng = np.random.default_rng(1234)
    plans = [
        [("NONE", 12), ("PUSH", 8), ("NONE", 15)],
        [("PUSH", 5), ("NONE", 20), ("PULL", 6), ("NONE", 5)],
        [("WAVE", 14), ("NONE", 3), ("PUSH", 6), ("NONE", 20)],
        [("NONE", 10), ("UNDO", 3), ("NONE", 3), ("UNDO", 3), ("NONE", 20)],
        [("OPEN_CLOSE", 30), ("NONE", 10)],
        [("NONE", 40)],
        [("PUSH", 3), ("PULL", 3), ("PUSH", 3), ("PULL", 3), ("NONE", 10)],
    ]
    cases = []
    for plan in plans:
        probs = _sequence(rng, plan).round(6)  # the rounded values are what the JSON carries, so decode those
        times = (np.arange(len(probs)) * EVAL_PERIOD_S).round(6)
        events = decode_events(probs, times, DEFAULT_THRESHOLDS)
        cases.append(
            {
                "probs": probs.tolist(),
                "timesS": times.tolist(),
                "events": [{"cls": e.cls, "tS": round(e.t_s, 6)} for e in events],
            }
        )
    return cases


def parity() -> tuple[GestureCNN, dict]:
    torch.manual_seed(0)
    model = GestureCNN(n_classes=len(CLASSES)).eval()
    rng = np.random.default_rng(99)
    window = rng.uniform(-0.1, 1.0, (WINDOW_FRAMES, ONNX_BINS)).astype(np.float32).round(6)
    with torch.no_grad():
        logits = model(torch.from_numpy(window)[None, None]).numpy()[0]
    return model, {"window": window.tolist(), "logits": logits.round(6).tolist()}


def spectrum_parity() -> dict:
    """Seeded audio (tone, a Doppler echo and noise) and the first four frames ml/features.py makes from it."""
    rng = np.random.default_rng(7)
    n = WINDOW + 3 * HOP
    t = np.arange(n) / 48000
    amp = lambda db: 10 ** (db / 20)  # noqa: E731
    x = amp(-36) * np.sin(2 * np.pi * 20000 * t) + amp(-56) * np.sin(2 * np.pi * 20117 * t) + rng.uniform(-1, 1, n) * amp(-90)
    samples = x.astype(np.float32)  # the exact values the engine receives
    bins = spectrogram_db(samples, 48000, 20000.0)
    return {"samples": samples.tolist(), "bins": bins.round(4).tolist()}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "spectrum-parity.json").write_text(json.dumps(spectrum_parity()))
    (OUT / "decoder-cases.json").write_text(json.dumps({"thresholds": DEFAULT_THRESHOLDS, "cases": decoder_cases()}))
    model, fixture = parity()
    export_onnx(model, OUT / "parity.onnx")
    (OUT / "parity.json").write_text(json.dumps(fixture))


if __name__ == "__main__":
    main()
