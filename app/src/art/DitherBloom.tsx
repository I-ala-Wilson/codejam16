import { useEffect, useRef } from 'react'
import { engine } from '../engine.ts'

// Hero art per docs/STYLE.md: a "sound flower" rendered in grayscale, then 8x8 Bayer ordered-dithered to 1-bit
// white on black and blitted pixel-crisp, like Ian's dithered flower references. Petals are wave lobes whose
// edges ripple like a waveform; concentric echo rings pulse out; thin dotted guide lines frame it.

const BAYER = [
  0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4, 52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21,
].map((v) => (v + 0.5) / 64)
const SCALE = 3 // one dither pixel = 3 CSS px, chunky like the references
const PETALS = 9

export default function DitherBloom({ height = 560 }: { height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const energy = useRef({ toward: 0, away: 0, pulse: 0 })

  useEffect(() => engine.onFrame((f) => {
    const e = energy.current
    e.toward = e.toward * 0.85 + Math.max(0, f.energyToward) * 0.15
    e.away = e.away * 0.85 + Math.max(0, f.energyAway) * 0.15
    if (Math.abs(f.shiftHz) > 40) e.pulse = Math.min(1, e.pulse + 0.3)
  }), [])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const out = c.getContext('2d')!
    const small = document.createElement('canvas')
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    let raf = 0, last = 0

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 1000 / (document.hidden ? 10 : 24)) return
      last = now
      const W = Math.max(1, Math.floor(c.clientWidth / SCALE)), H = Math.max(1, Math.floor(c.clientHeight / SCALE))
      if (small.width !== W || small.height !== H) { small.width = W; small.height = H }
      if (c.width !== W * SCALE || c.height !== H * SCALE) { c.width = W * SCALE; c.height = H * SCALE }

      const e = energy.current
      e.pulse *= 0.94
      const t = now / 1000
      const toward = Math.min(1, e.toward / 20), away = Math.min(1, e.away / 20)
      const cx = W / 2, cy = H * 0.46
      const R = Math.min(W * 0.36, H * 0.42) * (1 + 0.04 * Math.sin(t * 1.05) + 0.12 * e.pulse)

      const img = sctx.createImageData(W, H)
      const px = img.data
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = x - cx, dy = (y - cy) * 1.08
          const r = Math.hypot(dx, dy)
          const a = Math.atan2(dy, dx)
          // petal outline: lobes whose rim ripples like a waveform; the side facing the hand swells
          const lean = Math.cos(a + Math.PI / 2)
          const lobes = 0.62 + 0.38 * Math.abs(Math.cos((a * PETALS) / 2 + t * 0.15))
          const ripple = 0.045 * Math.sin(a * 37 + t * 3) + 0.03 * Math.sin(a * 61 - t * 2.2)
          const swell = 1 + 0.25 * (lean > 0 ? toward * lean : away * -lean)
          const edge = R * (lobes + ripple) * swell
          let g = 0
          if (r < edge) {
            const u = r / edge
            // bright rim and veins, darker hollow centre (like a petal photographed in strong light)
            const vein = 0.18 * Math.pow(Math.abs(Math.cos((a * PETALS) / 2 + t * 0.15)), 8)
            g = 0.25 + 0.55 * Math.pow(u, 1.6) + vein + 0.08 * Math.sin(r * 0.9 - t * 4)
            if (u < 0.12) g = 0.95 // bright seed centre
          }
          // echo rings travelling outward from the flower
          const ring = Math.sin((r - t * 18) * 0.22)
          if (r > edge && r < R * 2.1) g = Math.max(g, (0.16 + 0.35 * e.pulse) * Math.max(0, ring) * (1 - r / (R * 2.1)))
          // stem: a soft vertical waveform line
          if (y > cy && Math.abs(x - cx - Math.sin(y * 0.12 + t * 1.5) * 1.2) < 1.2) g = Math.max(g, 0.65)
          // ground line, like the reference's horizon rule
          if (Math.abs(y - Math.floor(H * 0.93)) < 0.6 && Math.abs(x - cx) < R * 1.25) g = 1
          const lit = g > BAYER[(y & 7) * 8 + (x & 7)]
          const i = (y * W + x) * 4
          const v = lit ? 242 : 0
          px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255
        }
      }
      sctx.putImageData(img, 0, 0)
      out.imageSmoothingEnabled = false
      out.drawImage(small, 0, 0, W * SCALE, H * SCALE)
      // thin dotted guide lines framing the flower (drawn crisp at full resolution)
      out.fillStyle = '#f2f2f0'
      const gx1 = Math.floor((cx - R * 1.05) * SCALE), gx2 = Math.floor((cx + R * 1.05) * SCALE)
      for (let y = Math.floor(H * 0.2 * SCALE); y < H * 0.93 * SCALE; y += 6) { out.fillRect(gx1, y, 1, 1); out.fillRect(gx2, y, 1, 1) }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvas} style={{ width: '100%', height, display: 'block', background: '#000', imageRendering: 'pixelated' }} />
}
