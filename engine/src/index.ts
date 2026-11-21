import type { Engine, EngineOptions, GestureEvent, SpectrumFrame } from '../../contracts/engine.ts'
import { startCapture, type CaptureOptions, type CaptureSession } from './audio.ts'
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

export interface EngineDeps {
  readonly startCapture: (opts: CaptureOptions) => Promise<CaptureSession>
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
  return createEngineWith({ startCapture }, opts)
}

/** createEngine with the audio capture injected, so the lifecycle can be tested without a browser. */
export function createEngineWith(deps: EngineDeps, opts: EngineOptions = {}): Engine {
  const toneHz = opts.toneHz ?? DEFAULT_TONE_HZ
  const toneDbfs = opts.toneDbfs ?? DEFAULT_TONE_DBFS
  assertValid(toneHz, toneDbfs)

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

  const onChunk = (chunk: Float32Array): void => {
    recorder?.pushChunk(chunk)
    const frame = pipeline?.push(chunk, performance.now())
    if (!frame) return
    recorder?.pushFrame(frame)
    notify(frameListeners, frame)
    for (const gesture of detector.push(frame)) notify(gestureListeners, gesture)
  }

  const teardown = (reason: string): void => {
    generation += 1
    detector.reset()
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
