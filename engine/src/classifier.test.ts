import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CLASS_NAMES,
  ClassifierRuntime,
  DEFAULT_DECODER,
  EventDecoder,
  DopplerSign,
  FrameWindow,
  resolveDirection,
  WINDOW_FRAMES,
  createOnnxRunner,
  decoderFromConfig,
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
    const push = [0.02, 0.9, 0.02, 0.02, 0.02, 0.01, 0.01]
    expect(decoder.push(push, 0)).toBeNull()
    expect(decoder.push(push, 85)?.cls).toBe('PUSH')
    decoder.reset()
    expect(decoder.push(push, 3000)).toBeNull() // needs 2 in a row again
  })

  it('respects a stricter threshold for one class', () => {
    const decoder = new EventDecoder({ ...DEFAULT_DECODER, thresholds: { ...DEFAULT_DECODER.thresholds, PULL: 0.95 } })
    const pull = [0.02, 0.02, 0.9, 0.02, 0.02, 0.01, 0.01]
    const events = Array.from({ length: 8 }, (_, i) => decoder.push(pull, i * 85)).filter(Boolean)
    expect(events).toEqual([])
  })
})

describe('the habit class', () => {
  const habit = [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.94]
  const run = (decoder: EventDecoder, evals: number, start = 0): ClassifierEvent[] =>
    Array.from({ length: evals }, (_, i) => decoder.push(habit, start + i * 85)).filter((e): e is ClassifierEvent => e !== null)

  it('fires REPETITIVE once and then holds off for the 3 s habit refractory', () => {
    const events = run(new EventDecoder(DEFAULT_DECODER), 30) // 2.5 s of scratching
    expect(events.map((e) => e.cls)).toEqual(['REPETITIVE'])
  })

  it('fires again once the habit refractory has passed', () => {
    const events = run(new EventDecoder(DEFAULT_DECODER), 80) // 6.8 s
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[1].tMs - events[0].tMs).toBeGreaterThanOrEqual(3000)
  })

  it('needs a stricter probability than a gesture does', () => {
    expect(DEFAULT_DECODER.thresholds.REPETITIVE).toBeGreaterThan(DEFAULT_DECODER.thresholds.PUSH)
    const fires = (probs: number[]): boolean => {
      const decoder = new EventDecoder(DEFAULT_DECODER)
      return Array.from({ length: 10 }, (_, i) => decoder.push(probs, i * 85)).some(Boolean)
    }
    expect(fires([0.04, 0.01, 0.01, 0.01, 0.01, 0.01, 0.91])).toBe(true) // above 0.90
    expect(fires([0.09, 0.01, 0.01, 0.01, 0.01, 0.01, 0.86])).toBe(false) // a habit at 0.86 is not enough...
    expect(fires([0.09, 0.86, 0.01, 0.01, 0.01, 0.01, 0.01])).toBe(true) // ...but a push at 0.86 is
  })

  it('uses the 0.85 gesture and 0.90 habit operating point of ml/evaluate.py', () => {
    expect(DEFAULT_DECODER.thresholds).toEqual({ PUSH: 0.85, PULL: 0.85, WAVE: 0.85, OPEN_CLOSE: 0.85, UNDO: 0.85, REPETITIVE: 0.9 })
  })
})

describe('decoderFromConfig (the gesture.json next to the model)', () => {
  const seven = ['NONE', 'PUSH', 'PULL', 'WAVE', 'OPEN_CLOSE', 'UNDO', 'REPETITIVE']

  it('takes the class list, thresholds and timings from the file', () => {
    const d = decoderFromConfig({
      classes: seven,
      thresholds: { PUSH: 0.7, REPETITIVE: 0.9 },
      decoder: { smooth: 4, confirm: 3, refractoryMs: 500, waveRefractoryMs: 1100, habitRefractoryMs: 2500 },
    })
    expect(d).toMatchObject({ classes: seven, smooth: 4, confirm: 3, refractoryMs: 500, waveRefractoryMs: 1100, habitRefractoryMs: 2500 })
    expect(d.thresholds.REPETITIVE).toBe(0.9)
  })

  it('decodes a 6-output model from an old file (no classes, no habit timing) without reading past its outputs', () => {
    const d = new EventDecoder(decoderFromConfig({ thresholds: { PUSH: 0.8 }, decoder: { smooth: 3, confirm: 2 } }))
    const six = [0.02, 0.9, 0.02, 0.02, 0.02, 0.02]
    expect(d.push(six, 0)).toBeNull()
    expect(d.push(six, 85)?.cls).toBe('PUSH')
    expect(decoderFromConfig({}).habitRefractoryMs).toBe(DEFAULT_DECODER.habitRefractoryMs)
  })

  it.each([0, -1, 2.5, Number.NaN])('keeps the default smoothing and confirm counts when the file says %s', (bad) => {
    const d = decoderFromConfig({ decoder: { smooth: bad, confirm: bad } })
    expect(d.smooth).toBe(DEFAULT_DECODER.smooth)
    expect(d.confirm).toBe(DEFAULT_DECODER.confirm)
  })

  it('decodes a 6-output model with no file at all (the defaults)', () => {
    const d = new EventDecoder(DEFAULT_DECODER)
    const six = [0.02, 0.9, 0.02, 0.02, 0.02, 0.02]
    d.push(six, 0)
    expect(d.push(six, 85)?.cls).toBe('PUSH')
  })

  it.each([null, 'x', 42, [], { classes: 'PUSH' }, { classes: [1, 2] }, { classes: ['PUSH', 'NONE'] }])(
    'falls back to the default class list for a malformed file: %j',
    (bad) => {
      expect(decoderFromConfig(bad).classes).toEqual(DEFAULT_DECODER.classes)
    },
  )
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

  it('can be given only the .wasm file (an object), so no .mjs loader is imported from a folder', async () => {
    const wasm = new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url).pathname
    const model = readFileSync(fixture('parity.onnx'))
    const { window, logits } = JSON.parse(readFileSync(fixture('parity.json'), 'utf8')) as { window: number[][]; logits: number[] }
    const runner = await createOnnxRunner(new Uint8Array(model), { wasmPaths: { wasm } })
    const out = await runner.run(Float32Array.from(window.flat()))
    out.forEach((v, i) => expect(v).toBeCloseTo(logits[i], 3))
  })

  it('refuses a model that is not ONNX', async () => {
    await expect(createOnnxRunner(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})


describe('DopplerSign: the direction of a push or pull from the sign of the Doppler shift', () => {
  const sign = (frames: Array<[number, number]>): DopplerSign => {
    const s = new DopplerSign()
    for (const [t, hz] of frames) s.push(t, hz)
    return s
  }

  it('calls a strong positive shift just before the event a PUSH and a strong negative one a PULL', () => {
    expect(sign([[2000, 120]]).decide(2300)).toBe('PUSH')
    expect(sign([[2000, -120]]).decide(2300)).toBe('PULL')
  })

  it('lets the largest magnitude win, so a weaker recoil before the push does not decide it', () => {
    expect(sign([[1600, -60], [2000, 140]]).decide(2300)).toBe('PUSH')
  })

  it('ignores frames older than one second and frames after the event', () => {
    expect(sign([[500, 150]]).decide(500 + 1000 + 300)).toBeNull()
    expect(sign([[3000, 150]]).decide(2300)).toBeNull()
  })

  it('does not trust a shift under 45 Hz, and says nothing without frames', () => {
    expect(sign([[2000, 44]]).decide(2300)).toBeNull()
    expect(new DopplerSign().decide(1000)).toBeNull()
  })

  it('keeps only a couple of seconds of history and forgets everything on reset()', () => {
    const s = sign([[0, 150]])
    s.push(5000, 0)
    expect(s.decide(500)).toBeNull() // the frame at 0 s was dropped long ago
    const r = sign([[2000, 150]])
    r.reset()
    expect(r.decide(2300)).toBeNull()
  })

  it('relabels only PUSH and PULL, and keeps the model\'s class when the sign is not decisive', () => {
    const away = sign([[2000, -130]])
    expect(resolveDirection('PUSH', 2300, away)).toBe('PULL')
    expect(resolveDirection('PULL', 2300, away)).toBe('PULL')
    for (const cls of ['WAVE', 'UNDO', 'OPEN_CLOSE', 'REPETITIVE', 'HOLD'] as const) expect(resolveDirection(cls, 2300, away)).toBe(cls)
    expect(resolveDirection('PULL', 2300, new DopplerSign())).toBe('PULL')
  })

  it('matches the Python signfix.sign_class on 60 generated cases', () => {
    const signCases = JSON.parse(readFileSync(fixture('sign-cases.json'), 'utf8')) as {
      windowS: number
      minHz: number
      cases: Array<{ t: number[]; shift: number[]; eventT: number; expected: string | null }>
    }
    expect(signCases.windowS).toBe(1)
    expect(signCases.minHz).toBe(45)
    expect(signCases.cases.some((c) => c.expected === 'PUSH') && signCases.cases.some((c) => c.expected === 'PULL')).toBe(true)
    for (const c of signCases.cases) {
      const s = new DopplerSign()
      // as in the engine: frames arrive in time order and the model answers a little after the window it looked at
      c.t.forEach((t, i) => {
        if (t <= c.eventT + 0.1) s.push(t * 1000, c.shift[i])
      })
      expect(s.decide(c.eventT * 1000)).toBe(c.expected)
    }
  })
})

describe('the sign override setting in gesture.json', () => {
  it('is off by default (its leave-one-person-out evaluation refused it) and can be switched on', () => {
    expect(DEFAULT_DECODER.signOverride).toBe(false)
    expect(decoderFromConfig({}).signOverride).toBe(false)
    expect(decoderFromConfig({ signOverride: true }).signOverride).toBe(true)
    expect(decoderFromConfig({ signOverride: 'yes' }).signOverride).toBe(false) // anything but a boolean keeps the default
  })
})
