"""Train and evaluate the gesture classifier on recordings (ml/PROTOCOL.md).

    ml/.venv/bin/python ml/run.py lopo  data/recordings      # leave-one-person-out, writes ml/REPORT.md
    ml/.venv/bin/python ml/run.py final data/recordings      # train on everyone, export ml/models/gesture.onnx + .json
    ml/.venv/bin/python ml/run.py calib data/recordings --person <login>   # demo-day retrain, see ml/README.md
"""

import argparse
import json
import sys
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import torch

from audit import AuditResult, audit_session
from data import Session, find_sessions, load_session
from dataset import CLASSES, STRIDE_FRAMES, WINDOW_FRAMES, Windows, concat, spectrogram_of, windows_of
from evaluate import (
    CONFIRM_EVALS,
    DEFAULT_THRESHOLDS,
    HABIT_REFRACTORY_S,
    REFRACTORY_S,
    SMOOTH_EVALS,
    WAVE_REFRACTORY_S,
    EvalReport,
    evaluate_takes,
)
from train import ONNX_BINS, SCALE_DB, export_onnx, macro_f1, pick_device, predict_proba, train

TARGET_RECALL = 0.80
TARGET_FALSE_ALARMS_PER_MINUTE = 1.0
DROP_BELOW_RECALL = 0.70
DEFAULT_EPOCHS = 30
#: Folders whose name starts with this hold the demo-day calibration takes (ml/README.md).
CALIB_PREFIX = "calib-"
#: A person's calibration takes count this many times in training (calibration.py: x5 was the best variant).
DEFAULT_CALIB_REPEAT = 5


@dataclass(frozen=True)
class FoldReport:
    person: str
    report: EvalReport
    n_train_windows: int
    #: Macro F1 (per window, no decoder) on a sample of the windows it trained on, and on the held-out person's windows.
    #: A big gap between the two is overfitting, whatever the held-out rep recall says.
    train_f1: float = 0.0
    heldout_f1: float = 0.0


def load_corpus(root: Path) -> list[Session]:
    return [load_session(p) for p in find_sessions(root)]


def usable_sessions(sessions: list[Session]) -> list[Session]:
    """Takes long enough to hold one model window; the rest are reported and skipped. A lead-in the person did not
    keep still does not make a take unusable (dataset.take_floor falls back to the quietest frames)."""
    usable: list[Session] = []
    for session in sessions:
        if spectrogram_of(session).shape[0] >= WINDOW_FRAMES:
            usable.append(session)
        else:
            sys.stderr.write(f"skipping {session.name}: too short for one model window\n")
    return usable


def _windows(sessions: list[Session]) -> Windows:
    return concat([windows_of(s) for s in sessions])


def lopo_reports(
    sessions: list[Session],
    epochs: int,
    device: str,
    seed: int,
    drop_train: frozenset[str] = frozenset(),
    drop_test: frozenset[str] = frozenset(),
    **train_kwargs: float,
) -> list[FoldReport]:
    """Train on everyone except one person and score that person's takes with the streaming decoder.

    `drop_train` and `drop_test` are take names (file names without extension): a take in `drop_train` is left out of the
    training windows of every fold, a take in `drop_test` is left out of the scoring of its held-out fold (the fold still
    trains and scores all its other takes). `train_kwargs` are the regularisation settings of train() (weight_decay, dropout,
    aug_strength, ...)."""
    sessions = usable_sessions(sessions)
    folds: list[FoldReport] = []
    for person in sorted({s.person for s in sessions}):
        train_windows = _windows([s for s in sessions if s.person != person and s.name not in drop_train])
        held_out = [s for s in sessions if s.person == person and s.name not in drop_test]
        if not held_out:
            continue
        result = train(train_windows, None, epochs=epochs, device=device, seed=seed, **train_kwargs)
        held_windows = _windows(held_out)
        held_f1 = macro_f1(held_windows.y, predict_proba(result.model, held_windows.x, device).argmax(axis=1), len(CLASSES))
        folds.append(
            FoldReport(person, evaluate_takes(result.model, held_out, device), len(train_windows.y), result.train_macro_f1, held_f1)
        )
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
        "How the recipe and thresholds were chosen, and what these numbers mean: ml/experiments/RESULTS.md.",
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


def replicate(windows: Windows, times: int) -> Windows:
    return windows if times <= 1 else concat([windows] * times)


def calib_windows(sessions: list[Session], calibration: list[Session], repeat: int) -> Windows:
    """Windows of every take, with the calibration takes (a subset of `sessions`) counted `repeat` times in all."""
    parts = [_windows(sessions)]
    if calibration and repeat > 1:
        parts.append(replicate(_windows(calibration), repeat - 1))
    return concat(parts)


def train_final(
    sessions: list[Session],
    epochs: int,
    device: str,
    seed: int,
    out_dir: Path,
    calibration: list[Session] | None = None,
    repeat: int = 1,
) -> int:
    """Train on every person and write gesture.onnx plus gesture.json (what the engine needs to run it).

    `calibration` takes (already part of `sessions`) are repeated so that they count `repeat` times in training.
    Returns the number of training windows."""
    sessions = usable_sessions(sessions)
    windows = calib_windows(sessions, usable_sessions(calibration or []), repeat)
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
            "habitRefractoryMs": round(HABIT_REFRACTORY_S * 1000),
        },
        "trainedOn": sorted({s.person for s in sessions}),
        "epochs": epochs,
        "windows": len(windows.y),
    }
    (out_dir / "gesture.json").write_text(json.dumps(config, indent=2) + "\n")
    return len(windows.y)


def is_calibration_path(path: Path, root: Path) -> bool:
    """True when a folder between `root` and the file starts with `calib-`."""
    return any(part.startswith(CALIB_PREFIX) for part in path.relative_to(root).parts[:-1])


def load_corpus_and_calibration(root: Path, person: str | list[str]) -> tuple[list[Session], list[Session]]:
    """(every take under root, the subset that belongs to `person` (one login or several) and sits in a calib-* folder)."""
    people = {p.lower() for p in ([person] if isinstance(person, str) else person)}
    sessions: list[Session] = []
    calibration: list[Session] = []
    for path in find_sessions(root):
        session = load_session(path)
        sessions.append(session)
        if session.person in people and is_calibration_path(path, root):
            calibration.append(session)
    return sessions, calibration


def failed_audits(calibration: list[Session]) -> list[AuditResult]:
    """The calibration takes that FAIL the ml/audit.py checks (warnings do not count)."""
    return [r for r in (audit_session(s) for s in calibration) if not r.passed]


def cue_counts(calibration: list[Session]) -> Counter[str]:
    return Counter(label for s in calibration for _, _, label in s.reps)


def run_calibration(args: argparse.Namespace, sessions: list[Session], calibration: list[Session]) -> int:
    if not calibration:
        sys.stderr.write(
            f"no calibration takes for {', '.join(args.person)} under {args.root}: put the .json and .wav files in "
            f"<root>/<login>/{CALIB_PREFIX}1/ (a folder starting with '{CALIB_PREFIX}')\n"
        )
        return 2
    bad = failed_audits(calibration)
    if bad and not args.skip_failed:
        sys.stderr.write(f"{len(bad)} of {len(calibration)} calibration takes FAILED the audit, not training. Redo them:\n")
        for r in bad:
            sys.stderr.write(f"  {r.name}: " + "; ".join(r.problems) + "\n")
        return 1
    if bad:
        skipped = {r.name for r in bad}
        sys.stderr.write(f"--skip-failed: leaving {len(bad)} failed take(s) out of training entirely (redo them when you can):\n")
        for r in bad:
            sys.stderr.write(f"  {r.name}: " + "; ".join(r.problems) + "\n")
        calibration = [s for s in calibration if s.name not in skipped]
        sessions = [s for s in sessions if s.name not in skipped]
    counts = cue_counts(calibration)
    started = time.time()
    n_windows = train_final(sessions, args.epochs, args.device, args.seed, args.out_dir, calibration, args.repeat)
    seconds = time.time() - started
    sys.stdout.write(
        f"calibration takes: {len(calibration)} ({sum(counts.values())} cues; "
        + ", ".join(f"{label} {n}" for label, n in sorted(counts.items()))
        + f"), each repeated x{args.repeat}\n"
        f"training windows: {n_windows} (from {len(sessions)} takes)\n"
        f"training time: {seconds:.0f} s\n"
        f"wrote {args.out_dir / 'gesture.onnx'} and {args.out_dir / 'gesture.json'}\n"
    )
    return 0


def device_problem(device: str, allow_cpu: bool) -> str | None:
    """Why training on `device` must be refused, or None. A GPU that is available is the only acceptable default."""
    if torch.cuda.is_available() and not device.startswith("cuda") and not allow_cpu:
        return f"A GPU is available but --device is {device}: refusing to train on the CPU (pass --allow-cpu to override)"
    return None


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("lopo", "final", "calib"):
        p = sub.add_parser(name)
        p.add_argument("root", type=Path, help="folder of recordings (data/recordings)")
        p.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
        p.add_argument("--seed", type=int, default=0)
        p.add_argument("--device", default=pick_device(), help="cuda by default whenever a GPU is available")
        p.add_argument("--allow-cpu", action="store_true", help="train on the CPU even though a GPU is available")
        if name == "lopo":
            p.add_argument("--out", type=Path, default=Path(__file__).parent / "REPORT.md")
        else:
            p.add_argument("--out-dir", type=Path, default=Path(__file__).parent / "models")
        if name == "calib":
            p.add_argument("--person", nargs="+", required=True, help="one or more logins whose calib-* takes are repeated (case-insensitive)")
            p.add_argument("--repeat", type=int, default=DEFAULT_CALIB_REPEAT, help="times the calibration takes count in training")
            p.add_argument("--skip-failed", action="store_true", help="leave calibration takes that FAIL the audit out of training (named on stderr) instead of refusing")
    args = parser.parse_args(argv)

    problem = device_problem(args.device, args.allow_cpu)
    if problem:
        sys.stderr.write(problem + "\n")
        return 2
    gpu = f" ({torch.cuda.get_device_name(0)})" if args.device.startswith("cuda") else ""
    sys.stdout.write(f"training on {args.device}{gpu}\n")

    if args.command == "calib":
        if args.repeat < 1:
            sys.stderr.write("--repeat must be at least 1\n")
            return 2
        sessions, calibration = load_corpus_and_calibration(args.root, args.person)
        return run_calibration(args, sessions, calibration)
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
