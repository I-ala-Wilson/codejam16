from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import torch

from dataset import CLASSES, CLASS_INDEX, Windows, concat, session_windows
from model import GestureCNN, count_parameters
from synth import make_take
from train import augment, export_onnx, macro_f1, pick_device, predict_proba, train

GESTURES = ["PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO"]


def person_windows(person: str, seed: int) -> Windows:
    takes = [make_take(g, person=person, n_cues=6, seed=seed + i) for i, g in enumerate(GESTURES)]
    takes.append(make_take("NONE", person=person, seed=seed + 99))
    return concat([session_windows(t) for t in takes])


@pytest.fixture(scope="module")
def corpus() -> dict[str, Windows]:
    return {p: person_windows(p, seed) for p, seed in [("ana", 10), ("bo", 20), ("cy", 30)]}


class TestDataset:
    def test_classes_are_the_six_from_the_protocol(self):
        assert CLASSES == ("NONE", "PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO")

    def test_a_none_take_gives_only_none_windows(self):
        w = session_windows(make_take("NONE", seed=1))
        assert w.x.shape[1:] == (48, 87) and w.x.dtype == np.float32
        assert set(w.y.tolist()) == {CLASS_INDEX["NONE"]}
        assert len(w.y) > 100

    def test_a_gesture_take_gives_its_class_and_a_lead_in_of_none(self):
        w = session_windows(make_take("WAVE", seed=2))
        assert set(w.y.tolist()) == {CLASS_INDEX["NONE"], CLASS_INDEX["WAVE"]}
        assert (w.y == CLASS_INDEX["WAVE"]).sum() > 40

    def test_windows_carry_the_person_and_take(self):
        w = session_windows(make_take("PUSH", person="dee", seed=3))
        assert set(w.person.tolist()) == {"dee"} and len(set(w.take.tolist())) == 1

    def test_labels_outside_the_six_classes_are_dropped(self):
        take = make_take("PUSH", seed=4)
        relabelled = replace(take, reps=[(s, e, "FREE") for s, e, _ in take.reps])
        assert set(session_windows(relabelled).y.tolist()) == {CLASS_INDEX["NONE"]}

    def test_the_values_are_dB_over_the_lead_in_floor_and_clipped(self):
        w = session_windows(make_take("PUSH", seed=5))
        assert w.x.min() >= -10.0 and w.x.max() <= 60.0
        push = w.x[w.y == CLASS_INDEX["PUSH"]]
        centre = push.shape[2] // 2
        assert push[:, :, centre + 5 : centre + 14].max() > 30  # the +117 Hz echo, well above the floor

    def test_concat_keeps_every_window(self, corpus: dict[str, Windows]):
        total = sum(len(w.y) for w in corpus.values())
        assert len(concat(list(corpus.values())).y) == total


class TestModel:
    def test_it_maps_a_batch_of_windows_to_six_logits_with_a_small_parameter_count(self):
        model = GestureCNN()
        assert model(torch.zeros(5, 1, 48, 87)).shape == (5, 6)
        assert 20_000 < count_parameters(model) < 100_000


class TestAugment:
    def test_it_keeps_shape_but_changes_values(self):
        x = torch.rand(16, 1, 48, 87)
        out = augment(x, torch.Generator().manual_seed(0))
        assert out.shape == x.shape and not torch.equal(out, x)

    def test_it_never_mirrors_direction(self):
        x = torch.zeros(64, 1, 48, 87)
        x[:, :, 10:30, 50:60] = 0.8  # energy only above the carrier (a push)
        out = augment(x, torch.Generator().manual_seed(1))
        assert out[:, :, :, 44:].sum() > 3 * out[:, :, :, :43].sum()


class TestTraining:
    def test_it_learns_the_synthetic_gestures_and_generalises_to_a_held_out_person(self, corpus: dict[str, Windows]):
        train_set = concat([corpus["ana"], corpus["bo"]])
        result = train(train_set, corpus["cy"], epochs=14, device=pick_device(), seed=0)
        probs = predict_proba(result.model, corpus["cy"].x, pick_device())
        assert probs.shape == (len(corpus["cy"].y), 6)
        assert np.allclose(probs.sum(axis=1), 1.0, atol=1e-4)
        accuracy = float((probs.argmax(axis=1) == corpus["cy"].y).mean())
        assert accuracy > 0.9, f"held-out accuracy {accuracy:.2f}"
        assert result.history[-1]["val_macro_f1"] > 0.85

    def test_the_history_records_every_epoch(self, corpus: dict[str, Windows]):
        result = train(corpus["ana"], corpus["bo"], epochs=2, device="cpu", seed=0)
        assert [h["epoch"] for h in result.history] == [1, 2]
        assert {"train_loss", "val_macro_f1"} <= set(result.history[0])

    def test_training_without_validation_still_works_for_the_final_model(self, corpus: dict[str, Windows]):
        result = train(corpus["ana"], None, epochs=1, device="cpu", seed=0)
        assert result.history[0]["val_macro_f1"] is None

    def test_macro_f1_is_one_for_perfect_predictions_and_lower_otherwise(self):
        y = np.array([0, 1, 2, 3, 4, 5, 0, 1])
        assert macro_f1(y, y, 6) == pytest.approx(1.0)
        assert macro_f1(y, np.zeros_like(y), 6) < 0.5


class TestOnnxExport:
    def test_it_writes_a_valid_onnx_model_with_the_documented_input_and_output(self, tmp_path: Path):
        onnx = pytest.importorskip("onnx")
        model = GestureCNN()
        path = tmp_path / "gesture.onnx"
        export_onnx(model, path)
        graph = onnx.load(str(path))
        onnx.checker.check_model(graph)
        assert [i.name for i in graph.graph.input] == ["x"]
        assert [o.name for o in graph.graph.output] == ["y"]

    def test_onnxruntime_gives_the_same_outputs_as_torch(self, tmp_path: Path):
        ort = pytest.importorskip("onnxruntime")
        model = GestureCNN().eval()
        path = tmp_path / "gesture.onnx"
        export_onnx(model, path)
        x = torch.rand(3, 1, 48, 87)
        expected = model(x).detach().numpy()
        got = ort.InferenceSession(str(path)).run(["y"], {"x": x.numpy()})[0]
        assert np.allclose(got, expected, atol=1e-4)
