import { useEffect, useRef } from 'react'

const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]
const PX = 3 // one dither pixel = 3 CSS px (STYLE.md)
const GAP = 1

// One bar per value (0..1, newest last); barWidth is in dither pixels (default 3, use more for few bars). Each bar fades from solid at its top to sparse at
// the base, then is Bayer-dithered to 1-bit off-white on charcoal.
export function Timeline({ values, marks, height = 120, barWidth = 3 }: { values: number[]; marks?: { i: number; label: string }[]; height?: number; barWidth?: number }) {
  const BAR = Math.max(1, Math.round(barWidth))
  const ref = useRef<HTMLCanvasElement>(null)
  const cols = Math.max(1, values.length) * (BAR + GAP)
  const rows = Math.max(8, Math.round(height / PX))

  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const img = ctx.createImageData(cols, rows)
    for (let i = 0; i < values.length; i++) {
      const v = Math.min(1, Math.max(0, values[i]))
      const top = rows - Math.round(v * rows)
      for (let x = i * (BAR + GAP); x < i * (BAR + GAP) + BAR; x++) {
        for (let y = top; y < rows; y++) {
          const shade = 0.35 + 0.65 * (1 - (y - top) / Math.max(1, rows - top)) * (0.4 + 0.6 * v)
          if (shade * 64 > BAYER[y & 7][x & 7]) {
            const o = (y * cols + x) * 4
            img.data[o] = 242; img.data[o + 1] = 242; img.data[o + 2] = 240; img.data[o + 3] = 255
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [values, cols, rows, BAR])

  return (
    <div className="echo-timeline" style={{ width: cols * PX }}>
      <canvas ref={ref} width={cols} height={rows} style={{ width: cols * PX, height: rows * PX }} />
      {marks && marks.length > 0 && (
        <div className="echo-timeline__marks">
          {marks.map((m) => (
            <span key={`${m.i}-${m.label}`} className="echo-timeline__mark" style={{ left: (m.i * (BAR + GAP) + BAR / 2) * PX }}>
              <i />
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
