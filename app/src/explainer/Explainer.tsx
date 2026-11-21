import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { createExplainer, GESTURES, F0, C, type Frame } from './scene.ts'
import './explainer.css'

const SPAN = 120 // Hz either side of 20 kHz on the spectrum

function drawSpectrum(cv: HTMLCanvasElement, df: number) {
  const dpr = Math.min(window.devicePixelRatio, 2)
  const w = cv.clientWidth, h = cv.clientHeight
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
  const g = cv.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const base = h - 4
  const x = (hz: number) => ((hz + SPAN) / (2 * SPAN)) * w
  g.strokeStyle = '#f2f2f0'
  g.lineWidth = 1
  g.setLineDash([2, 3])
  g.beginPath(); g.moveTo(0, base + 0.5); g.lineTo(w, base + 0.5); g.moveTo(x(0) + 0.5, 0); g.lineTo(x(0) + 0.5, base); g.stroke()
  g.setLineDash([])
  const peak = (hz: number, amp: number, dashed = false) => {
    g.strokeStyle = '#f2f2f0'
    g.lineWidth = 2
    g.setLineDash(dashed ? [4, 3] : [])
    g.beginPath()
    for (let i = 0; i <= w; i++) {
      const f = (i / w) * 2 * SPAN - SPAN
      const y = base - amp * (h - 10) * Math.exp(-((f - hz) ** 2) / (2 * 5 ** 2))
      if (i === 0) g.moveTo(i, y); else g.lineTo(i, y)
    }
    g.stroke()
  }
  peak(0, 1)
  peak(Math.max(-SPAN, Math.min(SPAN, df)), 0.6, true) // the echo, dashed like its wavefronts
  g.setLineDash([])
}

const fmt = (n: number, d: number) => (n >= 0 ? '+' : '-') + Math.abs(n).toFixed(d)

export default function Explainer({ embedded = false, children }: { embedded?: boolean; children?: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const speaker = useRef<HTMLDivElement>(null)
  const mic = useRef<HTMLDivElement>(null)
  const vEl = useRef<HTMLSpanElement>(null)
  const subEl = useRef<HTMLSpanElement>(null)
  const dfEl = useRef<HTMLSpanElement>(null)
  const echoEl = useRef<HTMLSpanElement>(null)
  const spec = useRef<HTMLCanvasElement>(null)
  const [gesture, setGesture] = useState(0)
  const [flags, setFlags] = useState({ paused: false, orbit: true, dither: true })

  useEffect(() => {
    let shown = -1
    const onFrame = (f: Frame) => {
      if (f.gesture !== shown) { shown = f.gesture; setGesture(f.gesture) }
      const v = Math.abs(f.v) < 0.01 ? 0 : f.v
      const df = (2 * v * F0) / C
      vEl.current!.textContent = `${fmt(v, 2)} m/s`
      subEl.current!.textContent = `= 2 × ${fmt(v, 2)} × ${F0} / ${C}`
      dfEl.current!.textContent = `${fmt(df, 0)} Hz`
      echoEl.current!.textContent = `${(F0 + df).toFixed(0)} Hz ${df > 0 ? '· pitch up' : df < 0 ? '· pitch down' : ''}`
      drawSpectrum(spec.current!, df)
    }
    const c = createExplainer(host.current!, { onFrame, labels: { speaker: speaker.current!, mic: mic.current! } })
    const nav = document.querySelector('nav.top')
    const fit = () => { if (nav && !embedded) root.current!.style.top = `${nav.getBoundingClientRect().bottom}px` }
    fit()
    window.addEventListener('resize', fit)
    if (!embedded) (document.activeElement as HTMLElement | null)?.blur()
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '1' && e.key <= '4') c.jump(Number(e.key))
      else if (e.key === (embedded ? 'p' : ' ')) { e.preventDefault(); const paused = c.togglePause(); setFlags((f) => ({ ...f, paused })) }
      else if (e.key === 'c') { const orbit = c.toggleOrbit(); setFlags((f) => ({ ...f, orbit })) }
      else if (e.key === 'd') { const dither = c.toggleDither(); setFlags((f) => ({ ...f, dither })) }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit); c.dispose() }
  }, [])

  const g = GESTURES[gesture]
  return (
    <div className={embedded ? 'ex ex--embedded' : 'ex'} ref={root}>
      <div className="ex__gl" ref={host} />
      <div className="ex__tag ex__tag--down" ref={speaker}><span>speaker · 20 kHz</span></div>
      <div className="ex__tag ex__tag--up" ref={mic}><span>mic</span></div>
      <div className="ex__caption">
        {children}
        <div className="ex__name">{g.name}</div>
        <div className="ex__sub">{g.sub}</div>
      </div>
      <div className="ex__readout">
        <div className="ex__row"><span>hand speed v</span><span ref={vEl} className="ex__num" /></div>
        <div className="ex__formula">Δf = 2 · v · f0 / c</div>
        <div className="ex__row ex__small"><span ref={subEl} /></div>
        <div className="ex__row"><span>shift Δf</span><span ref={dfEl} className="ex__num ex__big" /></div>
        <div className="ex__row ex__small"><span>echo</span><span ref={echoEl} /></div>
        <canvas ref={spec} className="ex__spec" />
        <div className="ex__axis"><span>-{SPAN} Hz</span><span>20 kHz</span><span>+{SPAN} Hz</span></div>
      </div>
      <div className="ex__keys">
        <div>1 push · 2 pull · 3 wave · 4 open/close</div>
        <div>{embedded ? 'p' : 'space'} {flags.paused ? 'play' : 'pause'} · c orbit {flags.orbit ? 'on' : 'off'} · d dither {flags.dither ? 'on' : 'off'}</div>
        <div>sound drawn ~1000× slower · f0 = 20 kHz · c = 343 m/s</div>
      </div>
    </div>
  )
}
