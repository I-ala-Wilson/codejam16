import json
from pathlib import Path

import pytest

from evaluate import EvalReport
from run import FoldReport, load_corpus
from synth import make_take, write_take
from tune import FA_SLACK_PER_MIN, GAP_SLACK, RunScore, decide, main, score_run

PEOPLE = ["a", "b", "c", "d", "e"]


def run(macro_by_person: dict[str, float], fa: float | None = 0.5, train_f1: float = 0.90, heldout_f1: float = 0.80, seed: int = 0) -> RunScore:
    return RunScore(
        recipe="x",
        seed=seed,
        fold_recall=macro_by_person,
        class_recall={"PUSH": sum(macro_by_person.values()) / len(macro_by_person)},
        false_alarms_per_minute=fa,
        train_f1=train_f1,
        heldout_f1=heldout_f1,
    )


def flat(value: float, **kw) -> RunScore:
    return run({p: value for p in PEOPLE}, **kw)


BASELINE = [flat(0.70, seed=0), flat(0.71, seed=1)]  # noise (std of the macro recall) is 0.005, below the 0.01 floor


class TestDecide:
    def test_a_clear_improvement_everywhere_is_accepted(self):
        verdict = decide(BASELINE, [flat(0.76)])
        assert verdict.accepted, verdict.reasons

    def test_an_improvement_inside_the_noise_is_refused(self):
        verdict = decide(BASELINE, [flat(0.712)])
        assert not verdict.accepted and any("noise" in r or "margin" in r for r in verdict.reasons)

    def test_the_margin_scales_with_the_measured_seed_noise(self):
        noisy_base = [flat(0.60, seed=0), flat(0.70, seed=1)]  # std 0.05 -> needs a gain over 0.10
        assert not decide(noisy_base, [flat(0.72)]).accepted
        assert decide(noisy_base, [flat(0.80)]).accepted

    def test_a_gain_carried_by_one_person_is_refused(self):
        lucky = run({"a": 0.99, "b": 0.70, "c": 0.70, "d": 0.70, "e": 0.70})  # mean 0.758 but only 1 of 5 people improved
        verdict = decide(BASELINE, [lucky])
        assert not verdict.accepted and any("people" in r for r in verdict.reasons)

    def test_more_false_alarms_are_refused_even_with_better_recall(self):
        verdict = decide(BASELINE, [flat(0.80, fa=0.5 + FA_SLACK_PER_MIN + 0.5)])
        assert not verdict.accepted and any("false alarm" in r for r in verdict.reasons)

    def test_a_wider_train_to_heldout_gap_is_refused_even_with_better_recall(self):
        verdict = decide(BASELINE, [flat(0.80, train_f1=0.99, heldout_f1=0.80)])  # gap 0.19 vs the baseline's 0.10
        assert not verdict.accepted and any("gap" in r for r in verdict.reasons)

    def test_a_gap_that_only_wobbles_is_fine(self):
        assert decide(BASELINE, [flat(0.80, train_f1=0.90 + GAP_SLACK / 2)]).accepted

    def test_the_noise_is_the_sample_spread_of_the_seeds_not_the_biased_population_one(self):
        wobbly = [flat(0.60, seed=0), flat(0.62, seed=1)]  # sample sd 0.0141 -> margin 0.0283 (the population sd would give 0.02)
        assert not decide(wobbly, [flat(0.61 + 0.025)]).accepted
        assert decide(wobbly, [flat(0.61 + 0.035)]).accepted

    def test_an_empty_candidate_list_is_an_error(self):
        with pytest.raises(ValueError, match="candidate"):
            decide(BASELINE, [])

    def test_it_needs_two_baseline_seeds_to_measure_the_noise(self):
        with pytest.raises(ValueError, match="two"):
            decide(BASELINE[:1], [flat(0.9)])

    def test_missing_false_alarm_data_does_not_block(self):
        assert decide([flat(0.70, fa=None, seed=0), flat(0.71, fa=None, seed=1)], [flat(0.80, fa=None)]).accepted

    def test_several_candidate_seeds_are_averaged(self):
        verdict = decide(BASELINE, [flat(0.74, seed=0), flat(0.78, seed=1)])
        assert verdict.accepted and verdict.gain == pytest.approx(0.76 - 0.705)


def test_score_run_summarises_the_folds():
    def fold(person: str, push: float, wave: float) -> FoldReport:
        report = EvalReport(
            n_reps={"PUSH": 10, "WAVE": 10},
            recall={"PUSH": push, "WAVE": wave},
            confusion={},
            false_alarms_per_minute=1.0,
            stray_events=0,
        )
        return FoldReport(person, report, 1000, train_f1=0.9, heldout_f1=0.7)

    score = score_run("r", 3, [fold("a", 0.8, 0.6), fold("b", 0.6, 0.4)])
    assert score.fold_recall == {"a": pytest.approx(0.7), "b": pytest.approx(0.5)}
    assert score.class_recall == {"PUSH": pytest.approx(0.7), "WAVE": pytest.approx(0.5)}
    assert score.macro_recall == pytest.approx(0.6)
    assert score.false_alarms_per_minute == pytest.approx(1.0)
    assert (score.train_f1, score.heldout_f1) == (pytest.approx(0.9), pytest.approx(0.7))


def test_the_cli_runs_recipes_and_writes_one_result_file_each(tmp_path: Path):
    root = tmp_path / "rec"
    for person, seed in [("ana", 10), ("bo", 20), ("cy", 30)]:
        for i, g in enumerate(["PUSH", "PULL", "WAVE"]):
            write_take(make_take(g, person=person, n_cues=4, seed=seed + i), root / person)
        write_take(make_take("NONE", person=person, seed=seed + 99), root / person)
    out = tmp_path / "out"
    out.mkdir()
    recipes = out / "recipes.json"  # recipe files live next to the results and must not be mistaken for one
    recipes.write_text(json.dumps({"baseline": {}, "tight": {"dropout": 0.4, "weight_decay": 0.05}}))
    code = main([str(root), "--recipes", str(recipes), "--seeds", "0", "1", "--epochs", "2", "--out", str(out), "--allow-cpu", "--device", "cpu"])
    assert code == 0
    saved = json.loads((out / "results" / "tight.json").read_text())
    assert [r["seed"] for r in saved["runs"]] == [0, 1] and saved["recipe"] == {"dropout": 0.4, "weight_decay": 0.05}
    assert {"fold_recall", "class_recall", "train_f1", "heldout_f1"} <= set(saved["runs"][0])
    assert (out / "SUMMARY.md").exists() and "tight" in (out / "SUMMARY.md").read_text()
    assert load_corpus(root)  # the corpus is untouched
