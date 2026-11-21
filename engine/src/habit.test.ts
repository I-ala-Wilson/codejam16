import { describe, expect, it } from 'vitest'
import type { GestureEvent } from '../../contracts/engine.ts'
import { HabitTracker } from './habit.ts'
import type { MotionFrame } from './gestures.ts'

const HOP_MS = (1024 / 48000) * 1000

type Part =
  | { readonly still: number }
  | { readonly flipEveryFrames: ReadonlyArray<number>; readonly ms: number; readonly shiftHz?: number; readonly energy?: number }

/** Frames of hand motion that flips direction every `flipEveryFrames[i]` frames (cycling through the list), or stillness. */
function frames(parts: ReadonlyArray<Part>, startMs = 0): MotionFrame[] {
  const out: MotionFrame[] = []
  let t = startMs
  let sign = 1
  for (const part of parts) {
    const n = Math.max(1, Math.round(('still' in part ? part.still : part.ms) / HOP_MS))
    if ('still' in part) {
      for (let i = 0; i < n; i++, t += HOP_MS) out.push({ t, shiftHz: 0, energyToward: 0, energyAway: 0 })
      continue
    }
    let cycle = 0
    let left = part.flipEveryFrames[0]
    for (let i = 0; i < n; i++, t += HOP_MS) {
      const shift = sign * (part.shiftHz ?? 80)
      const e = part.energy ?? 20
      out.push({ t, shiftHz: shift, energyToward: shift > 0 ? e : 0, energyAway: shift < 0 ? e : 0 })
      if (--left === 0) {
        sign = -sign
        cycle = (cycle + 1) % part.flipEveryFrames.length
        left = part.flipEveryFrames[cycle]
      }
    }
  }
  return out
}

function run(parts: ReadonlyArray<Part>, options?: ConstructorParameters<typeof HabitTracker>[0]): GestureEvent[] {
  const tracker = new HabitTracker(options)
  return frames(parts).flatMap((f) => tracker.push(f))
}

const FOUR_PER_SECOND = [12] // a flip every 12 frames (256 ms): about 3.9 flips a second

describe('HabitTracker', () => {
  it('emits nothing in 30 s of stillness or for direction-less energy', () => {
    expect(run([{ still: 30_000 }])).toEqual([])
    const pulses: Part[] = Array.from({ length: 40 }, () => [{ flipEveryFrames: [1000], ms: 300, shiftHz: 0, energy: 25 } as Part, { still: 100 } as Part]).flat()
    expect(run(pulses)).toEqual([])
  })

  it('reports REPETITIVE once the hand has gone back and forth 2-6 times a second for 1.5 s', () => {
    const events = run([{ still: 500 }, { flipEveryFrames: FOUR_PER_SECOND, ms: 2400 }, { still: 600 }])
    expect(events).toHaveLength(1)
    const [e] = events
    expect(e.type).toBe('REPETITIVE')
    expect(e.source).toBe('rules')
    expect(e.t - 500).toBeGreaterThanOrEqual(1450) // 1.5 s of motion, to within one 21 ms frame
    expect(e.t - 500).toBeLessThan(2200)
  })

  it('does not report it before 1.5 s of motion', () => {
    expect(run([{ still: 500 }, { flipEveryFrames: FOUR_PER_SECOND, ms: 1300 }, { still: 600 }])).toEqual([])
  })

  it('gives a steady rhythm a high confidence and a ragged one a lower one', () => {
    const steady = run([{ flipEveryFrames: FOUR_PER_SECOND, ms: 2400 }])[0]
    const ragged = run([{ flipEveryFrames: [4, 22], ms: 2400 }])[0] // 85 ms then 470 ms, about 3.6 flips a second on average
    expect(steady.confidence).toBeGreaterThanOrEqual(0.9)
    expect(steady.confidence).toBeLessThanOrEqual(1)
    expect(ragged.confidence).toBeGreaterThanOrEqual(0.6)
    expect(ragged.confidence).toBeLessThan(steady.confidence - 0.15)
  })

  it('ignores a rhythm that is too slow (1 a second) or too fast (8 a second)', () => {
    expect(run([{ flipEveryFrames: [47], ms: 4000 }])).toEqual([])
    expect(run([{ flipEveryFrames: [6], ms: 4000 }])).toEqual([])
  })

  it('needs the motion to be continuous: a 400 ms stop resets it', () => {
    const seq: Part[] = [{ flipEveryFrames: FOUR_PER_SECOND, ms: 1000 }, { still: 400 }, { flipEveryFrames: FOUR_PER_SECOND, ms: 1000 }, { still: 600 }]
    expect(run(seq)).toEqual([])
  })

  it('does not count a single stroke or a lone noisy frame as a rhythm', () => {
    expect(run([{ flipEveryFrames: [1000], ms: 2500 }])).toEqual([])
    const noisy = frames([{ still: 2000 }]).map((f, i) => (i % 9 === 0 ? { ...f, shiftHz: i % 18 === 0 ? 70 : -70, energyToward: 12, energyAway: 12 } : f))
    const tracker = new HabitTracker()
    expect(noisy.flatMap((f) => tracker.push(f))).toEqual([])
  })

  it('holds off for 3 s while a habit goes on, then reports it again', () => {
    const events = run([{ flipEveryFrames: FOUR_PER_SECOND, ms: 8000 }])
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < events.length; i++) expect(events[i].t - events[i - 1].t).toBeGreaterThanOrEqual(3000)
  })

  it('takes the hold-off from its options', () => {
    const quick = run([{ flipEveryFrames: FOUR_PER_SECOND, ms: 8000 }], { refractoryMs: 1000 })
    expect(quick.length).toBeGreaterThan(run([{ flipEveryFrames: FOUR_PER_SECOND, ms: 8000 }]).length)
  })

  it('forgets everything on reset()', () => {
    const tracker = new HabitTracker()
    frames([{ flipEveryFrames: FOUR_PER_SECOND, ms: 1400 }]).forEach((f) => tracker.push(f))
    tracker.reset()
    const after = frames([{ flipEveryFrames: FOUR_PER_SECOND, ms: 1000 }], 5000).flatMap((f) => tracker.push(f))
    expect(after).toEqual([]) // 1.0 s since the reset, and the 1.4 s before it no longer counts
  })
})
