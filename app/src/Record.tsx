import { useEffect, useState, type ReactNode } from 'react'
import type { GestureType } from '@contracts/engine.ts'
import { Window } from '@ui/index.ts'
import { engine } from './engine.ts'

const REPS = 20
const GO_MS = 1000
const REST_MS = 900

type Item = { gesture: GestureType | 'FREE'; how: string }
const GESTURES: Item[] = [
  { gesture: 'PUSH', how: 'Start about 30 cm away. On GO, one brisk push of about 15 cm (doorbell speed), then hold. During rest, drift back SLOWLY.' },
  { gesture: 'PULL', how: 'Start about 15 cm away. On GO, one brisk pull back of about 15 cm, then hold. During rest, drift forward SLOWLY.' },
  { gesture: 'WAVE', how: 'Wave side to side, fast, for the whole GO window.' },
  { gesture: 'OPEN_CLOSE', how: 'Hand toward the screen: open and close your fist 3 times quickly.' },
  { gesture: 'UNDO', how: 'Two quick pulls back to back (pull, reset, pull).' },
  { gesture: 'HOLD', how: 'Hand in front of the screen, completely still for the GO window.' },
  { gesture: 'REPETITIVE', how: 'Scratch your forearm in front of the laptop, small fast movements.' },
  { gesture: 'FREE', how: 'Normal activity: type, reach for a drink, shift in your seat. Teaches it what is NOT a gesture.' },
]

// Engine records float32; save 16-bit PCM to halve the size (contracts/recording.md v2).
async function toPcm16(wav: Blob): Promise<Blob> {
  const buf = await wav.arrayBuffer()
  const v = new DataView(buf)
  let off = 12, fmt = { rate: 48000, bits: 32, fmtTag: 3 }, dataOff = 0, dataLen = 0
  while (off + 8 <= buf.byteLength) {
    const id = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3))
    const len = v.getUint32(off + 4, true)
    if (id === 'fmt ') fmt = { fmtTag: v.getUint16(off + 8, true), rate: v.getUint32(off + 12, true), bits: v.getUint16(off + 22, true) }
    if (id === 'data') { dataOff = off + 8; dataLen = len; break }
    off += 8 + len + (len % 2)
  }
  if (!dataOff || fmt.bits !== 32 || fmt.fmtTag !== 3) return wav // already int16 or unknown: keep as is
  const n = Math.floor(dataLen / 4)
  const out = new DataView(new ArrayBuffer(44 + n * 2))
  const w = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true)
  out.setUint32(24, fmt.rate, true); out.setUint32(28, fmt.rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true)
  w(36, 'data'); out.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, v.getFloat32(dataOff + i * 4, true)))
    out.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function Record() {
  const [person, setPerson] = useState(localStorage.getItem('echo.person') ?? '')
  const [laptop, setLaptop] = useState(localStorage.getItem('echo.laptop') ?? '')
  const [running, setRunning] = useState(engine.health().running)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<Item | null>(null)
  const [rep, setRep] = useState(0)
  const [phase, setPhase] = useState<'go' | 'rest'>('rest')
  const [done, setDone] = useState<string[]>(JSON.parse(localStorage.getItem('echo.done') ?? '[]'))

  useEffect(() => { localStorage.setItem('echo.person', person) }, [person])
  useEffect(() => { localStorage.setItem('echo.laptop', laptop) }, [laptop])
  useEffect(() => { localStorage.setItem('echo.done', JSON.stringify(done)) }, [done])

  const startSonar = async () => {
    setError('')
    try { await engine.start(); await engine.calibrate(3000); setRunning(true) }
    catch (e) { setError(String(e)) }
  }

  const take = async (item: Item) => {
    setError('')
    try {
      engine.startRecording({ person: person.trim().toLowerCase(), gesture: item.gesture, laptop: laptop.trim().toLowerCase().replace(/\s+/g, '-') })
    } catch (e) { setError(String(e)); return }
    setCurrent(item)
    for (let i = 1; i <= REPS; i++) {
      // PUSH/PULL/UNDO need time to drift back to the start slowly between reps
      setRep(i); setPhase('rest'); await sleep(['PUSH', 'PULL', 'UNDO'].includes(item.gesture) ? 2200 : REST_MS)
      setPhase('go'); await sleep(GO_MS)
    }
    setPhase('rest'); await sleep(600)
    try {
      const s = await engine.stopRecording()
      download(await toPcm16(s.wav), s.filename)
      download(new Blob([JSON.stringify(s.meta, null, 2)], { type: 'application/json' }), s.filename.replace(/\.wav$/, '.json'))
      setDone((d) => [...new Set([...d, item.gesture])])
    } catch (e) { setError(String(e)) }
    setCurrent(null); setRep(0)
  }

  const ready = person.trim() !== '' && laptop.trim() !== ''

  return (
    <Window title="Record gestures (training data)">
      {!current && (
        <>
          <Box title="1. Who and which laptop">
            Your first name: <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="e.g. ej" />{' '}
            Laptop: <input value={laptop} onChange={(e) => setLaptop(e.target.value)} placeholder="e.g. macbook air" />
          </Box>
          <Box title="2. Turn on the sonar">
            {running ? '✓ Sonar is on.' : <button onClick={startSonar} disabled={!ready}>Start sonar and calibrate (keep still 3 s)</button>}
            {!ready && ' Fill in step 1 first.'}
          </Box>
          <Box title={`3. Record each gesture (${REPS} reps, about 40 s each)`}>
            <p>Sit in front of the laptop, hand about 20 cm from the screen. Press a gesture, then do the move every time the screen says <b>GO</b>. Two files download per gesture (a .wav and a .json). When you've done all of them, tell your agent: <b>"move my Echo recordings from Downloads into data/recordings/&lt;my GitHub login&gt;/ and push them"</b>.</p>
            {GESTURES.map((g) => (
              <div key={g.gesture} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
                <button onClick={() => take(g)} disabled={!running || !ready} style={{ minWidth: 130 }}>
                  {done.includes(g.gesture) ? '✓ ' : ''}{g.gesture}
                </button>
                <span>{g.how}</span>
              </div>
            ))}
            {done.length > 0 && <button onClick={() => setDone([])}>Clear checkmarks</button>}
          </Box>
        </>
      )}

      {current && (
        <Box title={`Recording ${current.gesture}: rep ${rep} of ${REPS}`}>
          <p>{current.how}</p>
          <div style={{ fontSize: 72, fontWeight: 900, textAlign: 'center', padding: '30px 0', border: '2px solid #000', borderRadius: 8, background: phase === 'go' ? '#000' : '#fff', color: phase === 'go' ? '#fff' : '#000' }}>
            {phase === 'go' ? 'GO' : 'rest: slowly back to start'}
          </div>
          <p>Keep everyone else still and away from the laptop while recording.</p>
        </Box>
      )}

      {error && <p><b>Problem:</b> {error}</p>}
    </Window>
  )
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '2px solid #000', borderRadius: 8, padding: '12px 16px', marginBottom: 12, boxShadow: '3px 3px 0 #000' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  )
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
