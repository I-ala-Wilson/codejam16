import { useEffect, useRef } from 'react'
import { engine } from '../engine.ts'

// The hero art from docs/STYLE.md: a flower whose petals are the sonar echo, drawn entirely from serif digits,
// off-white on charcoal, like Ian's digit-dandelion reference. Petals breathe at rest and swell toward the hand.

const DIGITS = '5972816340'
const PETALS = 26
const STRANDS = 4 // parallel digit rows per petal
const STEM_DIGITS = 60

type Props = { height?: number; label?: string }

export default function DigitBloom({ height = 560, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const energy = useRef({ toward: 0, away: 0, pulse: 0 })
  const lastLabel = useRef({ text: '', at: 0 })

  useEffect(() => {
    const offF = engine.onFrame((f) => {
      const e = energy.current
      e.toward = e.toward * 0.85 + Math.max(0, f.energyToward) * 0.15
      e.away = e.away * 0.85 + Math.max(0, f.energyAway) * 0.15
      if (Math.abs(f.shiftHz) > 40) e.pulse = Math.min(1, e.pulse + 0.25)
    })
    const offG = engine.onGesture((g) => { if (g.type !== 'HOLD') lastLabel.current = { text: g.type.replace('_', ' '), at: performance.now() } })
    return () => { offF(); offG() }
  }, [])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    let raf = 0
    let last = 0
    // deterministic per-petal shape so the flower keeps its identity between frames
    const seed = Array.from({ length: PETALS }, (_, i) => ({
      len: 0.72 + 0.28 * frac(Math.sin(i * 12.9898) * 43758.5453),
      bend: (frac(Math.sin(i * 78.233) * 12345.678) - 0.5) * 0.5,
      phase: i * 0.9,
    }))

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const fps = document.hidden ? 15 : 30
      if (now - last < 1000 / fps) return
      last = now
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = c.clientWidth, h = c.clientHeight
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#1e1f21'
      ctx.fillRect(0, 0, w, h)

      const e = energy.current
      e.pulse *= 0.93
      const t = now / 1000
      const cx = w / 2, cy = h * 0.66
      const R = Math.min(w * 0.46, h * 0.64)
      const breathe = 1 + 0.05 * Math.sin((t * 2 * Math.PI) / 6)
      const toward = Math.min(1, e.toward / 20)
      const away = Math.min(1, e.away / 20)

      ctx.textBaseline = 'middle'
      let di = 0
      for (let p = 0; p < PETALS; p++) {
        const s = seed[p]
        // dome: petals fan over the upper half (from 200° to 340°, i.e. left, up, right), a few short ones below
        const q = p / (PETALS - 1)
        const ang = Math.PI * (1.08 + 0.84 * q) + 0.06 * Math.sin(t * 0.35 + s.phase) + s.bend * 0.25
        const side = Math.cos(ang + Math.PI / 4)
        const swell = 1 + 0.3 * (side > 0 ? toward * side : away * -side) + 0.2 * e.pulse
        const upness = Math.max(0.35, -Math.sin(ang)) // petals pointing up are longest
        const len = R * s.len * breathe * swell * (0.55 + 0.45 * upness)
        for (let k = 0; k < STRANDS; k++) {
          const off = (k - (STRANDS - 1) / 2) / STRANDS
          let r = R * 0.1
          while (r < len) {
            const u = r / len
            const width = Math.sin(Math.PI * Math.min(1, u * 1.05)) * 0.2
            const a = ang + off * width + s.bend * u * u * 0.6
            const x = cx + Math.cos(a) * r
            const y = cy + Math.sin(a) * r * 0.86
            const ripple = e.pulse * Math.max(0, 1 - Math.abs(u - (1 - e.pulse)) * 4)
            // edges of each petal and its outer half carry the big, legible digits; tips scatter
            const edge = Math.abs(off) * 2
            const b = clamp(0.35 + 0.45 * Math.sin(Math.PI * u) + 0.25 * edge + ripple * 0.5 - (u > 0.9 ? (u - 0.9) * 6 : 0), 0, 1)
            const keep = frac(Math.sin((p * 131 + k * 17 + Math.floor(r)) * 0.731) * 9431) < 0.3 + 0.55 * b
            if (b > 0.1 && keep) {
              const size = 6 + b * b * 20 * (0.45 + 0.55 * u)
              ctx.font = `italic ${size.toFixed(1)}px Georgia, "Times New Roman", serif`
              ctx.fillStyle = `rgba(242,242,240,${(0.3 + 0.7 * b).toFixed(2)})`
              ctx.fillText(DIGITS[(di++ + p * 3 + k) % 10], x, y)
              r += size * 0.95
            } else r += 9
          }
        }
      }
      // dense core of small digits where the petals meet
      ctx.font = 'italic 9px Georgia, "Times New Roman", serif'
      for (let i = 0; i < 110; i++) {
        const a = Math.PI * (1.05 + 0.9 * frac(i * 0.618)), rr = R * 0.22 * Math.sqrt(frac(i * 0.37 + 0.5))
        ctx.fillStyle = 'rgba(242,242,240,0.8)'
        ctx.fillText(DIGITS[(i + Math.floor(t * 3)) % 10], cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.86 + 4)
      }

      // stem: a single column of small digits from the bloom to the bottom
      const stemTop = cy + 6
      ctx.font = 'italic 8px Georgia, "Times New Roman", serif'
      for (let i = 0; i < STEM_DIGITS; i++) {
        const y = stemTop + (i / STEM_DIGITS) * (h - stemTop - 8)
        if (y > h) break
        ctx.fillStyle = `rgba(242,242,240,${(0.85 - (i / STEM_DIGITS) * 0.5).toFixed(2)})`
        ctx.fillText(DIGITS[(i * 7 + Math.floor(t * 2)) % 10], cx + Math.sin(i * 0.35 + t) * 0.8, y)
      }

      // last detected gesture, in mono, under the bloom
      const L = lastLabel.current
      const shown = label ?? (now - L.at < 1200 ? L.text : '')
      if (shown) {
        ctx.font = '600 15px "JetBrains Mono", "SF Mono", Menlo, monospace'
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.fillText(shown, cx, h - 22)
        ctx.textAlign = 'start'
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [label])

  return <canvas ref={canvas} style={{ width: '100%', height, display: 'block', background: '#1e1f21' }} />
}

const frac = (x: number) => x - Math.floor(x)
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
