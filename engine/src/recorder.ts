import type { RecordedSession, SessionLabel } from '../../contracts/engine.ts'
import { WINDOW } from './pipeline.ts'

// Session recording per contracts/recording.md: raw mono float32 WAV plus JSON meta with sample-index reps.
// The Engine API has no "mark rep" call, so reps are found from motion energy; the WAV is always complete,
// so ml/ can re-segment however it likes.

/** A frame counts as motion when either side is this far above the learned floor. */
const REP_THRESHOLD_DB = 10
/** Motion must last this many consecutive frames (about 64 ms) to start a rep; one noisy frame is ignored. */
const MIN_REP_FRAMES = 3
/** A rep ends after this many quiet frames in a row (about 170 ms). */
const REP_GAP_FRAMES = 8

const WAV_HEADER_BYTES = 44
const BYTES_PER_SAMPLE = 4
const IEEE_FLOAT_FORMAT = 3

export interface RecorderConfig {
  readonly label: SessionLabel
  readonly sampleRate: number
  readonly toneHz: number
  readonly toneDbfs: number
  readonly now: Date
}

export interface FrameMotion {
  readonly energyToward: number
  readonly energyAway: number
}

interface Rep {
  readonly start: number
  readonly end: number
  readonly label: string
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** Lowercase, a-z 0-9 and single dashes only, so it is safe inside a file name. */
export function safeName(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'x' : cleaned
}

/** Local time with the numeric UTC offset, e.g. 2026-11-20T23:10:05-05:00. */
export function formatIsoWithOffset(date: Date): string {
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${day}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function fileTimestamp(date: Date): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  return `${day}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** Mono 32-bit float WAV. */
export function encodeWav(chunks: ReadonlyArray<Float32Array<ArrayBuffer>>, sampleRate: number): Blob {
  const samples = chunks.reduce((sum, c) => sum + c.length, 0)
  const dataBytes = samples * BYTES_PER_SAMPLE
  const header = new ArrayBuffer(WAV_HEADER_BYTES)
  const view = new DataView(header)
  const writeTag = (at: number, tag: string): void => {
    for (let i = 0; i < 4; i++) view.setUint8(at + i, tag.charCodeAt(i))
  }
  writeTag(0, 'RIFF')
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true)
  writeTag(8, 'WAVE')
  writeTag(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, IEEE_FLOAT_FORMAT, true)
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true) // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE, true) // block align
  view.setUint16(34, 32, true) // bits per sample
  writeTag(36, 'data')
  view.setUint32(40, dataBytes, true)
  return new Blob([header, ...chunks], { type: 'audio/wav' })
}

export class SessionRecorder {
  private readonly chunks: Float32Array<ArrayBuffer>[] = []
  private readonly reps: Rep[] = []
  private samples = 0
  private finished = false
  private candidateStart = 0
  private candidateFrames = 0
  private repOpen = false
  private repStart = 0
  private lastActive = 0
  private quietFrames = 0

  private readonly config: RecorderConfig

  constructor(config: RecorderConfig) {
    this.config = config
  }

  /** Store one hop of raw mic samples. The chunk is copied; the caller may reuse its buffer. */
  pushChunk(chunk: Float32Array): void {
    this.assertOpen()
    this.chunks.push(chunk.slice())
    this.samples += chunk.length
  }

  /** Report the frame produced by the chunk just pushed, so reps can be marked. */
  pushFrame(motion: FrameMotion): void {
    this.assertOpen()
    // A frame describes the window ending at the latest sample, so its centre is half a window earlier.
    const centre = Math.max(0, this.samples - WINDOW / 2)
    const active = Math.max(motion.energyToward, motion.energyAway) > REP_THRESHOLD_DB
    if (this.repOpen) this.trackOpenRep(active, centre)
    else this.trackCandidate(active, centre)
  }

  finish(): RecordedSession {
    this.assertOpen()
    if (this.repOpen) this.closeRep()
    this.finished = true
    const { label, sampleRate, toneHz, toneDbfs, now } = this.config
    return {
      wav: encodeWav(this.chunks, sampleRate),
      filename: `${safeName(label.person)}_${label.gesture}_${safeName(label.laptop)}_${fileTimestamp(now)}.wav`,
      meta: {
        person: label.person,
        gesture: label.gesture,
        laptop: label.laptop,
        note: label.note ?? '',
        sampleRate,
        toneHz,
        toneDbfs,
        reps: this.reps,
        createdAt: formatIsoWithOffset(now),
      },
    }
  }

  private assertOpen(): void {
    if (this.finished) throw new Error('This recording has already been stopped')
  }

  private trackCandidate(active: boolean, centre: number): void {
    if (!active) {
      this.candidateFrames = 0
      return
    }
    if (this.candidateFrames === 0) this.candidateStart = centre
    this.candidateFrames += 1
    if (this.candidateFrames < MIN_REP_FRAMES) return
    this.repOpen = true
    this.repStart = this.candidateStart
    this.lastActive = centre
    this.quietFrames = 0
  }

  private trackOpenRep(active: boolean, centre: number): void {
    if (active) {
      this.lastActive = centre
      this.quietFrames = 0
      return
    }
    this.quietFrames += 1
    if (this.quietFrames > REP_GAP_FRAMES) this.closeRep()
  }

  private closeRep(): void {
    this.reps.push({ start: this.repStart, end: this.lastActive, label: this.config.label.gesture })
    this.repOpen = false
    this.candidateFrames = 0
    this.quietFrames = 0
  }
}
