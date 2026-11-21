import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from data import Session, find_sessions, frame_labels, load_session, make_windows, protocol_labels
from features import HOP, WINDOW, band_bins, excess_db, frame_centers, spectrogram_db, still_floor

FS = 48000
TONE = 20000.0


def tone(seconds: float, amp: float = 10 ** (-36 / 20), noise: float = 1e-5, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * FS)) / FS
    return (amp * np.sin(2 * np.pi * TONE * t) + rng.uniform(-noise, noise, t.size)).astype(np.float32)


def write_session(root: Path, person: str, samples: np.ndarray, reps: list[dict], gesture: str = "PUSH") -> Path:
    folder = root / person
    folder.mkdir(parents=True, exist_ok=True)
    stem = f"{person}_{gesture}_mbp-{person}_20261120-231000"
    sf.write(folder / f"{stem}.wav", samples, FS, subtype="PCM_16")
    meta = {
        "person": person, "gesture": gesture, "laptop": f"mbp-{person}", "note": "",
        "sampleRate": FS, "toneHz": 20000, "toneDbfs": -36, "reps": reps,
        "createdAt": "2026-11-20T23:10:00-05:00",
    }
    (folder / f"{stem}.json").write_text(json.dumps(meta))
    return folder / f"{stem}.json"


class TestFeatures:
    def test_band_covers_about_500_hz_each_side_of_the_tone(self):
        center, half = band_bins(FS, TONE)
        assert center == round(TONE / (FS / WINDOW))
        assert half == round(500 / (FS / WINDOW))

    def test_frames_match_the_engine_geometry(self):
        spec = spectrogram_db(tone(1.0), FS, TONE)
        assert spec.shape == (1 + (FS - WINDOW) // HOP, 2 * round(500 / (FS / WINDOW)) + 1)
        assert spec.dtype == np.float32

    def test_the_carrier_is_the_loudest_bin_in_the_centre(self):
        spec = spectrogram_db(tone(1.0), FS, TONE)
        centre = spec.shape[1] // 2
        assert abs(int(np.argmax(spec[5])) - centre) <= 1
        assert spec[5, centre] == pytest.approx(-36, abs=2.5)  # -36 dBFS tone, Hann scalloping up to ~1.4 dB

    def test_too_short_audio_gives_no_frames(self):
        assert spectrogram_db(np.zeros(WINDOW - 1, dtype=np.float32), FS, TONE).shape[0] == 0

    def test_frame_centres_sit_half_a_window_into_each_frame(self):
        assert list(frame_centers(3)) == [WINDOW // 2, WINDOW // 2 + HOP, WINDOW // 2 + 2 * HOP]

    def test_a_still_room_sits_below_its_own_floor_and_almost_never_exceeds_it(self):
        spec = spectrogram_db(tone(3.0), FS, TONE)
        excess = excess_db(spec, still_floor(spec))
        # the floor is the median plus two robust sigmas, so a typical bin is a few dB under it
        assert -9.0 < float(np.median(excess)) < 0.0
        assert float(np.mean(excess > 3.0)) < 0.02

    def test_excess_is_clipped(self):
        excess = excess_db(np.array([[100.0, -100.0]], dtype=np.float32), np.zeros(2, dtype=np.float32), clip=(-10.0, 60.0))
        assert excess.tolist() == [[60.0, -10.0]]

    def test_a_doppler_echo_shows_up_above_the_floor_on_the_right_side(self):
        t = np.arange(2 * FS) / FS
        still = tone(2.0)
        moving = still + (10 ** (-56 / 20) * np.sin(2 * np.pi * (TONE + 117) * t)).astype(np.float32)
        floor = still_floor(spectrogram_db(still, FS, TONE))
        excess = excess_db(spectrogram_db(moving, FS, TONE), floor)
        centre = excess.shape[1] // 2
        assert excess[5, centre + 5 : centre + 15].max() > 30
        assert excess[5, centre - 15 : centre - 5].max() < 10


class TestSessions:
    def test_finds_only_sessions_with_both_files(self, tmp_path: Path):
        good = write_session(tmp_path, "ian", tone(1.0), [])
        orphan = tmp_path / "ej" / "ej_PUSH_x_1.json"
        orphan.parent.mkdir()
        orphan.write_text("{}")
        assert find_sessions(tmp_path) == [good]

    def test_loads_pcm16_as_floats_with_the_metadata(self, tmp_path: Path):
        path = write_session(tmp_path, "ian", tone(1.0), [{"start": 6000, "end": 12000, "label": "PUSH"}])
        s = load_session(path)
        assert s.person == "ian" and s.gesture == "PUSH" and s.laptop == "mbp-ian"
        assert s.sample_rate == FS and s.tone_hz == 20000.0
        assert s.samples.dtype == np.float32 and s.samples.ndim == 1
        assert np.abs(s.samples).max() <= 1.0
        assert s.reps == [(6000, 12000, "PUSH")]

    def test_rejects_a_stereo_recording(self, tmp_path: Path):
        path = write_session(tmp_path, "ian", tone(1.0), [])
        sf.write(path.with_suffix(".wav"), np.stack([tone(1.0), tone(1.0)], axis=1), FS, subtype="PCM_16")
        with pytest.raises(ValueError, match="mono"):
            load_session(path)

    def test_rejects_a_sample_rate_that_disagrees_with_the_json(self, tmp_path: Path):
        path = write_session(tmp_path, "ian", tone(1.0), [])
        sf.write(path.with_suffix(".wav"), tone(1.0), 44100, subtype="PCM_16")
        with pytest.raises(ValueError, match="sample rate"):
            load_session(path)


class TestLabels:
    def test_frames_inside_a_rep_get_its_label_and_the_rest_are_none(self):
        n = 40
        reps = [(WINDOW // 2 + 10 * HOP, WINDOW // 2 + 20 * HOP, "PUSH")]
        labels = frame_labels(n, reps)
        assert labels[9] == "NONE" and labels[10] == "PUSH" and labels[20] == "PUSH" and labels[21] == "NONE"
        assert labels.count("PUSH") == 11

    def test_no_reps_means_everything_is_none(self):
        assert set(frame_labels(10, [])) == {"NONE"}


class TestProtocolLabels:
    """ml/PROTOCOL.md section 3: labels come from the cue windows; gaps are IGNORE; NONE only from lead-in and NONE takes."""

    def make(self, take_kind: str, reps: list[tuple[int, int, str]]):
        samples = np.zeros(10 * FS, dtype=np.float32)
        return Session(
            name="t", person="ian", gesture="PUSH", laptop="mbp", sample_rate=FS, tone_hz=TONE,
            samples=samples, reps=reps, meta={"takeKind": take_kind},
        )

    def test_lead_in_is_none_cues_are_labelled_and_gaps_are_ignored(self):
        cue = (int(3.0 * FS), int(4.5 * FS), "PUSH")
        session = self.make("gesture", [cue])
        n = 1 + (10 * FS - WINDOW) // HOP
        labels = protocol_labels(session, n)
        centres = frame_centers(n) / FS
        for label, t in zip(labels, centres):
            if t < 3.0 - 0.3:
                assert label == "NONE", t
            elif 3.0 + 0.2 <= t <= 4.5 - 0.2:
                assert label == "PUSH", t
            elif t < 3.0 or t > 4.5:
                assert label in ("IGNORE", "NONE"), t
        assert "IGNORE" in labels
        assert labels[0] == "NONE"

    def test_a_none_take_is_none_everywhere(self):
        session = self.make("none", [])
        n = 1 + (10 * FS - WINDOW) // HOP
        assert set(protocol_labels(session, n)) == {"NONE"}

    def test_a_gesture_take_without_cues_has_only_the_lead_in_as_none(self):
        session = self.make("gesture", [])
        n = 1 + (10 * FS - WINDOW) // HOP
        labels = protocol_labels(session, n)
        assert labels[0] == "NONE" and "IGNORE" in labels

    def test_the_loader_keeps_the_extra_protocol_keys(self, tmp_path: Path):
        path = write_session(tmp_path, "ian", tone(1.0), [])
        meta = json.loads(path.read_text())
        meta.update({"takeKind": "none", "distanceCm": 20, "cueWindowMs": 1500, "periodMs": 3000})
        path.write_text(json.dumps(meta))
        s = load_session(path)
        assert s.meta["takeKind"] == "none" and s.meta["distanceCm"] == 20


class TestWindows:
    def test_windows_are_labelled_by_their_centre_frame(self):
        excess = np.zeros((50, 87), dtype=np.float32)
        labels = ["NONE"] * 20 + ["PUSH"] * 10 + ["NONE"] * 20
        x, y = make_windows(excess, labels, length=10, stride=5)
        assert x.shape[1:] == (10, 87) and len(x) == len(y)
        centre_of = lambda i: i * 5 + 5
        assert all(y[i] == labels[centre_of(i)] for i in range(len(y)))
        assert "PUSH" in set(y)

    def test_short_recordings_give_no_windows(self):
        x, y = make_windows(np.zeros((5, 87), dtype=np.float32), ["NONE"] * 5, length=10, stride=5)
        assert x.shape == (0, 10, 87) and y == []
