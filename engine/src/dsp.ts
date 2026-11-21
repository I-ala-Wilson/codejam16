// Pure DSP for the sonar engine. No browser APIs here so everything is unit-testable.

/** Bins either side of the carrier that hold the Hann main lobe; never treated as motion. */
export const GUARD_BINS = 2
/** Bins either side of the carrier excluded when estimating the off-tone level for SNR. */
export const OFF_TONE_BINS = 4
/** Default margin a smoothed bin must clear above the learned floor to count as motion (contract default). */
export const DEFAULT_SENSITIVITY_DB = 2.5
/** The floor sits this many robust standard deviations above the still-room median. */
export const FLOOR_SIGMAS = 2
/** Scales a MAD to a standard deviation for normally distributed data. */
const MAD_TO_SIGMA = 1.4826

const MIN_MAGNITUDE = 1e-12

export interface AnalyzeOptions {
  /** Margin in dB above the floor a smoothed bin must clear. Lower is more sensitive. */
  readonly sensitivityDb?: number
  /** Frequency of the centre bin minus the true tone frequency, so shifts are measured from the tone. */
  readonly centerBiasHz?: number
}

export interface FrameAnalysis {
  readonly shiftHz: number
  readonly energyToward: number
  readonly energyAway: number
}

/** In-place radix-2 FFT. Both arrays must have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n !== im.length || n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`fft needs equal power-of-two lengths, got ${re.length} and ${im.length}`)
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tRe = re[b] * curRe - im[b] * curIm
        const tIm = re[b] * curIm + im[b] * curRe
        re[b] = re[a] - tRe
        im[b] = im[a] - tIm
        re[a] += tRe
        im[a] += tIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/** Periodic Hann window. */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}

/** Magnitude spectrum in dBFS (a full-scale bin-centred sine reads 0 dB), bins 0..n/2-1. */
export function spectrumDb(samples: ArrayLike<number>, window: Float64Array): Float32Array {
  const n = window.length
  if (samples.length !== n) throw new Error(`need ${n} samples, got ${samples.length}`)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  let windowSum = 0
  for (let i = 0; i < n; i++) {
    re[i] = samples[i] * window[i]
    windowSum += window[i]
  }
  fft(re, im)
  const scale = windowSum / 2
  const out = new Float32Array(n / 2)
  for (let k = 0; k < out.length; k++) {
    out[k] = 20 * Math.log10(Math.max(Math.hypot(re[k], im[k]) / scale, MIN_MAGNITUDE))
  }
  return out
}

export function centerBinIndex(toneHz: number, binHz: number): number {
  return Math.round(toneHz / binHz)
}

/** Copy 2 * halfBins + 1 bins centred on `center`. */
export function sliceAroundTone(spectrum: Float32Array, center: number, halfBins: number): Float32Array {
  if (center - halfBins < 0 || center + halfBins >= spectrum.length) {
    throw new Error(`tone window ${center} +- ${halfBins} falls outside the ${spectrum.length}-bin spectrum`)
  }
  return spectrum.slice(center - halfBins, center + halfBins + 1)
}

export function median(values: ArrayLike<number>): number {
  const sorted = Array.from(values).sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Median absolute deviation. */
export function mad(values: ArrayLike<number>): number {
  const m = median(values)
  return median(Array.from(values, (v) => Math.abs(v - m)))
}

/** Per-bin noise floor from still frames: median + FLOOR_SIGMAS robust sigmas (from the MAD), in dB. */
export function buildFloor(frames: ReadonlyArray<Float32Array>): Float32Array {
  if (frames.length === 0) throw new Error('buildFloor needs at least one frame')
  const width = frames[0].length
  const floor = new Float32Array(width)
  for (let k = 0; k < width; k++) {
    const column = frames.map((f) => f[k])
    floor[k] = median(column) + FLOOR_SIGMAS * MAD_TO_SIGMA * mad(column)
  }
  return floor
}

/** 3-bin mean of the excess power ratio in dB. Carrier-guard bins are left out so the carrier cannot smear into motion bins. */
function smoothedExcessDb(bins: Float32Array, floor: Float32Array): Float32Array {
  const center = (bins.length - 1) / 2
  const ratio = Float64Array.from(bins, (b, k) => 10 ** ((b - floor[k]) / 10))
  const out = new Float32Array(bins.length)
  for (let k = 0; k < bins.length; k++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, k - 1); j <= Math.min(bins.length - 1, k + 1); j++) {
      if (Math.abs(j - center) <= GUARD_BINS) continue
      sum += ratio[j]
      count++
    }
    out[k] = count > 0 ? 10 * Math.log10(sum / count) : 0
  }
  return out
}

/**
 * Doppler analysis of one tone-centred frame against a still-room floor.
 * Bins above the tone (positive offset) mean motion toward the laptop.
 */
export function analyzeFrame(
  bins: Float32Array,
  binHz: number,
  floor: Float32Array,
  opts: AnalyzeOptions = {},
): FrameAnalysis {
  const sensitivityDb = opts.sensitivityDb ?? DEFAULT_SENSITIVITY_DB
  const centerBiasHz = opts.centerBiasHz ?? 0
  if (floor.length !== bins.length) throw new Error('floor and frame must have the same length')
  const center = (bins.length - 1) / 2
  const excess = smoothedExcessDb(bins, floor)
  let weightSum = 0
  let weightedOffset = 0
  let toward = 0
  let away = 0
  for (let k = 0; k < bins.length; k++) {
    const offset = k - center
    if (Math.abs(offset) <= GUARD_BINS) continue
    const e = excess[k]
    if (offset > 0) toward = Math.max(toward, e)
    else away = Math.max(away, e)
    if (e > sensitivityDb) {
      const w = 10 ** (e / 10)
      weightSum += w
      weightedOffset += (offset * binHz + centerBiasHz) * w
    }
  }
  return {
    shiftHz: weightSum > 0 ? weightedOffset / weightSum : 0,
    energyToward: toward,
    energyAway: away,
  }
}

/** Tone peak minus the median of the off-tone bins, in dB. */
export function snrDb(bins: Float32Array): number {
  const center = (bins.length - 1) / 2
  let peak = -Infinity
  const off: number[] = []
  for (let k = 0; k < bins.length; k++) {
    const d = Math.abs(k - center)
    if (d <= GUARD_BINS) peak = Math.max(peak, bins[k])
    else if (d > OFF_TONE_BINS) off.push(bins[k])
  }
  return peak - median(off)
}
