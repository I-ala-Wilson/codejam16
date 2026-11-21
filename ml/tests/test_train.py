from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import torch

from dataset import CLASSES, CLASS_INDEX, Windows, canonical_label, concat, session_windows, spectrogram_of, take_floor, windows_of
from features import spectrogram_db
from model import GestureCNN, count_parameters
from synth import make_take
import inspect

from train import NONE_WEIGHT, augment, class_weights, export_onnx, macro_f1, pick_device, predict_proba, train

GESTURES = ["PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO"]


def person_windows(person: str, seed: int) -> Windows:
    takes = [make_take(g, person=person, n_cues=6, seed=seed + i) for i, g in enumerate(GESTURES)]
    takes.append(make_take("NONE", person=person, seed=seed + 99))
    return concat([session_windows(t) for t in takes])


@pytest.fixture(scope="module")
def corpus() -> dict[str, Windows]:
    return {p: person_windows(p, seed) for p, seed in [("ana", 10), ("bo", 20), ("cy", 30)]}


class TestDataset:
    def test_classes_are_the_protocol_ones_plus_the_habit_class(self):
        assert CLASSES == ("NONE", "PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO", "REPETITIVE")

    def test_habit_variant_labels_all_mean_the_repetitive_class(self):
        assert canonical_label("REPETITIVE-scratch") == "REPETITIVE"
        assert canonical_label("REPETITIVE-nailbite") == "REPETITIVE"
        assert canonical_label("PUSH") == "PUSH" and canonical_label("FREE") == "FREE"

    def test_a_habit_take_trains_the_repetitive_class(self):
        w = session_windows(make_take("REPETITIVE-scratch", seed=11))
        assert set(w.y.tolist()) == {CLASS_INDEX["NONE"], CLASS_INDEX["REPETITIVE"]}
        assert (w.y == CLASS_INDEX["REPETITIVE"]).sum() > 40

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

    def test_a_clean_lead_in_gives_the_floor_and_is_reported_clean(self):
        take = make_take("PUSH", seed=8)
        spec = spectrogram_db(take.samples, take.sample_rate, take.tone_hz)
        floor, clean = take_floor(take, spec)
        assert clean is True and floor.shape == (spec.shape[1],)

    def test_a_moving_lead_in_falls_back_to_the_quietest_frames_for_the_floor(self):
        moving = make_take("PUSH", seed=7, lead_in_motion=True)
        spec = spectrogram_db(moving.samples, moving.sample_rate, moving.tone_hz)
        floor, clean = take_floor(moving, spec)
        assert clean is False
        still = make_take("PUSH", seed=9)
        still_floor_db, _ = take_floor(still, spectrogram_db(still.samples, still.sample_rate, still.tone_hz))
        # a floor that had swallowed the +-100 Hz lead-in motion would sit tens of dB above the still one
        assert float(np.max(floor - still_floor_db)) < 8.0

    def test_a_moving_lead_in_still_trains_the_cues_but_gives_no_none_examples(self):
        w = session_windows(make_take("PUSH", seed=6, lead_in_motion=True))
        assert CLASS_INDEX["NONE"] not in set(w.y.tolist())
        push = w.x[w.y == CLASS_INDEX["PUSH"]]
        centre = push.shape[2] // 2
        assert len(push) > 40
        assert push[:, :, centre + 5 : centre + 14].max() > 30

    def test_a_none_take_is_still_none_even_when_it_is_not_still(self):
        w = session_windows(make_take("NONE", seed=10, lead_in_motion=True))
        assert set(w.y.tolist()) == {CLASS_INDEX["NONE"]}

    def test_a_takes_spectrogram_is_computed_once_and_matches_the_direct_computation(self):
        take = make_take("PUSH", person="cache", seed=21)
        first = spectrogram_of(take)
        assert spectrogram_of(take) is first
        assert np.array_equal(first, spectrogram_db(take.samples, take.sample_rate, take.tone_hz))

    def test_a_takes_windows_are_cached_and_equal_to_building_them_directly(self):
        take = make_take("WAVE", person="cache", seed=22)
        cached = windows_of(take)
        assert windows_of(take) is cached
        direct = session_windows(take)
        assert np.array_equal(cached.x, direct.x) and np.array_equal(cached.y, direct.y)

    def test_concat_keeps_every_window(self, corpus: dict[str, Windows]):
        total = sum(len(w.y) for w in corpus.values())
        assert len(concat(list(corpus.values())).y) == total


class TestModel:
    def test_it_maps_a_batch_of_windows_to_one_logit_per_class_with_a_small_parameter_count(self):
        model = GestureCNN()
        assert model(torch.zeros(5, 1, 48, 87)).shape == (5, len(CLASSES))
        assert 20_000 < count_parameters(model) < 100_000


class TestRegularisationKnobs:
    def test_the_model_takes_a_dropout_rate_and_a_width(self):
        model = GestureCNN(width=8, dropout=0.5)
        drops = [m for m in model.modules() if isinstance(m, torch.nn.Dropout)]
        assert [d.p for d in drops] == [0.5]
        assert model(torch.zeros(3, 1, 48, 87)).shape == (3, len(CLASSES))

    def test_augmentation_strength_zero_leaves_the_input_alone(self):
        x = torch.rand(8, 1, 48, 87)
        out = augment(x, torch.Generator().manual_seed(0), strength=0.0)
        assert torch.equal(out, x)

    def test_a_stronger_augmentation_changes_the_input_more(self):
        x = torch.rand(64, 1, 48, 87)
        weak = (augment(x, torch.Generator().manual_seed(2), strength=0.5) - x).abs().mean()
        strong = (augment(x, torch.Generator().manual_seed(2), strength=2.0) - x).abs().mean()
        assert strong > weak

    def test_a_wider_gain_range_moves_the_whole_window_further(self):
        x = torch.zeros(256, 1, 48, 87)
        narrow = augment(x, torch.Generator().manual_seed(4), strength=1.0, gain_db=3.0).mean(dim=(1, 2, 3)).abs().mean()
        wide = augment(x, torch.Generator().manual_seed(4), strength=1.0, gain_db=15.0).mean(dim=(1, 2, 3)).abs().mean()
        assert wide > 3 * narrow  # per-window brightness is what differs between a loud and a quiet laptop

    def test_training_reports_how_well_it_fits_its_own_data(self, corpus: dict[str, Windows]):
        result = train(corpus["ana"], None, epochs=2, device="cpu", seed=0, weight_decay=0.05, label_smoothing=0.1, dropout=0.3, aug_strength=1.5, gain_db=10.0, none_weight=2.0)
        assert 0.0 <= result.train_macro_f1 <= 1.0


class TestClassWeights:
    def test_training_samples_idle_windows_three_times_as_often_by_default(self):
        # ml/experiments/RESULTS.md: this beat equal sampling at every false-alarm rate, on two seeds
        assert NONE_WEIGHT == 3.0
        assert inspect.signature(train).parameters["none_weight"].default == NONE_WEIGHT

    def test_every_class_is_equally_likely_by_default(self):
        y = torch.tensor([0] * 90 + [1] * 5 + [2] * 5)
        w = class_weights(y)
        per_class = [w[y == c].sum().item() for c in (0, 1, 2)]
        assert per_class == pytest.approx([per_class[0]] * 3)

    def test_a_none_weight_makes_idle_windows_proportionally_more_likely(self):
        y = torch.tensor([0] * 90 + [1] * 5 + [2] * 5)
        w = class_weights(y, none_weight=3.0)
        none_share = w[y == 0].sum().item() / w.sum().item()
        assert none_share == pytest.approx(3.0 / 5.0)  # 3 parts NONE to 1 part each of the two gestures

    def test_a_class_with_no_windows_does_not_break_it(self):
        assert torch.isfinite(class_weights(torch.tensor([0, 0, 1]), none_weight=2.0)).all()


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


@pytest.mark.skipif(not torch.cuda.is_available(), reason="needs a GPU")
class TestOnTheGpu:
    """Training must run the data and the augmentation on the GPU: a tiny CNN is otherwise starved by CPU-side batching."""

    def test_augment_runs_entirely_on_the_device(self):
        x = torch.rand(32, 1, 48, 87, device="cuda")
        out = augment(x, torch.Generator(device="cuda").manual_seed(0))
        assert out.device.type == "cuda" and out.shape == x.shape and not torch.equal(out, x)

    def test_augment_on_the_gpu_still_never_mirrors_direction(self):
        x = torch.zeros(64, 1, 48, 87, device="cuda")
        x[:, :, 10:30, 50:60] = 0.8
        out = augment(x, torch.Generator(device="cuda").manual_seed(1))
        assert out[:, :, :, 44:].sum() > 3 * out[:, :, :, :43].sum()

    def test_training_keeps_the_dataset_on_the_gpu(self, corpus: dict[str, Windows], monkeypatch: pytest.MonkeyPatch):
        import train as train_module

        seen_devices: set[str] = set()
        real_augment = train_module.augment

        def spying_augment(x: torch.Tensor, generator: torch.Generator, strength: float = 1.0, gain_db: float = 3.0) -> torch.Tensor:
            seen_devices.add(x.device.type)
            return real_augment(x, generator, strength, gain_db)

        monkeypatch.setattr(train_module, "augment", spying_augment)
        result = train(corpus["ana"], None, epochs=1, device="cuda", seed=0)
        assert seen_devices == {"cuda"}  # every batch was indexed and augmented on the GPU, none on the CPU
        assert next(result.model.parameters()).device.type == "cuda"


class TestTraining:
    def test_it_learns_the_synthetic_gestures_and_generalises_to_a_held_out_person(self, corpus: dict[str, Windows]):
        train_set = concat([corpus["ana"], corpus["bo"]])
        result = train(train_set, corpus["cy"], epochs=14, device=pick_device(), seed=0)
        probs = predict_proba(result.model, corpus["cy"].x, pick_device())
        assert probs.shape == (len(corpus["cy"].y), len(CLASSES))
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
