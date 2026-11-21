import { useEffect, useRef, useState } from 'react'
import { createEngine } from '@engine/index.ts'
import type { SpectrumFrame, EngineHealth } from '@contracts/engine.ts'
import { Window } from '@ui/index.ts'

const engine = createEngine()
const MOVE_HZ = 40 // a real hand push/pull shifts the echo by roughly 50-130 Hz

type Phase = 'near' | 'far'

export default function App() {
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'calibrating' | 'stopped' | 'error'>('idle')
  const [error, setError] = useState('')
  const [calibrated, setCalibrated] = useState(false)
  const [health, setHealth] = useState<EngineHealth | null>(null)
  const [frame, setFrame] = useState<SpectrumFrame | null>(null)
  const [phase, setPhase] = useState<Phase>('near')
  const [peaks, setPeaks] = useState({ near: { push: 0, pull: 0 }, far: { push: 0, pull: 0 } })
  const [audible, setAudible] = useState<'' | 'yes' | 'no'>('')
  const [laptop, setLaptop] = useState('')
  const [copied, setCopied] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const phaseRef = useRef<Phase>('near')
  const calibratedRef = useRef(false)

  useEffect(() => {
    let last = 0
    return engine.onFrame((f) => {
      drawColumn(canvas.current, f)
      if (calibratedRef.current) {
        const ph = phaseRef.current
        setPeaks((p) => ({
          ...p,
          [ph]: { push: Math.max(p[ph].push, f.shiftHz), pull: Math.min(p[ph].pull, f.shiftHz) },
        }))
      }
      if (f.t - last > 100) { last = f.t; setFrame(f); setHealth(engine.health()) }
    })
  }, [])

  const start = async () => {
    setError(''); setStatus('starting')
    try { await engine.start(); setStatus('running'); setHealth(engine.health()) }
    catch (e) { setStatus('error'); setError(String(e)) }
  }
  const calibrate = async () => {
    calibratedRef.current = false; setStatus('calibrating')
    await engine.calibrate(3000)
    setStatus('running'); setCalibrated(true); calibratedRef.current = true
    setPeaks((p) => ({ ...p, [phaseRef.current]: { push: 0, pull: 0 } }))
  }
  const goFar = () => {
    phaseRef.current = 'far'; setPhase('far')
    setPeaks((p) => ({ ...p, far: { push: 0, pull: 0 } }))
  }

  const snr = health?.snrDb ?? 0
  const running = status === 'running' || status === 'calibrating'
  const nearOk = peaks.near.push >= MOVE_HZ && peaks.near.pull <= -MOVE_HZ
  const farOk = peaks.far.push >= MOVE_HZ && peaks.far.pull <= -MOVE_HZ
  const results =
    `ROOM TEST: laptop ${laptop || '?'} | tone health ${snr.toFixed(1)} dB (${snr >= 30 ? 'good' : 'weak'}) | ` +
    `20 cm push +${peaks.near.push.toFixed(0)} Hz pull ${peaks.near.pull.toFixed(0)} Hz (${nearOk ? 'PASS' : 'FAIL'}) | ` +
    `50 cm push +${peaks.far.push.toFixed(0)} Hz pull ${peaks.far.pull.toFixed(0)} Hz (${farOk ? 'PASS' : 'FAIL'}) | ` +
    `tone audible: ${audible || '?'}`

  return (
    <Window title="Echo: room test (about 5 minutes)">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1.3fr)', gap: 24 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Before you start</h2>
          <ul>
            <li>Laptop on a table, <b>lid open at a normal typing angle (about 110°)</b>. Tilt barely matters, because the speakers and mic sit in the base, not the screen.</li>
            <li>Nothing covering the keyboard area (that's where the speakers and mic are). No headphones or Bluetooth speaker.</li>
            <li>Laptop <b>volume at about 70%</b>.</li>
            <li>Use Chrome.</li>
          </ul>

          <Step n={1} done={running} title="Start the sonar">
            <button onClick={start} disabled={running}>Start sonar</button>{' '}
            Click Start, then click <b>Allow</b> when Chrome asks for the microphone.
            {status === 'error' && <p><b>Didn't start:</b> {error}. Refresh the page and try again.</p>}
          </Step>

          <Step n={2} done={calibrated} title="Calibrate (hands still)">
            <button onClick={calibrate} disabled={!running || status === 'calibrating'}>
              {status === 'calibrating' ? 'Calibrating... keep still' : 'Calibrate'}
            </button>{' '}
            Take your hands off the laptop and keep still for 3 seconds.
          </Step>

          <Step n={3} done={running && snr >= 30} title="Check the tone health">
            Tone health: <b>{snr.toFixed(1)} dB</b> {running && (snr >= 30 ? '✓ good' : '✗ weak: turn the volume up')}
            <br />Can you hear a high-pitched whine?{' '}
            <label><input type="radio" checked={audible === 'yes'} onChange={() => setAudible('yes')} /> yes</label>{' '}
            <label><input type="radio" checked={audible === 'no'} onChange={() => setAudible('no')} /> no</label>
          </Step>

          <Step n={4} done={nearOk} title="Push and pull at 20 cm">
            Hold your hand flat, palm facing the screen, <b>about 20 cm (a hand-span) in front of the screen, above the keyboard</b>.
            Push toward the screen and pull back, <b>5 times</b>, at normal speed. Move only your hand.
            <br />Push peak <b>+{peaks.near.push.toFixed(0)} Hz</b> {peaks.near.push >= MOVE_HZ ? '✓' : ''} ·
            pull peak <b>{peaks.near.pull.toFixed(0)} Hz</b> {peaks.near.pull <= -MOVE_HZ ? '✓' : ''}
            {' '}(want +{MOVE_HZ} or more and −{MOVE_HZ} or less)
          </Step>

          <Step n={5} done={farOk} title="Push and pull at 50 cm">
            <button onClick={goFar} disabled={!nearOk || phase === 'far'}>Start the 50 cm test</button>{' '}
            Same thing, with your hand <b>about 50 cm away (an arm's length)</b>.
            <br />Push peak <b>+{peaks.far.push.toFixed(0)} Hz</b> {peaks.far.push >= MOVE_HZ ? '✓' : ''} ·
            pull peak <b>{peaks.far.pull.toFixed(0)} Hz</b> {peaks.far.pull <= -MOVE_HZ ? '✓' : ''}
            {phase === 'far' && !farOk && ' (if nothing registers after 5 tries, that is a valid result: write FAIL)'}
          </Step>

          <Step n={6} done={copied} title="Send your results">
            Laptop model: <input value={laptop} onChange={(e) => setLaptop(e.target.value)} placeholder="e.g. MacBook Air M2" />
            <br /><button onClick={() => { navigator.clipboard.writeText(results); setCopied(true) }}>Copy results</button>{' '}
            then paste them to your agent (it posts them to Ian), or text them to Ian.
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{results}</pre>
          </Step>
        </div>

        <div>
          <h2 style={{ marginTop: 0 }}>Live sonar</h2>
          <canvas ref={canvas} width={900} height={300} style={{ width: '100%', border: '2px solid #000', imageRendering: 'pixelated' }} />
          <p>
            <b>How to read it:</b> time scrolls left. The dark line in the middle is the inaudible 20 kHz tone.
            A hand moving <b>toward</b> the laptop leaves marks <b>above</b> the line; <b>away</b> leaves marks <b>below</b>.
            Faster moves land further from the line.
          </p>
          <p>
            Shift now: <b>{(frame?.shiftHz ?? 0).toFixed(1)} Hz</b> · toward {(frame?.energyToward ?? 0).toFixed(1)} dB ·
            away {(frame?.energyAway ?? 0).toFixed(1)} dB · tone {health?.toneHz ?? 0} Hz at {health?.toneDbfs ?? 0} dBFS ·
            mic {health?.sampleRate ?? 0} Hz
          </p>
          <p>
            <b>Stuck?</b> Nothing moves: refresh, Start, Calibrate again. Tone health weak: volume up, close other tabs playing audio.
            Peaks jump while you're still: someone nearby is moving, so Calibrate again.
          </p>
          <button onClick={() => { engine.stop(); setStatus('stopped'); setCalibrated(false); calibratedRef.current = false }}>Stop sonar</button>
        </div>
      </div>
    </Window>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div style={{ border: '2px solid #000', borderRadius: 8, padding: '10px 12px', marginBottom: 12, background: done ? '#eaffea' : '#fff' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{done ? '✓' : `${n}.`} {title}</div>
      <div>{children}</div>
    </div>
  )
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
