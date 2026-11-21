import { useEffect, useRef } from 'react'
import { engine } from '../engine.ts'

// Hero art per docs/STYLE.md: Ian's reference flower (public/art/flower-ref.png, 1920x1080) turned into a lightly
// smoothed grayscale field at full resolution, then 8x8 Bayer ordered-dithered to 1-bit off-white on charcoal, one dot
// per CSS pixel. It only sways gently (rows bend sideways from a fixed stem base, never scaling); hand motion
// brightens the petals on that side.

const REF_W = 1920, REF_H = 1080
const STEM_X = 952, STEM_Y = 1080
const HEAD_X = 955, HEAD_Y = 520 // centre of the bloom in the reference
const BINS = 72 // directions around the bloom with their own wave level
const WAVE_REACH = 70 // reference px the waves travel out from the petals
const WAVE_LAMBDA = 16 // reference px between wavefronts at rest
const WAVE_SPEED = 34 // reference px per second the fronts travel outward
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
  // distance (px) from every outside pixel to the petals' silhouette, so sound waves can follow each petal's outline
  const INF = 1e9, dist = new Float32Array(W * H)
  for (let p = 0; p < W * H; p++) dist[p] = a[p] > 0.16 ? 0 : INF
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; let d = dist[p]
    if (x > 0) d = Math.min(d, dist[p - 1] + 1)
    if (y > 0) { d = Math.min(d, dist[p - W] + 1); if (x > 0) d = Math.min(d, dist[p - W - 1] + 1.414); if (x < W - 1) d = Math.min(d, dist[p - W + 1] + 1.414) }
    dist[p] = d
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const p = y * W + x; let d = dist[p]
    if (x < W - 1) d = Math.min(d, dist[p + 1] + 1)
    if (y < H - 1) { d = Math.min(d, dist[p + W] + 1); if (x < W - 1) d = Math.min(d, dist[p + W + 1] + 1.414); if (x > 0) d = Math.min(d, dist[p + W - 1] + 1.414) }
    dist[p] = d
  }
  // pixels truly outside the flower (reachable from the screen edge without crossing a petal): waves only live there,
  // so they come off the outer petals and never fill the gaps inside the bloom
  const outside = new Uint8Array(W * H), stack: number[] = []
  const seed = (p: number) => { if (!outside[p] && a[p] <= 0.16) { outside[p] = 1; stack.push(p) } }
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
  while (stack.length) {
    const p = stack.pop()!, x = p % W
    if (x > 0) seed(p - 1)
    if (x < W - 1) seed(p + 1)
    if (p >= W) seed(p - W)
    if (p < W * (H - 1)) seed(p + W)
  }
  // points on the outer edge of the petals, found by marching out from the bloom centre at 72 angles
  const cx = ox + HEAD_X * s, cy = oy + HEAD_Y * s
  const edges: { x: number; y: number; nx: number; ny: number }[] = []
  for (let k = 0; k < 72; k++) {
    const th = (k / 72) * Math.PI * 2, nx = Math.cos(th), ny = Math.sin(th)
    if (ny > 0.55) continue // skip straight down: that is the stem
    let last = -1
    for (let r = 0; r < 700 * s; r++) {
      const x = Math.round(cx + nx * r), y = Math.round(cy + ny * r)
      if (x < 0 || y < 0 || x >= W || y >= H) break
      if (a[y * W + x] > 0.16) last = r
    }
    if (last > 40 * s) edges.push({ x: cx + nx * last, y: cy + ny * last, nx, ny })
  }
  return { W, H, v: a, s, ox, oy, top, bottom, left, right, edges, dist, outside, cx, cy }
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
    let lastT = 0, lastA = 0
    const level = new Float32Array(BINS), phaseB = new Float32Array(BINS), lamB = new Float32Array(BINS).fill(WAVE_LAMBDA)
    const img = new Image()
    img.src = '/art/flower-ref.png'

    let visible = true
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
    io.observe(c)
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (!visible) return
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
      // Sound waves hug the petals: each wavefront is a contour line at a growing distance from the flower's outline,
      // so it follows every petal's shape. Waves are bright where the petals are moving outward (and packed tighter
      // the faster, like Doppler), faint where they are still; hand motion seen by the sonar lifts them everywhere.
      const dt = Math.min(0.1, Math.max(0.001, t - lastT)); lastT = t
      const vA = (A - lastA) / dt; lastA = A
      const hand = Math.min(1, toward + away)
      for (let k = 0; k < BINS; k++) {
        const th = (k / BINS) * Math.PI * 2, nx = Math.cos(th), ny = Math.sin(th)
        const lift = Math.max(0, Math.min(1, (stemY - (f.cy + ny * 160 * f.s)) / height)) ** 1.6
        const vn = Math.max(0, vA * lift * nx) // outward speed of the petals on this side, px/s
        const goal = ny > 0.6 ? 0 : Math.min(1, vn * 0.06 * (1 + 1.5 * hand)) // only the side moving outward makes sound
        level[k] += (goal - level[k]) * Math.min(1, dt * 3)
        const lam = WAVE_LAMBDA * f.s / (1 + vn * 0.025) // tighter spacing when the edge moves out faster
        lamB[k] = lam
        phaseB[k] = (phaseB[k] + dt * WAVE_SPEED * f.s / lam) % 1
      }
      // repaint a margin wide enough to hold the waves
      const m = Math.ceil(WAVE_REACH * f.s + 6)
      const x0 = Math.max(0, f.left - pad - m), x1 = Math.min(W - 1, f.right + pad + m)
      const y0 = Math.max(0, f.top - m), y1 = Math.min(H - 1, f.bottom)
      const reach = WAVE_REACH * f.s
      for (let y = y0; y <= y1; y++) {
        const shift = Math.round(A * Math.max(0, (stemY - y) / height) ** 1.6)
        const row = y * W, b = (y & 7) * 8
        for (let x = x0; x <= x1; x++) {
          const sx = x - shift
          const inside = y >= f.top && sx >= 0 && sx < W
          let g = inside ? f.v[row + sx] : 0
          if (g > 0) g += 0.25 * (sx < stemX ? toward : away) * g
          if (g < 0.16 && sx >= 0 && sx < W && f.outside[row + sx]) {
            const d = f.dist[row + sx]
            if (d > 1.5 && d < reach) {
              let ang = Math.atan2(y - f.cy, sx - f.cx); if (ang < 0) ang += Math.PI * 2
              const k = Math.floor((ang / (Math.PI * 2)) * BINS) % BINS
              const lam = lamB[k], ph = d / lam - phaseB[k]
              const q = (ph - Math.floor(ph)) * lam // distance behind the nearest front, px
              const band = Math.exp(-((Math.min(q, lam - q)) ** 2) / 1.3)
              const wave = level[k] * band * (1 - d / reach) ** 1.3
              if (wave > g) g = wave
            }
          }
          px[row + x] = g > BAYER[b + (x & 7)] ? INK : BG
        }
      }
      ctx.putImageData(frame!, 0, 0)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); io.disconnect() }
  }, [])

  return <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', background: '#1e1f21', imageRendering: 'pixelated' }} />
}
