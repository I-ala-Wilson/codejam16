"""--drop-test and the recipe key drop_train: which takes reach training and which reach scoring."""

import json
from pathlib import Path

import pytest

import run
from run import load_corpus, lopo_reports, usable_sessions
from synth import make_take, write_take
from tune import main, read_take_list, run_recipe, unknown_takes

PEOPLE = [("ana", 10), ("bo", 20), ("cy", 30)]


def _sessions(tmp_path: Path):
    root = tmp_path / "rec"
    for person, seed in PEOPLE:
        for i, g in enumerate(["PUSH", "PULL"]):
            write_take(make_take(g, person=person, n_cues=4, seed=seed + i), root / person)
        write_take(make_take("NONE", person=person, seed=seed + 99), root / person)
    return root, usable_sessions(load_corpus(root))


class Spy:
    """Records, per fold, the take names that were turned into training windows and the ones that were scored."""

    def __init__(self, monkeypatch):
        self.window_calls: list[list[str]] = []
        self.scored: list[list[str]] = []
        real_windows, real_eval = run._windows, run.evaluate_takes

        def windows(sessions):
            self.window_calls.append([s.name for s in sessions])
            return real_windows(sessions)

        def evaluate(model, sessions, device, *a, **kw):
            self.scored.append([s.name for s in sessions])
            return real_eval(model, sessions, device, *a, **kw)

        monkeypatch.setattr(run, "_windows", windows)
        monkeypatch.setattr(run, "evaluate_takes", evaluate)

    @property
    def trained(self) -> list[str]:
        return [n for call in self.window_calls[0::2] for n in call]  # each fold builds train windows, then held-out windows

    @property
    def held_out_windows(self) -> list[str]:
        return [n for call in self.window_calls[1::2] for n in call]


def _names(sessions, person: str, gesture: str) -> str:
    return next(s.name for s in sessions if s.person == person and s.gesture == gesture)


def test_nothing_is_dropped_by_default(tmp_path, monkeypatch):
    _, sessions = _sessions(tmp_path)
    spy = Spy(monkeypatch)
    folds = lopo_reports(sessions, 1, "cpu", 0)
    assert len(folds) == 3
    assert sorted(n for call in spy.scored for n in call) == sorted(s.name for s in sessions)
    assert len(spy.trained) == 2 * len(sessions)  # every take is in the training set of the two folds it is not held out in


def test_a_dropped_train_take_never_reaches_training_but_is_still_scored(tmp_path, monkeypatch):
    _, sessions = _sessions(tmp_path)
    victim = _names(sessions, "ana", "PULL")
    spy = Spy(monkeypatch)
    lopo_reports(sessions, 1, "cpu", 0, drop_train=frozenset({victim}))
    assert victim not in spy.trained
    assert len(spy.trained) == 2 * len(sessions) - 2  # absent from the two folds that would have trained on it
    assert victim in [n for call in spy.scored for n in call]  # drop_train never touches the held-out set
    assert victim in spy.held_out_windows


def test_a_dropped_test_take_never_reaches_scoring_but_is_still_trained_on(tmp_path, monkeypatch):
    _, sessions = _sessions(tmp_path)
    victim = _names(sessions, "ana", "PULL")
    spy = Spy(monkeypatch)
    folds = lopo_reports(sessions, 1, "cpu", 0, drop_test=frozenset({victim}))
    scored = [n for call in spy.scored for n in call]
    assert victim not in scored and victim not in spy.held_out_windows
    assert sorted(scored) == sorted(s.name for s in sessions if s.name != victim)  # every other held-out take is untouched
    assert victim in spy.trained  # in the other people's folds it is still training data
    ana_fold = next(f for f in folds if f.person == "ana")
    assert "PULL" in ana_fold.report.recall or ana_fold.report.n_reps.get("PULL", 0) == 0
    assert ana_fold.report.n_reps == {"PUSH": 4}  # the remaining PUSH take was scored, the dropped PULL take was not


def test_a_person_whose_takes_are_all_dropped_from_scoring_has_no_fold(tmp_path, monkeypatch):
    _, sessions = _sessions(tmp_path)
    everything_of_ana = frozenset(s.name for s in sessions if s.person == "ana")
    folds = lopo_reports(sessions, 1, "cpu", 0, drop_test=everything_of_ana)
    assert sorted(f.person for f in folds) == ["bo", "cy"]


def test_read_take_list_ignores_blank_lines_and_comments(tmp_path):
    path = tmp_path / "list.txt"
    path.write_text("one\n\n  two  \n# a comment\nthree # trailing\n")
    assert read_take_list(path) == frozenset({"one", "two", "three"})
    assert read_take_list(None) == frozenset()


def test_unknown_take_names_are_reported(tmp_path):
    _, sessions = _sessions(tmp_path)
    real = sessions[0].name
    assert unknown_takes(frozenset({real, "typo"}), sessions) == ["typo"]


def test_run_recipe_applies_drop_train_and_drop_test(tmp_path, monkeypatch):
    _, sessions = _sessions(tmp_path)
    train_victim, test_victim = _names(sessions, "bo", "PULL"), _names(sessions, "cy", "PUSH")
    listing = tmp_path / "train.txt"
    listing.write_text(train_victim + "\n")
    spy = Spy(monkeypatch)
    run_recipe(sessions, "r", {"drop_train": str(listing)}, [0], 1, "cpu", tmp_path / "o", frozenset({test_victim}))
    assert train_victim not in spy.trained
    assert test_victim not in [n for call in spy.scored for n in call]
    saved = json.loads((tmp_path / "o" / "results" / "r.json").read_text())
    assert saved["drop_test"] == [test_victim] and saved["drop_train_takes"] == [train_victim]


def test_a_saved_result_is_not_reused_when_the_scoring_exclusions_change(tmp_path):
    _, sessions = _sessions(tmp_path)
    out = tmp_path / "o"
    run_recipe(sessions, "r", {}, [0], 1, "cpu", out)
    victim = _names(sessions, "ana", "PULL")
    run_recipe(sessions, "r", {}, [0], 1, "cpu", out, frozenset({victim}))
    assert json.loads((out / "results" / "r.json").read_text())["drop_test"] == [victim]


def test_the_cli_rejects_a_take_name_that_matches_nothing(tmp_path, capsys):
    root, _ = _sessions(tmp_path)
    out = tmp_path / "out"
    out.mkdir()
    (out / "recipes.json").write_text("{}")
    listing = tmp_path / "typo.txt"
    listing.write_text("no_such_take\n")
    code = main([str(root), "--recipes", str(out / "recipes.json"), "--out", str(out), "--allow-cpu", "--device", "cpu", "--drop-test", str(listing)])
    assert code == 2 and "no_such_take" in capsys.readouterr().err
