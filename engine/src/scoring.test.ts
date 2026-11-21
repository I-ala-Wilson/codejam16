import { describe, expect, it } from 'vitest'
import { encodeWav } from './recorder.ts'
import { parseWav, scoreRecording, summarize, type RecordingMeta } from './scoring.ts'

const FS = 48000
const amp = (db: number): number => 10 ** (db / 20)

function pcm16Wav(samples: number[], sampleRate: number, channels = 1): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const tag = (at: number, s: string): void => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  tag(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, channels, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2 * channels, true)
  v.setUint16(32, 2 * channels, true)
  v.setUint16(34, 16, true)
  tag(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true))
  return buf
}

/** A recording: a still 20 kHz tone with Doppler echoes (hz offset from the tone) at given seconds. */
function recording(seconds: number, echoes: ReadonlyArray<{ at: number; ms: number; dopplerHz: number }>): Float32Array {
  const out = new Float32Array(Math.round(seconds * FS))
  let s = 11
  for (let i = 0; i < out.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = (s / 0xffffffff - 0.5) * 2 * amp(-100) + amp(-36) * Math.sin((2 * Math.PI * 20000 * i) / FS)
  }
  for (const { at, ms, dopplerHz } of echoes) {
    const from = Math.round(at * FS)
    const n = Math.round((ms / 1000) * FS)
    for (let i = 0; i < n; i++) out[from + i] += amp(-56) * Math.sin((2 * Math.PI * (20000 + dopplerHz) * (from + i)) / FS)
  }
  return out
}

const meta = (reps: RecordingMeta['reps']): RecordingMeta => ({ sampleRate: FS, toneHz: 20000, reps })
const rep = (startS: number, endS: number, label: string) => ({ start: Math.round(startS * FS), end: Math.round(endS * FS), label })

describe('parseWav', () => {
  it('round-trips the float32 WAV the engine records', async () => {
    const samples = Float32Array.from({ length: 500 }, (_, i) => Math.sin(i / 7) * 0.5)
    const parsed = parseWav(await encodeWav([samples], FS).arrayBuffer())
    expect(parsed.sampleRate).toBe(FS)
    expect(Array.from(parsed.samples)).toEqual(Array.from(samples))
  })

  it('reads 16-bit PCM and scales it to -1..1', () => {
    const parsed = parseWav(pcm16Wav([0, 16384, -16384, 32767, -32768], 44100))
    expect(parsed.sampleRate).toBe(44100)
    expect(Array.from(parsed.samples)).toEqual([0, 0.5, -0.5, 32767 / 32768, -1])
  })

  it('rejects stereo, unknown formats and garbage', () => {
    expect(() => parseWav(pcm16Wav([0, 0, 0, 0], FS, 2))).toThrow(/mono/i)
    expect(() => parseWav(new ArrayBuffer(10))).toThrow()
    expect(() => parseWav(new TextEncoder().encode('not a wav file at all, just text........').buffer as ArrayBuffer)).toThrow(/RIFF/)
  })
})

describe('scoreRecording', () => {
  it('finds a PUSH inside a PUSH rep and nothing stray', () => {
    const samples = recording(7, [{ at: 4, ms: 300, dopplerHz: 117 }])
    const score = scoreRecording(samples, meta([rep(4, 4.3, 'PUSH')]))
    expect(score.reps).toHaveLength(1)
    expect(score.reps[0].hit).toBe(true)
    expect(score.reps[0].events).toEqual(['PUSH'])
    expect(score.strayEvents).toEqual([])
  })

  it('shows a confusion when the detector disagrees with the label', () => {
    const samples = recording(7, [{ at: 4, ms: 300, dopplerHz: -117 }])
    const score = scoreRecording(samples, meta([rep(4, 4.3, 'PUSH')]))
    expect(score.reps[0].hit).toBe(false)
    expect(score.reps[0].events).toEqual(['PULL'])
  })

  it('counts events outside every rep as stray', () => {
    const samples = recording(8, [{ at: 4, ms: 300, dopplerHz: 117 }, { at: 6, ms: 300, dopplerHz: 117 }])
    const score = scoreRecording(samples, meta([rep(4, 4.3, 'PUSH')]))
    expect(score.reps[0].hit).toBe(true)
    expect(score.strayEvents.map((e) => e.type)).toEqual(['PUSH'])
  })

  it('scores a REPETITIVE-scratch rep against a REPETITIVE event (the take label carries the habit kind)', () => {
    const echoes = Array.from({ length: 12 }, (_, i) => ({ at: 4 + i * 0.25, ms: 250, dopplerHz: i % 2 === 0 ? 117 : -117 }))
    const score = scoreRecording(recording(9, echoes), meta([rep(4, 7, 'REPETITIVE-scratch')]))
    expect(score.reps[0].events).toContain('REPETITIVE')
    expect(score.reps[0].hit).toBe(true)
  })

  it('reports no events for a still recording', () => {
    const score = scoreRecording(recording(10, []), meta([]))
    expect(score.events).toEqual([])
    expect(score.frames.length).toBeGreaterThan(100)
  })

  it('keeps the motion in the take out of its own floor', () => {
    // a long push that fills most of the take must still read as motion because the floor skips the rep
    const samples = recording(9, [{ at: 3, ms: 5000, dopplerHz: 117 }])
    const score = scoreRecording(samples, meta([rep(3, 8, 'PUSH')]))
    const inRep = score.frames.filter((f) => f.t > 4000 && f.t < 8000)
    expect(inRep.filter((f) => f.shiftHz > 60).length).toBeGreaterThan(inRep.length * 0.8)
  })
})

describe('summarize', () => {
  it('totals reps, hits and stray events per label', () => {
    const push = scoreRecording(recording(7, [{ at: 4, ms: 300, dopplerHz: 117 }]), meta([rep(4, 4.3, 'PUSH')]))
    const miss = scoreRecording(recording(7, [{ at: 4, ms: 300, dopplerHz: -117 }]), meta([rep(4, 4.3, 'PUSH')]))
    const s = summarize([push, miss])
    expect(s.PUSH).toEqual({ reps: 2, hits: 1, confusions: { PULL: 1 } })
  })
})
