import type { GestureType } from '../../contracts/engine.ts'

// Runs the trained gesture model (ml/PROTOCOL.md) in the browser. The window layout, the scaling and the event decoder
// mirror ml/dataset.py, ml/train.py and ml/evaluate.py; src/fixtures/ holds cross-language fixtures that keep them in step.

export const CLASS_NAMES = ['NONE', 'PUSH', 'PULL', 'WAVE', 'OPEN_CLOSE', 'UNDO', 'REPETITIVE'] as const
export type ClassName = (typeof CLASS_NAMES)[number]

/** One model input: this many frames of this many bins (about 1.0 s of the +-500 Hz band). */
export const WINDOW_FRAMES = 48
export const BINS = 87
/** The model is evaluated after every this many frames (about 85 ms). */
export const STRIDE_FRAMES = 4
/** Inputs are dB over the floor clipped to [CLIP_MIN_DB, CLIP_MAX_DB] and divided by SCALE_DB. */
export const SCALE_DB = 60
export const CLIP_MIN_DB = -10
export const CLIP_MAX_DB = 60
/** An evaluation is dropped, not queued, when this many are still waiting for the model. */
const MAX_PENDING = 3

export interface DecoderConfig {
  /** Output order of the model (gesture.json `classes`); index 0 is NONE. Only as many as the model outputs are read. */
  readonly classes: ReadonlyArray<string>
  readonly thresholds: Readonly<Record<string, number>>
  /** Average this many consecutive evaluations, fire after `confirm` in a row above threshold, then hold off. */
  readonly smooth: number
  readonly confirm: number
  readonly refractoryMs: number
  /** A wave is long, so it holds off the strokes that follow it for longer. */
  readonly waveRefractoryMs: number
  /** A habit goes on for seconds, so it holds off for longer still (ml/evaluate.py HABIT_REFRACTORY_S). */
  readonly habitRefractoryMs: number
}

export const DEFAULT_DECODER: DecoderConfig = {
  classes: CLASS_NAMES,
  thresholds: { PUSH: 0.85, PULL: 0.85, WAVE: 0.85, OPEN_CLOSE: 0.85, UNDO: 0.85, REPETITIVE: 0.9 }, // ml/evaluate.py DEFAULT_THRESHOLDS
  smooth: 3,
  confirm: 2,
  refractoryMs: 600,
  waveRefractoryMs: 1200,
  habitRefractoryMs: 3000,
}

const isClassList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length >= 2 && v.every((c) => typeof c === 'string') && v[0] === 'NONE'

const numberOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const countOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fallback)

/** The decoder settings from the gesture.json that `ml/run.py final` writes next to the model; anything missing or malformed takes the default. */
export function decoderFromConfig(config: unknown): DecoderConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return DEFAULT_DECODER
  const c = config as { classes?: unknown; thresholds?: unknown; decoder?: Record<string, unknown> | null }
  const d = c.decoder && typeof c.decoder === 'object' ? c.decoder : {}
  const thresholds =
    typeof c.thresholds === 'object' && c.thresholds !== null && !Array.isArray(c.thresholds)
      ? (c.thresholds as Record<string, number>)
      : DEFAULT_DECODER.thresholds
  return {
    classes: isClassList(c.classes) ? c.classes : DEFAULT_DECODER.classes,
    thresholds,
    smooth: countOr(d.smooth, DEFAULT_DECODER.smooth),
    confirm: countOr(d.confirm, DEFAULT_DECODER.confirm),
    refractoryMs: numberOr(d.refractoryMs, DEFAULT_DECODER.refractoryMs),
    waveRefractoryMs: numberOr(d.waveRefractoryMs, DEFAULT_DECODER.waveRefractoryMs),
    habitRefractoryMs: numberOr(d.habitRefractoryMs, DEFAULT_DECODER.habitRefractoryMs),
  }
}

export interface ClassifierEvent {
  readonly cls: GestureType
  readonly tMs: number
  readonly probability: number
}

export interface ModelRunner {
  /** Logits for one window of WINDOW_FRAMES * BINS scaled values, frame by frame, oldest first. */
  run(window: Float32Array): Promise<Float32Array>
}

export function softmax(logits: ArrayLike<number>): number[] {
  const values = Array.from(logits)
  const max = Math.max(...values)
  const exps = values.map((v) => Math.exp(v - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}

/** dB over the floor -> model input value. */
export function scaleExcess(excessDb: number): number {
  return Math.min(CLIP_MAX_DB, Math.max(CLIP_MIN_DB, excessDb)) / SCALE_DB
}

function argmax(values: ReadonlyArray<number>): number {
  let best = 0
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i
  return best
}

/** Turns a stream of class probabilities into events: the same rule as ml/evaluate.py decode_events. */
export class EventDecoder {
  private readonly config: DecoderConfig
  private history: number[][] = []
  private holdUntilMs = -Infinity
  private streak = 0
  private previous: number | null = null

  constructor(config: DecoderConfig) {
    this.config = config
  }

  reset(): void {
    this.history = []
    this.holdUntilMs = -Infinity
    this.streak = 0
    this.previous = null
  }

  push(probs: ArrayLike<number>, tMs: number): ClassifierEvent | null {
    const { smooth, confirm, thresholds, classes } = this.config
    this.history = [...this.history, Array.from(probs)].slice(-smooth)
    const names = classes.slice(0, probs.length) // never read past what the model outputs
    const mean = names.map((_, c) => this.history.reduce((sum, p) => sum + p[c], 0) / this.history.length)
    const strongest = argmax(mean.slice(1)) + 1 // the best class other than NONE
    const candidate =
      mean[strongest] >= (thresholds[names[strongest]] ?? Infinity) && argmax(mean) === strongest ? strongest : null
    if (tMs < this.holdUntilMs) {
      this.streak = 0
      this.previous = null
      return null
    }
    this.streak = candidate !== null && candidate === this.previous ? this.streak + 1 : candidate !== null ? 1 : 0
    this.previous = candidate
    if (candidate === null || this.streak < confirm) return null
    const cls = names[candidate] as GestureType
    const hold = cls === 'WAVE' ? this.config.waveRefractoryMs : cls === 'REPETITIVE' ? this.config.habitRefractoryMs : this.config.refractoryMs
    this.holdUntilMs = tMs + hold
    this.streak = 0
    this.previous = null
    return { cls, tMs, probability: mean[candidate] }
  }
}

/** The last WINDOW_FRAMES frames, handed out every STRIDE_FRAMES frames once the first window is full. */
export class FrameWindow {
  private frames: Float32Array[] = []
  private count = 0

  reset(): void {
    this.frames = []
    this.count = 0
  }

  /** Add one frame of BINS scaled values. Returns the window to evaluate, or undefined. */
  push(frame: Float32Array): Float32Array | undefined {
    if (frame.length !== BINS) throw new Error(`expected ${BINS} bins per frame, got ${frame.length}`)
    this.frames.push(frame.slice())
    if (this.frames.length > WINDOW_FRAMES) this.frames.shift()
    this.count += 1
    if (this.count < WINDOW_FRAMES || (this.count - WINDOW_FRAMES) % STRIDE_FRAMES !== 0) return undefined
    const window = new Float32Array(WINDOW_FRAMES * BINS)
    this.frames.forEach((f, i) => window.set(f, i * BINS))
    return window
  }
}

export interface ClassifierRuntimeOptions {
  readonly runner: ModelRunner
  readonly decoder: DecoderConfig
  readonly onEvent: (event: ClassifierEvent) => void
  readonly onError: (error: unknown) => void
}

/** Feeds frames to the model without ever blocking the audio callback: inference is queued, and dropped when behind. */
export class ClassifierRuntime {
  private readonly runner: ModelRunner
  private readonly decoder: EventDecoder
  private readonly onEvent: (event: ClassifierEvent) => void
  private readonly onError: (error: unknown) => void
  private readonly window = new FrameWindow()
  private chain: Promise<void> = Promise.resolve()
  private pending = 0

  constructor(opts: ClassifierRuntimeOptions) {
    this.runner = opts.runner
    this.decoder = new EventDecoder(opts.decoder)
    this.onEvent = opts.onEvent
    this.onError = opts.onError
  }

  /** `scaled` is one frame of BINS values already passed through scaleExcess. `tMs` is the frame's time. */
  push(scaled: Float32Array, tMs: number): void {
    const window = this.window.push(scaled)
    if (!window || this.pending >= MAX_PENDING) return
    this.pending += 1
    this.chain = this.chain
      .then(() => this.runner.run(window))
      .then((logits) => {
        const event = this.decoder.push(softmax(logits), tMs)
        if (event) this.onEvent(event)
      })
      .catch((error: unknown) => this.onError(error))
      .finally(() => {
        this.pending -= 1
      })
  }

  /** Forget the window and the decoder state (floor re-learned, engine stopped). */
  reset(): void {
    this.window.reset()
    this.decoder.reset()
  }

  /** Resolves when every queued evaluation has finished. */
  idle(): Promise<void> {
    return this.chain
  }
}

export interface OnnxRunnerOptions {
  /**
   * Where onnxruntime-web finds its files: a folder URL ending in a slash, or `{ wasm }` with the .wasm file alone.
   * Prefer the object form in a browser: with a folder, ORT also imports its .mjs loader from there, and Vite's dev
   * server refuses to import files that live in /public. The wasm-only build already embeds that loader.
   */
  readonly wasmPaths?: string | { readonly mjs?: string; readonly wasm?: string }
}

/** Loads an ONNX model (URL or bytes) with onnxruntime-web and returns a runner for it. */
export async function createOnnxRunner(source: string | Uint8Array, opts: OnnxRunnerOptions = {}): Promise<ModelRunner> {
  const ort = await import('onnxruntime-web/wasm') // the wasm-only build: far smaller than the default WebGPU-capable one
  if (opts.wasmPaths) ort.env.wasm.wasmPaths = typeof opts.wasmPaths === 'string' ? opts.wasmPaths : { ...opts.wasmPaths }
  ort.env.wasm.numThreads = 1 // multi-threading needs cross-origin isolation, which the app does not set up
  const session = await ort.InferenceSession.create(source as Uint8Array, { executionProviders: ['wasm'] })
  return {
    async run(window: Float32Array): Promise<Float32Array> {
      const input = new ort.Tensor('float32', window, [1, 1, WINDOW_FRAMES, BINS])
      const output = await session.run({ x: input })
      return Float32Array.from(output.y.data as Float32Array)
    },
  }
}
