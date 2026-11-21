import { useEffect, useRef } from 'react'

// A scene is painted in grayscale (0 = charcoal, 1 = ink) in a fixed 640 x 320 design space, then 8x8 Bayer
// ordered-dithered to 1-bit off-white on charcoal, the same technique as art/DitherFlower.tsx. Labels go in
// `overlay`, drawn crisp on top of the dither at full device resolution.

export const DW = 640, DH = 320
const DOT = 2 // CSS px per dither dot
const BAYER = [
  0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4, 52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21,
].map((v) => (v + 0.5) / 64)
const BG = 0xff000000, INK = 0xfff0f2f2 // ABGR

export type Scene = {
  draw: (g: CanvasRenderingContext2D, t: number) => void
  overlay?: (g: CanvasRenderingContext2D, t: number) => void
}

export default function DitherCanvas({ scene, label }: { scene: Scene; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current!
    const ctx = c.getContext('2d')!
    const off = document.createElement('canvas')
    const g = off.getContext('2d', { willReadFrequently: true })!
    const bits = document.createElement('canvas')
    const b = bits.getContext('2d')!
    let frame: ImageData | null = null
    let raf = 0, last = 0, visible = false
    const t0 = performance.now()

    const tick = (now: number) => {
      raf = 0
      if (!visible) return
      raf = requestAnimationFrame(tick)
      if (now - last < 1000 / 24) return
      last = now
      const cw = c.clientWidth, ch = c.clientHeight
      if (!cw || !ch) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.ceil(cw / DOT), h = Math.ceil(ch / DOT)
      if (off.width !== w || off.height !== h) {
        off.width = bits.width = w; off.height = bits.height = h
        frame = b.createImageData(w, h)
      }
      if (c.width !== Math.round(cw * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr) }
      const t = (now - t0) / 1000
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      g.setTransform(w / DW, 0, 0, h / DH, 0, 0)
      scene.draw(g, t)
      const src = g.getImageData(0, 0, w, h).data
      const px = new Uint32Array(frame!.data.buffer)
      for (let y = 0; y < h; y++) {
        const row = y * w, by = (y & 7) * 8
        for (let x = 0; x < w; x++) px[row + x] = src[(row + x) * 4] / 255 > BAYER[by + (x & 7)] ? INK : BG
      }
      b.putImageData(frame!, 0, 0)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(bits, 0, 0, w * DOT * dpr, h * DOT * dpr)
      if (scene.overlay) {
        ctx.setTransform((cw * dpr) / DW, 0, 0, (ch * dpr) / DH, 0, 0)
        scene.overlay(ctx, t)
      }
    }

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && !raf) raf = requestAnimationFrame(tick)
    })
    io.observe(c)
    return () => { cancelAnimationFrame(raf); io.disconnect() }
  }, [scene])

  return <canvas ref={ref} className="hwb__canvas" role="img" aria-label={label} />
}
