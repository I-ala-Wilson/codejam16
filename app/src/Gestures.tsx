import { useEffect, useRef, useState } from 'react'
import type { GestureEvent } from '@contracts/engine.ts'
import { Window } from '@ui/index.ts'
import { engine } from './engine.ts'
import { probeListeners } from '@engine/classifier.ts'

type Probs = { names: ReadonlyArray<string>; p: number[]; t: number }
const LABEL = (n: string) => (n === 'REPETITIVE' ? 'HABIT' : n.replace('_', '/'))

// Live view of engine.onGesture (#9): try every gesture and see what fires.
export default function Gestures() {
  const [running, setRunning] = useState(engine.health().running)
  useEffect(() => { const id = window.setInterval(() => setRunning(engine.health().running), 500); return () => clearInterval(id) }, [])
  const [last, setLast] = useState<GestureEvent | null>(null)
  const [log, setLog] = useState<{ e: GestureEvent; peak: number[] }[]>([])
  const [live, setLive] = useState<Probs | null>(null)
  // every model evaluation, kept for 2 s so each event can show what every class scored around it
  const recent = useRef<Probs[]>([])
  useEffect(() => {
    let last = 0
    const tap = (p: number[], names: ReadonlyArray<string>, t: number) => {
      recent.current = [...recent.current.filter((x) => x.t > t - 2000), { names, p, t }]
      if (t - last > 100) { last = t; setLive({ names, p, t }) }
    }
    probeListeners.add(tap)
    return () => { probeListeners.delete(tap) }
  }, [])
  const peaks = () => {
    const r = recent.current
    if (!r.length) return []
    return r[0].p.map((_, i) => Math.max(...r.map((x) => x.p[i])))
  }
  const names = live?.names ?? []
  const [error, setError] = useState('')

  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | undefined
    const off = engine.onGesture((e) => {
      if (e.type === 'REPETITIVE') return // Habit mode signal, not a gesture
      setLast(e); setLog((l) => [{ e, peak: peaks() }, ...l].slice(0, 30))
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
        <b> OPEN_CLOSE</b> (open/close fist quickly), <b>UNDO</b> (double tap: two quick small taps toward the screen), <b>HOLD</b> (stop and keep still 1.5 s).</p>
      <div style={{ fontSize: 64, fontWeight: 900, textAlign: 'center', border: '2px solid #000', borderRadius: 8, padding: '24px 0', margin: '12px 0' }}>
        {last ? `${last.type}${last.count ? ` ×${last.count}` : ''}` : 'waiting...'}
      </div>
      {live && (
        <div style={{ fontFamily: 'monospace', margin: '8px 0 16px' }}>
          {names.map((n, i) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '3px 0' }}>
              <span style={{ width: 110 }}>{LABEL(n)}</span>
              <span style={{ flex: 1, maxWidth: 420, height: 10, border: '1px dotted currentColor' }}>
                <span style={{ display: 'block', height: '100%', width: `${(live.p[i] * 100).toFixed(0)}%`, background: 'currentColor' }} />
              </span>
              <span style={{ width: 44, textAlign: 'right' }}>{live.p[i].toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
      <ol reversed style={{ fontFamily: 'monospace' }}>
        {log.map(({ e, peak }, i) => (
          <li key={i}><b>{e.type}</b>{e.count ? ` ×${e.count}` : ''} · conf {e.confidence.toFixed(2)}{e.source === 'rules' ? ' (rule)' : ''}
            {peak.length > 0 && <> · peaks: {names.map((n, k) => n === 'NONE' ? null : `${LABEL(n)} ${peak[k].toFixed(2)}`).filter(Boolean).join('  ')}</>}
          </li>
        ))}
      </ol>
    </Window>
  )
}
