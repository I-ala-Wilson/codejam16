// Score the engine's gesture detection against recordings (contracts/recording.md).
//
//   node --experimental-strip-types engine/tools/score.ts <folder-or-json>... [--frames]
//
// For every <name>.json with a sibling <name>.wav it runs the real DSP and rule detectors, then prints what
// the detector said inside each labelled rep, per-label hit rates and the false alarms. With --frames it also
// draws every frame as a strip chart: + / - a direction (|shift| >= 30 Hz), o motion without direction.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { countStray, parseWav, scoreRecording, summarize, type RecordingMeta, type SessionScore } from '../src/scoring.ts'

const FRAMES_PER_ROW = 47 // about one second

const print = (text = ''): void => void process.stdout.write(`${text}\n`)

function findJsonFiles(path: string): string[] {
  if (!existsSync(path)) throw new Error(`No such file or folder: ${path}`)
  if (statSync(path).isFile()) return [path]
  return readdirSync(path)
    .sort()
    .flatMap((name) => findJsonFiles(join(path, name)))
    .filter((p) => p.endsWith('.json') && existsSync(p.replace(/\.json$/, '.wav')))
}

function readMeta(jsonPath: string): RecordingMeta & { gesture?: string; person?: string } {
  const raw: unknown = JSON.parse(readFileSync(jsonPath, 'utf8'))
  if (typeof raw !== 'object' || raw === null) throw new Error(`${jsonPath}: not a JSON object`)
  const m = raw as Record<string, unknown>
  if (typeof m.sampleRate !== 'number' || typeof m.toneHz !== 'number' || !Array.isArray(m.reps)) {
    throw new Error(`${jsonPath}: needs numeric sampleRate and toneHz and a reps array (contracts/recording.md)`)
  }
  return {
    sampleRate: m.sampleRate,
    toneHz: m.toneHz,
    reps: m.reps as RecordingMeta['reps'],
    gesture: typeof m.gesture === 'string' ? m.gesture : undefined,
    person: typeof m.person === 'string' ? m.person : undefined,
  }
}

function countByType(types: ReadonlyArray<string>): string {
  const counts = new Map<string, number>()
  types.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1))
  return [...counts].map(([t, n]) => `${t}x${n}`).join(' ') || 'none'
}

function drawFrames(score: SessionScore): void {
  const inRep = (t: number): boolean => score.reps.some((r) => t >= r.startMs && t <= r.endMs + 85)
  for (let i = 0; i < score.frames.length; i += FRAMES_PER_ROW) {
    const row = score.frames.slice(i, i + FRAMES_PER_ROW)
    const glyph = (f: (typeof row)[number]): string => {
      if (f.shiftHz >= 30) return '+'
      if (f.shiftHz <= -30) return '-'
      return Math.max(f.energyToward, f.energyAway) > 10 ? 'o' : '.'
    }
    print(`${String(Math.round(row[0].t / 1000)).padStart(4)}s ${row.map(glyph).join('')}`)
    print(`      ${row.map((f) => (inRep(f.t) ? '^' : ' ')).join('')}`)
  }
}

function report(jsonPath: string, showFrames: boolean): SessionScore {
  const meta = readMeta(jsonPath)
  const bytes = readFileSync(jsonPath.replace(/\.json$/, '.wav'))
  const wav = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  if (wav.sampleRate !== meta.sampleRate) {
    throw new Error(`${jsonPath}: WAV sample rate ${wav.sampleRate} differs from the JSON's ${meta.sampleRate}`)
  }
  const score = scoreRecording(wav.samples, meta)
  const hits = score.reps.filter((r) => r.hit).length
  print(`${jsonPath.split('/').pop()}`)
  print(`  ${meta.person ?? '?'} ${meta.gesture ?? '?'}  ${(wav.samples.length / wav.sampleRate).toFixed(1)} s  reps ${score.reps.length} hits ${hits}`)
  print(`  events: ${countByType(score.events.map((e) => e.type))}   stray: ${countByType(score.strayEvents.map((e) => e.type))}`)
  score.reps.forEach((r, i) =>
    print(`  rep ${String(i + 1).padStart(2)} ${r.label.padEnd(10)} ${r.hit ? 'HIT ' : 'MISS'} said: ${r.events.join(',') || 'nothing'}`),
  )
  if (showFrames) drawFrames(score)
  return score
}

function main(): void {
  const args = process.argv.slice(2)
  const showFrames = args.includes('--frames')
  const paths = args.filter((a) => !a.startsWith('--'))
  if (paths.length === 0) throw new Error('Usage: score.ts <folder-or-json>... [--frames]')
  const files = paths.flatMap((p) => findJsonFiles(resolve(p)))
  if (files.length === 0) throw new Error('No recordings found (need <name>.json with a sibling <name>.wav)')
  const scores = files.map((f) => report(f, showFrames))

  print()
  print('== per label ==')
  for (const [label, s] of Object.entries(summarize(scores))) {
    const confused = Object.entries(s.confusions).map(([t, n]) => `${t}x${n}`).join(' ')
    print(`${label.padEnd(10)} ${s.hits}/${s.reps}  ${((100 * s.hits) / s.reps).toFixed(0)}%${confused ? `   missed as: ${confused}` : ''}`)
  }
  print(`false alarms: ${JSON.stringify(countStray(scores))}`)
}

try {
  main()
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
