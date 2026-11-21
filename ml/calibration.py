"""How much does one person's own data help? The demo runs on one known laptop, so a short calibration might be worth it.

    ml/.venv/bin/python ml/calibration.py data/recordings --person i-ala-wilson

The person recorded two sessions, one with each hand. Train on everyone else plus the first few cues of every take of one
hand's session, then test on the other hand's session (both directions, averaged), and compare with training on everyone
else only. `x5` means the person's windows are repeated 5 times, which is what a fine-tune on their data would emphasise.
"""

import argparse
import json
import statistics
import sys
import time
from dataclasses import replace
from pathlib import Path

from data import Session
from dataset import concat
from evaluate import EvalReport, evaluate_takes
from run import FoldReport, _windows, device_problem, load_corpus, pooled_recall, replicate, usable_sessions
from train import pick_device, train

#: Audio kept after the last cue of a truncated take (a cue's tone is still decaying and the decoder needs the tail).
TAIL_S = 1.0
HANDS = ("R", "L")


def truncate_session(session: Session, max_reps: int) -> Session:
    """The first `max_reps` cues of a take and the audio up to just after them; takes without that many cues are unchanged."""
    if not session.reps or len(session.reps) <= max_reps:
        return session
    kept = session.reps[:max_reps]
    end = kept[-1][1] + int(TAIL_S * session.sample_rate)
    return replace(session, samples=session.samples[:end], reps=kept)


def calibration_split(sessions: list[Session], person: str, calibration_hand: str) -> tuple[list[Session], list[Session], list[Session]]:
    """(everyone else, the person's takes with `calibration_hand`, the person's takes with the other hand)."""
    mine = [s for s in sessions if s.person == person]
    if not mine:
        raise ValueError(f"no takes for {person}")
    base = [s for s in sessions if s.person != person]
    calibration = [s for s in mine if s.meta.get("hand") == calibration_hand]
    test = [s for s in mine if s.meta.get("hand") != calibration_hand]
    return base, calibration, test


def _summary(reports: list[EvalReport]) -> dict:
    """Pooled per-class recall over the reports, their mean as the macro recall, and the mean false-alarm rate."""
    folds = [FoldReport("x", r, 0) for r in reports]
    classes = pooled_recall(folds)
    alarms = [r.false_alarms_per_minute for r in reports if r.false_alarms_per_minute is not None]
    return {
        "macro_recall": statistics.fmean(classes.values()),
        "class_recall": classes,
        "false_alarms_per_minute": statistics.fmean(alarms) if alarms else None,
    }


def run_condition(base, calibration, test, cues: int, factor: int, epochs: int, device: str, seed: int) -> EvalReport:
    parts = [_windows(base)]
    if cues:
        parts.append(replicate(_windows([truncate_session(s, cues) for s in calibration]), factor))
    model = train(concat(parts), None, epochs=epochs, device=device, seed=seed).model
    return evaluate_takes(model, test, device)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("root", type=Path)
    parser.add_argument("--person", required=True)
    parser.add_argument("--cues", type=int, nargs="+", default=[5, 20], help="cues per take used for calibration")
    parser.add_argument("--replicate", type=int, nargs="+", default=[1, 5])
    parser.add_argument("--seeds", type=int, nargs="+", default=[0, 1])
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "experiments" / "calibration")
    parser.add_argument("--device", default=pick_device())
    parser.add_argument("--allow-cpu", action="store_true")
    args = parser.parse_args(argv)
    problem = device_problem(args.device, args.allow_cpu)
    if problem:
        sys.stderr.write(problem + "\n")
        return 2
    sessions = usable_sessions(load_corpus(args.root))
    splits = {hand: calibration_split(sessions, args.person, hand) for hand in HANDS}
    for hand, (_, calibration, test) in splits.items():
        if not calibration or not test:
            sys.stderr.write(f"{args.person} needs takes with both hands (calibration {hand}: {len(calibration)}, test: {len(test)})\n")
            return 2
    conditions: dict[str, list[EvalReport]] = {}
    started = time.time()
    for seed in args.seeds:
        base = splits["R"][0]
        # no calibration: one model trained on everyone else, tested on each hand's session of the person
        for hand in HANDS:
            conditions.setdefault("none", []).append(run_condition(base, [], splits[hand][2], 0, 1, args.epochs, args.device, seed))
        for cues in args.cues:
            for factor in args.replicate:
                for hand in HANDS:
                    base, calibration, test = splits[hand]
                    report = run_condition(base, calibration, test, cues, factor, args.epochs, args.device, seed)
                    conditions.setdefault(f"cues{cues}x{factor}", []).append(report)
        sys.stdout.write(f"seed {seed} done ({time.time() - started:.0f} s)\n")
        sys.stdout.flush()
    results = []
    for name, reports in conditions.items():
        cues, factor = (0, 1) if name == "none" else (int(name[4:].split("x")[0]), int(name.split("x")[1]))
        results.append({"name": name, "cues": cues, "replicate": factor, **_summary(reports)})
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "calibration.json").write_text(json.dumps({"person": args.person, "seeds": args.seeds, "conditions": results}, indent=2) + "\n")
    classes = sorted({c for r in results for c in r["class_recall"]})
    lines = [
        f"# Calibration on {args.person}'s own data (train on everyone else + first N cues of one hand, test on the other hand)",
        "",
        "| condition | macro recall | false alarms/min | " + " | ".join(classes) + " |",
        "|---|---|---|" + "---|" * len(classes),
    ]
    for r in results:
        fa = "n/a" if r["false_alarms_per_minute"] is None else f"{r['false_alarms_per_minute']:.2f}"
        lines.append(f"| {r['name']} | {r['macro_recall']:.3f} | {fa} | " + " | ".join(f"{r['class_recall'].get(c, float('nan')):.2f}" for c in classes) + " |")
    (args.out / "CALIBRATION.md").write_text("\n".join(lines) + "\n")
    sys.stdout.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
