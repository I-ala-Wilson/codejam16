"""Compare recipes at the same false-alarm rate (ml/tune.py scores every recipe at one fixed decoder threshold).

    ml/.venv/bin/python ml/sweep.py data/recordings --recipes ml/experiments/sweep_recipes.json

A model that is less eager scores lower recall and fewer false alarms at the same threshold without being a worse model.
For each recipe this trains the leave-one-person-out folds once, keeps every held-out take's probabilities, and decodes
them at a range of thresholds, giving a recall-versus-false-alarms curve. Two recipes are comparable by their recall at
the same false-alarm rate.
"""

import argparse
import json
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from dataset import CLASSES
from evaluate import DEFAULT_THRESHOLDS, evaluate_takes, stream_probs
from run import FoldReport, _windows, device_problem, load_corpus, usable_sessions
from train import macro_f1, pick_device, predict_proba, train
from tune import score_run

THRESHOLD_GRID = (0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95)
#: The habit class stays this much stricter than the gestures, as in DEFAULT_THRESHOLDS.
HABIT_EXTRA = DEFAULT_THRESHOLDS["REPETITIVE"] - DEFAULT_THRESHOLDS["PUSH"]
#: False-alarm rates (per minute, on the idle takes) at which recipes are compared.
FALSE_ALARM_TARGETS = (4.0, 3.0, 2.0, 1.0)
SWEEPS_DIR = "sweeps"


@dataclass(frozen=True)
class SweepPoint:
    threshold: float
    macro_recall: float
    false_alarms_per_minute: float | None
    fold_recall: dict[str, float]


def thresholds_for(threshold: float) -> dict[str, float]:
    """One decoder threshold for every gesture; the habit class a little stricter."""
    gestures = {name: threshold for name in DEFAULT_THRESHOLDS if name != "REPETITIVE"}
    return {**gestures, "REPETITIVE": min(0.99, threshold + HABIT_EXTRA)}


def recall_at_false_alarms(curve: list[SweepPoint], target: float) -> float | None:
    """Macro recall at `target` false alarms per minute, interpolated along the curve. None if the model never gets that quiet."""
    points = sorted((p for p in curve if p.false_alarms_per_minute is not None), key=lambda p: p.false_alarms_per_minute)
    if not points or points[0].false_alarms_per_minute > target:
        return None
    if points[-1].false_alarms_per_minute <= target:
        return points[-1].macro_recall
    for low, high in zip(points, points[1:]):
        if low.false_alarms_per_minute <= target <= high.false_alarms_per_minute:
            span = high.false_alarms_per_minute - low.false_alarms_per_minute
            if span == 0:
                return high.macro_recall
            share = (target - low.false_alarms_per_minute) / span
            return low.macro_recall + share * (high.macro_recall - low.macro_recall)
    return None


@dataclass(frozen=True)
class HeldOutFold:
    """One leave-one-person-out fold after training: the held-out person's takes and the model's probabilities on them."""

    person: str
    sessions: list
    streams: list
    train_f1: float
    heldout_f1: float
    n_train: int


def lopo_streams(sessions, epochs: int, device: str, seed: int, **train_kwargs) -> list[HeldOutFold]:
    """Train each leave-one-person-out fold once and keep every held-out take's (probabilities, times)."""
    folds = []
    for person in sorted({s.person for s in sessions}):
        train_windows = _windows([s for s in sessions if s.person != person])
        held_out = [s for s in sessions if s.person == person]
        result = train(train_windows, None, epochs=epochs, device=device, seed=seed, **train_kwargs)
        windows = _windows(held_out)
        held_f1 = macro_f1(windows.y, predict_proba(result.model, windows.x, device).argmax(axis=1), len(CLASSES))
        streams = [stream_probs(result.model, s, device) for s in held_out]
        folds.append(HeldOutFold(person, held_out, streams, result.train_macro_f1, held_f1, len(train_windows.y)))
    return folds


def sweep_recipe(sessions, recipe: dict, epochs: int, device: str, seed: int, grid=THRESHOLD_GRID) -> list[SweepPoint]:
    """Train each leave-one-person-out fold once; decode its held-out takes at every threshold in the grid."""
    wanted_epochs = int(recipe.get("epochs", epochs))
    kwargs = {k: v for k, v in recipe.items() if k != "epochs"}
    held = lopo_streams(sessions, wanted_epochs, device, seed, **kwargs)
    curve = []
    for threshold in grid:
        folds = [
            FoldReport(f.person, evaluate_takes(None, f.sessions, device, thresholds_for(threshold), f.streams), f.n_train, f.train_f1, f.heldout_f1)
            for f in held
        ]
        score = score_run("sweep", seed, folds)
        curve.append(SweepPoint(threshold, score.macro_recall, score.false_alarms_per_minute, score.fold_recall))
    return curve


def render_table(curves: dict[str, list[SweepPoint]]) -> str:
    default_threshold = DEFAULT_THRESHOLDS["PUSH"]
    header = (
        "| recipe | "
        + " | ".join(f"recall at {t:g}/min" for t in FALSE_ALARM_TARGETS)
        + f" | recall / false alarms per min at the default threshold ({default_threshold:g}) |"
    )
    lines = ["# Recall at equal false-alarm rates (leave-one-person-out)", "", header, "|---|" + "---|" * (len(FALSE_ALARM_TARGETS) + 1)]
    for name, curve in curves.items():
        cells = []
        for target in FALSE_ALARM_TARGETS:
            value = recall_at_false_alarms(curve, target)
            cells.append("n/a" if value is None else f"{value:.3f}")
        at_default = next((p for p in curve if p.threshold == default_threshold), None)
        default = "n/a" if at_default is None else f"{at_default.macro_recall:.3f} / {at_default.false_alarms_per_minute or 0:.2f}"
        lines.append(f"| {name} | " + " | ".join(cells) + f" | {default} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("root", type=Path)
    parser.add_argument("--recipes", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "experiments")
    parser.add_argument("--device", default=pick_device())
    parser.add_argument("--allow-cpu", action="store_true")
    args = parser.parse_args(argv)
    problem = device_problem(args.device, args.allow_cpu)
    if problem:
        sys.stderr.write(problem + "\n")
        return 2
    sessions = usable_sessions(load_corpus(args.root))
    if len({s.person for s in sessions}) < 3:
        sys.stderr.write("a sweep needs at least three people\n")
        return 2
    sweeps = args.out / SWEEPS_DIR
    sweeps.mkdir(parents=True, exist_ok=True)
    for name, recipe in json.loads(args.recipes.read_text()).items():
        started = time.time()
        curve = sweep_recipe(sessions, recipe, args.epochs, args.device, args.seed)
        (sweeps / f"{name}.json").write_text(
            json.dumps({"name": name, "recipe": recipe, "seed": args.seed, "curve": [asdict(p) for p in curve]}, indent=2) + "\n"
        )
        sys.stdout.write(f"{name}: swept {len(curve)} thresholds ({time.time() - started:.0f} s)\n")
        sys.stdout.flush()
    curves = {}
    for path in sorted(sweeps.glob("*.json")):
        saved = json.loads(path.read_text())
        curves[saved["name"]] = [SweepPoint(**p) for p in saved["curve"]]
    table = render_table(curves)
    (args.out / "SWEEP.md").write_text(table)
    sys.stdout.write(table)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
