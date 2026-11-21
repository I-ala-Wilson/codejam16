import { readFileSync, writeFileSync } from 'node:fs'
import { parseWav, scoreRecording } from '/home/atlas/dev/competition/codejam-16/engine/src/scoring.ts'
const files = JSON.parse(readFileSync(process.argv[2], 'utf8')) as string[]
const out: Record<string, { type: string; t: number; count: number | null }[]> = {}
for (const f of files) {
  const m = JSON.parse(readFileSync(f, 'utf8'))
  const bytes = readFileSync(f.replace(/\.json$/, '.wav'))
  const wav = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const sc = scoreRecording(wav.samples, { sampleRate: m.sampleRate, toneHz: m.toneHz, reps: m.reps })
  out[f] = sc.events.map((e) => ({ type: e.type as string, t: e.t, count: (e as { count?: number }).count ?? null }))
}
writeFileSync(process.argv[3], JSON.stringify(out))
