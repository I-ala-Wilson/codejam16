import type { GestureEvent } from '../../contracts/engine.ts'
import type { MotionFrame } from './gestures.ts'

// Rule-based Habit detector: scratching, nail biting and fidgeting show up in the echo as fast back-and-forth hand
// motion. Ian's DIRECT 7064729504 fixed the rule before it was measured on any recording: the direction (sign of
// shiftHz) flips 2-6 times a second, with motion above the idle floor for at least 1.5 s. It runs next to the trained
// classifier and is OR-ed with it in index.ts.

export interface HabitTrackerOptions {
  /** Hold-off after an event, so one long habit is not reported every frame (the classifier uses the same 3 s). */
  readonly refractoryMs?: number
}

const DEFAULT_REFRACTORY_MS = 3000
/** The motion must last this long, and the flips are counted over this window. */
const WINDOW_MS = 1500
const MIN_FLIPS_PER_S = 2
const MAX_FLIPS_PER_S = 6
/** A frame has a direction when |shiftHz| reaches this (the rule detector's MIN_SHIFT_HZ). */
const MIN_SHIFT_HZ = 30
/** Energy (dB over the floor) that counts as motion even without a direction (the rule detector's MOTION_DB). */
const MOTION_DB = 10
/** The window counts as full when it is within this many ms (about one frame) of 1.5 s. */
const FULL_WINDOW_SLACK_MS = 25
/** Motion may pause this long inside the window; a longer stop starts the 1.5 s over. */
const MAX_GAP_MS = 250
/** A direction must hold for this many frames (about 43 ms) before it counts, so one noisy frame is not a flip. */
const MIN_RUN_FRAMES = 2
/** Confidence runs from 0.6 for an irregular rhythm to 1 for a perfectly regular one (rules give 0.6..1). */
const MIN_CONFIDENCE = 0.6

interface Run {
  readonly sign: 1 | -1
  readonly startT: number
  readonly frames: number
}

const isMoving = (f: MotionFrame): boolean => Math.abs(f.shiftHz) >= MIN_SHIFT_HZ || Math.max(f.energyToward, f.energyAway) >= MOTION_DB

function signOf(shiftHz: number): 1 | -1 | 0 {
  if (shiftHz >= MIN_SHIFT_HZ) return 1
  if (shiftHz <= -MIN_SHIFT_HZ) return -1
  return 0
}

/** Start times of every change of direction among the runs that held for MIN_RUN_FRAMES. */
function flipTimes(window: ReadonlyArray<MotionFrame>): number[] {
  const runs: Run[] = []
  for (const f of window) {
    const sign = signOf(f.shiftHz)
    if (sign === 0) continue
    const last = runs[runs.length - 1]
    if (last && last.sign === sign) runs[runs.length - 1] = { ...last, frames: last.frames + 1 }
    else runs.push({ sign, startT: f.t, frames: 1 })
  }
  const solid = runs.filter((r) => r.frames >= MIN_RUN_FRAMES)
  const flips: number[] = []
  for (let i = 1; i < solid.length; i++) if (solid[i].sign !== solid[i - 1].sign) flips.push(solid[i].startT)
  return flips
}

/** 1 for evenly spaced flips, down to 0 when the spacing varies as much as the spacing itself. */
function regularity(flips: ReadonlyArray<number>): number {
  if (flips.length < 3) return 0
  const gaps = flips.slice(1).map((t, i) => t - flips[i])
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length
  return Math.max(0, 1 - Math.sqrt(variance) / mean)
}

export class HabitTracker {
  private readonly refractoryMs: number
  private window: MotionFrame[] = []
  private holdUntilMs = -Infinity

  constructor(opts: HabitTrackerOptions = {}) {
    this.refractoryMs = opts.refractoryMs ?? DEFAULT_REFRACTORY_MS
  }

  reset(): void {
    this.window = []
    this.holdUntilMs = -Infinity
  }

  /** Feed one frame; returns a REPETITIVE event when the last 1.5 s fit the rule and the hold-off has passed. */
  push(frame: MotionFrame): GestureEvent[] {
    this.window = [...this.window.filter((f) => f.t >= frame.t - WINDOW_MS), frame]
    if (frame.t < this.holdUntilMs || !this.coversWindow(frame.t)) return []
    const flips = flipTimes(this.window)
    const perSecond = (flips.length * 1000) / WINDOW_MS
    if (perSecond < MIN_FLIPS_PER_S || perSecond > MAX_FLIPS_PER_S) return []
    this.holdUntilMs = frame.t + this.refractoryMs
    const confidence = MIN_CONFIDENCE + (1 - MIN_CONFIDENCE) * regularity(flips)
    return [{ type: 'REPETITIVE', t: frame.t, confidence, source: 'rules' }]
  }

  /** The window is full (1.5 s of frames), motion fills it from start to now, and no pause inside it exceeds MAX_GAP_MS. */
  private coversWindow(nowT: number): boolean {
    const first = this.window[0]
    if (nowT - first.t < WINDOW_MS - FULL_WINDOW_SLACK_MS) return false
    let lastMoving: number | null = null
    for (const f of this.window) {
      if (isMoving(f)) {
        if (lastMoving === null && f.t - first.t > FULL_WINDOW_SLACK_MS) return false // it only started part-way in
        lastMoving = f.t
      } else if (lastMoving !== null && f.t - lastMoving > MAX_GAP_MS) return false
    }
    return lastMoving !== null && nowT - lastMoving <= FULL_WINDOW_SLACK_MS // the motion runs up to now, not just up to a pause
  }
}
