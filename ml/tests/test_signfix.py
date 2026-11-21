import json
from pathlib import Path

import numpy as np
import pytest

from evaluate import Event
from signfix import SIGN_MIN_HZ, SIGN_WINDOW_S, apply_sign_override, load_shifts, sign_class

T = np.arange(0.0, 5.0, 0.1)


def shifts(**peaks: float) -> np.ndarray:
    """Zero shift everywhere except the given {time: Hz} spikes (keys like t2_0 mean 2.0 s)."""
    out = np.zeros_like(T)
    for key, hz in peaks.items():
        out[int(round(float(key[1:].replace("_", ".")) * 10))] = hz
    return out


class TestSignClass:
    def test_a_strong_positive_shift_just_before_the_event_is_a_push(self):
        assert sign_class(T, shifts(t2_0=120.0), 2.3) == "PUSH"

    def test_a_strong_negative_shift_is_a_pull(self):
        assert sign_class(T, shifts(t2_0=-120.0), 2.3) == "PULL"

    def test_the_largest_magnitude_wins_over_a_weaker_opposite_stroke(self):
        assert sign_class(T, shifts(t1_6=-60.0, t2_0=140.0), 2.3) == "PUSH"  # a recoil before the push does not decide it

    def test_a_shift_older_than_the_window_is_ignored(self):
        assert sign_class(T, shifts(t0_5=150.0), 0.5 + SIGN_WINDOW_S + 0.3) is None

    def test_a_shift_after_the_event_is_ignored(self):
        assert sign_class(T, shifts(t3_0=150.0), 2.3) is None

    def test_a_weak_shift_does_not_decide(self):
        assert sign_class(T, shifts(t2_0=SIGN_MIN_HZ - 1), 2.3) is None

    def test_no_frames_is_none(self):
        assert sign_class(np.array([]), np.array([]), 1.0) is None


class TestApplyOverride:
    def test_a_push_event_becomes_a_pull_when_the_doppler_says_away(self):
        events = [Event("PUSH", 2.3)]
        assert apply_sign_override(events, T, shifts(t2_0=-130.0)) == [Event("PULL", 2.3)]

    def test_a_correct_class_is_kept(self):
        assert apply_sign_override([Event("PUSH", 2.3)], T, shifts(t2_0=130.0)) == [Event("PUSH", 2.3)]

    def test_other_classes_are_never_touched(self):
        events = [Event("WAVE", 2.3), Event("UNDO", 3.0), Event("OPEN_CLOSE", 4.0), Event("REPETITIVE", 4.5)]
        assert apply_sign_override(events, T, shifts(t2_0=-130.0)) == events

    def test_the_number_and_times_of_events_never_change(self):
        events = [Event("PUSH", 1.5), Event("PULL", 2.3), Event("PUSH", 4.0)]
        out = apply_sign_override(events, T, shifts(t1_2=90.0, t2_0=-90.0))
        assert [e.t_s for e in out] == [e.t_s for e in events] and len(out) == 3

    def test_without_a_decisive_shift_the_classifier_keeps_its_class(self):
        assert apply_sign_override([Event("PULL", 2.3)], T, np.zeros_like(T)) == [Event("PULL", 2.3)]


def test_load_shifts_reads_the_cache_file_named_after_the_person_and_take(tmp_path: Path):
    (tmp_path / "ana__take1.json").write_text(json.dumps({"t": [0.0, 0.1], "shift": [0.0, 80.0]}))
    t, shift = load_shifts(tmp_path, "ana", "take1")
    assert t.tolist() == [0.0, 0.1] and shift.tolist() == [0.0, 80.0]


def test_a_missing_cache_file_is_a_clear_error(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="shift cache"):
        load_shifts(tmp_path, "ana", "nope")
