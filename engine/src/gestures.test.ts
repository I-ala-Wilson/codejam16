import { describe, expect, it } from 'vitest'
import type { GestureEvent } from '../../contracts/engine.ts'
import { GestureDetector, type MotionFrame } from './gestures.ts'

const HOP_MS = (1024 / 48000) * 1000
const TONE_HZ = 20000

type Part =
  | { readonly still: number }
  | { readonly stroke: 1 | -1; readonly peakHz: number; readonly ms: number }
  | { readonly pulseDb: number; readonly ms: number }

/** Build a frame sequence: stillness, half-sine strokes of Doppler shift, and direction-less energy pulses. */
function frames(parts: ReadonlyArray<Part>, startMs = 0): MotionFrame[] {
  const out: MotionFrame[] = []
  let t = startMs
  const add = (shiftHz: number, toward: number, away: number): void => {
    out.push({ t, shiftHz, energyToward: toward, energyAway: away })
    t += HOP_MS
  }
  for (const part of parts) {
    const n = Math.max(1, Math.round(('still' in part ? part.still : part.ms) / HOP_MS))
    for (let i = 0; i < n; i++) {
      if ('still' in part) add(0, 0, 0)
      else if ('stroke' in part) {
        const shift = part.stroke * part.peakHz * Math.sin((Math.PI * (i + 0.5)) / n)
        add(shift, part.stroke > 0 ? 20 : 0, part.stroke < 0 ? 20 : 0)
      } else add(0, part.pulseDb, part.pulseDb)
    }
  }
  return out
}

function run(parts: ReadonlyArray<Part>, opts = { toneHz: TONE_HZ }): GestureEvent[] {
  const detector = new GestureDetector(opts)
  return frames(parts).flatMap((f) => detector.push(f))
}

const types = (events: ReadonlyArray<GestureEvent>): string[] => events.map((e) => e.type)

const push = (peakHz = 110, ms = 250): Part => ({ stroke: 1, peakHz, ms })
const pull = (peakHz = 110, ms = 250): Part => ({ stroke: -1, peakHz, ms })

describe('GestureDetector', () => {
  it('emits nothing in 30 s of stillness', () => {
    expect(run([{ still: 30_000 }])).toEqual([])
  })

  it('emits nothing for quiet noise that never forms a direction', () => {
    const noisy: Part[] = Array.from({ length: 200 }, () => ({ pulseDb: 3, ms: HOP_MS }))
    expect(run([...noisy, { still: 2000 }]).filter((e) => e.type !== 'HOLD')).toEqual([])
  })

  it('reports a brisk push as one PUSH with a positive speed and rules confidence', () => {
    const events = run([{ still: 500 }, push(), { still: 600 }])
    expect(types(events)).toEqual(['PUSH'])
    const [e] = events
    expect(e.source).toBe('rules')
    expect(e.confidence).toBeGreaterThanOrEqual(0.6)
    expect(e.confidence).toBeLessThanOrEqual(1)
    expect(e.speed).toBeCloseTo((343 * 110) / (2 * TONE_HZ), 0) // about 0.94 m/s
  })

  it('reports a pull as one PULL with a negative speed', () => {
    const events = run([{ still: 500 }, pull(), { still: 600 }])
    expect(types(events)).toEqual(['PULL'])
    expect(events[0].speed).toBeLessThan(0)
  })

  it('scales speed with the tone frequency', () => {
    const slow = run([push(), { still: 600 }], { toneHz: 40000 })[0]
    expect(slow.speed).toBeCloseTo((343 * 110) / (2 * 40000), 0)
  })

  it('ignores a one-frame spike and a drift below the minimum shift', () => {
    const spike: Part = { stroke: 1, peakHz: 150, ms: HOP_MS }
    const drift: Part = { stroke: 1, peakHz: 20, ms: 400 }
    expect(types(run([spike, { still: 600 }, drift, { still: 600 }]))).toEqual([])
  })

  it('treats a short pull right before a push as a wind-up, not a PULL', () => {
    const events = run([pull(55, 150), { still: 100 }, push(120), { still: 600 }])
    expect(types(events)).toEqual(['PUSH'])
  })

  it('treats the weak return stroke after a push as recoil, not a PULL', () => {
    const events = run([push(120), pull(50, 180), { still: 600 }])
    expect(types(events)).toEqual(['PUSH'])
  })

  it('reports UNDO for a double tap toward: two small pushes within 600 ms', () => {
    const events = run([{ still: 300 }, push(60, 140), { still: 120 }, push(60, 140), { still: 700 }])
    expect(types(events)).toEqual(['UNDO'])
    expect(events[0].speed).toBeGreaterThan(0)
  })

  it.each([200, 300, 450])('reports UNDO for a natural double tap with a %i ms gap (within the 600 ms contract)', (gap) => {
    const events = run([{ still: 300 }, push(60, 140), { still: gap }, push(60, 140), { still: 1500 }])
    expect(types(events)).toEqual(['UNDO'])
    expect(events[0].speed).toBeGreaterThan(0)
  })

  it('still reports a lone small tap as PUSH, once the UNDO window has passed', () => {
    const events = run([{ still: 300 }, push(60, 140), { still: 1500 }])
    expect(types(events)).toEqual(['PUSH'])
  })

  it('does not delay a normal push waiting for a second tap', () => {
    const detector = new GestureDetector({ toneHz: TONE_HZ })
    const seq = frames([push(110, 250), { still: 600 }])
    const first = seq.map((f) => ({ f, e: detector.push(f) })).find((x) => x.e.length > 0)
    expect(first?.e[0].type).toBe('PUSH')
    expect(first!.f.t - seq.find((f) => f.shiftHz !== 0)!.t).toBeLessThan(700) // fires about 250 ms after the motion ends
  })

  it('does not turn two taps more than 600 ms apart into an UNDO (start to start)', () => {
    const events = run([push(60, 140), { still: 550 }, push(60, 140), { still: 1500 }])
    expect(types(events)).toEqual(['PUSH', 'PUSH'])
  })

  it('still reports UNDO when a weak return stroke sits between the two taps', () => {
    const events = run([push(70, 140), pull(40, 100), push(70, 140), { still: 700 }])
    expect(types(events)).toEqual(['UNDO'])
  })

  it('does not call two big pushes an UNDO', () => {
    const events = run([push(120, 200), { still: 100 }, push(120, 200), { still: 700 }])
    expect(types(events)).toEqual(['PUSH', 'PUSH'])
  })

  it('does not call two small taps more than 600 ms apart an UNDO', () => {
    const events = run([push(60, 140), { still: 900 }, push(60, 140), { still: 700 }])
    expect(types(events)).toEqual(['PUSH', 'PUSH'])
  })

  it('treats two pulls within 600 ms as two PULLs, not UNDO', () => {
    const events = run([pull(120, 150), push(45, 120), pull(120, 150), { still: 600 }])
    expect(types(events)).toEqual(['PULL', 'PULL'])
  })

  it('reports two plain PULLs when they are more than 600 ms apart', () => {
    const events = run([pull(), { still: 900 }, pull(), { still: 600 }])
    expect(types(events)).toEqual(['PULL', 'PULL'])
  })

  it('reports a WAVE once for 1.6 s of fast back-and-forth, and no PUSH or PULL for its strokes', () => {
    const wave: Part[] = Array.from({ length: 8 }, (_, i) => ({ stroke: i % 2 === 0 ? 1 : -1, peakHz: 100, ms: 200 }))
    const events = run([{ still: 300 }, ...wave, { still: 800 }])
    expect(types(events).filter((t) => t === 'WAVE')).toHaveLength(1)
    expect(types(events)).not.toContain('PUSH')
    expect(types(events)).not.toContain('PULL')
  })

  it('does not call a short two-stroke shake a WAVE', () => {
    const events = run([push(110, 180), pull(110, 180), { still: 800 }])
    expect(types(events)).not.toContain('WAVE')
  })

  it('reports HOLD once, 1.5 s after the last motion', () => {
    const detector = new GestureDetector({ toneHz: TONE_HZ })
    const seq = frames([push(), { still: 3000 }])
    const emitted = seq.flatMap((f) => detector.push(f).map((e) => ({ e, f })))
    expect(emitted.map((x) => x.e.type)).toEqual(['PUSH', 'HOLD'])
    const lastMotion = seq.filter((f) => f.shiftHz !== 0).at(-1)!.t
    const hold = emitted.find((x) => x.e.type === 'HOLD')!
    expect(hold.e.t - lastMotion).toBeGreaterThanOrEqual(1500)
    expect(hold.e.t - lastMotion).toBeLessThan(1700)
  })

  it('does not report HOLD before there has been any motion', () => {
    expect(types(run([{ still: 5000 }]))).not.toContain('HOLD')
  })

  it('counts direction-less energy pulses in one burst as one OPEN_CLOSE with a count', () => {
    const p: Part = { pulseDb: 15, ms: 160 }
    const events = run([{ still: 300 }, p, { still: 200 }, p, { still: 200 }, p, { still: 1000 }])
    const oc = events.filter((e) => e.type === 'OPEN_CLOSE')
    expect(oc).toHaveLength(1)
    expect(oc[0].count).toBe(3)
  })

  it('does not mistake a push or pull for an OPEN_CLOSE', () => {
    expect(types(run([push(), { still: 1000 }]))).not.toContain('OPEN_CLOSE')
  })

  it('forgets everything on reset()', () => {
    const detector = new GestureDetector({ toneHz: TONE_HZ })
    const seq = frames([push(110, 250)])
    seq.forEach((f) => detector.push(f))
    detector.reset()
    const after = frames([{ still: 3000 }], 10_000).flatMap((f) => detector.push(f))
    expect(after).toEqual([])
  })
})
