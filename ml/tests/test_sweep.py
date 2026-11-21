import json
from pathlib import Path

import pytest

from synth import make_take, write_take
from sweep import SweepPoint, recall_at_false_alarms, thresholds_for, main


def point(threshold: float, recall: float, fa: float | None) -> SweepPoint:
    return SweepPoint(threshold=threshold, macro_recall=recall, false_alarms_per_minute=fa, fold_recall={})


CURVE = [point(0.6, 0.60, 6.0), point(0.7, 0.55, 4.0), point(0.8, 0.50, 2.0), point(0.9, 0.30, 0.5)]


class TestRecallAtFalseAlarms:
    def test_it_interpolates_between_the_two_points_around_the_target(self):
        assert recall_at_false_alarms(CURVE, 3.0) == pytest.approx(0.525)  # halfway between (4.0, 0.55) and (2.0, 0.50)

    def test_a_target_equal_to_a_point_returns_that_points_recall(self):
        assert recall_at_false_alarms(CURVE, 2.0) == pytest.approx(0.50)

    def test_a_target_above_every_point_returns_the_most_permissive_recall(self):
        assert recall_at_false_alarms(CURVE, 20.0) == pytest.approx(0.60)

    def test_a_target_the_model_never_reaches_is_none(self):
        assert recall_at_false_alarms(CURVE, 0.1) is None

    def test_it_ignores_points_without_a_false_alarm_rate(self):
        assert recall_at_false_alarms([point(0.8, 0.5, None)], 2.0) is None

    def test_the_order_of_the_points_does_not_matter(self):
        assert recall_at_false_alarms(list(reversed(CURVE)), 3.0) == pytest.approx(0.525)


def test_one_threshold_applies_to_every_gesture_and_the_habit_class_stays_a_little_stricter():
    t = thresholds_for(0.7)
    assert t["PUSH"] == t["PULL"] == t["WAVE"] == t["OPEN_CLOSE"] == t["UNDO"] == 0.7
    assert t["REPETITIVE"] == pytest.approx(0.75)
    assert thresholds_for(0.97)["REPETITIVE"] <= 0.99


def test_the_cli_writes_one_curve_per_recipe_and_a_table(tmp_path: Path):
    root = tmp_path / "rec"
    for person, seed in [("ana", 10), ("bo", 20), ("cy", 30)]:
        for i, g in enumerate(["PUSH", "PULL", "WAVE"]):
            write_take(make_take(g, person=person, n_cues=4, seed=seed + i), root / person)
        write_take(make_take("NONE", person=person, seed=seed + 99), root / person)
    out = tmp_path / "out"
    out.mkdir()
    recipes = out / "recipes.json"
    recipes.write_text(json.dumps({"base": {}, "tight": {"dropout": 0.4}}))
    code = main([str(root), "--recipes", str(recipes), "--epochs", "2", "--out", str(out), "--allow-cpu", "--device", "cpu"])
    assert code == 0
    saved = json.loads((out / "sweeps" / "tight.json").read_text())
    assert saved["recipe"] == {"dropout": 0.4} and len(saved["curve"]) >= 5
    assert {"threshold", "macro_recall", "false_alarms_per_minute", "fold_recall"} <= set(saved["curve"][0])
    table = (out / "SWEEP.md").read_text()
    assert "base" in table and "tight" in table and "recall at" in table
    assert "at the default threshold (0.85)" in table  # the shipped operating point, not an old 0.8
