import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from dataset import concat, windows_of
from run import (
    calib_windows,
    cue_counts,
    failed_audits,
    is_calibration_path,
    load_corpus_and_calibration,
    main,
    replicate,
)
from synth import make_take, write_take

GESTURES = ["PUSH", "PULL", "WAVE"]


def still(take):
    """The same take with the hand never moving: every cue window is empty, so the audit fails it."""
    t = np.arange(take.samples.size) / take.sample_rate
    return replace(take, samples=(10 ** (-36 / 20) * np.sin(2 * np.pi * take.tone_hz * t)).astype(np.float32))


@pytest.fixture()
def root(tmp_path: Path) -> Path:
    for person, seed in [("ana", 10), ("bo", 20)]:
        for i, g in enumerate(GESTURES):
            write_take(make_take(g, person=person, n_cues=5, seed=seed + i), tmp_path / person)
        write_take(make_take("NONE", person=person, seed=seed + 99), tmp_path / person)
    for i, g in enumerate(["PUSH", "WAVE"]):
        write_take(make_take(g, person="ana", n_cues=3, seed=50 + i), tmp_path / "ana" / "calib-1")
    write_take(make_take("PULL", person="bo", n_cues=3, seed=60), tmp_path / "bo" / "calib-1")  # someone else's
    return tmp_path


def test_only_folders_starting_with_calib_dash_count_as_calibration(tmp_path: Path):
    assert is_calibration_path(tmp_path / "ana" / "calib-1" / "t.json", tmp_path)
    assert is_calibration_path(tmp_path / "ana" / "calib-demo" / "x" / "t.json", tmp_path)
    assert not is_calibration_path(tmp_path / "ana" / "t.json", tmp_path)
    assert not is_calibration_path(tmp_path / "ana" / "recalib-1" / "t.json", tmp_path)
    assert not is_calibration_path(tmp_path / "calib-1.json", tmp_path)  # the file name does not count


def test_it_finds_that_persons_calibration_takes_and_keeps_everything_in_the_corpus(root: Path):
    sessions, calibration = load_corpus_and_calibration(root, "ANA")  # the login is case-insensitive
    assert len(sessions) == 8 + 2 + 1
    assert sorted(s.gesture for s in calibration) == ["PUSH", "WAVE"]
    assert {s.person for s in calibration} == {"ana"}
    assert cue_counts(calibration) == {"PUSH": 3, "WAVE": 3}


def test_a_person_without_calibration_takes_gets_an_empty_list(root: Path):
    assert load_corpus_and_calibration(root, "nobody")[1] == []


def test_good_takes_pass_the_audit_and_an_empty_take_fails_it():
    good, bad = make_take("PUSH", n_cues=5, seed=1), still(make_take("PUSH", n_cues=5, seed=2))
    assert failed_audits([good]) == []
    failed = failed_audits([good, bad])
    assert [r.name for r in failed] == [bad.name] and failed[0].problems


def test_replicate_makes_the_calibration_windows_count_repeat_times_in_all():
    sessions = [make_take("PUSH", n_cues=4, seed=1), make_take("PULL", n_cues=4, seed=2), make_take("NONE", seed=3)]
    calibration = sessions[:1]
    base, one = len(concat([windows_of(s) for s in sessions]).y), len(windows_of(calibration[0]).y)
    assert len(calib_windows(sessions, calibration, 1).y) == base
    assert len(calib_windows(sessions, calibration, 5).y) == base + 4 * one
    assert len(calib_windows(sessions, [], 5).y) == base
    w = windows_of(calibration[0])
    assert replicate(w, 1) is w and len(replicate(w, 3).y) == 3 * len(w.y)


def test_the_cli_fails_clearly_when_there_are_no_calibration_takes(root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    out = tmp_path / "out"
    assert main(["calib", str(root), "--person", "nobody", "--out-dir", str(out), "--allow-cpu", "--device", "cpu"]) == 2
    err = capsys.readouterr().err
    assert "no calibration takes" in err and "calib-" in err
    assert not out.exists()


def test_the_cli_refuses_to_train_when_a_calibration_take_fails_the_audit(root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    bad = still(make_take("UNDO", person="ana", n_cues=5, seed=77))
    write_take(bad, root / "ana" / "calib-2")
    out = tmp_path / "out"
    assert main(["calib", str(root), "--person", "ana", "--out-dir", str(out), "--allow-cpu", "--device", "cpu", "--epochs", "1"]) == 1
    err = capsys.readouterr().err
    assert bad.name in err and "FAILED" in err
    assert not out.exists()  # nothing was trained or written


def test_the_cli_trains_exports_and_prints_the_summary(root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    out = tmp_path / "out"
    assert main(["calib", str(root), "--person", "ana", "--out-dir", str(out), "--allow-cpu", "--device", "cpu", "--epochs", "2", "--repeat", "3"]) == 0
    text = capsys.readouterr().out
    assert "calibration takes: 2 (6 cues; PUSH 3, WAVE 3)" in text and "x3" in text
    assert "training windows:" in text and "training time:" in text and str(out / "gesture.onnx") in text
    assert (out / "gesture.onnx").stat().st_size > 1000
    assert json.loads((out / "gesture.json").read_text())["classes"][0] == "NONE"


def test_the_cli_rejects_a_repeat_below_one(root: Path, tmp_path: Path):
    assert main(["calib", str(root), "--person", "ana", "--out-dir", str(tmp_path / "o"), "--allow-cpu", "--device", "cpu", "--repeat", "0"]) == 2
