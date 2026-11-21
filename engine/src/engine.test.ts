import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GestureEvent } from '../../contracts/engine.ts'
import type { CaptureOptions, CaptureSession } from './audio.ts'
import { createEngineWith } from './index.ts'
import { HOP } from './pipeline.ts'

interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

function deferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** A capture that records how it was used and lets the test push mic chunks. */
function fakeCapture(opts: { hold?: Deferred; sampleRate?: number } = {}) {
  const sessions: Array<{ stops: number; options: CaptureOptions }> = []
  const startCapture = vi.fn(async (options: CaptureOptions): Promise<CaptureSession> => {
    const record = { stops: 0, options }
    sessions.push(record)
    if (opts.hold) await opts.hold.promise
    return { sampleRate: opts.sampleRate ?? 48000, stop: () => void (record.stops += 1) }
  })
  const pushChunks = (n: number): void => {
    for (let i = 0; i < n; i++) sessions[sessions.length - 1].options.onChunk(new Float32Array(HOP))
  }
  return { startCapture, sessions, pushChunks }
}

/** Continuous synthetic mic stream (tone plus optional Doppler echo plus noise), chunked by HOP. */
function makeStream(echoHz: number | null, seed = 7): () => Float32Array {
  const amp = (db: number): number => 10 ** (db / 20)
  let sample = 0
  let s = seed
  return () => {
    const out = new Float32Array(HOP)
    for (let i = 0; i < HOP; i++, sample++) {
      s = (s * 1664525 + 1013904223) >>> 0
      let v = (s / 0xffffffff - 0.5) * 2 * amp(-100) + amp(-36) * Math.sin((2 * Math.PI * 20000 * sample) / 48000)
      if (echoHz !== null) v += amp(-56) * Math.sin((2 * Math.PI * echoHz * sample) / 48000)
      out[i] = v
    }
    return out
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createEngineWith', () => {
  it('rejects nonsense tone settings up front', () => {
    const { startCapture } = fakeCapture()
    expect(() => createEngineWith({ startCapture }, { toneHz: -1 })).toThrow(RangeError)
    expect(() => createEngineWith({ startCapture }, { toneDbfs: 3 })).toThrow(RangeError)
  })

  it('reports defaults before and after start', async () => {
    const { startCapture } = fakeCapture()
    const engine = createEngineWith({ startCapture })
    expect(engine.health()).toEqual({ running: false, toneHz: 20000, toneDbfs: -36, snrDb: 0, sampleRate: 0 })
    await engine.start()
    expect(engine.health().running).toBe(true)
    expect(engine.health().sampleRate).toBe(48000)
  })

  it('opens the capture only once for concurrent start() calls', async () => {
    const hold = deferred()
    const { startCapture } = fakeCapture({ hold })
    const engine = createEngineWith({ startCapture })
    const both = Promise.all([engine.start(), engine.start()])
    hold.resolve()
    await both
    expect(startCapture).toHaveBeenCalledTimes(1)
  })

  it('tears the capture down when stop() is called while start() is still waiting', async () => {
    const hold = deferred()
    const { startCapture, sessions } = fakeCapture({ hold })
    const engine = createEngineWith({ startCapture })
    const starting = engine.start()
    engine.stop()
    hold.resolve()
    await starting
    expect(engine.health().running).toBe(false)
    expect(sessions[0].stops).toBe(1)
  })

  it('delivers frames to listeners and stops delivering after unsubscribe', async () => {
    const { startCapture, pushChunks } = fakeCapture()
    const engine = createEngineWith({ startCapture })
    await engine.start()
    const seen: number[] = []
    const off = engine.onFrame((f) => seen.push(f.t))
    pushChunks(6)
    expect(seen.length).toBe(3)
    off()
    pushChunks(3)
    expect(seen.length).toBe(3)
  })

  it('keeps delivering to other listeners when one throws', async () => {
    const { startCapture, pushChunks } = fakeCapture()
    const engine = createEngineWith({ startCapture })
    await engine.start()
    const reported: unknown[] = []
    const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((cb) => {
      try {
        cb()
      } catch (e) {
        reported.push(e)
      }
    })
    const good = vi.fn()
    engine.onFrame(() => {
      throw new Error('bad listener')
    })
    engine.onFrame(good)
    pushChunks(4)
    spy.mockRestore()
    expect(good).toHaveBeenCalledTimes(1)
    expect(reported.length).toBe(1)
  })

  it('refuses to calibrate before start()', async () => {
    const { startCapture } = fakeCapture()
    const engine = createEngineWith({ startCapture })
    await expect(engine.calibrate()).rejects.toThrow(/start/)
  })

  it('honours the ms argument of calibrate() even right after the auto-calibration began', async () => {
    const { startCapture, pushChunks } = fakeCapture()
    const engine = createEngineWith({ startCapture })
    await engine.start()
    let done = false
    void engine.calibrate(2000).then(() => {
      done = true
    })
    pushChunks(60) // about 1.3 s: past the 1 s auto-calibration, short of 2 s
    await Promise.resolve()
    expect(done).toBe(false)
    pushChunks(60)
    await vi.waitFor(() => expect(done).toBe(true))
  })

  it('rejects a pending calibrate() when the engine is stopped', async () => {
    const { startCapture } = fakeCapture()
    const engine = createEngineWith({ startCapture })
    await engine.start()
    const pending = engine.calibrate(3000)
    engine.stop()
    await expect(pending).rejects.toThrow(/stopped/i)
  })

  it('rejects calibrate() when no audio frames arrive', async () => {
    vi.useFakeTimers()
    const { startCapture } = fakeCapture()
    const engine = createEngineWith({ startCapture })
    await engine.start()
    const pending = engine.calibrate(100)
    const assertion = expect(pending).rejects.toThrow(/no audio/i)
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })

  it('marks the engine stopped when the capture reports it ended', async () => {
    const { startCapture, sessions } = fakeCapture()
    const engine = createEngineWith({ startCapture })
    await engine.start()
    const pending = engine.calibrate(3000)
    sessions[0].options.onEnded('microphone unplugged')
    await expect(pending).rejects.toThrow(/microphone unplugged/)
    expect(engine.health().running).toBe(false)
  })

  describe('gestures', () => {
    async function runningEngine() {
      const fake = fakeCapture()
      const engine = createEngineWith({ startCapture: fake.startCapture })
      await engine.start()
      const send = (next: () => Float32Array, chunks: number): void => {
        for (let i = 0; i < chunks; i++) fake.sessions[0].options.onChunk(next())
      }
      return { engine, send }
    }

    it('turns a real push, from raw audio through the whole stack, into one PUSH event', async () => {
      const { engine, send } = await runningEngine()
      const got: GestureEvent[] = []
      engine.onGesture((e) => got.push(e))
      send(makeStream(null), 70) // warm-up, then the 1 s auto-calibration of the still room
      send(makeStream(20117, 5), 12) // a hand moving toward the laptop for about 250 ms
      send(makeStream(null, 9), 40)
      expect(got.map((e) => e.type)).toEqual(['PUSH'])
      expect(got[0].source).toBe('rules')
      expect(got[0].speed).toBeGreaterThan(0)
    })

    it('turns a pull into a PULL', async () => {
      const { engine, send } = await runningEngine()
      const got: GestureEvent[] = []
      engine.onGesture((e) => got.push(e))
      send(makeStream(null), 70)
      send(makeStream(19883, 5), 12)
      send(makeStream(null, 9), 40)
      expect(got.map((e) => e.type)).toEqual(['PULL'])
      expect(got[0].speed).toBeLessThan(0)
    })

    it('stays silent in a still room and stops notifying after unsubscribe', async () => {
      const { engine, send } = await runningEngine()
      const got: GestureEvent[] = []
      const off = engine.onGesture((e) => got.push(e))
      send(makeStream(null), 400)
      expect(got).toEqual([])
      off()
      send(makeStream(20117, 5), 12)
      send(makeStream(null, 9), 40)
      expect(got).toEqual([])
    })

    it('keeps notifying other listeners when one gesture listener throws', async () => {
      const { engine, send } = await runningEngine()
      const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => undefined)
      const good = vi.fn()
      engine.onGesture(() => {
        throw new Error('bad listener')
      })
      engine.onGesture(good)
      send(makeStream(null), 70)
      send(makeStream(20117, 5), 12)
      send(makeStream(null, 9), 40)
      spy.mockRestore()
      expect(good).toHaveBeenCalledTimes(1)
    })
  })

  describe('recording', () => {
    const label = { person: 'ian', gesture: 'PUSH', laptop: 'mbp-ian' } as const

    it('refuses to record before start()', () => {
      const { startCapture } = fakeCapture()
      const engine = createEngineWith({ startCapture })
      expect(() => engine.startRecording(label)).toThrow(/start/)
    })

    it('saves every mic sample between startRecording and stopRecording as a named WAV with meta', async () => {
      const { startCapture, pushChunks } = fakeCapture()
      const engine = createEngineWith({ startCapture })
      await engine.start()
      pushChunks(3) // before recording: must not be in the file
      engine.startRecording(label)
      pushChunks(10)
      const session = await engine.stopRecording()
      expect(session.wav.size).toBe(44 + 10 * HOP * 4)
      expect(session.filename).toMatch(/^ian_PUSH_mbp-ian_\d{8}-\d{6}\.wav$/)
      expect(session.meta).toMatchObject({ person: 'ian', gesture: 'PUSH', sampleRate: 48000, toneHz: 20000, toneDbfs: -36 })
    })

    it('rejects a second startRecording while one is running', async () => {
      const { startCapture } = fakeCapture()
      const engine = createEngineWith({ startCapture })
      await engine.start()
      engine.startRecording(label)
      expect(() => engine.startRecording(label)).toThrow(/already/)
    })

    it('rejects stopRecording when nothing is recording', async () => {
      const { startCapture } = fakeCapture()
      const engine = createEngineWith({ startCapture })
      await engine.start()
      await expect(engine.stopRecording()).rejects.toThrow(/not recording/i)
    })

    it('still returns the data when the engine stops or the mic dies mid-recording', async () => {
      const { startCapture, pushChunks, sessions } = fakeCapture()
      const engine = createEngineWith({ startCapture })
      await engine.start()
      engine.startRecording(label)
      pushChunks(5)
      sessions[0].options.onEnded('microphone unplugged')
      const session = await engine.stopRecording()
      expect(session.wav.size).toBe(44 + 5 * HOP * 4)
    })

    it('allows a new recording after the previous one was stopped', async () => {
      const { startCapture, pushChunks } = fakeCapture()
      const engine = createEngineWith({ startCapture })
      await engine.start()
      engine.startRecording(label)
      pushChunks(2)
      await engine.stopRecording()
      engine.startRecording(label)
      pushChunks(4)
      expect((await engine.stopRecording()).wav.size).toBe(44 + 4 * HOP * 4)
    })
  })

  it('can start again after a stop', async () => {
    const { startCapture } = fakeCapture()
    const engine = createEngineWith({ startCapture })
    await engine.start()
    engine.stop()
    await engine.start()
    expect(engine.health().running).toBe(true)
    expect(startCapture).toHaveBeenCalledTimes(2)
  })
})
