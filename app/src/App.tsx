import { useEffect, useRef, useState } from 'react'
import { createEngine } from '@engine/index.ts'
import type { SpectrumFrame, EngineHealth } from '@contracts/engine.ts'
import { Window } from '@ui/index.ts'

const engine = createEngine()

export default function App() {
  const [status, setStatus] = useState('idle')
  const [health, setHealth] = useState<EngineHealth | null>(null)
  const [frame, setFrame] = useState<SpectrumFrame | null>(null)
  const [peak, setPeak] = useState({ toward: 0, away: 0 })
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let last = 0
    const off = engine.onFrame((f) => {
      drawColumn(canvas.current, f)
      setPeak((p) => ({ toward: Math.max(p.toward, f.shiftHz), away: Math.min(p.away, f.shiftHz) }))
      if (f.t - last > 100) { last = f.t; setFrame(f); setHealth(engine.health()) }
    })
    return off
  }, [])

  const start = async () => {
    try { setStatus('starting'); await engine.start(); setStatus('running'); setHealth(engine.health()) }
    catch (e) { setStatus(String(e)) }
  }
  const calibrate = async () => {
    setStatus('calibrating: keep still'); await engine.calibrate(3000); setStatus('running')
    setPeak({ toward: 0, away: 0 })
  }

  const snr = health?.snrDb ?? 0
  return (
    <Window title="Echo: sonar check">
      <p>
        <button onClick={start}>Start sonar</button>{' '}
        <button onClick={calibrate} disabled={status !== 'running'}>Calibrate (keep still)</button>{' '}
        <button onClick={() => { engine.stop(); setStatus('stopped') }}>Stop</button>
      </p>
      <p><b>Status:</b> {status}</p>
      <p>
        <b>Tone health:</b> {snr.toFixed(1)} dB {snr >= 30 ? '(good)' : '(weak, raise volume or move closer)'}
        {' '}· {health?.toneHz ?? 0} Hz at {health?.toneDbfs ?? 0} dBFS · mic {health?.sampleRate ?? 0} Hz
      </p>
      <p>
        <b>Doppler shift now:</b> {(frame?.shiftHz ?? 0).toFixed(1)} Hz
        {' '}· toward {(frame?.energyToward ?? 0).toFixed(1)} dB · away {(frame?.energyAway ?? 0).toFixed(1)} dB
      </p>
      <p><b>Peak since calibrate:</b> push +{peak.toward.toFixed(0)} Hz · pull {peak.away.toFixed(0)} Hz</p>
      <canvas ref={canvas} width={900} height={240} style={{ width: '100%', border: '2px solid #000', imageRendering: 'pixelated' }} />
      <p>Waterfall: time scrolls left, the centre line is the tone; a hand moving toward the laptop shows above the line, away below.</p>
    </Window>
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
