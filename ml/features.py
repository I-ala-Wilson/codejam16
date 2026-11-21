"""Spectrogram features for the sonar models.

The geometry mirrors engine/src/pipeline.ts exactly (4096-sample Hann window, 1024 hop, bins in dBFS within
+-500 Hz of the tone), so a model trained here sees the same frames the engine produces in the browser.
"""

import numpy as np

WINDOW = 4096
HOP = 1024
HALF_BAND_HZ = 500.0
#: Bins either side of the carrier that hold its main lobe; never counted as motion.
GUARD_BINS = 2
_MIN_MAGNITUDE = 1e-12
_FLOOR_SIGMAS = 2.0
_MAD_TO_SIGMA = 1.4826


def hann(n: int) -> np.ndarray:
    """Periodic Hann window, as in the engine."""
    return 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)


def band_bins(sample_rate: int, tone_hz: float) -> tuple[int, int]:
    """(centre bin index, half width in bins) of the +-500 Hz band around the tone."""
    bin_hz = sample_rate / WINDOW
    return round(tone_hz / bin_hz), round(HALF_BAND_HZ / bin_hz)


def spectrogram_db(samples: np.ndarray, sample_rate: int, tone_hz: float = 20000.0) -> np.ndarray:
    """Frames x bins, dBFS (a full-scale bin-centred sine reads 0 dB). Frame i covers samples [i*HOP, i*HOP + WINDOW)."""
    center, half = band_bins(sample_rate, tone_hz)
    width = 2 * half + 1
    if samples.shape[0] < WINDOW:
        return np.zeros((0, width), dtype=np.float32)
    n_frames = 1 + (samples.shape[0] - WINDOW) // HOP
    window = hann(WINDOW)
    scale = window.sum() / 2
    index = np.arange(WINDOW)[None, :] + HOP * np.arange(n_frames)[:, None]
    spectrum = np.fft.rfft(samples[index].astype(np.float64) * window, axis=1)
    magnitude = np.abs(spectrum[:, center - half : center + half + 1]) / scale
    return (20 * np.log10(np.maximum(magnitude, _MIN_MAGNITUDE))).astype(np.float32)


def frame_centers(n_frames: int) -> np.ndarray:
    """Sample index at the centre of each frame."""
    return WINDOW // 2 + HOP * np.arange(n_frames)


def still_floor(frames: np.ndarray) -> np.ndarray:
    """Per-bin noise floor of still frames: median plus two robust sigmas (the engine's floor), in dB."""
    median = np.median(frames, axis=0)
    mad = np.median(np.abs(frames - median), axis=0)
    return (median + _FLOOR_SIGMAS * _MAD_TO_SIGMA * mad).astype(np.float32)


def motion_energy(excess: np.ndarray) -> np.ndarray:
    """Per frame: the largest excess over the floor in any bin outside the carrier's main lobe (dB)."""
    centre = excess.shape[1] // 2  # frames are centred on the tone
    keep = np.abs(np.arange(excess.shape[1]) - centre) > GUARD_BINS
    return excess[:, keep].max(axis=1)


def excess_db(
    frames: np.ndarray, floor: np.ndarray, clip: tuple[float, float] = (-10.0, 60.0)
) -> np.ndarray:
    """Frames minus the floor, clipped, so models see motion energy instead of absolute levels."""
    return np.clip(frames - floor, clip[0], clip[1]).astype(np.float32)
