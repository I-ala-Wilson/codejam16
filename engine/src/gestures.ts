import type { GestureEvent, GestureType, SpectrumFrame } from '../../contracts/engine.ts'
import { HabitTracker } from './habit.ts'

// Rule-based gesture detection on the stream of Doppler frames. Every threshold below is a first guess,
// to be tuned on real recordings (ml/REPORT.md has the per-gesture scores).

export type MotionFrame = Pick<SpectrumFrame, 't' | 'shiftHz' | 'energyToward' | 'energyAway'>

export interface GestureDetectorOptions {
  readonly toneHz: number
  /** Hold-off between REPETITIVE (habit) events; 3 s unless the caller knows better. */
  readonly habitRefractoryMs?: number
}

const SPEED_OF_SOUND_M_S = 343

/** A frame has a direction when |shiftHz| reaches this (about 0.26 m/s of hand speed). */
const MIN_SHIFT_HZ = 30
/** A stroke is a run of same-direction frames; it needs this many frames (about 64 ms) and this peak to count. */
const MIN_STROKE_FRAMES = 3
const MIN_STROKE_PEAK_HZ = 45
/** Up to this many direction-less frames do not break a stroke. */
const MAX_GAP_FRAMES = 2
/** Strokes closer than this form one chain, which is judged as a whole when it ends. */
const CHAIN_GAP_MS = 250
/** In a chain only strokes at least this fraction of the strongest are gestures; weaker ones are wind-up or recoil. */
const PRIMARY_RATIO = 0.5
/** UNDO is a double tap toward: two small pushes starting this close together (spec v4). */
const UNDO_WINDOW_MS = 600
/** A tap is a push smaller than this; bigger pushes are PUSH. */
const TAP_MAX_PEAK_HZ = 90
/** A WAVE is this many alternating strokes spanning at least this long. */
const WAVE_MIN_STROKES = 4
const WAVE_MIN_MS = 1000
/** HOLD: no motion for this long after some motion. */
const HOLD_MS = 1500
/** Energy (dB over the floor) that counts as motion even without a direction. */
const MOTION_DB = 10
/** OPEN_CLOSE pulses: direction-less energy bursts of this many frames, grouped when closer than the gap. */
const PULSE_MIN_FRAMES = 3
const PULSE_MAX_MS = 600
const BURST_GAP_MS = 600
/** Shift at which a rule-based confidence reaches 1. Confidence starts at 0.6 for a minimum stroke. */
const FULL_CONFIDENCE_HZ = 120

interface Stroke {
  readonly dir: 1 | -1
  readonly startT: number
  readonly endT: number
  readonly frames: number
  /** Signed shift of the strongest frame. */
  readonly peakShiftHz: number
}

interface Pulse {
  readonly startT: number
  readonly endT: number
  readonly frames: number
}

function directionOf(shiftHz: number): 1 | -1 | 0 {
  if (shiftHz >= MIN_SHIFT_HZ) return 1
  if (shiftHz <= -MIN_SHIFT_HZ) return -1
  return 0
}

const isTap = (s: Stroke): boolean => s.dir > 0 && Math.abs(s.peakShiftHz) < TAP_MAX_PEAK_HZ

/**
 * Index of the second tap when strokes[first] starts a double tap toward: another small push within UNDO_WINDOW_MS,
 * with only small pulls (return strokes) in between. Anything bigger or any other push in between breaks it.
 */
function doubleTapPartner(strokes: ReadonlyArray<Stroke>, first: number): number | null {
  if (!isTap(strokes[first])) return null
  for (let j = first + 1; j < strokes.length; j++) {
    const s = strokes[j]
    if (s.startT - strokes[first].startT > UNDO_WINDOW_MS) return null
    if (isTap(s)) return j
    if (s.dir > 0 || Math.abs(s.peakShiftHz) >= TAP_MAX_PEAK_HZ) return null
  }
  return null
}

function confidenceOf(peakAbsHz: number): number {
  const fraction = (peakAbsHz - MIN_STROKE_PEAK_HZ) / (FULL_CONFIDENCE_HZ - MIN_STROKE_PEAK_HZ)
  return 0.6 + 0.4 * Math.min(1, Math.max(0, fraction))
}

export class GestureDetector {
  private readonly toneHz: number
  private readonly habit: HabitTracker
  private open: Stroke | null = null
  private zeroRun = 0
  private chain: Stroke[] = []
  private chainIsWave = false
  /** A small tap toward that is waiting to see whether a second one makes it an UNDO. */
  private heldTap: Stroke | null = null
  private lastMotionT: number | null = null
  private holdArmed = false
  private pulse: Pulse | null = null
  private burst: Pulse[] = []

  constructor(opts: GestureDetectorOptions) {
    this.toneHz = opts.toneHz
    this.habit = new HabitTracker({ refractoryMs: opts.habitRefractoryMs })
  }

  reset(): void {
    this.habit.reset()
    this.open = null
    this.zeroRun = 0
    this.chain = []
    this.chainIsWave = false
    this.heldTap = null
    this.lastMotionT = null
    this.holdArmed = false
    this.pulse = null
    this.burst = []
  }

  /** Feed one frame; returns the gestures that became certain at this frame (often none). */
  push(frame: MotionFrame): GestureEvent[] {
    const events: GestureEvent[] = []
    const dir = directionOf(frame.shiftHz)
    const energy = Math.max(frame.energyToward, frame.energyAway)

    this.finishChainIfIdle(frame.t, events)
    this.flushStaleTap(frame.t, events)
    this.trackStroke(frame, dir, events)
    this.trackPulse(frame, dir, energy)
    this.trackHold(frame.t, dir !== 0 || energy > MOTION_DB, events)
    this.finishBurstIfIdle(frame.t, events)
    events.push(...this.habit.push(frame))
    return events
  }

  private trackStroke(frame: MotionFrame, dir: 1 | -1 | 0, events: GestureEvent[]): void {
    if (dir === 0) {
      if (this.open && ++this.zeroRun > MAX_GAP_FRAMES) this.closeStroke(events)
      return
    }
    this.zeroRun = 0
    const open = this.open
    if (open && open.dir === dir) {
      const stronger = Math.abs(frame.shiftHz) > Math.abs(open.peakShiftHz)
      this.open = {
        ...open,
        endT: frame.t,
        frames: open.frames + 1,
        peakShiftHz: stronger ? frame.shiftHz : open.peakShiftHz,
      }
      return
    }
    if (open) this.closeStroke(events)
    this.burst = [] // motion with a direction is not an open/close pulse
    this.pulse = null
    this.open = { dir, startT: frame.t, endT: frame.t, frames: 1, peakShiftHz: frame.shiftHz }
  }

  private closeStroke(events: GestureEvent[]): void {
    const stroke = this.open
    this.open = null
    this.zeroRun = 0
    if (!stroke || stroke.frames < MIN_STROKE_FRAMES || Math.abs(stroke.peakShiftHz) < MIN_STROKE_PEAK_HZ) return
    this.chain = [...this.chain, stroke]
    this.detectWave(events)
  }

  /** A WAVE is called as soon as enough alternating strokes have gone by, without waiting for the chain to end. */
  private detectWave(events: GestureEvent[]): void {
    if (this.chainIsWave) return
    const chain = this.chain
    let alternating = 1
    for (let i = chain.length - 1; i > 0 && chain[i].dir !== chain[i - 1].dir; i--) alternating += 1
    if (alternating < WAVE_MIN_STROKES) return
    const first = chain[chain.length - alternating]
    const last = chain[chain.length - 1]
    if (last.endT - first.startT < WAVE_MIN_MS) return
    this.chainIsWave = true
    events.push(this.event('WAVE', last, Math.abs(last.peakShiftHz)))
  }

  private finishChainIfIdle(t: number, events: GestureEvent[]): void {
    const chain = this.chain
    if (chain.length === 0 || this.open) return
    if (t - chain[chain.length - 1].endT <= CHAIN_GAP_MS) return
    this.chain = []
    if (this.chainIsWave) {
      this.chainIsWave = false
      return
    }
    const strongest = Math.max(...chain.map((s) => Math.abs(s.peakShiftHz)))
    const primaries = chain.filter((s) => Math.abs(s.peakShiftHz) >= PRIMARY_RATIO * strongest)
    for (let i = 0; i < primaries.length; i++) {
      const second = doubleTapPartner(primaries, i)
      if (second !== null) {
        this.flushHeldTap(events)
        events.push(this.event('UNDO', primaries[second], Math.abs(primaries[second].peakShiftHz)))
        i = second
        continue
      }
      this.emitStroke(primaries[i], events)
    }
  }

  /**
   * One settled stroke becomes an event, except a small tap toward: that waits up to UNDO_WINDOW_MS for a second tap,
   * because a natural double tap has a longer gap than a chain allows (the contract says up to ~600 ms apart).
   */
  private emitStroke(stroke: Stroke, events: GestureEvent[]): void {
    const peak = Math.abs(stroke.peakShiftHz)
    const held = this.heldTap
    if (held && stroke.dir < 0 && peak < TAP_MAX_PEAK_HZ && stroke.startT - held.startT <= UNDO_WINDOW_MS) return // a return stroke
    if (!isTap(stroke)) {
      this.flushHeldTap(events)
      events.push(this.event(stroke.dir > 0 ? 'PUSH' : 'PULL', stroke, peak))
      return
    }
    if (held && stroke.startT - held.startT <= UNDO_WINDOW_MS) {
      this.heldTap = null
      events.push(this.event('UNDO', stroke, peak))
      return
    }
    this.flushHeldTap(events)
    this.heldTap = stroke
  }

  private flushHeldTap(events: GestureEvent[]): void {
    const held = this.heldTap
    if (!held) return
    this.heldTap = null
    events.push(this.event('PUSH', held, Math.abs(held.peakShiftHz)))
  }

  /** A waiting tap becomes a plain PUSH once no second tap can still arrive inside the UNDO window. */
  private flushStaleTap(t: number, events: GestureEvent[]): void {
    const held = this.heldTap
    if (!held || t - held.startT <= UNDO_WINDOW_MS || this.open || this.chain.length > 0) return
    this.flushHeldTap(events)
  }

  private event(type: GestureType, stroke: Stroke, peakAbsHz: number): GestureEvent {
    return {
      type,
      t: stroke.endT,
      confidence: confidenceOf(peakAbsHz),
      speed: (SPEED_OF_SOUND_M_S * stroke.peakShiftHz) / (2 * this.toneHz),
      source: 'rules',
    }
  }

  private trackPulse(frame: MotionFrame, dir: 1 | -1 | 0, energy: number): void {
    const active = energy > MOTION_DB && dir === 0 && this.open === null
    const pulse = this.pulse
    if (active) {
      this.pulse = pulse
        ? { ...pulse, endT: frame.t, frames: pulse.frames + 1 }
        : { startT: frame.t, endT: frame.t, frames: 1 }
      return
    }
    if (!pulse) return
    this.pulse = null
    if (pulse.frames >= PULSE_MIN_FRAMES && pulse.endT - pulse.startT <= PULSE_MAX_MS) {
      this.burst = [...this.burst, pulse]
    }
  }

  private finishBurstIfIdle(t: number, events: GestureEvent[]): void {
    const burst = this.burst
    if (burst.length === 0 || this.pulse) return
    const lastEnd = burst[burst.length - 1].endT
    if (t - lastEnd <= BURST_GAP_MS) return
    this.burst = []
    events.push({ type: 'OPEN_CLOSE', t: lastEnd, confidence: 0.6, count: burst.length, source: 'rules' })
  }

  private trackHold(t: number, moving: boolean, events: GestureEvent[]): void {
    if (moving) {
      this.lastMotionT = t
      this.holdArmed = true
      return
    }
    if (!this.holdArmed || this.lastMotionT === null || this.chain.length > 0 || this.open) return
    if (t - this.lastMotionT < HOLD_MS) return
    this.holdArmed = false
    events.push({ type: 'HOLD', t, confidence: 0.6, source: 'rules' })
  }
}
