import { useEffect, useRef } from 'react'
import { engine } from '../engine.ts'

// Hero art per docs/STYLE.md: Ian's reference flower (public/art/flower-ref.png, 1920x1080) turned into a lightly
// smoothed grayscale field at full resolution, then 8x8 Bayer ordered-dithered to 1-bit off-white on charcoal, one dot
// per CSS pixel. It only sways gently (rows bend sideways from a fixed stem base, never scaling); hand motion
// brightens the petals on that side.

const REF_W = 1920, REF_H = 1080
const STEM_X = 952, STEM_Y = 1080
const SHIFT_X = 0.16 // flower sits right of centre, clear of the headline
const BLUR = 2 // px radius of each of the two box-blur passes, just enough to dissolve the digit shapes
const GAIN = 1.25 // dither density tracks the reference's own ink coverage, so the tone matches it
const BAYER = [
  0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4, 52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21,
].map((v) => (v + 0.5) / 64)
const BG = 0xff211f1e, INK = 0xfff0f2f2 // ABGR for a Uint32 view of the image data

function blur(a: Float32Array, w: number, h: number, R: number) {
  const b = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = 0; x <= R && x < w; x++) s += a[y * w + x]
    for (let x = 0; x < w; x++) {
      b[y * w + x] = s / (2 * R + 1)
      const add = x + R + 1, sub = x - R
      if (add < w) s += a[y * w + add]
      if (sub >= 0) s -= a[y * w + sub]
    }
  }
  const c = new Float32Array(w * h)
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = 0; y <= R && y < h; y++) s += b[y * w + x]
    for (let y = 0; y < h; y++) {
      c[y * w + x] = s / (2 * R + 1)
      const add = y + R + 1, sub = y - R
      if (add < h) s += b[add * w + x]
      if (sub >= 0) s -= b[sub * w + x]
    }
  }
  return c
}

// The reference resampled to the screen (contain, centred), as gray levels 0..1 per CSS pixel.
function buildField(img: HTMLImageElement, W: number, H: number) {
  const s = Math.min(W / REF_W, H / REF_H)
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#1e1f21'
  ctx.fillRect(0, 0, W, H)
  const ox = (W - REF_W * s) / 2 + W * SHIFT_X, oy = (H - REF_H * s) / 2
  ctx.drawImage(img, ox, oy, REF_W * s, REF_H * s)
  const data = ctx.getImageData(0, 0, W, H).data
  let a = new Float32Array(W * H)
  for (let p = 0; p < W * H; p++) a[p] = Math.max(0, (data[p * 4] - 32) / 223)
  a = blur(blur(a, W, H, BLUR), W, H, BLUR)
  for (let p = 0; p < W * H; p++) a[p] = Math.min(1, a[p] * GAIN)
  // bounding box of the ink, so the per-frame loop skips empty space
  let top = H, bottom = 0, left = W, right = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[y * W + x] > 0.01) {
    if (y < top) top = y
    if (y > bottom) bottom = y
    if (x < left) left = x
    if (x > right) right = x
  }
  return { W, H, v: a, s, ox, oy, top, bottom, left, right }
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
    const ctx = c.getContext('2d')!
    let field: ReturnType<typeof buildField> | null = null
    let frame: ImageData | null = null
    let raf = 0, last = 0
    const img = new Image()
    img.src = '/art/flower-ref.png'

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 1000 / (document.hidden ? 8 : 24)) return
      last = now
      const W = Math.max(1, c.clientWidth), H = Math.max(1, c.clientHeight)
      if (!img.complete || !img.naturalWidth) return
      if (!field || field.W !== W || field.H !== H) {
        c.width = W; c.height = H
        field = buildField(img, W, H)
        frame = ctx.createImageData(W, H)
        new Uint32Array(frame.data.buffer).fill(BG)
      }
      const f = field, px = new Uint32Array(frame!.data.buffer)
      const e = energy.current
      const t = now / 1000
      const toward = Math.min(1, e.toward / 20), away = Math.min(1, e.away / 20)
      const stemX = f.ox + STEM_X * f.s, stemY = f.oy + STEM_Y * f.s, height = 840 * f.s
      const A = (14 * Math.sin(t * 2 * Math.PI / 6) + 3.5 * Math.sin(t * 2 * Math.PI / 2.3 + 1.1)) * f.s
      const pad = Math.ceil(18 * f.s) + 2
      const x0 = Math.max(0, f.left - pad), x1 = Math.min(W - 1, f.right + pad)
      for (let y = f.top; y <= f.bottom; y++) {
        const shift = Math.round(A * Math.max(0, (stemY - y) / height) ** 1.6)
        const row = y * W, b = (y & 7) * 8
        for (let x = x0; x <= x1; x++) {
          const sx = x - shift
          let g = sx >= 0 && sx < W ? f.v[row + sx] : 0
          if (g > 0) g += 0.25 * (sx < stemX ? toward : away) * g
          px[row + x] = g > BAYER[b + (x & 7)] ? INK : BG
        }
      }
      ctx.putImageData(frame!, 0, 0)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvas} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'block', background: '#1e1f21', imageRendering: 'pixelated' }} />
}
