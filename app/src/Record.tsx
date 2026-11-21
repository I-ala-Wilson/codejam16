import { useEffect, useState, type ReactNode } from 'react'
import type { GestureType } from '@contracts/engine.ts'
import { Window } from '@ui/index.ts'
import { engine } from './engine.ts'

const REPS = 20
const GO_MS = 1300
const REST_MS = 1200

type Item = { gesture: GestureType | 'FREE'; how: string }
const GESTURES: Item[] = [
  { gesture: 'PUSH', how: 'Flat hand, palm to the screen, push toward the screen about 15 cm.' },
  { gesture: 'PULL', how: 'Start close to the screen, pull your hand back about 15 cm.' },
  { gesture: 'WAVE', how: 'Wave side to side, fast, for the whole GO window.' },
  { gesture: 'OPEN_CLOSE', how: 'Hand toward the screen: open and close your fist 3 times quickly.' },
  { gesture: 'UNDO', how: 'Two quick pulls back to back (pull, reset, pull).' },
  { gesture: 'HOLD', how: 'Hand in front of the screen, completely still for the GO window.' },
  { gesture: 'REPETITIVE', how: 'Scratch your forearm in front of the laptop, small fast movements.' },
  { gesture: 'FREE', how: 'Normal activity: type, reach for a drink, shift in your seat. Teaches it what is NOT a gesture.' },
]

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
      setRep(i); setPhase('rest'); await sleep(REST_MS)
      setPhase('go'); await sleep(GO_MS)
    }
    setPhase('rest'); await sleep(600)
    try {
      const s = await engine.stopRecording()
      download(s.wav, s.filename)
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
          <Box title={`3. Record each gesture (${REPS} reps, about 50 s each)`}>
            <p>Sit in front of the laptop, hand about 20 cm from the screen. Press a gesture, then do the move every time the screen says <b>GO</b>. Two files download per gesture: put them in the team Google Drive folder.</p>
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
            {phase === 'go' ? 'GO' : 'rest...'}
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
