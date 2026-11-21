"""Breathing rate from the echo's phase, on synthetic audio only (the GO/NO-GO rule is in ml/experiments/RESULTS.md)."""

import inspect
import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import breathing
from breathing import (
    APNEA_RATIO,
    APNEA_WINDOW_S,
    BAND_HZ,
    RATE_STEP_S,
    RATE_WINDOW_S,
    amplitude_signal,
    analyze_take,
    apnea_flags,
    breathing_signal,
    demodulate,
    estimate_rate,
    extract_signal,
    main,
    pick_best_bin,
    read_hold_window,
    remove_static,
)

FS = 48000
TONE = 20000.0
ECHO_AMPLITUDE = 0.01
OUT_RATE = 50.0
RATE_TOLERANCE_BPM = 1.0


def synth_audio(
    bpm: float,
    beta: float,
    *,
    seconds: float = 90.0,
    leakage: float = 10.0,
    snr_db: float | None = None,
    phi0: float = 0.7,
    hold: tuple[float, float] | None = None,
    clock_offset_hz: float = 0.0,
    seed: int = 0,
) -> np.ndarray:
    """A 20 kHz mic signal: a static leakage path `leakage` times the echo, plus a chest echo whose phase is
    phi0 + beta sin(2 pi f_b t), plus white noise. snr_db is the echo power over the noise power across the whole band.
    During `hold` the chest stops: the phase freezes at its last value. clock_offset_hz moves the whole tone off the
    nominal frequency, as a speaker and mic clock that disagree would."""
    t = np.arange(int(seconds * FS)) / FS
    carrier = 2 * np.pi * (TONE + clock_offset_hz) * t
    breath_t = t if hold is None else np.where(t < hold[0], t, np.where(t < hold[1], hold[0], t - (hold[1] - hold[0])))
    phase = phi0 + beta * np.sin(2 * np.pi * (bpm / 60.0) * breath_t)
    audio = leakage * ECHO_AMPLITUDE * np.cos(carrier + 1.9) + ECHO_AMPLITUDE * np.cos(carrier + phase)
    if snr_db is not None:
        sigma = ECHO_AMPLITUDE / np.sqrt(2.0) / 10 ** (snr_db / 20)
        audio = audio + np.random.default_rng(seed).normal(0.0, sigma, t.size)
    return audio


def rates_of(audio: np.ndarray, *, static: bool = True) -> list[float]:
    baseband = demodulate(audio, FS, TONE, OUT_RATE)
    signal = breathing_signal(remove_static(baseband, OUT_RATE) if static else baseband, OUT_RATE)
    return [bpm for _, bpm in estimate_rate(signal, OUT_RATE)]


def write_take(folder: Path, audio: np.ndarray, meta_extra: dict | None = None, name: str = "ian_BREATH_mbp-ian_20261121-100000") -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    sf.write(folder / f"{name}.wav", audio.astype(np.float32), FS, subtype="PCM_16")
    meta = {
        "person": "ian", "gesture": "BREATH", "laptop": "mbp-ian", "note": "", "sampleRate": FS, "toneHz": 20000,
        "toneDbfs": -36, "reps": [], "createdAt": "2026-11-21T10:00:00-05:00", **(meta_extra or {}),
    }
    (folder / f"{name}.json").write_text(json.dumps(meta))
    return folder / f"{name}.json"


class TestPreRegisteredConstants:
    def test_the_rule_fixed_in_results_md_is_what_the_code_uses(self):
        assert BAND_HZ == (0.1, 0.7)
        assert (RATE_WINDOW_S, RATE_STEP_S) == (30.0, 5.0)
        assert APNEA_WINDOW_S == 10.0
        assert APNEA_RATIO == 0.30


class TestDemodulate:
    def test_a_pure_tone_becomes_a_constant_at_the_output_rate(self):
        t = np.arange(20 * FS) / FS
        baseband = demodulate(0.5 * np.cos(2 * np.pi * TONE * t + 0.4), FS, TONE, OUT_RATE)
        assert len(baseband) == 20 * int(OUT_RATE)
        middle = baseband[200:-200]
        assert np.allclose(middle, 0.25 * np.exp(1j * 0.4), atol=1e-3)

    def test_a_tone_off_nominal_rotates_at_the_offset(self):
        t = np.arange(20 * FS) / FS
        baseband = demodulate(np.cos(2 * np.pi * (TONE + 1.0) * t), FS, TONE, OUT_RATE)
        turns = np.unwrap(np.angle(baseband[200:-200]))
        assert np.polyfit(np.arange(turns.size) / OUT_RATE, turns, 1)[0] == pytest.approx(2 * np.pi, rel=1e-2)


class TestRemoveStatic:
    def test_a_constant_complex_offset_is_gone_including_at_the_edges(self):
        rng = np.random.default_rng(0)
        baseband = (3 - 2j) + 0.01 * (rng.normal(size=1500) + 1j * rng.normal(size=1500))
        cleaned = remove_static(baseband, OUT_RATE)
        assert np.abs(cleaned).max() < 0.1

    def test_a_breath_sized_swing_survives(self):
        t = np.arange(3000) / OUT_RATE
        swing = 0.2 * np.exp(1j * 2 * np.pi * 0.25 * t)
        cleaned = remove_static(5.0 + swing, OUT_RATE)
        assert np.abs(cleaned[500:-500] - swing[500:-500]).max() < 0.02


class TestRateRecovery:
    @pytest.mark.parametrize("bpm", [10, 15, 20])
    @pytest.mark.parametrize("beta", [1.0, 2.0, 3.0])
    def test_the_rate_is_recovered_under_ten_times_static_leakage(self, bpm, beta):
        rates = rates_of(synth_audio(bpm, beta, snr_db=30.0))
        assert len(rates) >= 10
        assert np.abs(np.array(rates) - bpm).max() < RATE_TOLERANCE_BPM

    @pytest.mark.parametrize("bpm", [10, 15, 20])
    def test_the_rate_is_recovered_at_about_ten_db_snr(self, bpm):
        rates = rates_of(synth_audio(bpm, 2.0, snr_db=10.0, seed=3))
        assert abs(float(np.median(rates)) - bpm) < RATE_TOLERANCE_BPM

    def test_without_remove_static_the_leakage_breaks_the_estimate(self):
        """The leakage is ten times the echo, so the phase of the sum is a tenth-size, distorted copy of the breathing
        phase; for some echo phases its fundamental vanishes and the FFT peak lands on a harmonic."""
        failures = 0
        for phi0 in np.linspace(0.0, np.pi, 7):
            audio = synth_audio(15, 3.0, seconds=60.0, snr_db=30.0, phi0=float(phi0))
            with_static = rates_of(audio)
            without_static = rates_of(audio, static=False)
            assert np.abs(np.array(with_static) - 15).max() < RATE_TOLERANCE_BPM
            failures += int(np.abs(np.array(without_static) - 15).max() >= RATE_TOLERANCE_BPM)
        assert failures >= 1

    def test_a_take_shorter_than_one_window_gives_no_rate(self):
        assert estimate_rate(np.zeros(int(10 * OUT_RATE)), OUT_RATE) == []

    def test_windows_start_every_five_seconds(self):
        starts = [s for s, _ in estimate_rate(np.sin(np.arange(60 * 50) / 50.0), OUT_RATE)]
        assert starts == [0.0, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0]


class TestPhaseUnwrapping:
    @pytest.mark.parametrize("beta", [1.0, 2.0, 3.0])
    def test_a_swing_wider_than_pi_is_followed_not_wrapped(self, beta):
        audio = synth_audio(12, beta, leakage=0.0, seconds=90.0)
        signal = breathing_signal(remove_static(demodulate(audio, FS, TONE, OUT_RATE), OUT_RATE), OUT_RATE)
        assert np.percentile(np.abs(signal[500:-500]), 99) > 0.8 * beta

    def test_the_amplitude_backup_signal_sees_the_breathing_at_once_or_twice_the_rate(self):
        """Once the static path is gone the echo amplitude is an even function of the chest position, so a chest that
        swings both ways around its rest point modulates it twice per breath: the backup reads 2x the rate here."""
        audio = synth_audio(15, 2.0, snr_db=30.0)
        baseband = remove_static(demodulate(audio, FS, TONE, OUT_RATE), OUT_RATE)
        amplitude = amplitude_signal(baseband, OUT_RATE)
        assert amplitude.shape == baseband.shape
        median = float(np.median([b for _, b in estimate_rate(amplitude, OUT_RATE)]))
        assert min(abs(median - 15), abs(median - 30)) < RATE_TOLERANCE_BPM


class TestPickBestBin:
    def test_the_nominal_tone_is_chosen_when_the_clocks_agree(self):
        baseband = demodulate(synth_audio(15, 2.0, snr_db=30.0), FS, TONE, OUT_RATE)
        assert pick_best_bin(baseband, OUT_RATE).offset_hz == 0.0

    @pytest.mark.parametrize("clock_offset_hz", [-1.0, 1.0, 2.0])
    def test_a_tone_that_drifted_off_nominal_is_found_from_the_signal_alone(self, clock_offset_hz):
        audio = synth_audio(15, 2.0, snr_db=30.0, clock_offset_hz=clock_offset_hz)
        choice = pick_best_bin(demodulate(audio, FS, TONE, OUT_RATE), OUT_RATE)
        assert choice.offset_hz == pytest.approx(clock_offset_hz, abs=0.25)
        rates = [b for _, b in estimate_rate(choice.signal, OUT_RATE)]
        assert abs(float(np.median(rates)) - 15) < RATE_TOLERANCE_BPM

    def test_the_signature_has_no_rate_argument(self):
        names = set(inspect.signature(pick_best_bin).parameters)
        assert names == {"baseband", "rate_hz", "offsets_hz"}

    def test_the_chosen_bin_does_not_depend_on_the_paced_rate_in_the_json(self, tmp_path):
        audio = synth_audio(15, 2.0, seconds=60.0, snr_db=30.0, clock_offset_hz=1.0)
        bare = write_take(tmp_path / "bare", audio)
        paced = write_take(tmp_path / "paced", audio, {"paced_bpm": 15, "inhale_starts_s": [1.0, 5.0]})
        without = analyze_take(bare.with_suffix(".wav"), bare)
        with_rate = analyze_take(paced.with_suffix(".wav"), paced)
        assert without["chosen_offset_hz"] == with_rate["chosen_offset_hz"]
        assert without["windows"] == with_rate["windows"]


class TestApnea:
    HOLD = (40.0, 60.0)

    def flags_of(self, hold: tuple[float, float] | None, bpm: float = 15.0):
        audio = synth_audio(bpm, 2.0, seconds=90.0, snr_db=25.0, hold=hold)
        signal = extract_signal(audio, FS, TONE).signal
        times, flags = apnea_flags(signal, OUT_RATE)
        return np.asarray(times), np.asarray(flags)

    def test_a_breath_hold_is_flagged_within_ten_seconds_of_its_start(self):
        times, flags = self.flags_of(self.HOLD)
        flagged = times[flags]
        assert flagged.size > 0
        assert self.HOLD[0] <= flagged.min() <= self.HOLD[0] + 10.0

    def test_nothing_is_flagged_in_the_first_ten_seconds_or_in_most_breathing_windows(self):
        times, flags = self.flags_of(self.HOLD)
        assert not flags[times < 10.0].any()
        breathing_windows = (times + APNEA_WINDOW_S / 2 < self.HOLD[0]) | (times - APNEA_WINDOW_S / 2 > self.HOLD[1])
        assert flags[breathing_windows].mean() <= 0.20

    def test_a_take_with_steady_breathing_is_never_mostly_flagged(self):
        times, flags = self.flags_of(None, bpm=10.0)
        assert flags.mean() <= 0.20

    def test_a_take_shorter_than_one_window_has_no_flags(self):
        times, flags = apnea_flags(np.zeros(int(5 * OUT_RATE)), OUT_RATE)
        assert len(times) == 0 and len(flags) == 0


class TestHoldWindow:
    @pytest.mark.parametrize(
        "meta",
        [
            {"breath_hold": {"start_s": 40, "end_s": 60}},
            {"hold_window_s": [40, 60]},
            {"holdStartS": 40, "holdEndS": 60},
            {"hold": {"start": 40.0, "end": 60.0}},
            {"breath_hold_s": [{"start_s": 40, "end_s": 60}]},
        ],
    )
    def test_the_usual_spellings_are_understood(self, meta):
        assert read_hold_window(meta) == (40.0, 60.0)

    def test_a_rep_labelled_as_a_hold_is_read_from_sample_indices(self):
        meta = {"sampleRate": FS, "reps": [{"start": 40 * FS, "end": 60 * FS, "label": "BREATH_HOLD"}]}
        assert read_hold_window(meta) == (40.0, 60.0)

    @pytest.mark.parametrize("meta", [{}, {"hold": None}, {"hold": "none"}, {"hold_window_s": [5]}, {"reps": []}])
    def test_no_hold_is_not_an_error(self, meta):
        assert read_hold_window(meta) is None


class TestAnalyzeTake:
    def test_the_summary_has_rates_median_bin_and_apnea(self, tmp_path):
        json_path = write_take(tmp_path, synth_audio(15, 2.0, seconds=60.0, snr_db=25.0), {"paced_bpm": 15, "inhale_starts_s": [0.5 + 4 * i for i in range(14)]})
        result = analyze_take(json_path.with_suffix(".wav"), json_path)
        assert abs(result["median_bpm"] - 15) < RATE_TOLERANCE_BPM
        assert result["paced_bpm"] == 15
        assert abs(result["error_bpm"]) < RATE_TOLERANCE_BPM
        assert result["counted_bpm"] == pytest.approx(15.0)
        assert result["hold_window_s"] is None
        assert len(result["windows"]) == 7
        assert len(result["apnea"]["times_s"]) == len(result["apnea"]["flags"])

    def test_windows_that_overlap_a_labelled_hold_are_left_out_of_the_median(self, tmp_path):
        hold = (30.0, 50.0)
        audio = synth_audio(15, 2.0, seconds=90.0, snr_db=25.0, hold=hold)
        json_path = write_take(tmp_path, audio, {"breath_hold": {"start_s": 30, "end_s": 50}, "paced_bpm": 15})
        result = analyze_take(json_path.with_suffix(".wav"), json_path)
        kept = [w for w in result["windows"] if w["used_in_median"]]
        assert 0 < len(kept) < len(result["windows"])
        assert all(w["start_s"] + RATE_WINDOW_S <= hold[0] or w["start_s"] >= hold[1] for w in kept)
        assert abs(result["median_bpm"] - 15) < RATE_TOLERANCE_BPM

    def test_a_take_shorter_than_a_window_has_no_median(self, tmp_path):
        json_path = write_take(tmp_path, synth_audio(15, 2.0, seconds=12.0, snr_db=25.0))
        assert analyze_take(json_path.with_suffix(".wav"), json_path)["median_bpm"] is None

    def test_a_wav_whose_rate_differs_from_the_json_is_refused(self, tmp_path):
        json_path = write_take(tmp_path, synth_audio(15, 2.0, seconds=12.0), {"sampleRate": 44100})
        with pytest.raises(ValueError, match="sample rate"):
            analyze_take(json_path.with_suffix(".wav"), json_path)


class TestCli:
    def test_a_folder_gets_a_summary_in_json_and_markdown(self, tmp_path):
        write_take(tmp_path / "takes", synth_audio(15, 2.0, seconds=60.0, snr_db=25.0), {"paced_bpm": 15})
        out = tmp_path / "out"
        assert main([str(tmp_path / "takes"), "--out", str(out), "--no-plots"]) == 0
        rows = json.loads((out / "summary.json").read_text())
        assert len(rows) == 1 and "signal" not in rows[0]
        table = (out / "summary.md").read_text()
        assert "ian_BREATH_mbp-ian_20261121-100000" in table and "15" in table

    def test_a_single_json_gets_a_png_per_take(self, tmp_path):
        pytest.importorskip("matplotlib")
        json_path = write_take(tmp_path / "takes", synth_audio(15, 2.0, seconds=60.0, snr_db=25.0), {"paced_bpm": 15})
        out = tmp_path / "out"
        assert main([str(json_path), "--out", str(out)]) == 0
        assert (out / f"{json_path.stem}.png").stat().st_size > 1000

    def test_a_folder_without_takes_is_an_error(self, tmp_path):
        assert main([str(tmp_path), "--out", str(tmp_path / "out"), "--no-plots"]) == 1


def test_the_module_docstring_points_at_the_pre_registered_rule():
    assert "RESULTS.md" in (breathing.__doc__ or "")
