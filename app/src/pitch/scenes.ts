import type { Scene } from '../hwb/DitherCanvas.tsx'

// 2D dithered visual for the Habit chapter (the camera tiles and Care are 3D, in scenes3d.ts). Drawn in grayscale in DitherCanvas's 640 x 320 design space; labels go
// in overlay so they stay crisp. Outgoing sound is solid arcs, the returning echo dashed, as in How we built it.

const INK = '#f2f2f0'
const gray = (v: number) => { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${c},${c},${c})` }

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size = 17, align: CanvasTextAlign = 'center', color = INK) {
  g.font = `${size}px VT323, monospace`
  g.textAlign = align
  g.textBaseline = 'middle'
  g.fillStyle = color
  g.fillText(s, x, y)
}


function waves(g: CanvasRenderingContext2D, x: number, y: number, a: number, d: number, t: number, dashed = false, n = 4) {
  g.lineWidth = 2.6
  g.setLineDash(dashed ? [7, 6] : [])
  for (let k = 0; k < n; k++) {
    const u = (t * 0.55 + k / n) % 1
    g.strokeStyle = gray(Math.min(1, u * 6, (1 - u) * 6))
    g.beginPath()
    g.arc(x, y, 14 + u * d, a - 0.3, a + 0.3)
    g.stroke()
  }
  g.setLineDash([])
}

// A simple open hand (palm and four fingers plus thumb), outlined in ink with a mid-gray fill.
function palm(g: CanvasRenderingContext2D, x: number, y: number, k: number, rot = 0) {
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  g.scale(k, k)
  const path = () => {
    g.beginPath()
    g.roundRect(-16, -4, 32, 32, 9)
    for (let i = 0; i < 4; i++) g.roundRect(-16 + i * 8.4, -34 + Math.abs(i - 1.5) * 4, 7, 32, 3.5)
    g.roundRect(14, 4, 18, 7, 3.5)
  }
  path(); g.fillStyle = gray(0.45); g.fill()
  path(); g.strokeStyle = gray(1); g.lineWidth = 2.6; g.stroke()
  g.restore()
}

function laptop(g: CanvasRenderingContext2D, x: number, y: number, k = 1) {
  g.save()
  g.translate(x, y)
  g.scale(k, k)
  g.fillStyle = gray(0.3); g.strokeStyle = gray(1); g.lineWidth = 2.4
  g.beginPath(); g.rect(-50, -66, 100, 64); g.fill(); g.stroke()
  g.beginPath(); g.moveTo(-62, 0); g.lineTo(62, 0); g.lineTo(54, -6); g.lineTo(-54, -6); g.closePath(); g.fill(); g.stroke()
  g.restore()
}



// ---------- Habit: a forearm, a scratching hand, and the gentle bar ----------
export const habitScene: Scene = {
  draw(g, t) {
    laptop(g, 110, 250, 1)
    // forearm lying on the desk
    g.fillStyle = gray(0.5); g.strokeStyle = gray(1); g.lineWidth = 2.6
    g.beginPath(); g.roundRect(250, 180, 320, 44, 22); g.fill(); g.stroke()
    // scratching hand: fast small back and forth over the forearm
    const s = Math.sin(t * 22)
    const hx = 400 + 26 * s
    g.save(); g.translate(hx, 168); g.rotate(Math.PI); palm(g, 0, 0, 0.9); g.restore()
    for (let i = 0; i < 3; i++) { g.fillStyle = gray(0.85); g.fillRect(372 + i * 22, 198 + (i % 2) * 6, 10, 2) }
    waves(g, 110, 196, Math.atan2(168 - 196, hx - 110), 230, t)
    // the bar fades in for 2 s out of every 5
    const phase = t % 5, on = phase > 2.2 && phase < 4.2
    if (on) { g.fillStyle = gray(0.08); g.fillRect(0, 282, 640, 38); g.fillStyle = gray(1); g.fillRect(0, 282, 640, 1.5) }
  },
  overlay(g, t) {
    const phase = t % 5, on = phase > 2.2 && phase < 4.2
    text(g, 'SCRATCHING', 400, 120, 18)
    if (on) text(g, 'Hands down for a moment. Double tap any time to snooze for 10 minutes.', 320, 301, 16)
  },
}
