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
/** Doppler is searched only this far from the carrier: 350 Hz is about 3 m/s of hand speed at 20 kHz. */
export const MAX_DOPPLER_HZ = 350
/** A motion cluster needs this many contiguous bins above the floor; isolated bins are noise, not a hand. */
export const MIN_CLUSTER_BINS = 3
/** Only bins within this many dB of a cluster's peak count towards its centroid; window sidelobes sit far below. */
const LOBE_DB = 12
/** When both sides carry clusters this close in strength it is broadband interference, not a direction. */
const BOTH_SIDES_RATIO = 0.6

const MIN_MAGNITUDE = 1e-12

export interface AnalyzeOptions {
  /** Margin in dB above the floor a smoothed bin must clear. Lower is more sensitive. */
  readonly sensitivityDb?: number
  /** Frequency of the centre bin minus the true tone frequency, so shifts are measured from the tone. */
  readonly centerBiasHz?: number
  /** Widest Doppler shift searched, in Hz either side of the tone. Defaults to MAX_DOPPLER_HZ. */
  readonly maxDopplerHz?: number
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

interface Cluster {
  /** Sum of the excess (dB over the floor) of every bin in the cluster. */
  readonly strength: number
  readonly peakDb: number
  readonly centroidHz: number
}

interface ClusterSearch {
  readonly excess: Float32Array
  readonly center: number
  readonly side: 1 | -1
  readonly binHz: number
  readonly bandBins: number
  readonly sensitivityDb: number
  readonly centerBiasHz: number
}

/**
 * Strongest run of at least MIN_CLUSTER_BINS contiguous bins (one sub-threshold bin may bridge a run) above the
 * floor on one side of the carrier, within the Doppler band. A hand echo is a lobe several bins wide; a single
 * hot bin is noise or interference and never counts.
 */
function strongestCluster(s: ClusterSearch): Cluster | null {
  let best: Cluster | null = null
  let members: Array<{ hz: number; excessDb: number }> = []
  let gap = 0

  const close = (): void => {
    if (members.length >= MIN_CLUSTER_BINS) {
      const strength = members.reduce((sum, m) => sum + m.excessDb, 0)
      if (best === null || strength > best.strength) {
        const peakDb = Math.max(...members.map((m) => m.excessDb))
        best = { strength, peakDb, centroidHz: lobeCentroidHz(members, peakDb) }
      }
    }
    members = []
    gap = 0
  }

  for (let offset = GUARD_BINS + 1; offset <= s.bandBins; offset++) {
    const k = s.center + s.side * offset
    if (k < 0 || k >= s.excess.length) break
    const e = s.excess[k]
    if (e > s.sensitivityDb) {
      members.push({ hz: s.side * offset * s.binHz + s.centerBiasHz, excessDb: e })
      gap = 0
    } else if (members.length > 0 && ++gap > 1) {
      close()
    }
  }
  close()
  return best
}

/** Centroid of the lobe itself: bins within LOBE_DB of the peak, weighted in dB (not power) above that cut. */
function lobeCentroidHz(members: ReadonlyArray<{ hz: number; excessDb: number }>, peakDb: number): number {
  const cut = peakDb - LOBE_DB
  let weighted = 0
  let total = 0
  for (const m of members) {
    if (m.excessDb < cut) continue
    const weight = m.excessDb - cut + 1
    weighted += m.hz * weight
    total += weight
  }
  return weighted / total
}

/** The side with the stronger cluster wins; near-equal sides mean broadband interference, so no direction. */
function dominantShiftHz(toward: Cluster | null, away: Cluster | null): number {
  if (!toward || !away) return (toward ?? away)?.centroidHz ?? 0
  const ratio = Math.min(toward.strength, away.strength) / Math.max(toward.strength, away.strength)
  if (ratio >= BOTH_SIDES_RATIO) return 0
  return (toward.strength > away.strength ? toward : away).centroidHz
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
  if (floor.length !== bins.length) throw new Error('floor and frame must have the same length')
  const center = (bins.length - 1) / 2
  const base = {
    excess: Float32Array.from(bins, (b, k) => b - floor[k]),
    center,
    binHz,
    bandBins: Math.min(Math.floor((opts.maxDopplerHz ?? MAX_DOPPLER_HZ) / binHz), Math.floor(center)),
    sensitivityDb: opts.sensitivityDb ?? DEFAULT_SENSITIVITY_DB,
    centerBiasHz: opts.centerBiasHz ?? 0,
  }
  const toward = strongestCluster({ ...base, side: 1 })
  const away = strongestCluster({ ...base, side: -1 })
  return {
    shiftHz: dominantShiftHz(toward, away),
    energyToward: toward?.peakDb ?? 0,
    energyAway: away?.peakDb ?? 0,
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
