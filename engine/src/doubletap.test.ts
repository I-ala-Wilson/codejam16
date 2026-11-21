import { describe, expect, it } from 'vitest'
import type { GestureEvent } from '../../contracts/engine.ts'
import { DoubleTapTracker } from './doubletap.ts'
import type { MotionFrame } from './gestures.ts'

const HOP_MS = (1024 / 48000) * 1000

type Part = { readonly still: number } | { readonly toward: number; readonly hz?: number } | { readonly away: number; readonly hz?: number }

/** Frames for a sequence of stillness, strokes toward the laptop (+shiftHz) and strokes away from it (-shiftHz). */
function frames(parts: ReadonlyArray<Part>): MotionFrame[] {
  const out: MotionFrame[] = []
  let t = 0
  for (const part of parts) {
    const ms = 'still' in part ? part.still : 'toward' in part ? part.toward : part.away
    const hz = 'still' in part ? 0 : 'toward' in part ? (part.hz ?? 90) : -(part.hz ?? 90)
    for (let n = Math.max(1, Math.round(ms / HOP_MS)); n > 0; n--, t += HOP_MS) {
      out.push({ t, shiftHz: hz, energyToward: hz > 0 ? 20 : 0, energyAway: hz < 0 ? 20 : 0 })
    }
  }
  return out
}

function run(parts: ReadonlyArray<Part>, options?: ConstructorParameters<typeof DoubleTapTracker>[0]): GestureEvent[] {
  const tracker = new DoubleTapTracker(options)
  return frames(parts).flatMap((f) => tracker.push(f))
}

const TAP = { toward: 100 } as const // about 5 frames, peak 90 Hz
const REST = { still: 2500 } as const

describe('DoubleTapTracker', () => {
  it('reports one UNDO for two taps toward about 300 ms apart followed by stillness', () => {
    const events = run([{ still: 500 }, TAP, { still: 200 }, TAP, REST])
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('UNDO')
    expect(events[0].source).toBe('rules')
    expect(events[0].confidence).toBeGreaterThan(0.5)
  })

  it('also accepts the real shape: tap, return stroke away, tap, return stroke', () => {
    const events = run([{ still: 500 }, TAP, { away: 80 }, { still: 100 }, TAP, { away: 80 }, REST])
    expect(events).toHaveLength(1)
  })

  it('waits for the stillness: nothing while the hand is still moving, the event comes after', () => {
    const tracker = new DoubleTapTracker()
    const all = frames([TAP, { still: 200 }, TAP, { still: 400 }, { away: 400 }, REST])
    const fired = all.filter((f) => tracker.push(f).length > 0)
    expect(fired).toHaveLength(1)
    expect(fired[0].t).toBeGreaterThan(1000)
  })

  it('ignores a single push, with or without its return stroke', () => {
    expect(run([{ still: 500 }, TAP, REST])).toEqual([])
    expect(run([{ still: 500 }, TAP, { away: 120 }, REST])).toEqual([])
  })

  it('ignores a wave-like burst of three or more strokes', () => {
    expect(run([TAP, { still: 200 }, TAP, { still: 200 }, TAP, REST])).toEqual([])
    expect(run([TAP, { away: 100 }, TAP, { away: 100 }, TAP, { away: 100 }, TAP, REST])).toEqual([])
  })

  it('ignores taps that are too close (about 100 ms) or too far apart (about 800 ms)', () => {
    expect(run([TAP, { still: 20 }, TAP, REST])).toEqual([])
    expect(run([TAP, { still: 700 }, TAP, REST])).toEqual([])
  })

  it('ignores strokes that are too short or too weak, and pulls away from the laptop', () => {
    expect(run([{ toward: 40 }, { still: 200 }, { toward: 40 }, REST])).toEqual([])
    expect(run([{ toward: 100, hz: 35 }, { still: 200 }, { toward: 100, hz: 35 }, REST])).toEqual([])
    expect(run([{ away: 100 }, { still: 200 }, { away: 100 }, REST])).toEqual([])
  })

  it('holds off after an event and reports a second double tap seconds later', () => {
    const twice = run([TAP, { still: 200 }, TAP, { still: 3000 }, TAP, { still: 200 }, TAP, REST])
    expect(twice).toHaveLength(2)
    expect(twice[1].t - twice[0].t).toBeGreaterThan(2500)
  })

  it('forgets everything on reset()', () => {
    const tracker = new DoubleTapTracker()
    frames([TAP, { still: 200 }, TAP]).forEach((f) => tracker.push(f))
    tracker.reset()
    const rest = frames([{ still: 3000 }]).map((f) => ({ ...f, t: f.t + 10_000 }))
    expect(rest.flatMap((f) => tracker.push(f))).toEqual([])
  })
})
