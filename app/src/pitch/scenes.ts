import type { Scene } from '../hwb/DitherCanvas.tsx'

// Dithered visuals for the Home pitch chapters. Drawn in grayscale in DitherCanvas's 640 x 320 design space; labels go
// in overlay so they stay crisp. Outgoing sound is solid arcs, the returning echo dashed, as in How we built it.

const TAU = Math.PI * 2
const INK = '#f2f2f0', BG = '#000000'
const gray = (v: number) => { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${c},${c},${c})` }

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size = 17, align: CanvasTextAlign = 'center', color = INK) {
  g.font = `${size}px VT323, monospace`
  g.textAlign = align
  g.textBaseline = 'middle'
  g.fillStyle = color
  g.fillText(s, x, y)
}

function chip(g: CanvasRenderingContext2D, s: string, x: number, y: number, size = 17) {
  g.font = `${size}px VT323, monospace`
  const w = g.measureText(s).width + 12, h = size * 1.05
  g.fillStyle = INK
  g.fillRect(x - w / 2, y - h / 2, w, h)
  g.fillStyle = BG
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(s, x, y + 0.5)
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

function cross(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.strokeStyle = gray(1); g.lineWidth = 5
  g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke()
}

function camera(g: CanvasRenderingContext2D, x: number, y: number, fill = 0.35) {
  g.fillStyle = gray(fill); g.strokeStyle = gray(1); g.lineWidth = 2.6
  g.beginPath(); g.roundRect(x - 44, y - 26, 72, 52, 6); g.fill(); g.stroke()
  g.beginPath(); g.moveTo(x + 28, y - 10); g.lineTo(x + 50, y - 22); g.lineTo(x + 50, y + 22); g.lineTo(x + 28, y + 10); g.closePath(); g.fill(); g.stroke()
  g.beginPath(); g.arc(x - 8, y, 13, 0, TAU); g.fillStyle = gray(0.8); g.fill(); g.stroke()
}

// ---------- Why not a camera: three tiles ----------
export const costTile: Scene = {
  draw(g, t) {
    // a lidar / camera rig on a tripod, then the laptop that is already on the desk
    camera(g, 150, 120)
    g.strokeStyle = gray(1); g.lineWidth = 2.6
    g.beginPath(); g.moveTo(140, 146); g.lineTo(110, 262); g.moveTo(140, 146); g.lineTo(140, 262); g.moveTo(140, 146); g.lineTo(170, 262); g.stroke()
    const pulse = 0.5 + 0.5 * Math.sin(t * 2)
    g.fillStyle = gray(0.6 + 0.4 * pulse); g.beginPath(); g.arc(186, 96, 5, 0, TAU); g.fill()
    laptop(g, 470, 240, 1.3)
    waves(g, 470, 150, -Math.PI / 2, 70, t)
  },
  overlay(g) {
    text(g, 'CAMERA / LIDAR', 150, 296, 30)
    chip(g, '$$$', 150, 46, 34)
    text(g, 'YOUR LAPTOP', 470, 296, 30)
    chip(g, '$0', 470, 46, 34)
  },
}

export const privacyTile: Scene = {
  draw(g, t) {
    // a door with a restroom sign, a camera crossed out, and sound passing without an image
    g.fillStyle = gray(0.22); g.strokeStyle = gray(1); g.lineWidth = 2.6
    g.beginPath(); g.rect(80, 60, 150, 220); g.fill(); g.stroke()
    g.beginPath(); g.arc(210, 175, 6, 0, TAU); g.fillStyle = gray(1); g.fill()
    g.beginPath(); g.roundRect(120, 90, 70, 50, 6); g.fillStyle = gray(0.85); g.fill()
    camera(g, 440, 120, 0.25)
    cross(g, 440, 120, 58)
    laptop(g, 440, 286, 0.9)
    waves(g, 440, 232, -Math.PI / 2, 48, t)
  },
  overlay(g) {
    text(g, 'WC', 155, 116, 26, 'center', BG)
    text(g, 'NO LENS', 440, 34, 32)
  },
}

export const darkTile: Scene = {
  draw(g, t) {
    // night: a moon, a blind camera, and sound that still finds the hand
    g.fillStyle = gray(0.95); g.beginPath(); g.arc(90, 70, 30, 0, TAU); g.fill()
    g.fillStyle = gray(0); g.beginPath(); g.arc(104, 62, 26, 0, TAU); g.fill()
    camera(g, 230, 150, 0.12)
    cross(g, 230, 150, 50)
    laptop(g, 440, 280, 1.1)
    const hx = 520 + 18 * Math.sin(t * 2.4)
    waves(g, 440, 200, Math.atan2(110 - 200, hx - 440), 90, t)
    waves(g, hx - 10, 116, Math.atan2(200 - 116, 440 - hx + 10), 70, t + 0.4, true, 3)
    palm(g, hx, 112, 1.1)
  },
  overlay(g) {
    text(g, 'CAMERA: BLIND', 230, 240, 28)
    text(g, 'SONAR: HEARS', 470, 34, 32)
  },
}

// ---------- Care: a bed, a waving hand, sound arcs, and the caregiver's phone ----------
export const careScene: Scene = {
  draw(g, t) {
    // bed (side view) and patient
    g.fillStyle = gray(0.28); g.strokeStyle = gray(1); g.lineWidth = 2.6
    g.beginPath(); g.rect(60, 210, 300, 26); g.fill(); g.stroke()
    g.beginPath(); g.moveTo(60, 236); g.lineTo(60, 280); g.moveTo(360, 236); g.lineTo(360, 280); g.moveTo(60, 150); g.lineTo(60, 210); g.stroke()
    g.beginPath(); g.roundRect(74, 190, 70, 22, 10); g.fillStyle = gray(0.7); g.fill(); g.stroke()
    g.beginPath(); g.arc(112, 180, 18, 0, TAU); g.fillStyle = gray(0.5); g.fill(); g.stroke()
    g.beginPath(); g.moveTo(140, 206); g.quadraticCurveTo(250, 186, 350, 208); g.lineTo(350, 212); g.lineTo(140, 212); g.fillStyle = gray(0.55); g.fill(); g.stroke()
    // raised forearm and a waving hand
    const w = Math.sin(t * 5.2)
    const hx = 238 + 16 * w
    g.strokeStyle = gray(1); g.lineWidth = 9; g.lineCap = 'round'
    g.beginPath(); g.moveTo(220, 200); g.lineTo(hx - 4, 118); g.stroke(); g.lineCap = 'butt'
    palm(g, hx, 96, 1, w * 0.35)
    // bedside laptop and sound
    laptop(g, 430, 240, 0.85)
    waves(g, 430, 186, Math.atan2(96 - 186, hx - 430), 150, t)
    waves(g, hx + 14, 100, Math.atan2(186 - 100, 430 - hx - 14), 120, t + 0.5, true, 3)
    // caregiver phone
    g.fillStyle = gray(0.15); g.strokeStyle = gray(1); g.lineWidth = 2.6
    g.beginPath(); g.roundRect(540, 70, 76, 140, 12); g.fill(); g.stroke()
    const lit = (t % 4) > 1.2
    g.fillStyle = gray(lit ? 1 : 0.2); g.fillRect(550, 96, 56, 70)
  },
  overlay(g, t) {
    const lit = (t % 4) > 1.2
    if (lit) { text(g, 'HELP', 578, 122, 26, 'center', BG); text(g, 'BED 4', 578, 148, 15, 'center', BG) }
    text(g, 'CAREGIVER', 578, 230, 15)
    text(g, 'WAVE = HELP', 238, 30, 18)
  },
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
