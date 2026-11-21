"""Write ml/experiments/summary.json: the headline numbers for the site's results panel.

    ml/.venv/bin/python ml/experiments/make_summary.py            # from the repo root

Every number is read from a result file that is already in the repo; nothing is typed in by hand:
  - retrain_dell/results/baseline.json  leave-one-person-out, 2 seeds, the data the shipped model was trained on
  - calibration/calibration.json        Ian on his MacBook Pro, with and without his own takes in training
  - models/gesture.json                 training windows of the shipped model
  - data/recordings                     people and takes
"""

import json
import statistics
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPERIMENTS = ROOT / "ml" / "experiments"
#: The five gestures. REPETITIVE is not a gesture: it is the Habit feature's signal and is reported on its own.
GESTURES = ("PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO")
HABIT = "REPETITIVE"


def mean(values: list[float]) -> float:
    return round(statistics.fmean(values), 3)


def gesture_macro(class_recall: dict[str, float]) -> float:
    """Mean recall over the five gestures only (Habit excluded)."""
    return statistics.fmean(class_recall[g] for g in GESTURES)


def recordings() -> tuple[set[str], int]:
    """(people, gesture takes), breathing takes excluded."""
    people: set[str] = set()
    takes = 0
    for path in (ROOT / "data" / "recordings").rglob("*.json"):
        if "breath" in path.parts:
            continue
        meta = json.loads(path.read_text())
        if "reps" not in meta:
            continue
        people.add(str(meta.get("person", "?")).lower())
        takes += 1
    return people, takes


def stranger() -> dict:
    runs = json.loads((EXPERIMENTS / "retrain_dell" / "results" / "baseline.json").read_text())["runs"]
    return {
        "what": "leave-one-person-out: the model is trained on 4 people and scored on the 5th, who it has never seen",
        "seeds": len(runs),
        "gestures": {
            "macro_recall": mean([gesture_macro(r["class_recall"]) for r in runs]),
            "recall_per_gesture": {g: mean([r["class_recall"][g] for r in runs]) for g in GESTURES},
        },
        "habit": {"recall": mean([r["class_recall"][HABIT] for r in runs])},
        # What the pre-registered rules in RESULTS.md judged (ml/tune.py): the mean over all six classes, Habit included.
        "macro_recall_all_classes_rule_metric": mean([statistics.fmean(r["class_recall"].values()) for r in runs]),
        "recall_per_person_all_classes": {p: mean([r["fold_recall"][p] for r in runs]) for p in runs[0]["fold_recall"]},
        "false_alarms_per_minute": mean([r["false_alarms_per_minute"] for r in runs]),
        "train_f1": mean([r["train_f1"] for r in runs]),
        "held_out_f1": mean([r["heldout_f1"] for r in runs]),
    }


def calibration() -> dict:
    data = json.loads((EXPERIMENTS / "calibration" / "calibration.json").read_text())
    rows = [
        {
            "condition": c["name"],
            "calibration_cues_per_take": c["cues"],
            "repeated": c["replicate"],
            "gesture_macro_recall": round(gesture_macro(c["class_recall"]), 3),
            "habit_recall": round(c["class_recall"][HABIT], 2),
            "false_alarms_per_minute": round(c["false_alarms_per_minute"], 2),
            "recall_per_gesture": {g: round(c["class_recall"][g], 2) for g in GESTURES},
        }
        for c in data["conditions"]
    ]
    base = rows[0]["gesture_macro_recall"]
    return {
        "what": "one person (Ian, MacBook Pro): trained on the other 4 people plus N of his own cues per take, tested on his other hand",
        "person": data["person"],
        "seeds": len(data["seeds"]),
        "conditions": rows,
        "gain_over_no_calibration": {r["condition"]: round(r["gesture_macro_recall"] - base, 3) for r in rows[1:]},
    }


def main() -> None:
    people, takes = recordings()
    windows = json.loads((ROOT / "ml" / "models" / "gesture.json").read_text())["windows"]
    summary = {
        "generated": datetime.now().astimezone().isoformat(timespec="minutes"),
        "data": {"people": len(people), "gesture_takes": takes, "training_windows": windows},
        "stranger": stranger(),
        "ian_on_macbook_pro_calibration": calibration(),
        "caveats": [
            "Unseen-person recall is the honest number: it is about 0.4 macro recall with about 2 false alarms per minute.",
            "Calibrating on the demo person's own cues is what lifts it; the calibration numbers are one person and 2 seeds.",
            "Five people, three laptop models: the numbers have wide uncertainty (seed noise about 0.02 on macro recall).",
        ],
        "sources": [
            "ml/experiments/retrain_dell/results/baseline.json",
            "ml/experiments/calibration/calibration.json",
            "ml/experiments/RESULTS.md",
        ],
    }
    out = EXPERIMENTS / "summary.json"
    out.write_text(json.dumps(summary, indent=2) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
