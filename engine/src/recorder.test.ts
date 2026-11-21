import { describe, expect, it } from 'vitest'
import type { SessionLabel } from '../../contracts/engine.ts'
import { HOP, WINDOW } from './pipeline.ts'
import { SessionRecorder, encodeWav, formatIsoWithOffset, safeName } from './recorder.ts'

const FS = 48000
const LABEL: SessionLabel = { person: 'Ian', gesture: 'PUSH', laptop: 'MBP Ian', note: 'first take' }
const WHEN = new Date(2026, 10, 20, 23, 10, 5) // local time: Fri 20 Nov 2026 23:10:05

function recorder(label: SessionLabel = LABEL): SessionRecorder {
  return new SessionRecorder({ label, sampleRate: FS, toneHz: 20000, toneDbfs: -36, now: WHEN })
}

function ramp(n: number, offset = 0): Float32Array {
  return Float32Array.from({ length: n }, (_, i) => (i + offset) / 1000)
}

/** Feed `count` hops, each followed by a frame with the given motion energy (dB over floor). */
function feed(rec: SessionRecorder, count: number, energyDb: number): void {
  for (let i = 0; i < count; i++) {
    rec.pushChunk(new Float32Array(HOP))
    rec.pushFrame({ energyToward: energyDb, energyAway: 0 })
  }
}

describe('safeName', () => {
  it('lowercases and replaces anything outside a-z 0-9 with a single dash', () => {
    expect(safeName('MBP Ian!')).toBe('mbp-ian')
    expect(safeName('  Ünï/çode  ')).toBe('n-ode')
  })
  it('never returns an empty name', () => {
    expect(safeName('///')).toBe('x')
  })
})

describe('formatIsoWithOffset', () => {
  it('writes local time with the numeric UTC offset', () => {
    expect(formatIsoWithOffset(WHEN)).toMatch(/^2026-11-20T23:10:05[+-]\d{2}:\d{2}$/)
  })
})

describe('encodeWav', () => {
  it('writes a mono float32 WAV that round-trips the samples', async () => {
    const samples = ramp(300)
    const buf = await encodeWav([samples.slice(0, 100), samples.slice(100)], FS).arrayBuffer()
    const view = new DataView(buf)
    const tag = (at: number) => String.fromCharCode(...new Uint8Array(buf, at, 4))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(tag(12)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(3) // IEEE float
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(FS)
    expect(view.getUint16(34, true)).toBe(32)
    expect(tag(36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(300 * 4)
    expect(view.getUint32(4, true)).toBe(buf.byteLength - 8)
    const back = new Float32Array(buf, 44, 300)
    expect(Array.from(back)).toEqual(Array.from(samples))
  })

  it('writes a valid empty WAV', async () => {
    const buf = await encodeWav([], FS).arrayBuffer()
    expect(buf.byteLength).toBe(44)
  })
})

describe('SessionRecorder', () => {
  it('names the file person_gesture_laptop_timestamp.wav', () => {
    const rec = recorder()
    rec.pushChunk(ramp(HOP))
    expect(rec.finish().filename).toBe('ian_PUSH_mbp-ian_20261120-231005.wav')
  })

  it('records every sample of every chunk, unchanged, and copies the chunks it is given', async () => {
    const rec = recorder()
    const a = ramp(HOP)
    rec.pushChunk(a)
    a.fill(99) // the caller reuses its buffer
    rec.pushChunk(ramp(HOP, HOP))
    const { wav } = rec.finish()
    const buf = await wav.arrayBuffer()
    expect(buf.byteLength).toBe(44 + 2 * HOP * 4)
    expect(Array.from(new Float32Array(buf, 44, 5))).toEqual(Array.from(ramp(5)))
  })

  it('describes the session in the JSON meta exactly as contracts/recording.md says', () => {
    const rec = recorder()
    rec.pushChunk(ramp(HOP))
    const { meta } = rec.finish()
    expect(meta).toMatchObject({
      person: 'Ian',
      gesture: 'PUSH',
      laptop: 'MBP Ian',
      note: 'first take',
      sampleRate: FS,
      toneHz: 20000,
      toneDbfs: -36,
      reps: [],
    })
    expect(Object.keys(meta).sort()).toEqual(
      ['createdAt', 'gesture', 'laptop', 'note', 'person', 'reps', 'sampleRate', 'toneDbfs', 'toneHz'],
    )
  })

  it('defaults the note to an empty string', () => {
    const rec = recorder({ person: 'ian', gesture: 'FREE', laptop: 'mbp' })
    expect((rec.finish().meta as { note: string }).note).toBe('')
  })

  it('marks a burst of motion as one rep, labelled with the session gesture, in sample indices', () => {
    const rec = recorder()
    feed(rec, 40, 0) // still
    feed(rec, 20, 25) // motion
    feed(rec, 40, 0) // still
    const { reps } = rec.finish().meta as { reps: Array<{ start: number; end: number; label: string }> }
    expect(reps).toHaveLength(1)
    expect(reps[0].label).toBe('PUSH')
    // frame i is centred WINDOW/2 samples before the end of hop i
    const centre = (hop: number) => (hop + 1) * HOP - WINDOW / 2
    expect(reps[0].start).toBe(centre(40))
    expect(reps[0].end).toBeGreaterThanOrEqual(centre(59))
    expect(reps[0].end).toBeLessThanOrEqual(centre(59) + 10 * HOP)
  })

  it('keeps a pause shorter than the gap inside one rep and splits on a longer one', () => {
    const rec = recorder()
    feed(rec, 10, 25)
    feed(rec, 3, 0) // short pause
    feed(rec, 10, 25)
    feed(rec, 30, 0) // long quiet
    feed(rec, 10, 25)
    feed(rec, 30, 0)
    expect((rec.finish().meta as { reps: unknown[] }).reps).toHaveLength(2)
  })

  it('ignores a single noisy frame', () => {
    const rec = recorder()
    feed(rec, 20, 0)
    feed(rec, 1, 25)
    feed(rec, 30, 0)
    expect((rec.finish().meta as { reps: unknown[] }).reps).toHaveLength(0)
  })

  it('closes a rep that is still going when recording stops', () => {
    const rec = recorder()
    feed(rec, 20, 0)
    feed(rec, 15, 25)
    const { reps } = rec.finish().meta as { reps: Array<{ start: number; end: number }> }
    expect(reps).toHaveLength(1)
    expect(reps[0].end).toBeGreaterThan(reps[0].start)
  })

  it('rejects use after finish()', () => {
    const rec = recorder()
    rec.finish()
    expect(() => rec.pushChunk(new Float32Array(HOP))).toThrow()
    expect(() => rec.finish()).toThrow()
  })
})
