import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from calibration import calibration_split, main, replicate, truncate_session
from dataset import windows_of
from synth import make_take, write_take


def with_hand(take, hand: str):
    return replace(take, meta={**take.meta, "hand": hand})


class TestTruncateSession:
    def test_it_keeps_only_the_first_cues_and_cuts_the_audio_after_them(self):
        take = make_take("PUSH", n_cues=8, seed=1)
        short = truncate_session(take, 3)
        assert short.reps == take.reps[:3]
        assert len(short.samples) < len(take.samples)
        assert len(short.samples) >= take.reps[2][1]  # the whole third cue is still there

    def test_asking_for_more_cues_than_the_take_has_changes_nothing(self):
        take = make_take("PUSH", n_cues=4, seed=2)
        assert truncate_session(take, 10) is take

    def test_a_take_without_cues_is_left_alone(self):
        take = make_take("NONE", seed=3)
        assert truncate_session(take, 3) is take

    def test_it_does_not_change_the_original(self):
        take = make_take("WAVE", n_cues=6, seed=4)
        before = (len(take.samples), list(take.reps))
        truncate_session(take, 2)
        assert (len(take.samples), take.reps) == before


def test_replicate_repeats_every_window():
    w = windows_of(make_take("PUSH", n_cues=3, seed=5))
    triple = replicate(w, 3)
    assert len(triple.y) == 3 * len(w.y)
    assert np.array_equal(triple.x[: len(w.y)], w.x)


def test_replicating_once_returns_the_same_windows():
    w = windows_of(make_take("PUSH", n_cues=3, seed=6))
    assert replicate(w, 1) is w


class TestCalibrationSplit:
    def sessions(self):
        return [
            with_hand(make_take("PUSH", person=person, n_cues=3, seed=i), hand)
            for i, (person, hand) in enumerate([("ana", "R"), ("ana", "L"), ("ian", "R"), ("ian", "L")])
        ]

    def test_the_target_person_is_split_by_hand_and_everyone_else_is_the_base(self):
        base, calibration, test = calibration_split(self.sessions(), "ian", "R")
        assert {s.person for s in base} == {"ana"}
        assert [(s.person, s.meta["hand"]) for s in calibration] == [("ian", "R")]
        assert [(s.person, s.meta["hand"]) for s in test] == [("ian", "L")]

    def test_the_other_direction_swaps_the_hands(self):
        _, calibration, test = calibration_split(self.sessions(), "ian", "L")
        assert [s.meta["hand"] for s in calibration] == ["L"] and [s.meta["hand"] for s in test] == ["R"]

    def test_an_unknown_person_is_an_error(self):
        with pytest.raises(ValueError, match="nobody"):
            calibration_split(self.sessions(), "nobody", "R")


def test_the_cli_writes_a_curve_and_a_table(tmp_path: Path):
    root = tmp_path / "rec"
    for person, seed in [("ana", 10), ("bo", 20), ("ian", 30)]:
        for hand, shift in (("R", 0), ("L", 50)):
            folder = root / person / hand
            for i, g in enumerate(["PUSH", "PULL"]):
                write_take(with_hand(make_take(g, person=person, n_cues=4, seed=seed + i + shift), hand), folder)
            write_take(with_hand(make_take("NONE", person=person, seed=seed + 99 + shift), hand), folder)
    out = tmp_path / "out"
    code = main([str(root), "--person", "ian", "--cues", "2", "--epochs", "2", "--seeds", "0", "--out", str(out), "--allow-cpu", "--device", "cpu"])
    assert code == 0
    saved = json.loads((out / "calibration.json").read_text())
    assert saved["person"] == "ian" and {c["name"] for c in saved["conditions"]} >= {"none", "cues2x1"}
    assert {"macro_recall", "false_alarms_per_minute", "class_recall"} <= set(saved["conditions"][0])
    assert "cues2x1" in (out / "CALIBRATION.md").read_text()
