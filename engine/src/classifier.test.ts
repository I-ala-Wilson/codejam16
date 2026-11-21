import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CLASS_NAMES,
  ClassifierRuntime,
  DEFAULT_DECODER,
  EventDecoder,
  FrameWindow,
  WINDOW_FRAMES,
  createOnnxRunner,
  softmax,
  type ClassifierEvent,
  type ModelRunner,
} from './classifier.ts'

const fixture = (name: string): string => new URL(`./fixtures/${name}`, import.meta.url).pathname
const BINS = 87

describe('EventDecoder matches the Python reference decoder', () => {
  const cases = JSON.parse(readFileSync(fixture('decoder-cases.json'), 'utf8')) as {
    cases: Array<{ probs: number[][]; timesS: number[]; events: Array<{ cls: string; tS: number }> }>
  }

  it.each(cases.cases.map((c, i) => [i, c] as const))('case %i fires the same events at the same times', (_i, c) => {
    const decoder = new EventDecoder(DEFAULT_DECODER)
    const got: Array<{ cls: string; tS: number }> = []
    c.probs.forEach((p, k) => {
      const event = decoder.push(p, c.timesS[k] * 1000)
      if (event) got.push({ cls: event.cls, tS: event.tMs / 1000 })
    })
    expect(got.map((e) => e.cls)).toEqual(c.events.map((e) => e.cls))
    got.forEach((e, k) => expect(e.tS).toBeCloseTo(c.events[k].tS, 5))
  })

  it('forgets its history on reset()', () => {
    const decoder = new EventDecoder(DEFAULT_DECODER)
    const push = [0.02, 0.9, 0.02, 0.02, 0.02, 0.02]
    expect(decoder.push(push, 0)).toBeNull()
    expect(decoder.push(push, 85)?.cls).toBe('PUSH')
    decoder.reset()
    expect(decoder.push(push, 3000)).toBeNull() // needs 2 in a row again
  })

  it('respects a stricter threshold for one class', () => {
    const decoder = new EventDecoder({ ...DEFAULT_DECODER, thresholds: { ...DEFAULT_DECODER.thresholds, PULL: 0.95 } })
    const pull = [0.02, 0.02, 0.9, 0.02, 0.02, 0.02]
    const events = Array.from({ length: 8 }, (_, i) => decoder.push(pull, i * 85)).filter(Boolean)
    expect(events).toEqual([])
  })
})

describe('softmax', () => {
  it('sums to one and orders like the logits', () => {
    const p = softmax(Float32Array.from([1, 2, 3, 0, -1, 0.5]))
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    expect(p[2]).toBeGreaterThan(p[1])
  })

  it('does not overflow on huge logits', () => {
    const p = softmax(Float32Array.from([1000, 0, 0, 0, 0, 0]))
    expect(p[0]).toBeCloseTo(1, 6)
    expect(Number.isFinite(p[1])).toBe(true)
  })
})

describe('FrameWindow', () => {
  const frame = (v: number): Float32Array => new Float32Array(BINS).fill(v)

  it('has nothing to evaluate until 48 frames have arrived, then evaluates every 4 frames', () => {
    const w = new FrameWindow()
    const evaluated: number[] = []
    for (let i = 0; i < 100; i++) if (w.push(frame(i))) evaluated.push(i)
    expect(evaluated[0]).toBe(WINDOW_FRAMES - 1)
    expect(evaluated.slice(0, 3)).toEqual([47, 51, 55])
    expect(evaluated.length).toBe(14)
  })

  it('returns the last 48 frames oldest first, laid out frame by frame', () => {
    const w = new FrameWindow()
    let last: Float32Array | null = null
    for (let i = 0; i < 52; i++) last = w.push(frame(i)) ?? last
    expect(last).not.toBeNull()
    expect(last!.length).toBe(WINDOW_FRAMES * BINS)
    expect(last![0]).toBe(4) // frames 4..51 are the window ending at frame 51
    expect(last![(WINDOW_FRAMES - 1) * BINS]).toBe(51)
  })

  it('starts counting again after reset()', () => {
    const w = new FrameWindow()
    for (let i = 0; i < 60; i++) w.push(frame(0))
    w.reset()
    const evaluated: number[] = []
    for (let i = 0; i < 60; i++) if (w.push(frame(0))) evaluated.push(i)
    expect(evaluated[0]).toBe(47)
  })

  it('rejects a frame of the wrong width', () => {
    expect(() => new FrameWindow().push(new Float32Array(10))).toThrow()
  })
})

describe('ClassifierRuntime', () => {
  const logitsFor = (name: (typeof CLASS_NAMES)[number]): Float32Array => {
    const l = new Float32Array(CLASS_NAMES.length)
    l[CLASS_NAMES.indexOf(name)] = 6
    return l
  }
  const fake = (name: (typeof CLASS_NAMES)[number]): ModelRunner & { calls: number } => ({
    calls: 0,
    async run(window: Float32Array) {
      this.calls += 1
      expect(window.length).toBe(WINDOW_FRAMES * BINS)
      return logitsFor(name)
    },
  })

  it('fires the decoded class once a window has filled and the answer has held', async () => {
    const events: ClassifierEvent[] = []
    const runtime = new ClassifierRuntime({ runner: fake('PUSH'), decoder: DEFAULT_DECODER, onEvent: (e) => events.push(e), onError: () => {} })
    for (let i = 0; i < 70; i++) runtime.push(new Float32Array(BINS), 1000 + i * 21.33)
    await runtime.idle()
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].cls).toBe('PUSH')
    expect(events[0].probability).toBeGreaterThan(0.9)
  })

  it('stays silent when the model says NONE', async () => {
    const events: ClassifierEvent[] = []
    const runtime = new ClassifierRuntime({ runner: fake('NONE'), decoder: DEFAULT_DECODER, onEvent: (e) => events.push(e), onError: () => {} })
    for (let i = 0; i < 200; i++) runtime.push(new Float32Array(BINS), i * 21.33)
    await runtime.idle()
    expect(events).toEqual([])
  })

  it('reports a model error and keeps running', async () => {
    const errors: unknown[] = []
    const broken: ModelRunner = { run: async () => Promise.reject(new Error('boom')) }
    const runtime = new ClassifierRuntime({ runner: broken, decoder: DEFAULT_DECODER, onEvent: () => {}, onError: (e) => errors.push(e) })
    for (let i = 0; i < 60; i++) runtime.push(new Float32Array(BINS), i * 21.33)
    await runtime.idle()
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('drops evaluations instead of queueing without bound when the model is slow', async () => {
    let calls = 0
    const slow: ModelRunner = {
      run: () =>
        new Promise((resolve) => {
          calls += 1
          setTimeout(() => resolve(new Float32Array(CLASS_NAMES.length)), 30)
        }),
    }
    const runtime = new ClassifierRuntime({ runner: slow, decoder: DEFAULT_DECODER, onEvent: () => {}, onError: () => {} })
    for (let i = 0; i < 400; i++) runtime.push(new Float32Array(BINS), i * 21.33) // 100 evaluations arrive at once
    await runtime.idle()
    expect(calls).toBeLessThan(20)
  })

  it('starts over on reset()', async () => {
    const runner = fake('PUSH')
    const runtime = new ClassifierRuntime({ runner, decoder: DEFAULT_DECODER, onEvent: () => {}, onError: () => {} })
    for (let i = 0; i < 40; i++) runtime.push(new Float32Array(BINS), i)
    runtime.reset()
    for (let i = 0; i < 40; i++) runtime.push(new Float32Array(BINS), i)
    await runtime.idle()
    expect(runner.calls).toBe(0) // neither run reached 48 frames
  })
})

describe('createOnnxRunner', () => {
  it('gives the same logits as PyTorch for the exported parity model', async () => {
    const model = readFileSync(fixture('parity.onnx'))
    const { window, logits } = JSON.parse(readFileSync(fixture('parity.json'), 'utf8')) as { window: number[][]; logits: number[] }
    const runner = await createOnnxRunner(new Uint8Array(model))
    const out = await runner.run(Float32Array.from(window.flat()))
    expect(out.length).toBe(CLASS_NAMES.length)
    out.forEach((v, i) => expect(v).toBeCloseTo(logits[i], 3))
  })

  it('refuses a model that is not ONNX', async () => {
    await expect(createOnnxRunner(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})
