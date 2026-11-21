import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildFloor } from './dsp.ts'
import { FramePipeline, HOP, WINDOW } from './pipeline.ts'

const FS = 48000
const dbToAmp = (db: number): number => 10 ** (db / 20)

/** Continuous synthetic mic stream, chunked by HOP samples. */
function makeStream(parts: ReadonlyArray<{ hz: number; amp: number }>, noiseAmp: number, seed = 7) {
  let sample = 0
  let s = seed
  return (): Float32Array => {
    const out = new Float32Array(HOP)
    for (let i = 0; i < HOP; i++, sample++) {
      s = (s * 1664525 + 1013904223) >>> 0
      let v = (s / 0xffffffff - 0.5) * 2 * noiseAmp
      for (const { hz, amp } of parts) v += amp * Math.sin((2 * Math.PI * hz * sample) / FS)
      out[i] = v
    }
    return out
  }
}

const carrier = { hz: 20000, amp: dbToAmp(-36) }
const noise = dbToAmp(-100)

function feed(p: FramePipeline, next: () => Float32Array, chunks: number) {
  const frames = []
  for (let i = 0; i < chunks; i++) {
    const f = p.push(next(), i * 21)
    if (f) frames.push(f)
  }
  return frames
}

describe('FramePipeline', () => {
  it('stays silent until a full window has arrived, then emits one frame per hop', () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const frames = feed(p, makeStream([carrier], noise), WINDOW / HOP + 2)
    expect(frames.length).toBe(3)
  })

  it('emits tone-centred frames of about +-500 Hz', () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const [frame] = feed(p, makeStream([carrier], noise), WINDOW / HOP)
    expect(frame.binHz).toBeCloseTo(FS / WINDOW, 6)
    expect(frame.bins.length % 2).toBe(1)
    expect((frame.bins.length - 1) * frame.binHz).toBeGreaterThan(900)
    expect((frame.bins.length - 1) * frame.binHz).toBeLessThan(1100)
  })

  it('reports zero shift and energy while it has no floor yet', () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const moving = makeStream([carrier, { hz: 20117, amp: dbToAmp(-56) }], noise)
    const frames = feed(p, moving, 8)
    expect(frames.every((f) => f.shiftHz === 0 && f.energyToward === 0 && f.energyAway === 0)).toBe(true)
  })

  it('resolves calibration after enough frames and then measures a positive shift for a push', async () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const done = p.beginCalibration(300)
    const still = makeStream([carrier], noise)
    feed(p, still, 40)
    await done
    expect(p.isCalibrated).toBe(true)

    const moving = makeStream([carrier, { hz: 20117, amp: dbToAmp(-56) }], noise, 99)
    const frames = feed(p, moving, WINDOW / HOP + 4)
    const last = frames[frames.length - 1]
    expect(last.shiftHz).toBeGreaterThan(60)
    expect(last.energyToward).toBeGreaterThan(20)
  })

  it('measures a negative shift for a receding hand', async () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const done = p.beginCalibration(300)
    feed(p, makeStream([carrier], noise), 40)
    await done
    const moving = makeStream([carrier, { hz: 19883, amp: dbToAmp(-56) }], noise, 99)
    const frames = feed(p, moving, WINDOW / HOP + 4)
    expect(frames[frames.length - 1].shiftHz).toBeLessThan(-60)
  })

  it('reports a healthy SNR for a clean tone', () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    feed(p, makeStream([carrier], dbToAmp(-90)), 30)
    expect(p.snrDb).toBeGreaterThan(30)
  })

  it('does not invent motion in a still room after the 1 s auto-calibration', async () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const room = makeStream([{ hz: 20000, amp: dbToAmp(-45) }], dbToAmp(-70), 3)
    const done = p.beginCalibration(1000)
    feed(p, room, 60)
    await done
    const frames = feed(p, room, 400)
    const phantom = frames.filter((f) => f.shiftHz !== 0).length
    expect(phantom / frames.length).toBeLessThan(0.02)
  })

  it('still sees a real push in that noisy room', async () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const done = p.beginCalibration(1000)
    feed(p, makeStream([{ hz: 20000, amp: dbToAmp(-45) }], dbToAmp(-70), 3), 60)
    await done
    const push = makeStream([{ hz: 20000, amp: dbToAmp(-45) }, { hz: 20117, amp: dbToAmp(-62) }], dbToAmp(-70), 4)
    const frames = feed(p, push, 30)
    const last = frames[frames.length - 1]
    expect(last.shiftHz).toBeGreaterThan(80)
    expect(last.shiftHz).toBeLessThan(150)
  })

  it('reports the shift relative to the tone, not to the nearest bin centre', async () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const done = p.beginCalibration(300)
    feed(p, makeStream([carrier], noise), 40)
    await done
    const frames = feed(p, makeStream([carrier, { hz: 20117, amp: dbToAmp(-50) }], noise, 5), 8)
    expect(frames[frames.length - 1].shiftHz).toBeGreaterThan(105)
    expect(frames[frames.length - 1].shiftHz).toBeLessThan(130)
  })

  it('lets an explicit calibrate() override a shorter one already running', async () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const short = p.beginCalibration(100)
    const long = p.beginCalibration(1000)
    let longDone = false
    void long.then(() => {
      longDone = true
    })
    feed(p, makeStream([carrier], noise), 20)
    await short
    expect(longDone).toBe(false)
    feed(p, makeStream([carrier], noise, 9), 60)
    await long
    expect(p.isCalibrated).toBe(true)
  })

  it('rejects a pending calibration when cancelled', async () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const pending = p.beginCalibration(3000)
    p.cancelCalibration(new Error('stopped'))
    await expect(pending).rejects.toThrow('stopped')
  })

  it('timestamps frames from the hop count so a main-thread stall does not bunch them up', () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const next = makeStream([carrier], noise)
    const times: number[] = []
    for (let i = 0; i < 8; i++) {
      const f = p.push(next(), i < 6 ? i * 21.3 : 500) // last two chunks arrive late, together
      if (f) times.push(f.t)
    }
    const gaps = times.slice(1).map((t, i) => t - times[i])
    for (const gap of gaps) expect(gap).toBeCloseTo((1024 / FS) * 1000, 3)
  })

  it('does not let a listener corrupt calibration by mutating a frame', async () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const done = p.beginCalibration(1000)
    const next = makeStream([carrier], noise)
    for (let i = 0; i < 60; i++) p.push(next(), i)?.bins.fill(1000) // a listener scribbling on its frame
    await done
    const push = makeStream([carrier, { hz: 20117, amp: dbToAmp(-56) }], noise, 11)
    const frames = feed(p, push, 8)
    expect(frames[frames.length - 1].shiftHz).toBeGreaterThan(60) // a corrupted floor would hide this push
  })

  it('measures motion against a floor supplied with setFloor() instead of calibrating', () => {
    const learner = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const stillBins = feed(learner, makeStream([carrier], noise), 80).map((f) => f.bins)
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    expect(p.isCalibrated).toBe(false)
    p.setFloor(buildFloor(stillBins))
    expect(p.isCalibrated).toBe(true)
    const frames = feed(p, makeStream([carrier, { hz: 20117, amp: dbToAmp(-56) }], noise, 5), WINDOW / HOP + 4)
    expect(frames[frames.length - 1].shiftHz).toBeGreaterThan(60)
  })

  it('produces the same frames as ml/features.py for the same audio (training and live inference must agree)', () => {
    const { samples, bins } = JSON.parse(readFileSync(new URL('./fixtures/spectrum-parity.json', import.meta.url), 'utf8')) as {
      samples: number[]
      bins: number[][]
    }
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    const frames = []
    for (let i = 0; i + HOP <= samples.length; i += HOP) {
      const frame = p.push(Float32Array.from(samples.slice(i, i + HOP)), i)
      if (frame) frames.push(frame)
    }
    expect(frames.length).toBe(bins.length)
    frames.forEach((frame, f) => {
      expect(frame.bins.length).toBe(bins[f].length)
      frame.bins.forEach((value, k) => expect(Math.abs(value - bins[f][k])).toBeLessThan(0.01))
    })
  })

  it('rejects a chunk of the wrong size', () => {
    const p = new FramePipeline({ sampleRate: FS, toneHz: 20000 })
    expect(() => p.push(new Float32Array(100), 0)).toThrow()
  })

  it('rejects a sample rate that cannot carry the tone', () => {
    expect(() => new FramePipeline({ sampleRate: 22050, toneHz: 20000 })).toThrow()
  })
})
