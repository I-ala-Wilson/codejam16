"""Train and evaluate the gesture classifier on recordings (ml/PROTOCOL.md).

    ml/.venv/bin/python ml/run.py lopo  data/recordings      # leave-one-person-out, writes ml/REPORT.md
    ml/.venv/bin/python ml/run.py final data/recordings      # train on everyone, export ml/models/gesture.onnx + .json
"""

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from data import Session, find_sessions, load_session
from dataset import CLASSES, STRIDE_FRAMES, WINDOW_FRAMES, Windows, concat, lead_in_floor, session_windows
from evaluate import (
    CONFIRM_EVALS,
    DEFAULT_THRESHOLDS,
    REFRACTORY_S,
    SMOOTH_EVALS,
    WAVE_REFRACTORY_S,
    EvalReport,
    evaluate_takes,
)
from features import spectrogram_db
from train import ONNX_BINS, SCALE_DB, export_onnx, pick_device, train

TARGET_RECALL = 0.80
TARGET_FALSE_ALARMS_PER_MINUTE = 1.0
DROP_BELOW_RECALL = 0.70
DEFAULT_EPOCHS = 30


@dataclass(frozen=True)
class FoldReport:
    person: str
    report: EvalReport
    n_train_windows: int


def load_corpus(root: Path) -> list[Session]:
    return [load_session(p) for p in find_sessions(root)]


def usable_sessions(sessions: list[Session]) -> list[Session]:
    """Takes with a long enough hands-off lead-in to learn a floor; the rest are reported and skipped."""
    usable: list[Session] = []
    for session in sessions:
        spec = spectrogram_db(session.samples, session.sample_rate, session.tone_hz)
        try:
            if spec.shape[0] > 0:
                lead_in_floor(session, spec)
                usable.append(session)
                continue
        except ValueError:
            pass
        sys.stderr.write(f"skipping {session.name}: no usable hands-off lead-in\n")
    return usable


def _windows(sessions: list[Session]) -> Windows:
    return concat([session_windows(s) for s in sessions])


def lopo_reports(sessions: list[Session], epochs: int, device: str, seed: int) -> list[FoldReport]:
    """Train on everyone except one person and score that person's takes with the streaming decoder."""
    sessions = usable_sessions(sessions)
    folds: list[FoldReport] = []
    for person in sorted({s.person for s in sessions}):
        train_sessions = [s for s in sessions if s.person != person]
        train_windows = _windows(train_sessions)
        model = train(train_windows, None, epochs=epochs, device=device, seed=seed).model
        report = evaluate_takes(model, [s for s in sessions if s.person == person], device)
        folds.append(FoldReport(person, report, len(train_windows.y)))
    return folds


def pooled_recall(folds: list[FoldReport]) -> dict[str, float]:
    """Recall per label over every rep of every held-out person."""
    hits: Counter[str] = Counter()
    total: Counter[str] = Counter()
    for fold in folds:
        for label, n in fold.report.n_reps.items():
            hits[label] += round(fold.report.recall[label] * n)
            total[label] += n
    return {label: hits[label] / total[label] for label in total}


def _mark(recall: float) -> str:
    return f"{recall:.0%} {'ok' if recall >= TARGET_RECALL else ('LOW' if recall >= DROP_BELOW_RECALL else 'DROP')}"


def render_report(folds: list[FoldReport], epochs: int, device: str, seed: int) -> str:
    labels = [c for c in CLASSES[1:] if any(c in f.report.recall for f in folds)]
    pooled = pooled_recall(folds)
    lines = [
        "# Gesture classifier report",
        "",
        f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} on {device}; {epochs} epochs, seed {seed}.",
        "Method: leave-one-person-out. For each person, train on everyone else, then score that person's takes with the",
        "streaming decoder (a class must fire inside the cue window). Takes without a usable hands-off lead-in are skipped.",
        f"Targets: rep recall of {TARGET_RECALL:.0%} or more per class, at most {TARGET_FALSE_ALARMS_PER_MINUTE:.0f} false alarm per minute on NONE takes.",
        f"A class under {DROP_BELOW_RECALL:.0%} is dropped from the Lock vocabulary (LOW means between {DROP_BELOW_RECALL:.0%} and {TARGET_RECALL:.0%}).",
        "",
        "## Rep recall by held-out person",
        "",
        "| held out | " + " | ".join(labels) + " | false alarms per min (NONE takes) | stray events |",
        "|---|" + "---|" * (len(labels) + 2),
    ]
    for f in folds:
        cells = [_mark(f.report.recall[c]) if c in f.report.recall else "n/a" for c in labels]
        fa = "n/a" if f.report.false_alarms_per_minute is None else f"{f.report.false_alarms_per_minute:.1f}"
        lines.append(f"| {f.person} | " + " | ".join(cells) + f" | {fa} | {f.report.stray_events} |")
    lines.append("| **pooled** | " + " | ".join(f"**{_mark(pooled[c])}**" if c in pooled else "n/a" for c in labels) + " | | |")
    lines += ["", "## Confusion, pooled over all held-out people (rows: cued gesture, columns: what fired)", ""]
    confusion: dict[str, Counter[str]] = {}
    for f in folds:
        for label, row in f.report.confusion.items():
            confusion.setdefault(label, Counter()).update(row)
    columns = [*labels, "none"]
    lines += ["| cued | " + " | ".join(columns) + " |", "|---|" + "---|" * len(columns)]
    for label in labels:
        row = confusion.get(label, Counter())
        lines.append(f"| {label} | " + " | ".join(str(row.get(c, 0)) for c in columns) + " |")
    return "\n".join(lines) + "\n"


def train_final(sessions: list[Session], epochs: int, device: str, seed: int, out_dir: Path) -> None:
    """Train on every person and write gesture.onnx plus gesture.json (what the engine needs to run it)."""
    sessions = usable_sessions(sessions)
    windows = _windows(sessions)
    model = train(windows, None, epochs=epochs, device=device, seed=seed).model
    out_dir.mkdir(parents=True, exist_ok=True)
    export_onnx(model, out_dir / "gesture.onnx")
    config = {
        "classes": list(CLASSES),
        "windowFrames": WINDOW_FRAMES,
        "strideFrames": STRIDE_FRAMES,
        "bins": ONNX_BINS,
        "scaleDb": SCALE_DB,
        "clipDb": [-10.0, 60.0],
        "thresholds": DEFAULT_THRESHOLDS,
        "decoder": {
            "smooth": SMOOTH_EVALS,
            "confirm": CONFIRM_EVALS,
            "refractoryMs": round(REFRACTORY_S * 1000),
            "waveRefractoryMs": round(WAVE_REFRACTORY_S * 1000),
        },
        "trainedOn": sorted({s.person for s in sessions}),
        "epochs": epochs,
        "windows": len(windows.y),
    }
    (out_dir / "gesture.json").write_text(json.dumps(config, indent=2) + "\n")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("lopo", "final"):
        p = sub.add_parser(name)
        p.add_argument("root", type=Path, help="folder of recordings (data/recordings)")
        p.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
        p.add_argument("--seed", type=int, default=0)
        p.add_argument("--device", default=pick_device())
        if name == "lopo":
            p.add_argument("--out", type=Path, default=Path(__file__).parent / "REPORT.md")
        else:
            p.add_argument("--out-dir", type=Path, default=Path(__file__).parent / "models")
    args = parser.parse_args(argv)

    sessions = load_corpus(args.root)
    if not usable_sessions(sessions):
        sys.stderr.write(f"no usable recordings under {args.root}\n")
        return 2
    if args.command == "lopo":
        if len({s.person for s in sessions}) < 2:
            sys.stderr.write("leave-one-person-out needs at least two people\n")
            return 2
        folds = lopo_reports(sessions, args.epochs, args.device, args.seed)
        args.out.write_text(render_report(folds, args.epochs, args.device, args.seed))
        sys.stdout.write(f"wrote {args.out}\n")
    else:
        train_final(sessions, args.epochs, args.device, args.seed, args.out_dir)
        sys.stdout.write(f"wrote {args.out_dir / 'gesture.onnx'}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
