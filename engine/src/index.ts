import type { Engine, EngineOptions, GestureEvent, SpectrumFrame } from '../../contracts/engine.ts'
import { startCapture, type CaptureOptions, type CaptureSession } from './audio.ts'
import {
  ClassifierRuntime,
  DEFAULT_DECODER,
  DopplerSign,
  createOnnxRunner,
  decoderFromConfig,
  type ClassifierEvent,
  type DecoderConfig,
  type ModelRunner,
  resolveDirection,
} from './classifier.ts'
import { GestureDetector } from './gestures.ts'
import { FramePipeline } from './pipeline.ts'
import { SessionRecorder } from './recorder.ts'

const DEFAULT_TONE_HZ = 20000
const DEFAULT_TONE_DBFS = -36
const DEFAULT_CALIBRATION_MS = 3000
/** Right after start() the engine assumes a still room and learns its floor for this long. */
const AUTO_CALIBRATION_MS = 1000
/** calibrate() gives up this long after it should have finished if no audio frames are arriving. */
const CALIBRATION_TIMEOUT_SLACK_MS = 2000

/** The onnxruntime-web .wasm file, which the app publishes (app/copy-ort.sh). Only the wasm: see OnnxRunnerOptions. */
/** The rule habit stays quiet this long after the engine reported any other gesture. */
const HABIT_AFTER_GESTURE_MS = 2000
/** A rule-assisted gesture is dropped when the model reported any gesture this recently. */
const RULE_ASSIST_GAP_MS = 1200

const ORT_WASM_PATHS = { wasm: '/ort/ort-wasm-simd-threaded.wasm' }

export interface LoadedClassifier {
  readonly runner: ModelRunner
  readonly decoder: DecoderConfig
}

export interface EngineDeps {
  readonly startCapture: (opts: CaptureOptions) => Promise<CaptureSession>
  /** Loads the gesture model; only used when EngineOptions.useClassifier is on. */
  readonly loadClassifier?: (modelUrl: string) => Promise<LoadedClassifier>
}

/** The model at `modelUrl` (.onnx) plus its decoder settings from the .json next to it (defaults if that is missing). */
async function loadClassifierFromUrl(modelUrl: string): Promise<LoadedClassifier> {
  const runner = await createOnnxRunner(modelUrl, { wasmPaths: ORT_WASM_PATHS })
  try {
    const response = await fetch(modelUrl.replace(/\.onnx$/, '.json'))
    if (!response.ok) return { runner, decoder: DEFAULT_DECODER }
    return { runner, decoder: decoderFromConfig(await response.json()) }
  } catch {
    return { runner, decoder: DEFAULT_DECODER }
  }
}

function toGestureEvent(e: ClassifierEvent): GestureEvent {
  return { type: e.cls, t: e.tMs, confidence: e.probability, source: 'classifier' }
}

function assertValid(toneHz: number, toneDbfs: number): void {
  if (!(toneHz > 0)) throw new RangeError(`toneHz must be positive, got ${toneHz}`)
  if (!(toneDbfs <= 0)) throw new RangeError(`toneDbfs must be 0 or below, got ${toneDbfs}`)
}

/** Surface an error from a listener without letting it break the audio callback. */
function reportAsync(error: unknown): void {
  queueMicrotask(() => {
    throw error
  })
}

/** Call every listener; one that throws must not starve the others. */
function notify<T>(listeners: ReadonlySet<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value)
    } catch (error: unknown) {
      reportAsync(error)
    }
  }
}

export function createEngine(opts: EngineOptions = {}): Engine {
  return createEngineWith({ startCapture, loadClassifier: loadClassifierFromUrl }, opts)
}

/** createEngine with the audio capture injected, so the lifecycle can be tested without a browser. */
export function createEngineWith(deps: EngineDeps, opts: EngineOptions = {}): Engine {
  const toneHz = opts.toneHz ?? DEFAULT_TONE_HZ
  const toneDbfs = opts.toneDbfs ?? DEFAULT_TONE_DBFS
  assertValid(toneHz, toneDbfs)
  if (opts.useClassifier && !opts.modelUrl) throw new RangeError('useClassifier needs modelUrl (the .onnx model path)')

  const frameListeners = new Set<(f: SpectrumFrame) => void>()
  const gestureListeners = new Set<(e: GestureEvent) => void>()
  let session: CaptureSession | null = null
  let pipeline: FramePipeline | null = null
  /** Survives stop() and a dead mic, so a take that was cut short can still be saved. */
  let recorder: SessionRecorder | null = null
  let starting: Promise<void> | null = null
  /** Bumped on every teardown so a start() that was still waiting can tell it was cancelled. */
  let generation = 0

  const detector = new GestureDetector({ toneHz })
  /** Recent signed Doppler shifts, so a PUSH or PULL from the model can be given the direction the shift says. */
  const dopplerSign = new DopplerSign()
  /** The model and the rules can both see a habit; whichever reports first holds the other off for this long. */
  let habitHoldMs = DEFAULT_DECODER.habitRefractoryMs
  let lastHabitMs = -Infinity
  /** When a deliberate gesture was last reported. A wave, an undo or a push is also back-and-forth motion, so the rule habit waits. */
  let lastGestureMs = -Infinity
  const ruleAssist = new Set(opts.ruleAssist ?? [])
  /** The last rule-assisted gesture, so the model reporting the same one a moment later is not counted twice. */
  let lastAssist = { type: '', t: -Infinity }
  const emit = (gesture: GestureEvent): void => {
    if (gesture.type === 'REPETITIVE') {
      if (gesture.t - lastHabitMs < habitHoldMs) return
      if (gesture.source === 'rules' && gesture.t - lastGestureMs < HABIT_AFTER_GESTURE_MS) return
      lastHabitMs = gesture.t
    } else if (gesture.type !== 'HOLD') {
      lastGestureMs = gesture.t
    }
    notify(gestureListeners, gesture)
  }
  /** The trained model, once loaded. While it is set it decides the gestures and the rules only keep HOLD. */
  let classifier: ClassifierRuntime | null = null

  const onChunk = (chunk: Float32Array): void => {
    recorder?.pushChunk(chunk)
    const frame = pipeline?.push(chunk, performance.now())
    if (!frame) return
    recorder?.pushFrame(frame)
    dopplerSign.push(frame.t, frame.shiftHz)
    notify(frameListeners, frame)
    const ruleGestures = detector.push(frame)
    if (classifier) {
      const scaled = pipeline?.scaledExcess(frame.bins)
      if (scaled) classifier.push(scaled, frame.t)
      else classifier.reset() // no floor yet, or it is being re-learned
    }
    // With the model on, the rules keep HOLD and the habit: the model is weak at habits, so the two are OR-ed.
    for (const gesture of ruleGestures) {
      if (!classifier || gesture.type === 'HOLD' || gesture.type === 'REPETITIVE') { emit(gesture); continue }
      // Rule assist: the model misses some gestures live (WAVE, OPEN_CLOSE); the rules may report them too, unless the
      // model just reported that gesture (no double count) or a different one (the model wins a disagreement).
      if (!ruleAssist.has(gesture.type)) continue
      if (gesture.type === 'OPEN_CLOSE' && (gesture.count ?? 0) < 2) continue // one pulse is any small movement
      if (gesture.t - lastGestureMs < RULE_ASSIST_GAP_MS) continue
      lastAssist = { type: gesture.type, t: gesture.t }
      emit(gesture)
    }
  }

  const attachClassifier = async (myGeneration: number): Promise<void> => {
    try {
      if (!deps.loadClassifier) throw new Error('no classifier loader available')
      const loaded = await deps.loadClassifier(opts.modelUrl as string)
      if (generation !== myGeneration) return
      habitHoldMs = loaded.decoder.habitRefractoryMs
      classifier = new ClassifierRuntime({
        runner: loaded.runner,
        decoder: loaded.decoder,
        onEvent: (event) => {
          const cls = loaded.decoder.signOverride ? resolveDirection(event.cls, event.tMs, dopplerSign) : event.cls
          const gesture = toGestureEvent({ ...event, cls })
          if (gesture.type === lastAssist.type && gesture.t - lastAssist.t < RULE_ASSIST_GAP_MS) return
          emit(gesture)
        },
        onError: reportAsync,
      })
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      reportAsync(new Error(`Classifier unavailable, using the rule detectors: ${reason}`))
    }
  }

  const teardown = (reason: string): void => {
    generation += 1
    detector.reset()
    dopplerSign.reset()
    lastHabitMs = -Infinity
    lastGestureMs = -Infinity
    classifier?.reset()
    classifier = null
    const live = session
    const livePipeline = pipeline
    session = null
    pipeline = null
    live?.stop()
    livePipeline?.cancelCalibration(new Error(reason))
  }

  const open = async (): Promise<void> => {
    const myGeneration = generation
    const capture = await deps.startCapture({
      toneHz,
      toneDbfs,
      onChunk,
      onEnded: (reason) => {
        if (generation === myGeneration && session) teardown(reason)
      },
    })
    if (generation !== myGeneration) {
      capture.stop() // stop() was called while the mic prompt was still open
      return
    }
    try {
      pipeline = new FramePipeline({ sampleRate: capture.sampleRate, toneHz, sensitivityDb: opts.sensitivityDb })
    } catch (error: unknown) {
      capture.stop()
      throw error
    }
    session = capture
    pipeline.beginCalibration(AUTO_CALIBRATION_MS).catch(() => {
      // cancelled by stop(): nobody is waiting on the automatic calibration
    })
    if (opts.useClassifier) await attachClassifier(myGeneration)
  }

  return {
    async start() {
      if (session) return
      starting ??= open().finally(() => {
        starting = null
      })
      await starting
    },

    stop() {
      teardown('Engine stopped')
    },

    async calibrate(ms = DEFAULT_CALIBRATION_MS) {
      const live = pipeline
      if (!live) throw new Error('Engine is not running: call start() before calibrate()')
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Calibration timed out: no audio frames arriving')),
          ms + CALIBRATION_TIMEOUT_SLACK_MS,
        )
      })
      try {
        await Promise.race([live.beginCalibration(ms), timeout])
      } finally {
        clearTimeout(timer)
      }
    },

    health() {
      return {
        running: session !== null,
        toneHz,
        toneDbfs,
        snrDb: pipeline?.snrDb ?? 0,
        sampleRate: session?.sampleRate ?? 0,
      }
    },

    onGesture(cb) {
      gestureListeners.add(cb)
      return () => gestureListeners.delete(cb)
    },

    onFrame(cb) {
      frameListeners.add(cb)
      return () => frameListeners.delete(cb)
    },

    startRecording(label) {
      if (!session) throw new Error('Engine is not running: call start() before startRecording()')
      if (recorder) throw new Error('A recording is already running: call stopRecording() first')
      recorder = new SessionRecorder({ label, sampleRate: session.sampleRate, toneHz, toneDbfs, now: new Date() })
    },

    async stopRecording() {
      if (!recorder) throw new Error('Not recording: call startRecording() first')
      const finished = recorder
      recorder = null
      return finished.finish()
    },
  }
}
