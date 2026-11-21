"""Doppler-sign override for PUSH vs PULL (ml/experiments/RESULTS.md, round 3b; the rule was fixed before it was run).

    node --experimental-strip-types <shifts.ts> data/recordings <cache>      # the engine's per-frame shiftHz for every take
    ml/.venv/bin/python ml/signfix.py data/recordings --cache <cache>

The CNN finds that a push or pull happened but often gets the direction wrong. The Doppler sign of the engine's frames
knows the direction, so when the classifier fires PUSH or PULL the class is set by the sign of the largest |shiftHz| in
the last SIGN_WINDOW_S seconds. Event times and counts never change, so false alarms per minute are unchanged.
"""

import argparse
import json
import statistics
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

from data import Session
from evaluate import DEFAULT_THRESHOLDS, EvalReport, Event, evaluate_takes
from run import FoldReport, device_problem, load_corpus, pooled_recall, usable_sessions
from sweep import lopo_streams
from train import pick_device

#: The class is decided by the strongest frame in this many seconds before the event.
SIGN_WINDOW_S = 1.0
#: Below this |shiftHz| the sign is not trusted and the classifier's class stays (the rule detector's minimum stroke peak).
SIGN_MIN_HZ = 45.0
#: Pre-registered acceptance: macro recall gain on EVERY seed, and PUSH and PULL recall not lower.
MIN_MACRO_GAIN = 0.02


def sign_class(shift_t: np.ndarray, shift_hz: np.ndarray, t_s: float) -> str | None:
    """PUSH or PULL from the largest-magnitude shift among the frames in (t_s - SIGN_WINDOW_S, t_s]; None if not decisive."""
    inside = (shift_t > t_s - SIGN_WINDOW_S) & (shift_t <= t_s)
    if not inside.any():
        return None
    window = shift_hz[inside]
    peak = window[np.argmax(np.abs(window))]
    if abs(peak) < SIGN_MIN_HZ:
        return None
    return "PUSH" if peak > 0 else "PULL"


def apply_sign_override(events: list[Event], shift_t: np.ndarray, shift_hz: np.ndarray) -> list[Event]:
    """The same events with each PUSH or PULL relabelled by the Doppler sign when that is decisive."""
    out = []
    for event in events:
        if event.cls in ("PUSH", "PULL"):
            event = replace(event, cls=sign_class(shift_t, shift_hz, event.t_s) or event.cls)
        out.append(event)
    return out


def load_shifts(cache: Path, person: str, name: str) -> tuple[np.ndarray, np.ndarray]:
    path = cache / f"{person}__{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"no shift cache for {person}/{name}: expected {path}")
    saved = json.loads(path.read_text())
    return np.array(saved["t"]), np.array(saved["shift"])


def _summary(reports: list[EvalReport]) -> dict:
    classes = pooled_recall([FoldReport("x", r, 0) for r in reports])
    alarms = [r.false_alarms_per_minute for r in reports if r.false_alarms_per_minute is not None]
    confusion: dict[str, dict[str, int]] = {}
    for report in reports:
        for label, row in report.confusion.items():
            for said, n in row.items():
                confusion.setdefault(label, {})[said] = confusion.get(label, {}).get(said, 0) + n
    return {
        "macro_recall": statistics.fmean(classes.values()),
        "class_recall": classes,
        "false_alarms_per_minute": statistics.fmean(alarms) if alarms else None,
        "push_as_pull": confusion.get("PUSH", {}).get("PULL", 0),
        "pull_as_push": confusion.get("PULL", {}).get("PUSH", 0),
    }


def accepted(results: list[dict]) -> tuple[bool, list[str]]:
    """The pre-registered rule over every seed's plain and overridden summaries."""
    reasons = []
    for r in results:
        plain, sign = r["plain"], r["sign"]
        gain = sign["macro_recall"] - plain["macro_recall"]
        if gain <= MIN_MACRO_GAIN:
            reasons.append(f"seed {r['seed']}: macro recall gain {gain:+.3f} does not clear {MIN_MACRO_GAIN}")
        for label in ("PUSH", "PULL"):
            if sign["class_recall"].get(label, 0.0) < plain["class_recall"].get(label, 0.0):
                reasons.append(f"seed {r['seed']}: {label} recall is lower with the override")
    return not reasons, reasons


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("root", type=Path)
    parser.add_argument("--cache", type=Path, required=True, help="folder of <person>__<take>.json shift files")
    parser.add_argument("--seeds", type=int, nargs="+", default=[0, 1])
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "experiments" / "round3" / "sign")
    parser.add_argument("--device", default=pick_device())
    parser.add_argument("--allow-cpu", action="store_true")
    args = parser.parse_args(argv)
    problem = device_problem(args.device, args.allow_cpu)
    if problem:
        sys.stderr.write(problem + "\n")
        return 2
    sessions: list[Session] = usable_sessions(load_corpus(args.root))
    shifts = {(s.person, s.name): load_shifts(args.cache, s.person, s.name) for s in sessions}

    def rewrite(session: Session, events: list[Event]) -> list[Event]:
        return apply_sign_override(events, *shifts[(session.person, session.name)])

    results = []
    for seed in args.seeds:
        plain_reports, sign_reports = [], []
        for fold in lopo_streams(sessions, args.epochs, args.device, seed):
            plain_reports.append(evaluate_takes(None, fold.sessions, args.device, DEFAULT_THRESHOLDS, fold.streams))
            sign_reports.append(evaluate_takes(None, fold.sessions, args.device, DEFAULT_THRESHOLDS, fold.streams, rewrite=rewrite))
        results.append({"seed": seed, "plain": _summary(plain_reports), "sign": _summary(sign_reports)})
        sys.stdout.write(f"seed {seed}: macro recall {results[-1]['plain']['macro_recall']:.3f} -> {results[-1]['sign']['macro_recall']:.3f}\n")
        sys.stdout.flush()
    ok, reasons = accepted(results)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "sign.json").write_text(json.dumps({"accepted": ok, "reasons": reasons, "seeds": results}, indent=2) + "\n")
    verdict = "ACCEPT" if ok else "REFUSE - " + "; ".join(reasons)
    lines = ["# Doppler-sign override (leave-one-person-out, default thresholds)", "", f"Verdict: {verdict}", ""]
    classes = sorted(results[0]["plain"]["class_recall"])
    lines += [
        "| seed | variant | macro recall | false alarms/min | PUSH as PULL | PULL as PUSH | " + " | ".join(classes) + " |",
        "|---|---|---|---|---|---|" + "---|" * len(classes),
    ]
    for r in results:
        for variant in ("plain", "sign"):
            s = r[variant]
            fa = "n/a" if s["false_alarms_per_minute"] is None else f"{s['false_alarms_per_minute']:.2f}"
            recalls = " | ".join(f"{s['class_recall'].get(c, float('nan')):.2f}" for c in classes)
            lines.append(f"| {r['seed']} | {variant} | {s['macro_recall']:.3f} | {fa} | {s['push_as_pull']} | {s['pull_as_push']} | {recalls} |")
    (args.out / "SIGN.md").write_text("\n".join(lines) + "\n")
    sys.stdout.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
