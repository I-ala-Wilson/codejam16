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

// A fraction in the site's pixel font: 'left = numerator over denominator (= result)', built from plain spans.
const frac = (left: string, num: string, den: string, result?: string) =>
  `<span class="fx">${left} =</span><span class="fx-frac"><span>${num}</span><span>${den}</span></span>` +
  (result ? `<span class="fx">= ${result}</span>` : '')

export default function Explainer({ embedded = false, children }: { embedded?: boolean; children?: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const speaker = useRef<HTMLDivElement>(null)
  const mic = useRef<HTMLDivElement>(null)
  const subEl = useRef<HTMLDivElement>(null)
  const formulaEl = useRef<HTMLDivElement>(null)
  const dfEl = useRef<HTMLDivElement>(null)
  const echoEl = useRef<HTMLDivElement>(null)
  const spec = useRef<HTMLCanvasElement>(null)
  const [gesture, setGesture] = useState(0)
  const [gen, setGen] = useState(0) // bumped when the browser drops the WebGL context: rebuild instead of going white

  useEffect(() => {
    let shown = -1, heldAt = -1e9, heldKey = ''
    formulaEl.current!.innerHTML = frac('Δf', '2·v·f₀', 'c')
    const onFrame = (f: Frame) => {
      if (f.gesture !== shown) { shown = f.gesture; setGesture(f.gesture) }
      // One sample of v drives every number on the panel, refreshed together about 8 times a second
      const now = performance.now()
      if (now - heldAt < 125) return
      heldAt = now
      const v = Math.round(f.v * 100) / 100 || 0
      const df = Math.round((2 * v * F0) / C)
      const key = `${v}|${df}`
      if (key === heldKey) return
      heldKey = key
      subEl.current!.innerHTML = frac('Δf', `2 × (${fmt(v, 2)}) × ${F0}`, `${C}`, `${fmt(df, 0)} Hz`)
      dfEl.current!.textContent = `${fmt(df, 0)} Hz`
      echoEl.current!.textContent = `echo ${F0 + df} Hz${df > 0 ? ' · pitch up' : df < 0 ? ' · pitch down' : ''}`
      drawSpectrum(spec.current!, df)
    }
    const c = createExplainer(host.current!, { onFrame, labels: { speaker: speaker.current!, mic: mic.current! } })
    const canvas = host.current!.querySelector('canvas')
    const onLost = (e: Event) => { e.preventDefault(); setTimeout(() => setGen((n) => n + 1), 200) }
    canvas?.addEventListener('webglcontextlost', onLost)
    const nav = document.querySelector('nav.top')
    const fit = () => { if (nav && !embedded) root.current!.style.top = `${nav.getBoundingClientRect().bottom}px` }
    fit()
    window.addEventListener('resize', fit)
    if (!embedded) (document.activeElement as HTMLElement | null)?.blur()
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '1' && e.key <= '5') c.jump(Number(e.key))
      else if (e.key === (embedded ? 'p' : ' ')) { e.preventDefault(); c.togglePause() }
      else if (e.key === 'c') c.toggleOrbit()
      else if (e.key === 'd') c.toggleDither()
    }
    window.addEventListener('keydown', onKey)
    return () => { canvas?.removeEventListener('webglcontextlost', onLost); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit); c.dispose() }
  }, [gen])

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
        <div className="ex__label">Doppler shift</div>
        <div className="ex__formula" ref={formulaEl} />
        <div className="ex__legend">v = hand speed · f₀ = 20 kHz tone · c = speed of sound (343 m/s)</div>
        <div className="ex__sub-tex" ref={subEl} />
        <div className="ex__result" ref={dfEl} />
        <div className="ex__echo" ref={echoEl} />
        <canvas ref={spec} className="ex__spec" />
        <div className="ex__axis"><span>-{SPAN} Hz</span><span>20 kHz</span><span>+{SPAN} Hz</span></div>
      </div>
    </div>
  )
}
