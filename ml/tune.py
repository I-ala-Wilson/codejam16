"""Tune the training recipe without overfitting to the evaluation (ml/REPORT.md).

    ml/.venv/bin/python ml/tune.py data/recordings --recipes ml/experiments/round1.json --seeds 0 1

Every recipe is scored by leave-one-person-out over all the people, so a number is always about someone the model never
trained on. Because trying many recipes and keeping the best one overfits the held-out people too, a recipe is only
accepted by `decide`, a rule fixed here before any run: it must beat the baseline by more than the measured seed noise,
on most people, with at most FA_SLACK_PER_MIN more false alarms and without a wider gap between how well it fits its own training windows and
how well it does on the held-out person.
"""

import argparse
import json
import math
import statistics
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from dataset import set_snr_reference
from run import FoldReport, device_problem, load_corpus, lopo_reports, pooled_recall, usable_sessions
from train import pick_device

#: The baseline's seed-to-seed spread, in macro recall, is multiplied by this to get the margin a recipe must clear...
NOISE_MULT = 2.0
#: ...but the margin is never smaller than this.
MIN_GAIN = 0.01
#: A recipe must beat the baseline for at least this share of the held-out people.
PEOPLE_SHARE = 0.8
#: It may not add more than this many false alarms per minute (on the NONE takes); a recipe that only fires more would otherwise win.
FA_SLACK_PER_MIN = 0.25
#: It may not widen the train-to-held-out F1 gap by more than this.
GAP_SLACK = 0.02
BASELINE = "baseline"
RESULTS_DIR = "results"


@dataclass(frozen=True)
class RunScore:
    recipe: str
    seed: int
    #: Mean rep recall over the classes in that person's takes, per held-out person.
    fold_recall: dict[str, float]
    #: Rep recall per class pooled over every held-out person.
    class_recall: dict[str, float]
    false_alarms_per_minute: float | None
    train_f1: float
    heldout_f1: float

    @property
    def macro_recall(self) -> float:
        return statistics.fmean(self.class_recall.values())

    @property
    def gap(self) -> float:
        return self.train_f1 - self.heldout_f1


@dataclass(frozen=True)
class Verdict:
    accepted: bool
    gain: float
    margin: float
    reasons: list[str] = field(default_factory=list)


def score_run(recipe: str, seed: int, folds: list[FoldReport]) -> RunScore:
    alarms = [f.report.false_alarms_per_minute for f in folds if f.report.false_alarms_per_minute is not None]
    return RunScore(
        recipe=recipe,
        seed=seed,
        fold_recall={f.person: statistics.fmean(f.report.recall.values()) for f in folds if f.report.recall},
        class_recall=pooled_recall(folds),
        false_alarms_per_minute=statistics.fmean(alarms) if alarms else None,
        train_f1=statistics.fmean(f.train_f1 for f in folds),
        heldout_f1=statistics.fmean(f.heldout_f1 for f in folds),
    )


def _mean_by_person(runs: list[RunScore]) -> dict[str, float]:
    people = set.intersection(*(set(r.fold_recall) for r in runs))
    return {p: statistics.fmean(r.fold_recall[p] for r in runs) for p in people}


def decide(baseline: list[RunScore], candidate: list[RunScore], fa_slack: float = FA_SLACK_PER_MIN) -> Verdict:
    """Accept a recipe only if it is better than the baseline by more than luck can explain (see the module docstring)."""
    if len(baseline) < 2:
        raise ValueError("measuring the seed noise needs at least two baseline seeds")
    if not candidate:
        raise ValueError("no candidate runs to judge")
    noise = statistics.stdev(r.macro_recall for r in baseline)  # the sample spread: with two seeds pstdev would be 0.71x too small
    margin = max(NOISE_MULT * noise, MIN_GAIN)
    gain = statistics.fmean(r.macro_recall for r in candidate) - statistics.fmean(r.macro_recall for r in baseline)
    reasons: list[str] = []
    if gain <= margin:
        reasons.append(f"gain {gain:+.3f} does not clear the margin {margin:.3f} ({NOISE_MULT:g} x seed noise {noise:.3f}, floor {MIN_GAIN})")
    baseline_by_seed = {r.seed: r for r in baseline}
    for run in sorted(candidate, key=lambda r: r.seed):
        paired = baseline_by_seed.get(run.seed)
        if paired is not None and run.macro_recall <= paired.macro_recall:
            reasons.append(f"seed {run.seed}: macro recall {run.macro_recall:.3f} is not above the baseline's {paired.macro_recall:.3f}")
    base_people, cand_people = _mean_by_person(baseline), _mean_by_person(candidate)
    shared = sorted(set(base_people) & set(cand_people))
    better = [p for p in shared if cand_people[p] > base_people[p]]
    need = math.ceil(PEOPLE_SHARE * len(shared))
    if len(better) < need:
        reasons.append(f"better for only {len(better)} of {len(shared)} people (needs {need}): {better}")
    base_fa = [r.false_alarms_per_minute for r in baseline if r.false_alarms_per_minute is not None]
    cand_fa = [r.false_alarms_per_minute for r in candidate if r.false_alarms_per_minute is not None]
    if base_fa and cand_fa and statistics.fmean(cand_fa) > statistics.fmean(base_fa) + fa_slack:
        reasons.append(f"more false alarms per minute: {statistics.fmean(cand_fa):.2f} vs {statistics.fmean(base_fa):.2f}")
    base_gap, cand_gap = statistics.fmean(r.gap for r in baseline), statistics.fmean(r.gap for r in candidate)
    if cand_gap > base_gap + GAP_SLACK:
        reasons.append(f"wider train-to-held-out gap: {cand_gap:.3f} vs {base_gap:.3f} (overfitting)")
    return Verdict(not reasons, gain, margin, reasons)


def _load_runs(path: Path) -> tuple[dict, list[RunScore]]:
    saved = json.loads(path.read_text())
    return saved, [RunScore(recipe=saved["name"], **r) for r in saved["runs"]]


def _run_dict(score: RunScore) -> dict:
    d = asdict(score)
    d.pop("recipe")
    return d


def run_recipe(sessions, name: str, recipe: dict, seeds: list[int], epochs: int, device: str, out: Path) -> list[RunScore]:
    """All seeds of one recipe, saved to <out>/results/<name>.json. An identical earlier result is reused."""
    path = out / RESULTS_DIR / f"{name}.json"
    wanted_epochs = int(recipe.get("epochs", epochs))
    if path.exists():
        saved, runs = _load_runs(path)
        if saved["recipe"] == recipe and saved["epochs"] == wanted_epochs and [r.seed for r in runs] == seeds:
            sys.stdout.write(f"{name}: reusing {path}\n")
            return runs
    kwargs = {k: v for k, v in recipe.items() if k not in ("epochs", "snr_reference_db")}
    snr_reference = recipe.get("snr_reference_db")
    runs = []
    set_snr_reference(snr_reference)  # input scaling is a property of the data, not of train(); it applies to this recipe only
    try:
        for seed in seeds:
            started = time.time()
            folds = lopo_reports(sessions, wanted_epochs, device, seed, **kwargs)
            runs.append(score_run(name, seed, folds))
            r = runs[-1]
            sys.stdout.write(
                f"{name} seed {seed}: macro recall {r.macro_recall:.3f}, false alarms/min {r.false_alarms_per_minute}, "
                f"train F1 {r.train_f1:.3f}, held-out F1 {r.heldout_f1:.3f} ({time.time() - started:.0f} s)\n"
            )
            sys.stdout.flush()
    finally:
        set_snr_reference(None)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"name": name, "recipe": recipe, "epochs": wanted_epochs, "runs": [_run_dict(r) for r in runs]}, indent=2) + "\n"
    )
    return runs


def render_summary(results: dict[str, list[RunScore]], fa_slack: float = FA_SLACK_PER_MIN) -> str:
    lines = [
        "# Tuning summary (leave-one-person-out)",
        "",
        f"Accepted only if: gain over the baseline > max({NOISE_MULT:g} x seed noise, {MIN_GAIN}), better for {PEOPLE_SHARE:.0%} of people,",
        f"false alarms/min no more than {fa_slack} per minute above the baseline, train-to-held-out gap no more than {GAP_SLACK} wider.",
        "",
        "| recipe | seeds | macro recall | false alarms/min | train F1 | held-out F1 | gap | verdict |",
        "|---|---|---|---|---|---|---|---|",
    ]
    base = results.get(BASELINE)
    for name, runs in results.items():
        fa_values = [r.false_alarms_per_minute for r in runs if r.false_alarms_per_minute is not None]
        fa = f"{statistics.fmean(fa_values):.2f}" if fa_values else "n/a"
        if name == BASELINE or base is None or len(base) < 2:
            verdict = "baseline" if name == BASELINE else "needs 2 baseline seeds"
        else:
            v = decide(base, runs, fa_slack)
            verdict = f"ACCEPT ({v.gain:+.3f})" if v.accepted else "refuse: " + "; ".join(v.reasons)
        lines.append(
            f"| {name} | {len(runs)} | {statistics.fmean(r.macro_recall for r in runs):.3f} | {fa} |"
            f" {statistics.fmean(r.train_f1 for r in runs):.3f} | {statistics.fmean(r.heldout_f1 for r in runs):.3f} |"
            f" {statistics.fmean(r.gap for r in runs):.3f} | {verdict} |"
        )
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("root", type=Path)
    parser.add_argument("--recipes", type=Path, required=True, help='JSON {"name": {train() settings}}; "baseline" is the reference')
    parser.add_argument("--seeds", type=int, nargs="+", default=[0, 1])
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "experiments")
    parser.add_argument("--device", default=pick_device())
    parser.add_argument("--allow-cpu", action="store_true")
    parser.add_argument("--fa-slack", type=float, default=FA_SLACK_PER_MIN, help="extra false alarms per minute a recipe may have")
    args = parser.parse_args(argv)
    problem = device_problem(args.device, args.allow_cpu)
    if problem:
        sys.stderr.write(problem + "\n")
        return 2
    sessions = usable_sessions(load_corpus(args.root))
    people = {s.person for s in sessions}
    if len(people) < 3:
        sys.stderr.write("tuning needs at least three people\n")
        return 2
    sys.stdout.write(f"tuning on {args.device}, {len(sessions)} takes, {len(people)} people\n")
    for name, recipe in json.loads(args.recipes.read_text()).items():
        run_recipe(sessions, name, recipe, args.seeds, args.epochs, args.device, args.out)
    results = {path.stem: _load_runs(path)[1] for path in sorted((args.out / RESULTS_DIR).glob("*.json"))}
    (args.out / "SUMMARY.md").write_text(render_summary(results, args.fa_slack))
    sys.stdout.write((args.out / "SUMMARY.md").read_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
