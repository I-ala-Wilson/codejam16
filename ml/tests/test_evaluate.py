import numpy as np
import pytest

from dataset import CLASSES, CLASS_INDEX, concat, session_windows
from evaluate import DEFAULT_THRESHOLDS, Event, decode_events, evaluate_takes, stream_probs
from synth import make_take
from train import pick_device, train

DT = 0.085  # one evaluation every 4 frames, about 85 ms


def probs_for(plan: list[tuple[str, int]]) -> tuple[np.ndarray, np.ndarray]:
    """plan: (class name, number of evaluations) pieces; the named class gets 0.9, the rest share 0.1."""
    rows = []
    for name, n in plan:
        row = np.full(len(CLASSES), 0.1 / (len(CLASSES) - 1))
        row[CLASS_INDEX[name]] = 0.9
        rows.extend([row] * n)
    probs = np.array(rows)
    return probs, np.arange(len(probs)) * DT


def kinds(events: list[Event]) -> list[str]:
    return [e.cls for e in events]


class TestDecode:
    def test_a_confident_run_fires_once_on_its_fourth_evaluation(self):
        # smoothing over 3 evaluations needs 3 confident ones to clear 0.7, and 2 in a row are needed to confirm
        probs, times = probs_for([("NONE", 10), ("PUSH", 6), ("NONE", 10)])
        events = decode_events(probs, times)
        assert kinds(events) == ["PUSH"]
        assert events[0].t_s == pytest.approx(times[13], abs=1e-9)

    def test_a_single_evaluation_blip_does_not_fire(self):
        probs, times = probs_for([("NONE", 10), ("PUSH", 1), ("NONE", 10)])
        assert decode_events(probs, times) == []

    def test_a_probability_below_the_class_threshold_does_not_fire(self):
        probs, times = probs_for([("NONE", 5), ("PULL", 8), ("NONE", 5)])
        strict = {**DEFAULT_THRESHOLDS, "PULL": 0.95}
        assert decode_events(probs, times, thresholds=strict) == []

    def test_two_pushes_further_apart_than_the_refractory_both_fire(self):
        probs, times = probs_for([("PUSH", 5), ("NONE", 20), ("PUSH", 5), ("NONE", 5)])
        assert kinds(decode_events(probs, times)) == ["PUSH", "PUSH"]

    def test_a_short_second_push_inside_the_refractory_is_swallowed(self):
        probs, times = probs_for([("PUSH", 5), ("NONE", 2), ("PUSH", 3), ("NONE", 20)])
        assert kinds(decode_events(probs, times)) == ["PUSH"]

    def test_a_long_push_fires_again_once_the_refractory_has_passed(self):
        probs, times = probs_for([("PUSH", 30), ("NONE", 10)])
        events = decode_events(probs, times)
        assert len(events) >= 3 and set(kinds(events)) == {"PUSH"}
        gaps = np.diff([e.t_s for e in events])
        assert np.all(gaps >= 0.6)  # never closer together than the refractory

    def test_a_wave_holds_off_the_strokes_that_follow_it(self):
        probs, times = probs_for([("WAVE", 5), ("NONE", 2), ("PUSH", 5), ("NONE", 20)])
        assert kinds(decode_events(probs, times)) == ["WAVE"]

    def test_none_never_fires(self):
        probs, times = probs_for([("NONE", 50)])
        assert decode_events(probs, times) == []


@pytest.fixture(scope="module")
def trained():
    gestures = ["PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO"]
    parts = []
    for person, seed in [("ana", 10), ("bo", 20)]:
        takes = [make_take(g, person=person, n_cues=6, seed=seed + i) for i, g in enumerate(gestures)]
        takes.append(make_take("NONE", person=person, seed=seed + 99))
        parts.extend(session_windows(t) for t in takes)
    return train(concat(parts), None, epochs=14, device=pick_device(), seed=0).model


class TestStreaming:
    def test_probabilities_and_times_line_up_with_the_take(self, trained):
        take = make_take("PUSH", person="cy", n_cues=3, seed=50)
        probs, times = stream_probs(trained, take, pick_device())
        assert probs.shape == (len(times), 6) and len(times) > 20
        assert np.all(np.diff(times) > 0) and times[0] > 0.5  # the first window ends after about 1 s

    def test_held_out_synthetic_takes_are_recalled_and_a_none_take_stays_quiet(self, trained):
        takes = [make_take(g, person="cy", n_cues=6, seed=60 + i) for i, g in enumerate(["PUSH", "PULL", "WAVE", "UNDO"])]
        takes.append(make_take("NONE", person="cy", seed=70))
        report = evaluate_takes(trained, takes, pick_device())
        for label in ["PUSH", "PULL", "WAVE", "UNDO"]:
            assert report.recall[label] >= 0.8, (label, report.recall)
        assert report.false_alarms_per_minute < 1.0
        assert set(report.confusion) >= {"PUSH", "PULL", "WAVE", "UNDO"}
