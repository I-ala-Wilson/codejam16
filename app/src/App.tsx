import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createEngine } from '@engine/index.ts'
import type { SpectrumFrame, EngineHealth } from '@contracts/engine.ts'
import { Window } from '@ui/index.ts'

const engine = createEngine()
const MOVE_HZ = 40      // a real hand push/pull shifts the echo by roughly 50-130 Hz
const REPS = 5
const REP_WINDOW_MS = 3000
const REST_MS = 1500

type Dist = 'near' | 'far'
type Move = 'push' | 'pull'
type Step =
  | 'setup' | 'start' | 'calibrate' | 'tone'
  | { reps: Dist; move: Move; rep: number; resting: boolean }
  | 'results'
type RepResult = { move: Move; dist: Dist; peak: number; ok: boolean }

const DIST_TEXT: Record<Dist, string> = {
  near: 'about 20 cm (a hand-span) in front of the screen, above the keyboard',
  far: 'about 50 cm (an arm\'s length) in front of the screen',
}

export default function App() {
  const [step, setStep] = useState<Step>('setup')
  const [error, setError] = useState('')
  const [health, setHealth] = useState<EngineHealth | null>(null)
  const [frame, setFrame] = useState<SpectrumFrame | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [results, setResults] = useState<RepResult[]>([])
  const [audible, setAudible] = useState<'' | 'yes' | 'no'>('')
  const [laptop, setLaptop] = useState('')
  const [copied, setCopied] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => engine.onFrame((f) => {
    drawColumn(canvas.current, f)
    trackPeak(f.shiftHz)
    setFrame(f); setHealth(engine.health())
  }), [])

  // per-rep peak tracking (signed: push looks for max, pull for min)
  const moveRef = useRef<Move>('push')
  const peakRef = useRef(0)
  function trackPeak(shift: number) {
    peakRef.current = moveRef.current === 'push' ? Math.max(peakRef.current, shift) : Math.min(peakRef.current, shift)
  }

  // drive the guided reps
  useEffect(() => {
    if (typeof step !== 'object') return
    const { reps, move, rep, resting } = step
    if (resting) {
      setCountdown(Math.ceil(REST_MS / 1000))
      const t = setTimeout(() => {
        moveRef.current = move; peakRef.current = 0
        setStep({ reps, move, rep, resting: false })
      }, REST_MS)
      return () => clearTimeout(t)
    }
    const started = Date.now()
    const tick = setInterval(() => setCountdown(Math.max(0, Math.ceil((REP_WINDOW_MS - (Date.now() - started)) / 1000))), 200)
    const done = setTimeout(() => {
      const peak = peakRef.current
      const ok = move === 'push' ? peak >= MOVE_HZ : peak <= -MOVE_HZ
      setResults((r) => [...r, { move, dist: reps, peak, ok }])
      if (rep < REPS) setStep({ reps, move, rep: rep + 1, resting: true })
      else if (move === 'push') setStep({ reps, move: 'pull', rep: 1, resting: true })
      else if (reps === 'near') setStep({ reps: 'far', move: 'push', rep: 1, resting: true })
      else setStep('results')
    }, REP_WINDOW_MS)
    return () => { clearInterval(tick); clearTimeout(done) }
  }, [step])

  const start = async () => {
    setError('')
    try { await engine.start(); setStep('calibrate') }
    catch (e) { setError(String(e)) }
  }
  const calibrate = async () => {
    setCountdown(3)
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000)
    await engine.calibrate(3000)
    clearInterval(t); setStep('tone')
  }
  const restart = () => { setResults([]); setCopied(false); setStep({ reps: 'near', move: 'push', rep: 1, resting: true }) }

  const snr = health?.snrDb ?? 0
  const count = (d: Dist, m: Move) => results.filter((r) => r.dist === d && r.move === m && r.ok).length
  const best = (d: Dist, m: Move) => {
    const xs = results.filter((r) => r.dist === d && r.move === m).map((r) => r.peak)
    return xs.length ? (m === 'push' ? Math.max(...xs) : Math.min(...xs)) : 0
  }
  const summary =
    `ROOM TEST: laptop ${laptop || '?'} | tone health ${snr.toFixed(1)} dB (${snr >= 30 ? 'good' : 'weak'}) | tone audible: ${audible || '?'} | ` +
    `20 cm: push ${count('near', 'push')}/${REPS} (peak +${best('near', 'push').toFixed(0)} Hz), pull ${count('near', 'pull')}/${REPS} (peak ${best('near', 'pull').toFixed(0)} Hz) | ` +
    `50 cm: push ${count('far', 'push')}/${REPS} (peak +${best('far', 'push').toFixed(0)} Hz), pull ${count('far', 'pull')}/${REPS} (peak ${best('far', 'pull').toFixed(0)} Hz)`

  const progress = ['setup', 'start', 'calibrate', 'tone', 'reps', 'results']
  const idx = typeof step === 'object' ? 4 : progress.indexOf(step)

  return (
    <Window title="Echo: room test">
      <p style={{ marginTop: 0 }}>Step {idx + 1} of 6</p>

      {step === 'setup' && (
        <Prompt title="Set up your laptop">
          <ol>
            <li>Laptop on a table, <b>lid open at a normal typing angle</b>.</li>
            <li><b>Volume at about 70%</b>, no headphones or Bluetooth speaker.</li>
            <li>Nothing covering the keyboard area (that's where the speakers and mic are).</li>
            <li>You're in Chrome.</li>
          </ol>
          <button onClick={() => setStep('start')}>Done, next</button>
        </Prompt>
      )}

      {step === 'start' && (
        <Prompt title="Turn on the sonar">
          <p>Click the button, then click <b>Allow</b> when Chrome asks for the microphone.</p>
          <button onClick={start}>Start sonar</button>
          {error && <p><b>Didn't start:</b> {error}. Refresh the page and try again.</p>}
        </Prompt>
      )}

      {step === 'calibrate' && (
        <Prompt title="Hands off, keep still">
          <p>Take your hands away from the laptop and don't move. This measures the quiet room for 3 seconds.</p>
          {countdown > 0 ? <Big>{countdown}</Big> : <button onClick={calibrate}>I'm still, calibrate</button>}
        </Prompt>
      )}

      {step === 'tone' && (
        <Prompt title="Check the tone">
          <p>Tone health: <Big>{snr.toFixed(0)} dB</Big> {snr >= 30 ? '✓ good' : '✗ weak: turn the volume up, then this number should rise'}</p>
          <p>Can you hear a high-pitched whine?{' '}
            <label><input type="radio" checked={audible === 'yes'} onChange={() => setAudible('yes')} /> yes</label>{' '}
            <label><input type="radio" checked={audible === 'no'} onChange={() => setAudible('no')} /> no</label>
          </p>
          <button onClick={restart} disabled={!audible}>Next: hand test</button>
        </Prompt>
      )}

      {typeof step === 'object' && (
        <Prompt title={step.reps === 'near' ? 'Hand test at 20 cm' : 'Hand test at 50 cm'}>
          <p>Hold your hand flat, palm facing the screen, <b>{DIST_TEXT[step.reps]}</b>. Move only your hand.</p>
          {step.resting ? (
            <>
              <Big>Get ready...</Big>
              <p>Next: {step.move === 'push' ? 'PUSH' : 'PULL'} {step.rep} of {REPS}. Hold your hand still.</p>
            </>
          ) : (
            <>
              <Big>{step.move === 'push' ? 'PUSH toward the screen' : 'PULL away from the screen'}</Big>
              <p>Rep {step.rep} of {REPS} · {countdown}s left</p>
            </>
          )}
          <p>
            {(['push', 'pull'] as Move[]).map((m) => (
              <span key={m} style={{ marginRight: 16 }}>
                {m.toUpperCase()}: {results.filter((r) => r.dist === step.reps && r.move === m).map((r, i) => <span key={i}>{r.ok ? '✓' : '✗'}</span>)}
              </span>
            ))}
          </p>
        </Prompt>
      )}

      {step === 'results' && (
        <Prompt title="Done. Send your results">
          <p>20 cm: push <b>{count('near', 'push')}/{REPS}</b>, pull <b>{count('near', 'pull')}/{REPS}</b> · 50 cm: push <b>{count('far', 'push')}/{REPS}</b>, pull <b>{count('far', 'pull')}/{REPS}</b></p>
          <p>Laptop model: <input value={laptop} onChange={(e) => setLaptop(e.target.value)} placeholder="e.g. MacBook Air M2" /></p>
          <button onClick={() => { navigator.clipboard.writeText(summary); setCopied(true) }}>{copied ? 'Copied ✓' : 'Copy results'}</button>{' '}
          <button onClick={restart}>Redo hand test</button>
          <p>Paste the copied line to your agent (it posts it to Ian), or text it to Ian.</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{summary}</pre>
        </Prompt>
      )}

      <h3>Live sonar</h3>
      <canvas ref={canvas} width={900} height={220} style={{ width: '100%', border: '2px solid #000', imageRendering: 'pixelated' }} />
      <p>
        The dark middle line is the inaudible 20 kHz tone. A hand moving <b>toward</b> the laptop leaves marks <b>above</b> it,
        <b> away</b> leaves marks <b>below</b>. Shift now: <b>{(frame?.shiftHz ?? 0).toFixed(0)} Hz</b>.
      </p>
    </Window>
  )
}

function Prompt({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '2px solid #000', borderRadius: 8, padding: '16px 20px', boxShadow: '3px 3px 0 #000', maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </div>
  )
}

function Big({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 40, fontWeight: 800, margin: '12px 0' }}>{children}</div>
}

function drawColumn(c: HTMLCanvasElement | null, f: SpectrumFrame) {
  if (!c) return
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return
  const { width: w, height: h } = c
  g.drawImage(c, -2, 0)
  const n = f.bins.length
  for (let y = 0; y < h; y++) {
    const i = Math.floor(((h - 1 - y) / h) * n)
    const db = f.bins[i] ?? -120
    const v = Math.max(0, Math.min(255, ((db + 100) / 70) * 255))
    g.fillStyle = `rgb(${255 - v},${255 - v},${255 - v})`
    g.fillRect(w - 2, y, 2, 1)
  }
}
