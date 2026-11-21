import json
from pathlib import Path

import pytest
import torch

from dataset import CLASSES
from run import load_corpus, lopo_reports, main, pooled_recall, render_report, train_final
from synth import make_take, write_take
from train import pick_device

GESTURES = ["PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO"]


@pytest.fixture(scope="module")
def root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    folder = tmp_path_factory.mktemp("recordings")
    for person, seed in [("ana", 10), ("bo", 20), ("cy", 30)]:
        takes = [make_take(g, person=person, n_cues=5, seed=seed + i) for i, g in enumerate(GESTURES)]
        takes.append(make_take("NONE", person=person, seed=seed + 99))
        for t in takes:
            write_take(t, folder / person)
    return folder


def test_the_corpus_loads_every_take_from_disk(root: Path):
    sessions = load_corpus(root)
    assert len(sessions) == 18 and {s.person for s in sessions} == {"ana", "bo", "cy"}


def test_leave_one_person_out_gives_one_fold_per_person(root: Path):
    folds = lopo_reports(load_corpus(root), epochs=8, device=pick_device(), seed=0)
    assert [f.person for f in folds] == ["ana", "bo", "cy"]
    for fold in folds:
        assert set(fold.report.recall) == set(GESTURES)
        assert fold.n_train_windows > 500
    pooled = pooled_recall(folds)
    assert set(pooled) == set(GESTURES) and all(0.0 <= v <= 1.0 for v in pooled.values())


def test_the_report_names_the_method_the_folds_and_the_targets(root: Path):
    folds = lopo_reports(load_corpus(root), epochs=4, device="cpu", seed=0)
    text = render_report(folds, epochs=4, device="cpu", seed=0)
    assert "leave-one-person-out" in text.lower()
    for person in ["ana", "bo", "cy"]:
        assert person in text
    assert "PUSH" in text and "false alarms" in text.lower() and "80%" in text


def test_the_final_model_is_exported_with_the_config_the_engine_needs(root: Path, tmp_path: Path):
    train_final(load_corpus(root), epochs=3, device="cpu", seed=0, out_dir=tmp_path)
    assert (tmp_path / "gesture.onnx").stat().st_size > 1000
    config = json.loads((tmp_path / "gesture.json").read_text())
    assert config["classes"] == list(CLASSES)
    assert config["windowFrames"] == 48 and config["bins"] == 87 and config["scaleDb"] == 60.0
    assert set(config["thresholds"]) == set(CLASSES[1:])
    assert {"smooth", "confirm", "refractoryMs", "waveRefractoryMs", "habitRefractoryMs"} <= set(config["decoder"])
    assert sorted(config["trainedOn"]) == ["ana", "bo", "cy"]


def test_the_cli_writes_the_report_and_the_model(root: Path, tmp_path: Path):
    report = tmp_path / "REPORT.md"
    assert main(["lopo", str(root), "--epochs", "3", "--out", str(report), "--allow-cpu", "--device", "cpu"]) == 0
    assert "PUSH" in report.read_text()
    assert main(["final", str(root), "--epochs", "3", "--out-dir", str(tmp_path / "model"), "--allow-cpu", "--device", "cpu"]) == 0
    assert (tmp_path / "model" / "gesture.onnx").exists()


def test_the_cli_refuses_an_empty_folder(tmp_path: Path):
    assert main(["lopo", str(tmp_path), "--epochs", "1", "--out", str(tmp_path / "r.md"), "--allow-cpu", "--device", "cpu"]) == 2


@pytest.mark.skipif(not torch.cuda.is_available(), reason="needs a GPU")
def test_it_refuses_to_train_on_the_cpu_when_a_gpu_is_available(root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    out = tmp_path / "model"
    assert main(["final", str(root), "--epochs", "1", "--out-dir", str(out), "--device", "cpu"]) == 2
    assert "CPU" in capsys.readouterr().err
    assert not (out / "gesture.onnx").exists()  # it stopped before training anything


@pytest.mark.skipif(not torch.cuda.is_available(), reason="needs a GPU")
def test_it_trains_on_the_gpu_by_default_and_says_so(root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    assert main(["final", str(root), "--epochs", "1", "--out-dir", str(tmp_path / "model")]) == 0
    assert "training on cuda" in capsys.readouterr().out


def test_it_says_which_device_it_trains_on_even_when_the_cpu_is_forced(root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    assert main(["final", str(root), "--epochs", "1", "--out-dir", str(tmp_path / "m"), "--allow-cpu", "--device", "cpu"]) == 0
    assert "training on cpu" in capsys.readouterr().out
