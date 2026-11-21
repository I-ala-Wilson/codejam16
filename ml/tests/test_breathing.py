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
    TONE_MAX_DEV_DB,
    TONE_MIN_SPAN_S,
    TONE_STEP_S,
    TONE_WINDOW_S,
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
    stable_span,
    tone_level_db,
    verdict,
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

    @pytest.mark.parametrize("clock_offset_hz", [-1.0, 0.3, 0.75, 1.237, -2.718])
    def test_a_tone_that_drifted_off_nominal_is_found_from_the_signal_alone(self, clock_offset_hz):
        audio = synth_audio(15, 2.0, snr_db=30.0, clock_offset_hz=clock_offset_hz)
        choice = pick_best_bin(demodulate(audio, FS, TONE, OUT_RATE), OUT_RATE)
        assert choice.offset_hz == pytest.approx(clock_offset_hz, abs=0.01)
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

    def test_a_take_shorter_than_a_window_is_rejected_by_the_gate(self, tmp_path):
        json_path = write_take(tmp_path, synth_audio(15, 2.0, seconds=12.0, snr_db=25.0))
        result = analyze_take(json_path.with_suffix(".wav"), json_path)
        assert result["rejected"] and "30 s needed" in result["reason"]

    def test_a_wav_whose_rate_differs_from_the_json_is_refused(self, tmp_path):
        json_path = write_take(tmp_path, synth_audio(15, 2.0, seconds=12.0), {"sampleRate": 44100})
        with pytest.raises(ValueError, match="sample rate"):
            analyze_take(json_path.with_suffix(".wav"), json_path)


def with_gain(audio: np.ndarray, steps: list[tuple[float, float]]) -> np.ndarray:
    """The audio scaled by a level that steps to `db` dB (relative) from each `seconds` on; steps are (seconds, db)."""
    gain_db = np.zeros(audio.size)
    for seconds, db in steps:
        gain_db[int(seconds * FS) :] = db
    return audio * 10 ** (gain_db / 20)


def span_of(audio: np.ndarray):
    times, levels = tone_level_db(audio, FS, TONE)
    return stable_span(times, levels)


class TestToneLevel:
    def test_a_known_amplitude_reads_in_dbfs_every_second(self):
        t = np.arange(20 * FS) / FS
        times, levels = tone_level_db(0.1 * np.sin(2 * np.pi * TONE * t), FS, TONE)
        assert levels == pytest.approx(-20.0, abs=0.5)
        assert len(times) == 16 and times[0] == pytest.approx(TONE_WINDOW_S / 2) and np.diff(times) == pytest.approx(TONE_STEP_S)

    def test_the_tone_is_found_a_few_hz_off_nominal(self):
        t = np.arange(10 * FS) / FS
        _, levels = tone_level_db(0.1 * np.sin(2 * np.pi * (TONE + 2.0) * t), FS, TONE)
        assert levels == pytest.approx(-20.0, abs=1.0)

    def test_silence_is_a_finite_very_low_level(self):
        _, levels = tone_level_db(np.zeros(6 * FS), FS, TONE)
        assert np.isfinite(levels).all() and levels.max() < -200


class TestStableSpan:
    def test_a_flat_level_is_stable_for_the_whole_take(self):
        times = np.arange(86) + 2.5
        assert stable_span(times, np.full(86, -30.0)) == (0.0, 90.0)

    def test_a_wobble_of_two_db_is_fine_and_a_step_of_four_db_is_not(self):
        times = np.arange(86) + 2.5
        wobble = -30.0 + 2.0 * np.sin(np.arange(86))
        assert stable_span(times, wobble) == (0.0, 90.0)
        step = np.where(times < 30, -30.0, -26.0)  # 4 dB up after 30 s: the minority 30 s is out of the 3 dB band
        span = stable_span(times, step)
        assert span is not None and span[0] >= 30.0 - TONE_WINDOW_S / 2

    def test_a_stretch_shorter_than_thirty_seconds_is_none(self):
        times = np.arange(40) + 2.5
        levels = np.where(times < 25, -30.0, -60.0)
        assert stable_span(times, levels) is None

    def test_the_longest_of_several_stable_stretches_is_chosen(self):
        times = np.arange(100) + 2.5
        levels = np.full(100, -30.0)
        levels[20:25] = -70.0  # a dip splits the take into 20 and 75 windows
        start, end = stable_span(times, levels)
        assert (start, end) == (times[25] - 2.5, times[-1] + 2.5)

    def test_no_windows_is_none(self):
        assert stable_span(np.array([]), np.array([])) is None


class TestQualityGate:
    def analyze(self, tmp_path, audio, extra=None):
        json_path = write_take(tmp_path, audio, extra)
        return analyze_take(json_path.with_suffix(".wav"), json_path)

    def test_a_steady_take_passes_whole(self, tmp_path):
        result = self.analyze(tmp_path, synth_audio(15, 2.0, seconds=60.0, snr_db=25.0))
        assert not result["rejected"]
        assert result["tone_span_s"] == [0.0, 60.0]
        low, high = result["tone_level_range_db"]
        assert high - low < TONE_MAX_DEV_DB

    def test_a_tone_that_drops_20_db_halfway_is_rejected_with_a_reason(self, tmp_path):
        audio = with_gain(synth_audio(15, 2.0, seconds=60.0, snr_db=25.0), [(30.0, -20.0)])
        result = self.analyze(tmp_path, audio)
        assert result["rejected"] is True
        assert "tone level not stable" in result["reason"] and "dB" in result["reason"]
        assert "median_bpm" not in result and "apnea" not in result

    def test_a_late_drop_leaves_a_long_enough_stretch_that_is_cropped_to(self, tmp_path):
        audio = with_gain(synth_audio(15, 2.0, seconds=100.0, snr_db=25.0), [(70.0, -20.0)])
        result = self.analyze(tmp_path, audio, {"paced_bpm": 15})
        assert not result["rejected"]
        start, end = result["tone_span_s"]
        assert start == 0.0 and 60.0 <= end <= 75.0  # the last stable 5 s window may reach a couple of seconds past the drop
        assert max(w["start_s"] for w in result["windows"]) + RATE_WINDOW_S <= end + 1e-9
        assert abs(result["median_bpm"] - 15) < RATE_TOLERANCE_BPM

    def test_an_early_drop_is_cropped_and_times_stay_on_the_take_clock(self, tmp_path):
        audio = with_gain(synth_audio(15, 2.0, seconds=100.0, snr_db=25.0), [(0.0, -20.0), (30.0, 0.0)])
        result = self.analyze(tmp_path, audio)
        start, _ = result["tone_span_s"]
        assert 25.0 <= start <= 35.0
        assert min(w["start_s"] for w in result["windows"]) == pytest.approx(start)
        assert min(result["apnea"]["times_s"]) == pytest.approx(start + APNEA_WINDOW_S / 2)

    def test_rejected_takes_are_listed_with_their_reason_in_the_summary(self, tmp_path):
        write_take(tmp_path / "takes", synth_audio(15, 2.0, seconds=60.0, snr_db=25.0), {"paced_bpm": 15}, name="good")
        write_take(tmp_path / "takes", with_gain(synth_audio(15, 2.0, seconds=60.0), [(30.0, -20.0)]), name="dead_tone")
        out = tmp_path / "out"
        assert main([str(tmp_path / "takes"), "--out", str(out), "--no-plots"]) == 0
        rows = {r["take"]: r for r in json.loads((out / "summary.json").read_text())}
        assert rows["dead_tone"]["rejected"] and rows["dead_tone"]["reason"]
        table = (out / "summary.md").read_text()
        assert "Rejected takes" in table and "dead_tone: tone level not stable" in table
        assert "Verdict: INSUFFICIENT DATA" in table


def paced_result(person: str, error: float | None, *, rejected: bool = False, hold: dict | None = None) -> dict:
    result = {"take": f"{person}-{error}", "person": person, "rejected": rejected, "paced_bpm": 15, "error_bpm": error, "hold_window_s": None}
    return {**result, **(hold or {})}


def hold_result(person: str, flagged_at: float | None, *, early: bool = False, false_share: float = 0.0) -> dict:
    """A 90 s hold take, hold 40-60 s, apnea windows every second from 5 s to 85 s."""
    times = [float(t) for t in range(5, 86)]
    flags = [False] * len(times)
    if flagged_at is not None:
        flags[times.index(flagged_at)] = True
    if early:
        flags[0] = True
    breathing = [i for i, t in enumerate(times) if t + 5 <= 40 or t - 5 >= 60]
    for i in breathing[len(breathing) - int(false_share * len(breathing)) :]:  # late ones: the first 10 s stay clean
        flags[i] = True
    return {
        "take": f"hold-{person}-{flagged_at}", "person": person, "rejected": False, "paced_bpm": None, "error_bpm": None,
        "hold_window_s": [40.0, 60.0], "tone_span_s": [0.0, 90.0], "apnea": {"times_s": times, "flags": flags},
    }


FOUR_PACED_GOOD = [paced_result("a", 0.5), paced_result("a", -1.5), paced_result("b", 2.0), paced_result("b", 0.0)]


class TestVerdict:
    def test_three_of_four_within_two_bpm_from_two_people_is_go(self):
        results = [paced_result("a", 0.5), paced_result("a", -1.5), paced_result("b", 2.0), paced_result("b", 3.1)]
        assert verdict(results) == "GO"

    def test_two_of_four_is_not_go(self):
        results = [paced_result("a", 0.5), paced_result("a", 4.0), paced_result("b", 2.0), paced_result("b", -3.1)]
        assert verdict(results) == "NO-GO"

    def test_a_missing_estimate_counts_against_the_take(self):
        results = [paced_result("a", 0.5), paced_result("a", None), paced_result("b", None), paced_result("b", 1.0)]
        assert verdict(results) == "NO-GO"

    def test_rejected_takes_never_count_for_or_against(self):
        bad_but_rejected = [paced_result("a", 9.0, rejected=True), paced_result("b", 9.0, rejected=True)]
        assert verdict(FOUR_PACED_GOOD + bad_but_rejected) == "GO"

    def test_three_usable_paced_takes_are_insufficient_data(self):
        assert verdict(FOUR_PACED_GOOD[:3]) == "INSUFFICIENT DATA"

    def test_four_takes_after_dropping_a_rejected_one_are_still_insufficient(self):
        assert verdict(FOUR_PACED_GOOD[:3] + [paced_result("b", 0.0, rejected=True)]) == "INSUFFICIENT DATA"

    def test_all_takes_from_one_person_are_insufficient_data(self):
        assert verdict([paced_result("a", 0.0) for _ in range(6)]) == "INSUFFICIENT DATA"

    def test_no_takes_at_all_are_insufficient_data(self):
        assert verdict([]) == "INSUFFICIENT DATA"

    def test_a_failed_rate_with_a_passing_apnea_check_is_partial_go(self):
        failed = [paced_result("a", 5.0), paced_result("a", 6.0), paced_result("b", -4.0), paced_result("b", 3.0)]
        holds = [hold_result("a", 45.0), hold_result("b", 50.0), hold_result("b", 40.0), hold_result("a", 49.0)]
        assert verdict(failed + holds) == "PARTIAL GO"

    def test_a_good_rate_is_go_even_when_the_apnea_check_fails(self):
        assert verdict(FOUR_PACED_GOOD + [hold_result("a", None), hold_result("b", None)]) == "GO"

    def test_three_of_four_hold_takes_flagged_in_time_passes_the_apnea_check(self):
        failed = [paced_result("a", 5.0), paced_result("a", 6.0), paced_result("b", -4.0), paced_result("b", 3.0)]
        holds = [hold_result("a", 45.0), hold_result("b", 50.0), hold_result("a", 41.0), hold_result("b", None)]
        assert verdict(failed + holds) == "PARTIAL GO"

    def test_half_the_hold_takes_flagged_in_time_is_no_go(self):
        failed = [paced_result("a", 5.0), paced_result("a", 6.0), paced_result("b", -4.0), paced_result("b", 3.0)]
        holds = [hold_result("a", 45.0), hold_result("b", 50.0), hold_result("a", None), hold_result("b", None)]
        assert verdict(failed + holds) == "NO-GO"

    def test_a_flag_more_than_ten_seconds_after_the_hold_start_does_not_count(self):
        failed = [paced_result("a", 5.0), paced_result("a", 6.0), paced_result("b", -4.0), paced_result("b", 3.0)]
        assert verdict(failed + [hold_result("a", 52.0), hold_result("b", 55.0)]) == "NO-GO"

    def test_a_flag_in_the_first_ten_seconds_fails_that_hold_take(self):
        failed = [paced_result("a", 5.0), paced_result("a", 6.0), paced_result("b", -4.0), paced_result("b", 3.0)]
        assert verdict(failed + [hold_result("a", 45.0, early=True), hold_result("b", 45.0, early=True)]) == "NO-GO"

    def test_flags_in_more_than_a_fifth_of_the_breathing_windows_fail_that_hold_take(self):
        failed = [paced_result("a", 5.0), paced_result("a", 6.0), paced_result("b", -4.0), paced_result("b", 3.0)]
        noisy = [hold_result("a", 45.0, false_share=0.3), hold_result("b", 45.0, false_share=0.3)]
        assert verdict(failed + noisy) == "NO-GO"
        calm = [hold_result("a", 45.0, false_share=0.15), hold_result("b", 45.0, false_share=0.15)]
        assert verdict(failed + calm) == "PARTIAL GO"

    def test_the_apnea_check_needs_hold_takes_from_two_people(self):
        failed = [paced_result("a", 5.0), paced_result("a", 6.0), paced_result("b", -4.0), paced_result("b", 3.0)]
        assert verdict(failed + [hold_result("a", 45.0), hold_result("a", 46.0)]) == "NO-GO"

    def test_rejected_hold_takes_are_ignored_by_the_apnea_check(self):
        failed = [paced_result("a", 5.0), paced_result("a", 6.0), paced_result("b", -4.0), paced_result("b", 3.0)]
        holds = [hold_result("a", 45.0), hold_result("b", 45.0), {**hold_result("a", None), "rejected": True}]
        assert verdict(failed + holds) == "PARTIAL GO"


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
