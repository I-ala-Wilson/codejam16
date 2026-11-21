import type { SpectrumFrame } from '../../contracts/engine.ts'
import { analyzeFrame, buildFloor, centerBinIndex, hann, sliceAroundTone, snrDb, spectrumDb } from './dsp.ts'

/** FFT window in samples (about 85 ms at 48 kHz, 11.7 Hz per bin). */
export const WINDOW = 4096
/** Samples between frames (about 21 ms, about 47 frames/s at 48 kHz). */
export const HOP = 1024
/** Frames are centred on the tone and cover this many Hz either side. */
export const HALF_BAND_HZ = 500

const SNR_SMOOTHING = 0.8
const NO_MOTION = { shiftHz: 0, energyToward: 0, energyAway: 0 } as const

export interface PipelineOptions {
  readonly sampleRate: number
  readonly toneHz: number
  /** Margin in dB above the learned floor a bin must clear to count as motion. */
  readonly sensitivityDb?: number
}

interface Calibration {
  readonly framesNeeded: number
  readonly frames: Float32Array[]
  readonly resolve: () => void
  readonly reject: (reason: Error) => void
}

/**
 * Turns raw mic chunks into SpectrumFrames. Pure and synchronous so it is testable without a browser.
 * Until a still-room floor exists (see beginCalibration) frames carry zero shift and zero energy.
 */
export class FramePipeline {
  private readonly ring = new Float32Array(WINDOW)
  private readonly window = hann(WINDOW)
  private readonly binHz: number
  private readonly hopMs: number
  private readonly centerBin: number
  private readonly centerBiasHz: number
  private readonly halfBins: number
  private readonly sensitivityDb: number | undefined
  private filled = 0
  private emitted = 0
  private originMs = 0
  private floor: Float32Array | null = null
  private calibrations: Calibration[] = []
  private smoothedSnr: number | null = null

  constructor(opts: PipelineOptions) {
    this.binHz = opts.sampleRate / WINDOW
    this.hopMs = (HOP / opts.sampleRate) * 1000
    this.centerBin = centerBinIndex(opts.toneHz, this.binHz)
    this.centerBiasHz = this.centerBin * this.binHz - opts.toneHz
    this.halfBins = Math.round(HALF_BAND_HZ / this.binHz)
    this.sensitivityDb = opts.sensitivityDb
    if (this.centerBin + this.halfBins >= WINDOW / 2) {
      throw new Error(`a ${opts.sampleRate} Hz sample rate cannot carry a ${opts.toneHz} Hz tone with its +-${HALF_BAND_HZ} Hz band`)
    }
  }

  get isCalibrated(): boolean {
    return this.floor !== null
  }

  get snrDb(): number {
    return this.smoothedSnr ?? 0
  }

  /**
   * Learn the still-room floor from about `ms` of frames. Calibrations run side by side, each on its own
   * frames; the longest one to finish sets the floor, so an explicit long call beats a short auto one.
   */
  beginCalibration(ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.calibrations = [
        ...this.calibrations,
        { framesNeeded: Math.max(1, Math.ceil(ms / this.hopMs)), frames: [], resolve, reject },
      ]
    })
  }

  /** Use a floor learned elsewhere (offline scoring of a recording) instead of calibrating live. */
  setFloor(floor: Float32Array): void {
    this.floor = floor
  }

  /** Reject every calibration still waiting (engine stopped, capture lost). */
  cancelCalibration(reason: Error): void {
    const pending = this.calibrations
    this.calibrations = []
    pending.forEach((c) => c.reject(reason))
  }

  /** Feed exactly HOP samples. Returns a frame once a full window has accumulated, else null. */
  push(chunk: Float32Array, arrivalMs: number): SpectrumFrame | null {
    if (chunk.length !== HOP) throw new Error(`expected ${HOP} samples per chunk, got ${chunk.length}`)
    this.ring.copyWithin(0, HOP)
    this.ring.set(chunk, WINDOW - HOP)
    this.filled = Math.min(WINDOW, this.filled + HOP)
    if (this.filled < WINDOW) return null

    // Frame times come from the hop count, not from when the main thread happened to get the chunk.
    if (this.emitted === 0) this.originMs = arrivalMs
    const t = this.originMs + this.emitted * this.hopMs
    this.emitted += 1

    const bins = sliceAroundTone(spectrumDb(this.ring, this.window), this.centerBin, this.halfBins)
    const instantSnr = snrDb(bins)
    this.smoothedSnr =
      this.smoothedSnr === null ? instantSnr : SNR_SMOOTHING * this.smoothedSnr + (1 - SNR_SMOOTHING) * instantSnr

    const motion = this.calibrations.length === 0 && this.floor ? this.analyze(bins, this.floor) : NO_MOTION
    this.collect(bins)
    return { t, bins, binHz: this.binHz, ...motion }
  }

  private analyze(bins: Float32Array, floor: Float32Array) {
    return analyzeFrame(bins, this.binHz, floor, {
      sensitivityDb: this.sensitivityDb,
      centerBiasHz: this.centerBiasHz,
    })
  }

  private collect(bins: Float32Array): void {
    if (this.calibrations.length === 0) return
    const copy = bins.slice() // listeners own the emitted array and may modify it
    for (const cal of this.calibrations) cal.frames.push(copy)
    const finished = this.calibrations.filter((c) => c.frames.length >= c.framesNeeded)
    if (finished.length === 0) return
    this.calibrations = this.calibrations.filter((c) => !finished.includes(c))
    const longest = finished.reduce((a, b) => (b.frames.length > a.frames.length ? b : a))
    this.floor = buildFloor(longest.frames)
    finished.forEach((c) => c.resolve())
  }
}
