// Score the double-tap UNDO detector (engine/src/doubletap.ts) against recordings, exactly as pre-registered in
// ml/experiments/RESULTS.md ("New double-tap UNDO detector").
//
//   node --experimental-strip-types engine/tools/undo-score.ts <folder>...
//
// For every <name>.json with a sibling <name>.wav (breath takes are skipped) it runs the real DSP, feeds the frames to
// DoubleTapTracker, and prints: UNDO rep recall per person (an UNDO event is a hit for a rep when it falls between the
// rep's start and 1.0 s after its end), and false UNDO events per minute on the takes of every other gesture. In UNDO takes,
// events outside every rep window are false too.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DoubleTapTracker } from '../src/doubletap.ts'
import { parseWav, scoreRecording, type RecordingMeta } from '../src/scoring.ts'

const REP_TAIL_MS = 1000
const FLUSH_FRAMES = 140 // about 3 s of stillness after the last frame, so a final burst is decided

const print = (text = ''): void => void process.stdout.write(`${text}\n`)

function findJsonFiles(path: string): string[] {
  if (!existsSync(path)) throw new Error(`No such file or folder: ${path}`)
  if (statSync(path).isFile()) return [path]
  return readdirSync(path)
    .sort()
    .filter((name) => name !== 'breath')
    .flatMap((name) => findJsonFiles(join(path, name)))
    .filter((p) => p.endsWith('.json') && existsSync(p.replace(/\.json$/, '.wav')))
}

interface Meta extends RecordingMeta {
  readonly gesture: string
  readonly person: string
}

function readMeta(jsonPath: string): Meta {
  const m = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>
  if (typeof m.sampleRate !== 'number' || typeof m.toneHz !== 'number' || !Array.isArray(m.reps)) {
    throw new Error(`${jsonPath}: needs numeric sampleRate and toneHz and a reps array`)
  }
  return {
    sampleRate: m.sampleRate,
    toneHz: m.toneHz,
    reps: m.reps as RecordingMeta['reps'],
    gesture: typeof m.gesture === 'string' ? m.gesture : '?',
    person: typeof m.person === 'string' ? m.person.toLowerCase() : '?',
  }
}

interface Tally {
  reps: number
  hits: number
  falseEvents: number
  minutes: number
}
const newTally = (): Tally => ({ reps: 0, hits: 0, falseEvents: 0, minutes: 0 })

function scoreTake(jsonPath: string): { meta: Meta; reps: number; hits: number; falseEvents: number; minutes: number } {
  const meta = readMeta(jsonPath)
  const bytes = readFileSync(jsonPath.replace(/\.json$/, '.wav'))
  const wav = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const { frames } = scoreRecording(wav.samples, meta)
  const tracker = new DoubleTapTracker()
  const hopMs = frames.length > 1 ? frames[1].t - frames[0].t : 21.33
  const lastT = frames.length > 0 ? frames[frames.length - 1].t : 0
  const flush = Array.from({ length: FLUSH_FRAMES }, (_, k) => ({ t: lastT + (k + 1) * hopMs, shiftHz: 0, energyToward: 0, energyAway: 0 }))
  const events = [...frames, ...flush].flatMap((f) => tracker.push(f))
  const windows = meta.reps.map((r): [number, number] => [(r.start / meta.sampleRate) * 1000, (r.end / meta.sampleRate) * 1000 + REP_TAIL_MS])
  const inRep = (t: number): boolean => windows.some(([s, e]) => t >= s && t <= e)
  const isUndoTake = meta.gesture === 'UNDO'
  const hits = isUndoTake ? windows.filter(([s, e]) => events.some((ev) => ev.t >= s && ev.t <= e)).length : 0
  const falseEvents = isUndoTake ? events.filter((e) => !inRep(e.t)).length : events.length
  return { meta, reps: isUndoTake ? windows.length : 0, hits, falseEvents, minutes: wav.samples.length / wav.sampleRate / 60 }
}

const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`)
const perMin = (t: Tally): string => (t.minutes === 0 ? 'n/a' : (t.falseEvents / t.minutes).toFixed(2))

function main(argv: string[]): number {
  const roots = argv.length > 0 ? argv : ['data/recordings']
  const files = roots.flatMap(findJsonFiles)
  const undoByPerson = new Map<string, Tally>()
  const none = newTally()
  const others = newTally()
  const undoTakeFalse = newTally()
  for (const file of files) {
    const r = scoreTake(file)
    if (r.meta.gesture === 'UNDO') {
      const t = undoByPerson.get(r.meta.person) ?? newTally()
      t.reps += r.reps
      t.hits += r.hits
      undoByPerson.set(r.meta.person, t)
      undoTakeFalse.falseEvents += r.falseEvents
      undoTakeFalse.minutes += r.minutes
    } else {
      const bucket = r.meta.gesture === 'NONE' ? none : others
      bucket.falseEvents += r.falseEvents
      bucket.minutes += r.minutes
    }
  }
  print(`UNDO rep recall (${files.length} takes scanned)`)
  let reps = 0
  let hits = 0
  for (const [person, t] of [...undoByPerson].sort()) {
    print(`  ${person.padEnd(14)} ${String(t.hits).padStart(3)}/${String(t.reps).padEnd(3)} ${pct(t.hits, t.reps)}`)
    reps += t.reps
    hits += t.hits
  }
  print(`  ${'pooled'.padEnd(14)} ${String(hits).padStart(3)}/${String(reps).padEnd(3)} ${pct(hits, reps)}`)
  print('False UNDO events per minute')
  print(`  NONE takes                         ${perMin(none)}   (${none.falseEvents} in ${none.minutes.toFixed(1)} min)`)
  print(`  PUSH/PULL/WAVE/OPEN_CLOSE/REPET.   ${perMin(others)}   (${others.falseEvents} in ${others.minutes.toFixed(1)} min)`)
  print(`  outside the reps of UNDO takes     ${perMin(undoTakeFalse)}   (${undoTakeFalse.falseEvents} in ${undoTakeFalse.minutes.toFixed(1)} min)`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
