"""Shipping check for a candidate gesture model against the shipped one, on one person's UNSEEN takes (ml/experiments/RESULTS.md).

    ml/.venv/bin/python ml/compare_models.py <shipped.onnx> <candidate.onnx> --person ian

Unseen takes are `data/pilot` (never trained on) plus every take in a `livecheck-*` folder under data/recordings (held out of
training by data.find_sessions). Both models run through the real streaming decoder. The candidate passes when, for every
gesture, its hits are at least the shipped model's hits minus ONE cue (these sets are small, one cue is noise), and the UNDO
events it emits during that person's WAVE takes are at most the shipped model's plus one. The exit code is 1 on a fail.
"""

import argparse
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from data import Session, find_held_out_sessions, find_sessions, load_session
from evaluate import DEFAULT_THRESHOLDS, decode_events, evaluate_takes, stream_probs

GESTURES = ("PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO", "REPETITIVE")
#: A candidate may lose this many hits (cues) per gesture, and add this many UNDO events in WAVE takes, against the shipped model.
TOLERANCE = 1


class OnnxModel(torch.nn.Module):
    """An exported gesture.onnx behind the same call as the torch model, so evaluate.stream_probs works unchanged."""

    def __init__(self, path: Path) -> None:
        super().__init__()
        self._session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.from_numpy(self._session.run(None, {"x": x.numpy().astype(np.float32)})[0])


def unseen_sessions(person: str, pilot_root: Path, recordings_root: Path) -> list[Session]:
    paths = [*find_sessions(pilot_root), *find_held_out_sessions(recordings_root)]
    return [s for s in (load_session(p) for p in paths) if s.person == person.lower()]


def score_model(model: torch.nn.Module, sessions: list[Session]) -> tuple[dict[str, int], dict[str, int], int]:
    """(hits per gesture, cue count per gesture, UNDO events emitted during WAVE takes)."""
    streams = [stream_probs(model, s, "cpu") for s in sessions]
    report = evaluate_takes(None, sessions, "cpu", DEFAULT_THRESHOLDS, streams)
    hits = {g: round(report.recall.get(g, 0.0) * report.n_reps.get(g, 0)) for g in GESTURES}
    cues = {g: report.n_reps.get(g, 0) for g in GESTURES}
    undo_in_wave = 0
    for session, (probs, ends) in zip(sessions, streams):
        if any(label == "WAVE" for _, _, label in session.reps):
            undo_in_wave += Counter(e.cls for e in decode_events(probs, ends, DEFAULT_THRESHOLDS))["UNDO"]
    return hits, cues, undo_in_wave


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("shipped", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--person", required=True, help="the presenter's name as stored in the recordings, e.g. ian")
    parser.add_argument("--pilot", type=Path, default=Path("data/pilot"))
    parser.add_argument("--recordings", type=Path, default=Path("data/recordings"))
    args = parser.parse_args(argv)

    sessions = unseen_sessions(args.person, args.pilot, args.recordings)
    if not sessions:
        sys.stderr.write(f"no unseen takes for {args.person} under {args.pilot} or livecheck-* in {args.recordings}\n")
        return 2
    base_hits, cues, base_undo = score_model(OnnxModel(args.shipped), sessions)
    cand_hits, _, cand_undo = score_model(OnnxModel(args.candidate), sessions)

    print(f"{len(sessions)} unseen takes for {args.person}")
    print(f"{'gesture':12s}{'cues':>6s}{'shipped':>9s}{'candidate':>11s}  verdict")
    failed = False
    for g in GESTURES:
        if cues[g] == 0:
            continue
        ok = cand_hits[g] >= base_hits[g] - TOLERANCE
        failed |= not ok
        print(f"{g:12s}{cues[g]:6d}{base_hits[g]:9d}{cand_hits[g]:11d}  {'ok' if ok else 'FAIL: lost more than one cue'}")
    wave_ok = cand_undo <= base_undo + TOLERANCE
    failed |= not wave_ok
    print(f"UNDO events during WAVE takes: shipped {base_undo}, candidate {cand_undo}  {'ok' if wave_ok else 'FAIL: more stray UNDOs'}")
    print("RESULT:", "FAIL, keep the shipped model" if failed else "PASS (rule b); Ian's live check (c) is still required")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
