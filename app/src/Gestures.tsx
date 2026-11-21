import { useEffect, useState } from 'react'
import type { GestureEvent } from '@contracts/engine.ts'
import { Window } from '@ui/index.ts'
import { engine } from './engine.ts'

// Live view of engine.onGesture (#9): try every gesture and see what fires.
export default function Gestures() {
  const [running, setRunning] = useState(engine.health().running)
  const [last, setLast] = useState<GestureEvent | null>(null)
  const [log, setLog] = useState<GestureEvent[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | undefined
    const off = engine.onGesture((e) => {
      setLast(e); setLog((l) => [e, ...l].slice(0, 30))
      clearTimeout(clear); clear = setTimeout(() => setLast(null), 1200)
    })
    return () => { off(); clearTimeout(clear) }
  }, [])

  const start = async () => {
    setError('')
    try { await engine.start(); await engine.calibrate(3000); setRunning(true) } catch (e) { setError(String(e)) }
  }

  return (
    <Window title="Gesture test">
      {!running && <p><button onClick={start}>Start sonar and calibrate (keep still 3 s)</button></p>}
      {error && <p><b>Problem:</b> {error}</p>}
      <p>Try each one about 20-30 cm from the screen and check the big readout:
        <b> PUSH</b> then <b>PULL</b> (brisk 15 cm toward, then back: the pull is your return), <b>WAVE</b> (fast side to side, 1 s+),
        <b> OPEN_CLOSE</b> (open/close fist quickly), <b>UNDO</b> (a very fast short flick of the fingers away, like shooing a fly), <b>HOLD</b> (stop and keep still 1.5 s).</p>
      <div style={{ fontSize: 64, fontWeight: 900, textAlign: 'center', border: '2px solid #000', borderRadius: 8, padding: '24px 0', margin: '12px 0' }}>
        {last ? `${last.type}${last.count ? ` ×${last.count}` : ''}` : 'waiting...'}
      </div>
      <ol reversed style={{ fontFamily: 'monospace' }}>
        {log.map((e, i) => (
          <li key={i}>{e.type}{e.count ? ` ×${e.count}` : ''} · conf {e.confidence.toFixed(2)} · {e.speed !== undefined ? `${e.speed.toFixed(2)} m/s` : ''}</li>
        ))}
      </ol>
    </Window>
  )
}
