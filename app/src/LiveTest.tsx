import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GestureEvent, GestureType } from '@contracts/engine.ts'
import { HOP } from '@engine/pipeline.ts'
import { Window } from '@ui/index.ts'
import { engine } from './engine.ts'
import { toPcm16, download } from './Record.tsx'

// Cued live test (Yahya's plan step 3): cue a gesture, see what the model fired, tally hits/misses per gesture
// per person, and save every attempt as a cue-labelled take (more training data, with the prediction stored).

const REPS = 10
const GRACE_MS = 400 // detections can land a little after the cue window (engine emits ~250 ms after motion ends)
const SPEC: Record<string, { cueWindowMs: number; periodMs: number; how: string }> = {
  PUSH: { cueWindowMs: 1500, periodMs: 3000, how: 'one push toward the screen' },
  PULL: { cueWindowMs: 1500, periodMs: 3000, how: 'one pull away from the screen' },
  UNDO: { cueWindowMs: 1500, periodMs: 3000, how: 'double tap: two quick small taps toward the screen' },
  WAVE: { cueWindowMs: 2500, periodMs: 4000, how: 'wave about 3 swings' },
  OPEN_CLOSE: { cueWindowMs: 2000, periodMs: 3500, how: 'open and close your hand 2 to 3 times' },
}
type Tally = Record<string, { hit: number; total: number; confusions: Record<string, number> }>

export default function LiveTest() {
  const [login, setLogin] = useState(localStorage.getItem('echo.login') ?? '')
  const [laptop] = useState(localStorage.getItem('echo.laptop') ?? '')
  const [running, setRunning] = useState(engine.health().running)
  const [gesture, setGesture] = useState<GestureType>('PUSH')
  const [distance, setDistance] = useState(20)
  const [phase, setPhase] = useState<'idle' | 'away' | 'leadin' | 'cue' | 'rest' | 'saving'>('idle')
  const [count, setCount] = useState(0)
  const [rep, setRep] = useState(0)
  const [lastResult, setLastResult] = useState('')
  const [tally, setTally] = useState<Tally>(() => JSON.parse(localStorage.getItem(`echo.tally.${login}`) ?? '{}'))
  const [error, setError] = useState('')
  const frames = useRef(0)
  const events = useRef<GestureEvent[]>([])
  const sources = useRef<Record<string, number>>({})

  useEffect(() => { localStorage.setItem('echo.login', login); setTally(JSON.parse(localStorage.getItem(`echo.tally.${login}`) ?? '{}')) }, [login])
  useEffect(() => { localStorage.setItem(`echo.tally.${login}`, JSON.stringify(tally)) }, [tally, login])
  useEffect(() => {
    const offF = engine.onFrame(() => { frames.current += 1 })
    const offG = engine.onGesture((e) => {
      events.current.push(e)
      sources.current[e.source] = (sources.current[e.source] ?? 0) + 1
    })
    return () => { offF(); offG() }
  }, [])

  const startSonar = async () => {
    setError('')
    try { await engine.start(); await engine.calibrate(3000); setRunning(true) } catch (e) { setError(String(e)) }
  }

  const run = async () => {
    const spec = SPEC[gesture]
    setError(''); setLastResult('')
    setPhase('away'); for (let s = 2; s > 0; s--) { setCount(s); await sleep(1000) }
    const person = login.trim()
    const lap = laptop.trim().toLowerCase().replace(/\s+/g, '-') || 'laptop'
    try { engine.startRecording({ person, gesture, laptop: lap, note: `live test ${gesture} ${distance} cm` }) }
    catch (e) { setError(String(e)); setPhase('idle'); return }
    frames.current = 0
    setPhase('leadin'); for (let s = 3; s > 0; s--) { setCount(s); await sleep(1000) }

    const sr = engine.health().sampleRate || 48000
    const reps: { start: number; end: number; label: string; predicted: string[]; hit: boolean }[] = []
    let hits = 0
    const conf: Record<string, number> = {}
    for (let i = 0; i < REPS; i++) {
      setRep(i + 1)
      const start = frames.current * HOP
      events.current = []
      const t0 = performance.now()
      beep(); setPhase('cue'); await sleep(spec.cueWindowMs)
      setPhase('rest'); await sleep(Math.min(GRACE_MS, spec.periodMs - spec.cueWindowMs))
      const inWindow = events.current.filter((e) => e.t >= t0 - 100 && e.t <= t0 + spec.cueWindowMs + GRACE_MS).map((e) => e.type)
      const hit = inWindow.includes(gesture)
      if (hit) hits++
      for (const p of inWindow.filter((x) => x !== gesture && x !== 'HOLD')) conf[p] = (conf[p] ?? 0) + 1
      if (!inWindow.length) conf['(nothing)'] = (conf['(nothing)'] ?? 0) + 1
      setLastResult(hit ? `✓ ${gesture}` : `✗ saw ${inWindow.filter((x) => x !== 'HOLD').join(', ') || 'nothing'}`)
      reps.push({ start, end: start + Math.round((spec.cueWindowMs / 1000) * sr), label: gesture, predicted: inWindow, hit })
      await sleep(Math.max(0, spec.periodMs - spec.cueWindowMs - GRACE_MS))
    }

    setPhase('saving')
    try {
      const s = await engine.stopRecording()
      const stamp = s.filename.match(/_(\d{8}-\d{6})\.wav$/)?.[1] ?? Date.now().toString()
      const base = `${person.toLowerCase()}_${gesture}_${distance}cm_${lap}_live_${stamp}`
      const meta = {
        ...(s.meta as Record<string, unknown>), gesture, reps, takeKind: 'gesture', battery: 'livetest',
        distanceCm: distance, cueWindowMs: spec.cueWindowMs, periodMs: spec.periodMs, leadInMs: 3000,
        laptopModel: laptop, protocol: 'ml/PROTOCOL.md',
        note: `live test: ${hits}/${REPS} detected; detector sources ${JSON.stringify(sources.current)}`,
      }
      download(await toPcm16(s.wav), `${base}.wav`)
      download(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }), `${base}.json`)
    } catch (e) { setError(String(e)) }
    setTally((t) => {
      const cur = t[gesture] ?? { hit: 0, total: 0, confusions: {} }
      const c = { ...cur.confusions }
      for (const [k, v] of Object.entries(conf)) c[k] = (c[k] ?? 0) + v
      return { ...t, [gesture]: { hit: cur.hit + hits, total: cur.total + REPS, confusions: c } }
    })
    setPhase('idle'); setRep(0)
  }

  const busy = phase !== 'idle'
  const spec = SPEC[gesture]
  return (
    <Window title="Live test (cued): how well does the detector work for you?">
      {!busy && (
        <>
          <Box title="Setup">
            Your name / GitHub login: <input value={login} onChange={(e) => setLogin(e.target.value)} />{' '}
            {running ? `· sonar on (tone ${engine.health().snrDb.toFixed(0)} dB)` : <button onClick={startSonar} disabled={!login.trim()}>Start sonar and calibrate</button>}
          </Box>
          <Box title="Run a test (10 cues, about 40 s)">
            Gesture: <select value={gesture} onChange={(e) => setGesture(e.target.value as GestureType)}>
              {Object.keys(SPEC).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>{' '}
            Distance: <select value={distance} onChange={(e) => setDistance(Number(e.target.value))}>
              {[15, 20, 30, 50].map((d) => <option key={d} value={d}>{d} cm</option>)}
            </select>{' '}
            <button onClick={run} disabled={!running}>Start test</button>
            <p>On each beep + GO: {spec.how}, then hand back to rest and keep still. Every test is saved as extra training data (two files download); move them to data/recordings/&lt;your login&gt;/ like the dataset.</p>
          </Box>
          <Box title={`Results for ${login || '…'} (this laptop)`}>
            {Object.keys(tally).length === 0 ? <p>No tests yet.</p> : (
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={th}>Gesture</th><th style={th}>Detected</th><th style={th}>Rate</th><th style={th}>Confused with</th></tr></thead>
                <tbody>
                  {Object.entries(tally).map(([g, r]) => (
                    <tr key={g}>
                      <td style={td}>{g}</td><td style={td}>{r.hit} / {r.total}</td>
                      <td style={td}><b>{Math.round((100 * r.hit) / Math.max(1, r.total))}%</b></td>
                      <td style={td}>{Object.entries(r.confusions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p><button onClick={() => setTally({})}>Clear my results</button> Detector in use: {Object.keys(sources.current).join(', ') || 'none yet'} (rules until Yahya's model lands, then classifier).</p>
          </Box>
        </>
      )}
      {busy && (
        <Box title={`${gesture} at ${distance} cm${rep ? `: cue ${rep} of ${REPS}` : ''}`}>
          <div style={{ fontSize: 60, fontWeight: 900, textAlign: 'center', padding: '26px 0', border: '2px solid #000', borderRadius: 8,
            background: phase === 'cue' ? '#000' : '#fff', color: phase === 'cue' ? '#fff' : '#000' }}>
            {phase === 'away' && `Take your hands away… ${count}`}
            {phase === 'leadin' && `Hands off, keep still… ${count}`}
            {phase === 'cue' && `GO: ${gesture}`}
            {phase === 'rest' && 'hand back to rest, stay still'}
            {phase === 'saving' && 'saving…'}
          </div>
          <p style={{ fontSize: 24, textAlign: 'center' }}>{lastResult}</p>
        </Box>
      )}
      {error && <p><b>Problem:</b> {error}</p>}
    </Window>
  )
}

const th = { borderBottom: '2px solid #000', textAlign: 'left' as const, padding: 4 }
const td = { borderBottom: '1px solid #000', padding: 4 }

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '2px solid #000', borderRadius: 8, padding: '12px 16px', marginBottom: 12, boxShadow: '3px 3px 0 #000' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  )
}

let beepCtx: AudioContext | null = null
function beep() {
  beepCtx ??= new AudioContext()
  const o = beepCtx.createOscillator(); const g = beepCtx.createGain()
  o.frequency.value = 1000; g.gain.value = 0.15
  o.connect(g).connect(beepCtx.destination)
  o.start(); o.stop(beepCtx.currentTime + 0.12)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
