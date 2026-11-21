"""Contactless breathing rate from the phase of the 20 kHz echo.

    ml/.venv/bin/python ml/breathing.py data/recordings --out ml/experiments/breathing

A chest that moves 4 mm changes the round-trip path by 8 mm, about half a wavelength at 20 kHz (17 mm), so the phase of the
echo swings by several radians with every breath while its Doppler shift is far too small to see. The method, and the
GO/NO-GO rule it is judged by, are pre-registered in ml/experiments/RESULTS.md ("Breathing rate from the echo's phase");
every constant that rule fixes is a named constant below, and none of them is tuned on a recording.
"""

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from scipy import signal as sp

from data import find_sessions

#: Breathing band: 6 to 42 breaths per minute.
BAND_HZ = (0.1, 0.7)
#: The rate is the FFT peak of each 30 s window, windows stepped by 5 s.
RATE_WINDOW_S = 30.0
RATE_STEP_S = 5.0
#: Breathing strength is the RMS of the band-passed phase over 10 s; below 30% of the take's median it is a breath-hold.
APNEA_WINDOW_S = 10.0
APNEA_RATIO = 0.30
#: How often the apnea window advances. Not part of the rule: it only sets the time resolution of the flag.
APNEA_STEP_S = 1.0
#: The phase is sampled at this rate after demodulation (the band tops out at 0.7 Hz).
OUT_RATE_HZ = 50.0
LOWPASS_HZ = 10.0
#: The moving average that estimates the static path is this long: a few breaths, so a breath averages out of it.
STATIC_WINDOW_S = 20.0
#: The FFT is zero-padded to at least this many times the window length, so the peak is read finer than 1 bin.
ZERO_PAD_FACTOR = 16
#: Demodulation frequencies tried around the nominal tone: the speaker and mic clocks can disagree by a few Hz at 20 kHz.
#: The step is this fine because the leakage can be many times the echo: an offset error of only 0.02 Hz leaves it
#: rotating inside the breathing band and wrecks the estimate (measured on synthetic takes). Every offset stays inside
#: LOWPASS_HZ, so one demodulation serves all of them.
BIN_STEP_HZ = 0.01
BIN_RANGE_HZ = 3.0
BIN_OFFSETS_HZ = tuple(k * BIN_STEP_HZ for k in range(-round(BIN_RANGE_HZ / BIN_STEP_HZ), round(BIN_RANGE_HZ / BIN_STEP_HZ) + 1))
#: Tone-level quality gate (RESULTS.md, "data-quality gate"): the tone's level is measured in 5 s windows stepped by 1 s;
#: a window is stable within 3 dB of the take's median; a take is kept only if a stable run lasts at least 30 s.
TONE_WINDOW_S = 5.0
TONE_STEP_S = 1.0
TONE_MAX_DEV_DB = 3.0
TONE_MIN_SPAN_S = 30.0
#: The tone is looked for this far either side of its nominal frequency (the same range the bin search covers).
TONE_SEARCH_HZ = BIN_RANGE_HZ
TONE_FLOOR = 1e-12  # amplitude (full scale = 1) below which a silent window is reported as -240 dB, not minus infinity
#: The GO/NO-GO rule (RESULTS.md): within 2 bpm of the paced rate on 75% of the paced takes, from 2 people or more.
GO_TOLERANCE_BPM = 2.0
PASS_SHARE = 0.75
MIN_PEOPLE = 2
#: Fewer paced takes than this after the gate and the verdict is INSUFFICIENT DATA, not NO-GO.
MIN_PACED_TAKES = 4
#: Apnea check: the flag comes within this long after the labelled start of the hold and not in this long at the take's
#: start, and at most this share of the breathing windows may be flagged.
APNEA_ONSET_S = 10.0
APNEA_MAX_FALSE_SHARE = 0.20
DEFAULT_OUT = Path(__file__).parent / "experiments" / "breathing"


@dataclass(frozen=True)
class BinChoice:
    """The demodulation offset that showed the most breathing, with its cleaned baseband and breathing signal."""

    offset_hz: float
    baseband: np.ndarray
    signal: np.ndarray


def demodulate(samples: np.ndarray, sample_rate: float, tone_hz: float, out_rate: float = OUT_RATE_HZ) -> np.ndarray:
    """Complex baseband of the mic around the tone: mix with exp(-j 2 pi f0 t), low-pass to LOWPASS_HZ, decimate.

    Both filters are zero-phase (a symmetric FIR in the decimator, filtfilt for the low-pass). A causal filter would delay
    the phase and bend its shape, and the breathing phase is exactly what is being measured."""
    index = np.arange(len(samples))
    turns = (tone_hz * index / sample_rate) % 1.0  # whole turns removed first, so the angle stays exact on long takes
    mixed = samples * np.exp(-2j * np.pi * turns)
    out = int(round(out_rate))
    divisor = math.gcd(int(round(sample_rate)), out)
    decimated = sp.resample_poly(mixed, out // divisor, int(round(sample_rate)) // divisor)
    lowpass = sp.butter(4, LOWPASS_HZ, btype="lowpass", fs=out, output="sos")
    return sp.sosfiltfilt(lowpass, decimated)


def remove_static(baseband: np.ndarray, out_rate: float, window_s: float = STATIC_WINDOW_S) -> np.ndarray:
    """Subtract a slow moving average of the complex baseband.

    The direct speaker-to-mic path and the room's reflections do not move, so they are a constant complex offset that can
    be many times the chest echo. Left in, it makes the phase a small, distorted copy of the breathing. The average is
    taken over the part of the window that exists, so the first and last seconds are cleaned too (just less exactly)."""
    half = max(1, int(round(window_s * out_rate / 2)))
    index = np.arange(len(baseband))
    low = np.maximum(index - half, 0)
    high = np.minimum(index + half + 1, len(baseband))
    cumulative = np.concatenate(([0.0], np.cumsum(baseband)))
    return baseband - (cumulative[high] - cumulative[low]) / (high - low)


def _bandpass(values: np.ndarray, rate_hz: float) -> np.ndarray:
    sos = sp.butter(2, BAND_HZ, btype="bandpass", fs=rate_hz, output="sos")
    return sp.sosfiltfilt(sos, values)


def breathing_signal(baseband: np.ndarray, out_rate: float) -> np.ndarray:
    """Unwrapped phase of a static-free baseband, band-passed to BAND_HZ (radians).

    Unwrapping lets a swing wider than pi (a chest moving more than a quarter wavelength) be followed instead of folded."""
    return _bandpass(np.unwrap(np.angle(baseband)), out_rate)


def amplitude_signal(baseband: np.ndarray, out_rate: float) -> np.ndarray:
    """The backup signal: echo amplitude, band-passed. It carries the breathing when the phase is too noisy to unwrap.

    Caution: a chest swinging symmetrically around its rest point makes the amplitude repeat twice per breath, so an
    estimate from it can read double the rate."""
    return _bandpass(np.abs(baseband), out_rate)


def estimate_rate(
    signal: np.ndarray, rate_hz: float, window_s: float = RATE_WINDOW_S, step_s: float = RATE_STEP_S
) -> list[tuple[float, float]]:
    """(window start in seconds, breaths per minute) from the FFT peak inside BAND_HZ of each window."""
    length = int(round(window_s * rate_hz))
    step = int(round(step_s * rate_hz))
    nfft = 1 << (ZERO_PAD_FACTOR * length - 1).bit_length()
    frequencies = np.fft.rfftfreq(nfft, 1.0 / rate_hz)
    in_band = (frequencies >= BAND_HZ[0]) & (frequencies <= BAND_HZ[1])
    taper = np.hanning(length)
    rates = []
    for start in range(0, len(signal) - length + 1, step):
        segment = signal[start : start + length]
        spectrum = np.abs(np.fft.rfft((segment - segment.mean()) * taper, nfft))
        peak_hz = frequencies[in_band][np.argmax(spectrum[in_band])]
        rates.append((start / rate_hz, 60.0 * float(peak_hz)))
    return rates


def _signal_at_offset(baseband: np.ndarray, rate_hz: float, offset_hz: float) -> BinChoice:
    seconds = np.arange(len(baseband)) / rate_hz
    cleaned = remove_static(baseband * np.exp(-2j * np.pi * offset_hz * seconds), rate_hz)
    return BinChoice(offset_hz, cleaned, breathing_signal(cleaned, rate_hz))


def pick_best_bin(baseband: np.ndarray, rate_hz: float, offsets_hz: tuple[float, ...] = BIN_OFFSETS_HZ) -> BinChoice:
    """The offset whose band-passed phase holds the most energy.

    A wrong offset leaves the leakage rotating, so the phase is a ramp that the band-pass removes and only a small ripple
    of breathing is left; the right one leaves the leakage constant and the whole echo swing shows. The choice looks at
    the signal alone: there is no argument through which a paced rate could reach it. (Rotating the IQ plane would change
    nothing, the phase is invariant to it, so only frequency offsets are tried.)"""
    candidates = [_signal_at_offset(baseband, rate_hz, offset) for offset in offsets_hz]
    return max(candidates, key=lambda choice: float(np.sum(choice.signal**2)))


def extract_signal(samples: np.ndarray, sample_rate: float, tone_hz: float, out_rate: float = OUT_RATE_HZ) -> BinChoice:
    """Raw mic samples to the best breathing signal, at out_rate."""
    return pick_best_bin(demodulate(samples, sample_rate, tone_hz, out_rate), out_rate)


def apnea_flags(signal: np.ndarray, rate_hz: float, window_s: float = APNEA_WINDOW_S) -> tuple[list[float], list[bool]]:
    """(window centres in seconds, breath-hold flags): strength is the RMS of the band-passed phase in a window, and a
    window is a hold when it falls below APNEA_RATIO of the median strength over the take's windows."""
    length = int(round(window_s * rate_hz))
    step = int(round(APNEA_STEP_S * rate_hz))
    starts = range(0, len(signal) - length + 1, step)
    strength = np.array([np.sqrt(np.mean(signal[s : s + length] ** 2)) for s in starts])
    centres = [(s + length / 2) / rate_hz for s in starts]
    if strength.size == 0:
        return centres, []
    return centres, [bool(flag) for flag in strength < APNEA_RATIO * np.median(strength)]


def tone_level_db(
    samples: np.ndarray, sample_rate: float, tone_hz: float, window_s: float = TONE_WINDOW_S, step_s: float = TONE_STEP_S
) -> tuple[np.ndarray, np.ndarray]:
    """(window centres in seconds, tone level in dB re full scale) of the raw mic spectrum, one value per window.

    The level is the largest spectral magnitude within TONE_SEARCH_HZ of the tone, scaled so a full-scale sine reads 0 dB.
    A tone that moves in level (another app taking the audio device, a device switch) says nothing about breathing."""
    length = int(round(window_s * sample_rate))
    step = int(round(step_s * sample_rate))
    taper = np.hanning(length)
    near = np.abs(np.fft.rfftfreq(length, 1.0 / sample_rate) - tone_hz) <= TONE_SEARCH_HZ
    starts = range(0, len(samples) - length + 1, step)
    peaks = np.array([np.abs(np.fft.rfft(samples[s : s + length] * taper)[near]).max() for s in starts])
    levels = 20.0 * np.log10(np.maximum(2.0 * peaks / taper.sum(), TONE_FLOOR))
    return np.array([(s + length / 2) / sample_rate for s in starts]), levels


def _longest_stable_span(
    times: np.ndarray, levels_db: np.ndarray, max_dev_db: float, window_s: float
) -> tuple[float, float] | None:
    """The span in seconds covered by the longest run of consecutive windows within max_dev_db of the median level."""
    if len(levels_db) == 0:
        return None
    stable = np.abs(np.asarray(levels_db) - np.median(levels_db)) <= max_dev_db
    best, run_start = None, None
    for i, is_stable in enumerate([*stable, False]):
        if is_stable and run_start is None:
            run_start = i
        elif not is_stable and run_start is not None:
            best = (run_start, i - 1) if best is None or i - run_start > best[1] - best[0] + 1 else best
            run_start = None
    return None if best is None else (float(times[best[0]] - window_s / 2), float(times[best[1]] + window_s / 2))


def stable_span(
    times: np.ndarray,
    levels_db: np.ndarray,
    max_dev_db: float = TONE_MAX_DEV_DB,
    min_span_s: float = TONE_MIN_SPAN_S,
    window_s: float = TONE_WINDOW_S,
) -> tuple[float, float] | None:
    """(start, end) in seconds of the longest stretch whose tone level stays within max_dev_db of the take's median, or
    None when that stretch is shorter than min_span_s (the take is then rejected)."""
    span = _longest_stable_span(np.asarray(times), np.asarray(levels_db), max_dev_db, window_s)
    return span if span is not None and span[1] - span[0] >= min_span_s else None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _number_with(mapping: dict[str, Any], fragment: str) -> float | None:
    return next((float(v) for k, v in mapping.items() if fragment in k.lower() and _is_number(v)), None)


def _window_from(value: Any) -> tuple[float, float] | None:
    """A (start, end) from [start, end], {start..., end...} or a one-item list of those; None for anything else."""
    if isinstance(value, (list, tuple)):
        if len(value) == 2 and all(_is_number(v) for v in value):
            return float(value[0]), float(value[1])
        return _window_from(value[0]) if len(value) == 1 else None
    if isinstance(value, dict):
        start, end = _number_with(value, "start"), _number_with(value, "end")
        return (start, end) if start is not None and end is not None else None
    return None


def read_hold_window(meta: dict[str, Any]) -> tuple[float, float] | None:
    """The labelled breath-hold in seconds, or None.

    The field name is not fixed by contracts/recording.md yet, so this accepts any top-level key mentioning "hold" or
    "apnea" holding [start, end] or {start, end} in seconds, flat keys such as holdStartS / holdEndS, or a rep labelled
    "...HOLD..." (reps are sample indices, converted with sampleRate)."""
    hold_keys = {k: v for k, v in meta.items() if "hold" in k.lower() or "apnea" in k.lower()}
    candidates = [_window_from(v) for v in hold_keys.values()] + [_window_from(hold_keys)]
    window = next((w for w in candidates if w is not None), None)
    if window is None:
        window = _hold_from_reps(meta)
    return window if window is not None and window[1] > window[0] else None


def _hold_from_reps(meta: dict[str, Any]) -> tuple[float, float] | None:
    rate = meta.get("sampleRate")
    for rep in meta.get("reps", []):
        if "hold" in str(rep.get("label", "")).lower() and _is_number(rate):
            return rep["start"] / rate, rep["end"] / rate
    return None


def _counted_bpm(inhale_starts_s: list[float]) -> float | None:
    """Breaths per minute from the labelled inhales: (count - 1) intervals over the time they span."""
    if len(inhale_starts_s) < 2 or inhale_starts_s[-1] <= inhale_starts_s[0]:
        return None
    return 60.0 * (len(inhale_starts_s) - 1) / (inhale_starts_s[-1] - inhale_starts_s[0])


def _read_mono(wav_path: Path, expected_rate: int) -> tuple[np.ndarray, int]:
    audio, sample_rate = sf.read(wav_path, dtype="float64", always_2d=True)
    if audio.shape[1] != 1:
        raise ValueError(f"{wav_path.name}: expected a mono recording, got {audio.shape[1]} channels")
    if sample_rate != expected_rate:
        raise ValueError(f"{wav_path.name}: WAV sample rate {sample_rate} differs from the JSON's {expected_rate}")
    return audio[:, 0], int(sample_rate)


def _rejection_reason(times: np.ndarray, levels_db: np.ndarray) -> str:
    span = _longest_stable_span(times, levels_db, TONE_MAX_DEV_DB, TONE_WINDOW_S)
    longest = 0.0 if span is None else span[1] - span[0]
    return (
        f"tone level not stable: the longest stretch within {TONE_MAX_DEV_DB:g} dB of the median lasts {longest:.0f} s, "
        f"{TONE_MIN_SPAN_S:g} s needed (level range {levels_db.min():.0f} to {levels_db.max():.0f} dB)"
        if len(levels_db)
        else f"recording shorter than one {TONE_WINDOW_S:g} s tone window"
    )


def analyze_take(wav_path: Path, json_path: Path) -> dict[str, Any]:
    """Everything the experiment reports for one take, or a rejection when its tone level is not stable.

    The quality gate comes first: the audio is cropped to the longest stretch whose tone level is stable, and a take with
    no such stretch of TONE_MIN_SPAN_S is returned as {"rejected": True, "reason": ...} with no rate and no apnea result.
    Times in the result (rate windows, apnea windows, hold) are seconds from the start of the whole take.

    paced_bpm, inhale_starts_s and the hold window are read only to be reported next to the estimate (and to leave hold
    windows out of the median); the demodulation bin and the rates are computed without them."""
    meta = json.loads(json_path.read_text())
    samples, sample_rate = _read_mono(wav_path, int(meta["sampleRate"]))
    tone_hz = float(meta["toneHz"])
    times, levels = tone_level_db(samples, sample_rate, tone_hz)
    span = stable_span(times, levels)
    gate = {
        "take": json_path.stem,
        "person": str(meta.get("person", "")).lower(),
        "tone_level_range_db": [float(levels.min()), float(levels.max())] if len(levels) else None,
    }
    if span is None:
        return {**gate, "rejected": True, "reason": _rejection_reason(times, levels)}
    origin = span[0]
    choice = extract_signal(samples[int(round(span[0] * sample_rate)) : int(round(span[1] * sample_rate))], sample_rate, tone_hz)
    hold = read_hold_window(meta)
    windows = [
        {"start_s": origin + start, "bpm": bpm, "used_in_median": hold is None or not (origin + start < hold[1] and origin + start + RATE_WINDOW_S > hold[0])}
        for start, bpm in estimate_rate(choice.signal, OUT_RATE_HZ)
    ]
    kept = [w["bpm"] for w in windows if w["used_in_median"]]
    median_bpm = float(np.median(kept)) if kept else None
    paced = meta.get("paced_bpm")
    apnea_times, flags = apnea_flags(choice.signal, OUT_RATE_HZ)
    apnea_times = [origin + t for t in apnea_times]
    return {
        **gate,
        "rejected": False,
        "tone_hz": tone_hz,
        "tone_span_s": [span[0], span[1]],
        "chosen_offset_hz": choice.offset_hz,
        "windows": windows,
        "median_bpm": median_bpm,
        "paced_bpm": paced,
        "error_bpm": median_bpm - paced if median_bpm is not None and _is_number(paced) else None,
        "counted_bpm": _counted_bpm(list(meta.get("inhale_starts_s", []))),
        "hold_window_s": list(hold) if hold else None,
        "apnea": {"times_s": apnea_times, "flags": flags, "first_flag_s": next((t for t, f in zip(apnea_times, flags) if f), None)},
        "signal": choice.signal,
        "rate_hz": OUT_RATE_HZ,
        "signal_origin_s": origin,
    }


def _apnea_check_passes(result: dict[str, Any]) -> bool:
    """The pre-registered apnea check for one breath-hold take: flag raised within APNEA_ONSET_S after the labelled start
    of the hold, none in the first APNEA_ONSET_S of the analysed signal, and at most APNEA_MAX_FALSE_SHARE of the
    breathing windows (those not overlapping the hold) flagged."""
    hold_start, hold_end = result["hold_window_s"]
    times = np.asarray(result["apnea"]["times_s"], dtype=float)
    flags = np.asarray(result["apnea"]["flags"], dtype=bool)
    origin = result["tone_span_s"][0] if "tone_span_s" in result else 0.0
    raised = flags & (times >= hold_start) & (times <= hold_start + APNEA_ONSET_S)
    too_early = flags & (times < origin + APNEA_ONSET_S)
    breathing = (times + APNEA_WINDOW_S / 2 <= hold_start) | (times - APNEA_WINDOW_S / 2 >= hold_end)
    false_share = float(flags[breathing].mean()) if breathing.any() else 0.0
    return bool(raised.any() and not too_early.any() and false_share <= APNEA_MAX_FALSE_SHARE)


def verdict(results: list[dict[str, Any]]) -> str:
    """GO, PARTIAL GO, NO-GO or INSUFFICIENT DATA by the rule pre-registered in ml/experiments/RESULTS.md.

    Rejected takes never count. With fewer than MIN_PACED_TAKES paced takes, or paced takes from fewer than MIN_PEOPLE
    people, nothing can be concluded. Otherwise GO needs PASS_SHARE of the paced takes within GO_TOLERANCE_BPM; failing
    that, PARTIAL GO needs PASS_SHARE of the breath-hold takes, from at least MIN_PEOPLE people, to pass the apnea check.
    (The 'fewer than 4 takes from fewer than 2 people' of the rule is read as either shortfall being enough.)"""
    usable = [r for r in results if not r.get("rejected")]
    paced = [r for r in usable if _is_number(r.get("paced_bpm"))]
    if len(paced) < MIN_PACED_TAKES or len({r["person"] for r in paced}) < MIN_PEOPLE:
        return "INSUFFICIENT DATA"
    within = sum(1 for r in paced if r.get("error_bpm") is not None and abs(r["error_bpm"]) <= GO_TOLERANCE_BPM)
    if within >= PASS_SHARE * len(paced):
        return "GO"
    holds = [r for r in usable if r.get("hold_window_s")]
    passed = sum(1 for r in holds if _apnea_check_passes(r))
    if holds and len({r["person"] for r in holds}) >= MIN_PEOPLE and passed >= PASS_SHARE * len(holds):
        return "PARTIAL GO"
    return "NO-GO"


def plot_take(result: dict[str, Any], path: Path) -> None:
    """The breathing signal, the rate per window against the paced rate, and the apnea flag, over time."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    signal = result["signal"]
    figure, axes = plt.subplots(3, 1, figsize=(10, 8), sharex=True)
    axes[0].plot(result["signal_origin_s"] + np.arange(len(signal)) / result["rate_hz"], signal, linewidth=0.8)
    axes[0].set_ylabel("band-passed phase (rad)")
    centres = [w["start_s"] + RATE_WINDOW_S / 2 for w in result["windows"]]
    axes[1].plot(centres, [w["bpm"] for w in result["windows"]], "o-", label="estimate (30 s windows)")
    if _is_number(result["paced_bpm"]):
        paced = result["paced_bpm"]
        axes[1].axhline(paced, color="tab:green", label="paced")
        axes[1].axhspan(paced - GO_TOLERANCE_BPM, paced + GO_TOLERANCE_BPM, color="tab:green", alpha=0.15)
    axes[1].set_ylabel("breaths per minute")
    axes[1].legend(loc="upper right")
    axes[2].fill_between(result["apnea"]["times_s"], [int(f) for f in result["apnea"]["flags"]], step="mid", color="tab:red")
    axes[2].set_ylabel("apnea flag")
    axes[2].set_ylim(0, 1.1)
    axes[2].set_xlabel("time (s)")
    if result["hold_window_s"]:
        for axis in axes:
            axis.axvspan(*result["hold_window_s"], color="grey", alpha=0.2)
    figure.suptitle(result["take"])
    figure.tight_layout()
    figure.savefig(path, dpi=110)
    plt.close(figure)


def _cell(value: float | None) -> str:
    return "-" if value is None else f"{value:.1f}"


def summary_table(rows: list[dict[str, Any]]) -> str:
    """The per-take table, then the takes the tone-level gate rejected with their reasons, then the verdict."""
    accepted = [r for r in rows if not r["rejected"]]
    lines = [
        f"Verdict: {verdict(rows)}",
        "",
        "| take | paced bpm | median bpm | error | counted bpm | bin offset Hz | hold s | first apnea flag s | tone span s |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in accepted:
        hold = "-" if r["hold_window_s"] is None else f"{r['hold_window_s'][0]:.0f}-{r['hold_window_s'][1]:.0f}"
        lines.append(
            f"| {r['take']} | {_cell(r['paced_bpm'])} | {_cell(r['median_bpm'])} | {_cell(r['error_bpm'])} | "
            f"{_cell(r['counted_bpm'])} | {r['chosen_offset_hz']:+.2f} | {hold} | {_cell(r['apnea']['first_flag_s'])} | "
            f"{r['tone_span_s'][0]:.0f}-{r['tone_span_s'][1]:.0f} |"
        )
    rejected = [r for r in rows if r["rejected"]]
    if rejected:
        lines += ["", "Rejected takes (not counted):", ""] + [f"- {r['take']}: {r['reason']}" for r in rejected]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", type=Path, help="a recording .json, or a folder searched for <name>.json + <name>.wav")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--no-plots", action="store_true", help="write the summary only (no matplotlib needed)")
    args = parser.parse_args(argv)
    json_paths = [args.path] if args.path.is_file() else find_sessions(args.path)
    if not json_paths:
        print(f"no recordings (<name>.json with a <name>.wav) under {args.path}", file=sys.stderr)
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    results = [analyze_take(p.with_suffix(".wav"), p) for p in json_paths]
    rows = [{k: v for k, v in r.items() if k not in ("signal", "rate_hz", "signal_origin_s")} for r in results]
    (args.out / "summary.json").write_text(json.dumps(rows, indent=2))
    (args.out / "summary.md").write_text(summary_table(rows))
    print(f"{len(results)} takes, {sum(r['rejected'] for r in results)} rejected by the tone-level gate: {verdict(results)}")
    if not args.no_plots:
        try:
            for result in (r for r in results if not r["rejected"]):
                plot_take(result, args.out / f"{result['take']}.png")
        except ImportError as error:
            print(f"plots need matplotlib ({error}); the summary was written, rerun with --no-plots to skip", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
