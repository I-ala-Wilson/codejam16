import { useEffect, useRef } from 'react'
import { engine } from '../engine.ts'

// Hero art per docs/STYLE.md: Ian's reference flower (public/art/flower-ref.png, 1920x1080) turned into a smooth
// grayscale field, then 8x8 Bayer ordered-dithered to 1-bit off-white on charcoal, blitted pixel-crisp. It only sways
// gently (bending from the stem base, never scaling); hand motion brightens the petals on that side.

const REF_W = 1920, REF_H = 1080
const CELL = 3 // field resolution in reference px
const SCALE = 3 // one dither pixel = 3 CSS px
const STEM_X = 952, STEM_Y = 1080
const BAYER = [
  0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4, 52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21,
].map((v) => (v + 0.5) / 64)
const BG = [0x1e, 0x1f, 0x21], INK = [0xf2, 0xf2, 0xf0]

function buildField(img: HTMLImageElement) {
  const w = REF_W / CELL, h = REF_H / CELL
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  let a = new Float32Array(w * h)
  for (let p = 0; p < w * h; p++) a[p] = Math.max(0, (data[p * 4] - 32) / 223)
  // two separable box-blur passes turn the glyph texture into a smooth ink-density field
  for (let pass = 0; pass < 2; pass++) {
    const R = 2, b = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0
      for (let d = -R; d <= R; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += a[y * w + xx]; n++ } }
      b[y * w + x] = s / n
    }
    a = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0
      for (let d = -R; d <= R; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += b[yy * w + x]; n++ } }
      a[y * w + x] = s / n
    }
  }
  for (let p = 0; p < w * h; p++) a[p] = Math.min(1, (a[p] / 0.4) ** 0.85)
  return { w, h, v: a }
}

export default function DitherFlower() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const energy = useRef({ toward: 0, away: 0 })

  useEffect(() => engine.onFrame((f) => {
    const e = energy.current
    e.toward = e.toward * 0.85 + Math.max(0, f.energyToward) * 0.15
    e.away = e.away * 0.85 + Math.max(0, f.energyAway) * 0.15
  }), [])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const out = c.getContext('2d')!
    const small = document.createElement('canvas')
    const sctx = small.getContext('2d')!
    let field: ReturnType<typeof buildField> | null = null
    let raf = 0, last = 0
    const img = new Image()
    img.onload = () => { field = buildField(img) }
    img.src = '/art/flower-ref.png'

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 1000 / (document.hidden ? 8 : 24)) return
      last = now
      const W = Math.max(1, Math.floor(c.clientWidth / SCALE)), H = Math.max(1, Math.floor(c.clientHeight / SCALE))
      if (small.width !== W || small.height !== H) { small.width = W; small.height = H }
      if (c.width !== W * SCALE || c.height !== H * SCALE) { c.width = W * SCALE; c.height = H * SCALE }
      const img = sctx.createImageData(W, H)
      const px = img.data
      const e = energy.current
      const t = now / 1000
      const toward = Math.min(1, e.toward / 20), away = Math.min(1, e.away / 20)
      // reference -> screen fit (contain, centred); the sway bends the flower sideways, more towards the head
      const s = Math.min(W / REF_W, H / REF_H)
      const ox = (W - REF_W * s) / 2, oy = (H - REF_H * s) / 2
      const A = 14 * Math.sin(t * 2 * Math.PI / 6) + 3.5 * Math.sin(t * 2 * Math.PI / 2.3 + 1.1)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let g = 0
          if (field) {
            const qy = (y - oy) / s
            const qx = (x - ox) / s - A * Math.max(0, (STEM_Y - qy) / 840) ** 1.6
            const fx = Math.floor(qx / CELL), fy = Math.floor(qy / CELL)
            if (fx >= 0 && fy >= 0 && fx < field.w && fy < field.h) {
              g = field.v[fy * field.w + fx]
              g += 0.25 * (qx < STEM_X ? toward : away) * g
            }
          }
          const lit = g > BAYER[(y & 7) * 8 + (x & 7)]
          const i = (y * W + x) * 4
          const col = lit ? INK : BG
          px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255
        }
      }
      sctx.putImageData(img, 0, 0)
      out.imageSmoothingEnabled = false
      out.drawImage(small, 0, 0, W * SCALE, H * SCALE)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvas} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'block', background: '#1e1f21', imageRendering: 'pixelated' }} />
}
