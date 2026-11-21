import type { GestureEvent } from '../../contracts/engine.ts'
import type { MotionFrame } from './gestures.ts'

// Rule-based UNDO detector: a double tap toward the screen is two short, sharp positive Doppler strokes about 0.3 s
// apart, then stillness. The numbers were fixed before this was scored on any recording (ml/experiments/RESULTS.md,
// "New double-tap UNDO detector"). It runs next to the trained classifier and is OR-ed with it in index.ts.

export interface DoubleTapOptions {
  /** Hold-off after an event, so one double tap is reported once. */
  readonly refractoryMs?: number
}

const DEFAULT_REFRACTORY_MS = 800
/** A frame is moving toward the laptop when shiftHz reaches this. */
const MIN_SHIFT_HZ = 30
/** A stroke needs this many frames toward (about 64 ms) and a peak of at least this many Hz. */
const MIN_STROKE_FRAMES = 3
const MIN_STROKE_PEAK_HZ = 45
/** Frames without a direction that still belong to the same stroke. */
const MAX_STROKE_GAP_FRAMES = 2
/** Strokes whose starts are closer than this belong to one burst; a burst is a double tap only with exactly two. */
const BURST_CHAIN_MS = 700
const MIN_TAP_GAP_MS = 150
const MAX_TAP_GAP_MS = 600
const MAX_BURST_SPAN_MS = 1300
/** No strong motion (either sign, 2+ frames) for this long after the second stroke ends. */
const STILL_AFTER_MS = 300
const STRONG_RUN_FRAMES = 2
const CONFIDENCE = 0.7

interface Stroke {
  readonly startT: number
  readonly endT: number
  readonly peakHz: number
}

interface OpenStroke {
  readonly startT: number
  readonly lastT: number
  readonly frames: number
  readonly peakHz: number
  readonly gapFrames: number
}

export class DoubleTapTracker {
  private readonly refractoryMs: number
  private strokes: ReadonlyArray<Stroke> = []
  private open: OpenStroke | null = null
  private strongRun = 0
  private lastStrongT = -Infinity
  private holdUntilMs = -Infinity

  constructor(opts: DoubleTapOptions = {}) {
    this.refractoryMs = opts.refractoryMs ?? DEFAULT_REFRACTORY_MS
  }

  reset(): void {
    this.strokes = []
    this.open = null
    this.strongRun = 0
    this.lastStrongT = -Infinity
    this.holdUntilMs = -Infinity
  }

  /** Feed one frame; returns an UNDO event once a two-tap burst has been followed by stillness. */
  push(frame: MotionFrame): GestureEvent[] {
    this.trackStroke(frame)
    this.trackStrongMotion(frame)
    if (this.open !== null) return []
    const burst = this.burst()
    if (burst.length === 0) return []
    // A burst is final once no further stroke can chain onto it (BURST_CHAIN_MS after its last start) and the hand has
    // been still for STILL_AFTER_MS. It is decided exactly once, then forgotten, whatever the verdict.
    const last = burst[burst.length - 1]
    if (frame.t < last.startT + BURST_CHAIN_MS || frame.t - Math.max(last.endT, this.lastStrongT) < STILL_AFTER_MS) return []
    this.strokes = []
    if (frame.t < this.holdUntilMs || burst.length !== 2) return []
    const [first, second] = burst
    const gap = second.startT - first.startT
    if (gap < MIN_TAP_GAP_MS || gap > MAX_TAP_GAP_MS || second.endT - first.startT > MAX_BURST_SPAN_MS) return []
    this.holdUntilMs = frame.t + this.refractoryMs
    return [{ type: 'UNDO', t: frame.t, confidence: CONFIDENCE, source: 'rules' }]
  }

  private trackStroke(frame: MotionFrame): void {
    const toward = frame.shiftHz >= MIN_SHIFT_HZ
    const cur = this.open
    if (toward) {
      this.open = cur
        ? { ...cur, lastT: frame.t, frames: cur.frames + 1, peakHz: Math.max(cur.peakHz, frame.shiftHz), gapFrames: 0 }
        : { startT: frame.t, lastT: frame.t, frames: 1, peakHz: frame.shiftHz, gapFrames: 0 }
      return
    }
    if (!cur) return
    if (cur.gapFrames + 1 <= MAX_STROKE_GAP_FRAMES) {
      this.open = { ...cur, gapFrames: cur.gapFrames + 1 }
      return
    }
    this.open = null
    if (cur.frames >= MIN_STROKE_FRAMES && cur.peakHz >= MIN_STROKE_PEAK_HZ) {
      this.strokes = [...this.strokes, { startT: cur.startT, endT: cur.lastT, peakHz: cur.peakHz }]
    }
  }

  private trackStrongMotion(frame: MotionFrame): void {
    this.strongRun = Math.abs(frame.shiftHz) >= MIN_SHIFT_HZ ? this.strongRun + 1 : 0
    if (this.strongRun >= STRONG_RUN_FRAMES) this.lastStrongT = frame.t
  }

  /** The newest strokes, chained back while each start is less than BURST_CHAIN_MS after the previous one. */
  private burst(): ReadonlyArray<Stroke> {
    const out: Stroke[] = []
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]
      if (out.length > 0 && out[0].startT - s.startT >= BURST_CHAIN_MS) break
      out.unshift(s)
    }
    return out
  }
}
