import type { GestureEvent } from '../../contracts/engine.ts'
import { buildFloor } from './dsp.ts'
import { GestureDetector, type MotionFrame } from './gestures.ts'
import { FramePipeline, HOP, WINDOW } from './pipeline.ts'

// Offline scoring: run the real DSP and rule detectors over a recording and compare the events with its labelled
// reps (contracts/recording.md). Used by engine/tools/score.ts to tune thresholds on real takes.

export interface ParsedWav {
  readonly sampleRate: number
  readonly samples: Float32Array
}

export interface RecordingRep {
  readonly start: number
  readonly end: number
  readonly label: string
}

export interface RecordingMeta {
  readonly sampleRate: number
  readonly toneHz: number
  readonly reps: ReadonlyArray<RecordingRep>
}

export interface ScoredRep {
  readonly label: string
  readonly startMs: number
  readonly endMs: number
  readonly hit: boolean
  /** Types of every event found inside the rep's match window. */
  readonly events: string[]
}

export interface SessionScore {
  readonly frames: MotionFrame[]
  readonly events: GestureEvent[]
  readonly reps: ScoredRep[]
  /** Events that fall inside no rep window. */
  readonly strayEvents: GestureEvent[]
}

export interface LabelSummary {
  reps: number
  hits: number
  /** What the detector said instead, for reps it missed ('NONE' when it said nothing). */
  confusions: Record<string, number>
}

/** The floor skips frames within this long of a rep, so the take's own motion cannot hide itself. */
const FLOOR_MARGIN_MS = 300
const MIN_FLOOR_FRAMES = 20
/** An event belongs to a rep when it falls between a little before its start and a while after its end. */
const MATCH_HEAD_MS = 150
const MATCH_TAIL_MS = 800
/** Quiet frames appended so chains still waiting out their idle time get judged (about 2 s). */
const FLUSH_FRAMES = 100

const RIFF_HEADER_BYTES = 12
const PCM_FORMAT = 1
const FLOAT_FORMAT = 3

interface WavFormat {
  readonly format: number
  readonly channels: number
  readonly sampleRate: number
  readonly bits: number
}

function tagAt(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
}

/** Mono 16-bit PCM or 32-bit float WAV, as the engine records and the Record page saves. */
export function parseWav(buffer: ArrayBuffer): ParsedWav {
  const view = new DataView(buffer)
  if (buffer.byteLength < RIFF_HEADER_BYTES || tagAt(view, 0) !== 'RIFF' || tagAt(view, 8) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file')
  }
  let fmt: WavFormat | null = null
  let data: { offset: number; size: number } | null = null
  for (let at = RIFF_HEADER_BYTES; at + 8 <= buffer.byteLength; ) {
    const id = tagAt(view, at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      data = { offset: body, size: Math.min(size, buffer.byteLength - body) }
      break
    }
    at = body + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('WAV is missing its fmt or data chunk')
  if (fmt.channels !== 1) throw new Error(`Only mono WAV is supported, got ${fmt.channels} channels`)
  return { sampleRate: fmt.sampleRate, samples: decodeSamples(view, data, fmt) }
}

function decodeSamples(view: DataView, data: { offset: number; size: number }, fmt: WavFormat): Float32Array {
  if (fmt.format === PCM_FORMAT && fmt.bits === 16) {
    const out = new Float32Array(Math.floor(data.size / 2))
    for (let i = 0; i < out.length; i++) out[i] = view.getInt16(data.offset + i * 2, true) / 32768
    return out
  }
  if (fmt.format === FLOAT_FORMAT && fmt.bits === 32) {
    const out = new Float32Array(Math.floor(data.size / 4))
    for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(data.offset + i * 4, true)
    return out
  }
  throw new Error(`Unsupported WAV format ${fmt.format} with ${fmt.bits} bits`)
}

function chunksOf(samples: Float32Array): Float32Array[] {
  const out: Float32Array[] = []
  for (let i = 0; i + HOP <= samples.length; i += HOP) out.push(samples.subarray(i, i + HOP))
  return out
}

/** Pass 1: frames from the raw audio, to learn the still-room floor from frames away from every rep. */
function learnFloor(chunks: Float32Array[], meta: RecordingMeta, repsMs: ReadonlyArray<[number, number]>): Float32Array | null {
  const pipeline = new FramePipeline({ sampleRate: meta.sampleRate, toneHz: meta.toneHz })
  const hopMs = (HOP / meta.sampleRate) * 1000
  const windowMs = (WINDOW / meta.sampleRate) * 1000
  const all: Float32Array[] = []
  const still: Float32Array[] = []
  chunks.forEach((chunk, i) => {
    const t = (i + 1) * hopMs
    const frame = pipeline.push(chunk, t)
    if (!frame) return
    all.push(frame.bins)
    const nearRep = repsMs.some(([s, e]) => t + FLOOR_MARGIN_MS >= s && t - windowMs - FLOOR_MARGIN_MS <= e)
    if (!nearRep) still.push(frame.bins)
  })
  if (all.length === 0) return null
  return buildFloor(still.length >= MIN_FLOOR_FRAMES ? still : all)
}

/** Habit takes are labelled with their kind (REPETITIVE-scratch, REPETITIVE-nailbite); the detector reports REPETITIVE. */
export const canonicalLabel = (label: string): string => (label.startsWith('REPETITIVE') ? 'REPETITIVE' : label)

/** Run the real pipeline and detectors over a recording and match their events to its reps. */
export function scoreRecording(samples: Float32Array, meta: RecordingMeta): SessionScore {
  const toMs = (sample: number): number => (sample / meta.sampleRate) * 1000
  const repsMs = meta.reps.map((r): [number, number] => [toMs(r.start), toMs(r.end)])
  const chunks = chunksOf(samples)
  const floor = learnFloor(chunks, meta, repsMs)
  if (!floor) return { frames: [], events: [], reps: [], strayEvents: [] }

  const pipeline = new FramePipeline({ sampleRate: meta.sampleRate, toneHz: meta.toneHz })
  pipeline.setFloor(floor)
  const detector = new GestureDetector({ toneHz: meta.toneHz })
  const hopMs = (HOP / meta.sampleRate) * 1000
  const frames: MotionFrame[] = []
  const events: GestureEvent[] = []
  chunks.forEach((chunk, i) => {
    const frame = pipeline.push(chunk, (i + 1) * hopMs)
    if (!frame) return
    frames.push(frame)
    events.push(...detector.push(frame))
  })
  const lastT = frames.length > 0 ? frames[frames.length - 1].t : 0
  for (let k = 1; k <= FLUSH_FRAMES; k++) {
    events.push(...detector.push({ t: lastT + k * hopMs, shiftHz: 0, energyToward: 0, energyAway: 0 }))
  }

  const inWindow = (e: GestureEvent, [s, end]: [number, number]): boolean =>
    e.t >= s - MATCH_HEAD_MS && e.t <= end + MATCH_TAIL_MS
  const reps = meta.reps.map((rep, i): ScoredRep => {
    const found = events.filter((e) => inWindow(e, repsMs[i])).map((e) => e.type as string)
    return { label: rep.label, startMs: repsMs[i][0], endMs: repsMs[i][1], hit: found.includes(canonicalLabel(rep.label)), events: found }
  })
  // A HOLD follows every motion by design, so it is only a false alarm in takes that are scored on HOLD.
  const scoresHold = meta.reps.some((r) => r.label === 'HOLD')
  const strayEvents = events.filter((e) => !repsMs.some((r) => inWindow(e, r)) && (scoresHold || e.type !== 'HOLD'))
  return { frames, events, reps, strayEvents }
}

/** Per label: how many reps there were, how many the detector got, and what it said for the rest. */
export function summarize(scores: ReadonlyArray<SessionScore>): Record<string, LabelSummary> {
  const out: Record<string, LabelSummary> = {}
  for (const rep of scores.flatMap((s) => s.reps)) {
    const entry = (out[rep.label] ??= { reps: 0, hits: 0, confusions: {} })
    entry.reps += 1
    if (rep.hit) {
      entry.hits += 1
      continue
    }
    const said = rep.events.length > 0 ? [...new Set(rep.events)] : ['NONE']
    for (const type of said) entry.confusions[type] = (entry.confusions[type] ?? 0) + 1
  }
  return out
}

/** Events outside every rep, by type: the false alarms. */
export function countStray(scores: ReadonlyArray<SessionScore>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of scores.flatMap((s) => s.strayEvents)) out[e.type] = (out[e.type] ?? 0) + 1
  return out
}
