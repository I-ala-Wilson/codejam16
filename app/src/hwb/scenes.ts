import type { Scene } from './DitherCanvas.tsx'

// The four How-we-built visuals. Everything is drawn in grayscale in a 640 x 320 design space and dithered by
// DitherCanvas. Outgoing sound is solid arcs, the returning echo is dashed arcs, as in the How it works explainer.

const TAU = Math.PI * 2
const INK = '#f2f2f0', BG = '#1e1f21'
const gray = (v: number) => { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${c},${c},${c})` }
const smooth = (x: number) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u) }
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s) }

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, size = 15, align: CanvasTextAlign = 'left') {
  g.font = `${size}px VT323, monospace`
  g.textAlign = align
  g.textBaseline = 'middle'
  g.fillStyle = INK
  g.fillText(text, x, y)
}

function tag(g: CanvasRenderingContext2D, text: string, x: number, y: number, size = 15, align: CanvasTextAlign = 'center') {
  g.font = `${size}px VT323, monospace`
  const w = g.measureText(text).width + 10, h = size * 0.95
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
  g.fillStyle = INK
  g.fillRect(x0, y - h / 2, w, h)
  g.fillStyle = BG
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, x0 + w / 2, y + 0.5)
}

// An open hand, palm facing the viewer: a union outline in ink with a dithered fill.
function hand(g: CanvasRenderingContext2D, x: number, y: number, k: number, fill: number) {
  g.save()
  g.translate(x, y)
  g.scale(k, k)
  const shapes = () => {
    g.beginPath()
    g.roundRect(-19, -8, 38, 40, 11)
    g.roundRect(-19, -40, 8.5, 40, 4.25)
    g.roundRect(-8.5, -48, 8.5, 48, 4.25)
    g.roundRect(2, -46, 8.5, 46, 4.25)
    g.roundRect(12.5, -36, 8, 36, 4)
    g.save(); g.translate(-17, 12); g.rotate(-0.75); g.roundRect(-4.25, -30, 8.5, 32, 4.25); g.restore()
  }
  shapes(); g.strokeStyle = gray(1); g.lineWidth = 3.2; g.stroke()
  shapes(); g.fillStyle = gray(fill); g.fill()
  g.restore()
}

// Solid wavefront arcs travelling from (x, y) toward angle a, `n` at a time over distance d.
function arcs(g: CanvasRenderingContext2D, x: number, y: number, a: number, r0: number, d: number, t: number, opts: { n: number; speed: number; spread: number; dashed?: boolean; bright?: number; width?: number }) {
  const { n, speed, spread, dashed = false, bright = 1, width = 2.4 } = opts
  g.lineWidth = width
  g.setLineDash(dashed ? [7, 6] : [])
  for (let k = 0; k < n; k++) {
    const u = ((t * speed) / (d - r0) + k / n) % 1
    const r = r0 + u * (d - r0)
    const v = bright * Math.min(1, u * 7, (1 - u) * 7)
    g.strokeStyle = gray(v)
    g.beginPath()
    g.arc(x, y, r, a - spread, a + spread)
    g.stroke()
  }
  g.setLineDash([])
}

// ---------- 1. The signal ----------
const HAND_PERIOD = 8, HAND_AMP = 62
const handX = (t: number) => 456 + HAND_AMP * Math.sin((TAU * t) / HAND_PERIOD)
const handV = (t: number) => ((HAND_AMP * TAU) / HAND_PERIOD) * Math.cos((TAU * t) / HAND_PERIOD)
const SPK = { x: 176, y: 190 }, MIC = { x: 44, y: 44 }, HAND_Y = 104
const SPEC = { x0: 40, x1: 600, base: 292, h: 50, span: 120 }
const echoHz = (t: number) => (-handV(t) / ((HAND_AMP * TAU) / HAND_PERIOD)) * 64 // toward the screen = pitch up

export const signal: Scene = {
  draw(g, t) {
    const hx = handX(t), hy = HAND_Y
    // table
    g.strokeStyle = gray(1); g.lineWidth = 1.2; g.setLineDash([2, 5])
    g.beginPath(); g.moveTo(16, 208); g.lineTo(624, 208); g.stroke(); g.setLineDash([])
    // laptop, side view: base on the table, screen tilted back facing the hand
    g.fillStyle = gray(0.3); g.strokeStyle = gray(1); g.lineWidth = 2.4
    g.beginPath(); g.rect(40, 194, 196, 12); g.fill(); g.stroke()
    g.beginPath(); g.moveTo(46, 194); g.lineTo(56, 194); g.lineTo(38, 30); g.lineTo(28, 30); g.closePath(); g.fill(); g.stroke()
    // speaker grille on the deck, mic dot at the top of the screen
    g.fillStyle = gray(1)
    for (let i = 0; i < 5; i++) g.fillRect(SPK.x - 14 + i * 6, 189, 3.4, 3.4)
    g.beginPath(); g.arc(MIC.x - 5, MIC.y, 3.4, 0, TAU); g.fill()
    // waves: tone out to the hand (solid), echo back to the mic (dashed)
    const dOut = Math.hypot(hx - SPK.x, hy - SPK.y)
    arcs(g, SPK.x, SPK.y, Math.atan2(hy - SPK.y, hx - SPK.x), 16, dOut - 34, t, { n: 5, speed: 60, spread: 0.26, width: 3 })
    const dIn = Math.hypot(MIC.x - hx, MIC.y - hy)
    arcs(g, hx - 14, hy - 12, Math.atan2(MIC.y - hy + 12, MIC.x - hx + 14), 26, dIn - 24, t + 0.7, { n: 5, speed: 60, spread: 0.22, dashed: true, width: 3 })
    hand(g, hx, hy + 12, 1.2, 0.42)
    // spectrum: the steady 20 kHz carrier and the echo peak that slides with the hand
    const { x0, x1, base, h, span } = SPEC
    const X = (hz: number) => x0 + ((hz + span) / (2 * span)) * (x1 - x0)
    const peak = (hz: number, amp: number, sigma: number) => {
      g.beginPath()
      g.moveTo(x0, base)
      for (let x = x0; x <= x1; x += 1) {
        const f = ((x - x0) / (x1 - x0)) * 2 * span - span
        g.lineTo(x, base - amp * h * Math.exp(-((f - hz) ** 2) / (2 * sigma * sigma)))
      }
      g.lineTo(x1, base)
    }
    const df = echoHz(t)
    peak(0, 1, 4.5); g.fillStyle = gray(0.3); g.fill()
    peak(df, 0.62, 6); g.fillStyle = gray(0.16); g.fill()
    g.strokeStyle = gray(1); g.lineWidth = 2
    peak(0, 1, 4.5); g.stroke()
    g.setLineDash([5, 4]); peak(df, 0.62, 6); g.stroke(); g.setLineDash([])
    g.strokeStyle = gray(0.7); g.lineWidth = 1; g.setLineDash([2, 3])
    g.beginPath(); g.moveTo(x0, base + 1); g.lineTo(x1, base + 1); g.stroke(); g.setLineDash([])
    for (const hz of [-100, -50, 0, 50, 100]) { g.fillStyle = gray(1); g.fillRect(X(hz) - 0.5, base + 2, 1.5, 4) }
  },
  overlay(g, t) {
    label(g, 'SPEAKER', SPK.x, 222, 17, 'center')
    label(g, 'MIC', MIC.x + 4, 18, 17)
    const v = handV(t), hx = handX(t)
    if (Math.abs(v) > 18) label(g, v < 0 ? '<  TOWARD' : 'AWAY  >', hx, 186, 17, 'center')
    const { x0, x1, base, span, h } = SPEC
    const X = (hz: number) => x0 + ((hz + span) / (2 * span)) * (x1 - x0)
    label(g, '20 kHz TONE', X(0), base - h - 12, 17, 'center')
    const df = echoHz(t)
    const q = Math.round(df / 5) * 5
    if (Math.abs(df) > 14) label(g, `ECHO ${q > 0 ? '+' : ''}${q} Hz`, X(df) + (df > 0 ? 16 : -16), base - h * 0.62 - 4, 17, df > 0 ? 'left' : 'right')
    label(g, 'PITCH LOWER', x0, base + 16, 15)
    label(g, 'PITCH HIGHER', x1, base + 16, 15, 'right')
  },
}

// ---------- 2. The model ----------
export const CLASSES = ['NONE', 'PUSH', 'PULL', 'WAVE', 'OPEN/CLOSE', 'UNDO', 'HABIT']
const SEQ = [1, 2, 3, 0, 4, 5, 6]
const SEG = 3.2, SCROLL = 44
const SG = { x0: 16, x1: 214, y0: 34, y1: 254 }
function streak(tau: number) {
  const i = Math.floor(tau / SEG)
  const q = (tau / SEG - i), cls = SEQ[((i % SEQ.length) + SEQ.length) % SEQ.length]
  const p = (q - 0.12) / 0.66
  if (p <= 0 || p >= 1 || cls === 0) return { cls, shift: 0, on: 0 }
  const env = Math.sin(Math.PI * p), A = 0.62
  const s = [0, A * env, -A * env, A * 0.8 * Math.sin(TAU * 2 * p), A * Math.sin(TAU * p), -A * Math.sin(TAU * p), A * 0.32 * Math.sin(TAU * 3 * p)][cls]
  return { cls, shift: s, on: Math.min(1, Math.sin(Math.PI * p) * 2.2) }
}
const LAYERS = [
  { x: 246, h: 176, n: 4 },
  { x: 302, h: 132, n: 6 },
  { x: 356, h: 92, n: 8 },
]
const CY = 144
const OUT = { x: 466, bar: 566, w: 62, y0: 54, dy: 30 }
const probs = CLASSES.map(() => 0.06)
let lastT = -1

export const model: Scene = {
  draw(g, t) {
    // scrolling spectrogram: time runs left to right, pitch up is up, the bright line is the 20 kHz carrier
    const { x0, x1, y0, y1 } = SG
    const cols = x1 - x0, cell = 2
    const nowCol = Math.floor(t * SCROLL)
    for (let c = 0; c < cols; c += cell) {
      const col = nowCol - (cols - c)
      const tau = col / SCROLL
      const s = streak(tau)
      for (let y = y0; y < y1; y += cell) {
        const fy = -((y - y0) / (y1 - y0)) * 2 + 1
        let v = 0.05 + hash(Math.floor(col / cell), y) * 0.16
        v += 0.92 * Math.exp(-((fy / 0.035) ** 2))
        if (s.on > 0) {
          v += s.on * 0.95 * Math.exp(-(((fy - s.shift) / 0.07) ** 2))
          v += s.on * 0.28 * Math.exp(-(((fy - s.shift * 0.55) / 0.2) ** 2))
        }
        g.fillStyle = gray(v)
        g.fillRect(x0 + c, y, cell, cell)
      }
    }
    g.strokeStyle = gray(1); g.lineWidth = 1.5
    g.strokeRect(x0, y0, cols, y1 - y0)

    // the network: three conv blocks then a dense column; a soft activation travels through once per gesture
    const pulse = 214 + ((t % SEG) / SEG) * 260
    const glow = (x: number) => 0.12 + 0.4 * Math.exp(-(((x - pulse) / 34) ** 2))
    let prev = { x: x1, top: y0, bot: y1 }
    for (const L of LAYERS) {
      const top = CY - L.h / 2, bot = CY + L.h / 2
      g.strokeStyle = gray(0.6); g.lineWidth = 1; g.setLineDash([2, 3])
      g.beginPath(); g.moveTo(prev.x, prev.top); g.lineTo(L.x, top); g.moveTo(prev.x, prev.bot); g.lineTo(L.x, bot); g.stroke()
      g.setLineDash([])
      for (let k = L.n - 1; k >= 0; k--) {
        const ox = L.x + k * 3.2, oy = top - k * 3.2
        g.fillStyle = gray(glow(L.x) + k * 0.015); g.strokeStyle = gray(1); g.lineWidth = 1.2
        g.beginPath(); g.rect(ox, oy, 12, L.h); g.fill(); g.stroke()
      }
      prev = { x: L.x + 12 + (L.n - 1) * 3.2, top: top - (L.n - 1) * 3.2, bot: bot - (L.n - 1) * 3.2 }
    }
    const dx = 420, n = 11
    for (let i = 0; i < n; i++) {
      const y = CY - ((n - 1) / 2) * 13 + i * 13
      g.strokeStyle = gray(0.45); g.lineWidth = 0.8
      g.beginPath(); g.moveTo(prev.x, CY); g.lineTo(dx, y + 4); g.stroke()
      g.fillStyle = gray(glow(dx) + 0.1 * hash(i, 3)); g.strokeStyle = gray(1); g.lineWidth = 1.2
      g.beginPath(); g.rect(dx, y, 9, 9); g.fill(); g.stroke()
    }

    // output bars: the class whose gesture just finished crossing the window wins
    const active = streak(t - 2.1).cls
    const dt = lastT < 0 ? 0.04 : Math.min(0.1, Math.max(0, t - lastT)); lastT = t
    const k = 1 - Math.exp(-dt * 4)
    for (let i = 0; i < CLASSES.length; i++) {
      const target = i === active ? 0.92 : 0.04 + 0.1 * hash(i, Math.floor((t - 2.1) / SEG))
      probs[i] += (target - probs[i]) * k
      const y = OUT.y0 + i * OUT.dy
      g.strokeStyle = gray(0.4); g.lineWidth = 0.8
      g.beginPath(); g.moveTo(dx + 9, CY); g.lineTo(OUT.x - 4, y); g.stroke()
      g.strokeStyle = gray(1); g.lineWidth = 1.2; g.setLineDash([2, 3])
      g.beginPath(); g.moveTo(OUT.bar, y + 6); g.lineTo(OUT.bar + OUT.w, y + 6); g.stroke(); g.setLineDash([])
      g.fillStyle = gray(i === active ? 1 : 0.62)
      g.fillRect(OUT.bar, y - 6, Math.max(2, OUT.w * probs[i]), 10)
    }
  },
  overlay(g, t) {
    const active = streak(t - 2.1).cls
    for (let i = 0; i < CLASSES.length; i++) {
      const y = OUT.y0 + i * OUT.dy
      if (i === active) tag(g, CLASSES[i], OUT.x - 2, y, 18, 'left')
      else label(g, CLASSES[i], OUT.x + 3, y, 18)
    }
    label(g, 'ECHO OVER TIME', SG.x0, 276, 17)
    label(g, 'NOW', SG.x1, 276, 17, 'right')
    label(g, 'SMALL CNN', 246, 276, 17)
    label(g, '7 GESTURES', OUT.x + 3, 276, 17)
  },
}

// ---------- 3. The agents ----------
// Each person drives their own AI agent; every agent reads the same spec and posts to one shared board.
const TEAM = [
  { human: 'IAN', agent: 'CLAUDE', role: 'lead: app, lock, extension', y: 52 },
  { human: 'YAHYA', agent: 'CLAUDE', role: 'model training + sonar engine', y: 104 },
  { human: 'YAHYA', agent: 'CLAUDE', role: 'tester: finds and reports bugs', y: 156 },
  { human: 'EJ', agent: 'CLAUDE', role: 'design + pitch', y: 208 },
  { human: 'MICHAEL', agent: 'CODEX', role: 'caregiver dashboard + backend', y: 260 },
]
const COL = { human: 92, agent: 232, board: 560 }
const BRD = { x: 520, y0: 34, y1: 278, w: 92 }

export const agents: Scene = {
  draw(g, t) {
    g.lineWidth = 1.4
    for (let i = 0; i < TEAM.length; i++) {
      const r = TEAM[i]
      // human -> their agent: a short solid line
      const hy = r.human === 'YAHYA' ? 130 : r.y
      g.strokeStyle = gray(0.9); g.setLineDash([])
      g.beginPath(); g.moveTo(COL.human + 18, hy); g.lineTo(COL.agent - 16, r.y); g.stroke()
      // agent -> shared board: dotted, with a message travelling in and a reply travelling back
      const x0 = COL.agent + 206, x1 = BRD.x - BRD.w / 2 // starts after the agent's label
      g.strokeStyle = gray(0.7); g.setLineDash([2, 5])
      g.beginPath(); g.moveTo(x0, r.y); g.lineTo(x1, r.y); g.stroke(); g.setLineDash([])
      const P = 3.6 + (i % 3) * 0.7, u = ((t + i * 1.13) / P) % 1
      const at = (p: number) => { g.fillStyle = gray(1); g.fillRect(x0 + (x1 - x0) * p - 3, r.y - 3, 6, 6) }
      if (u < 0.45) at(smooth(u / 0.45))
      else if (u > 0.55 && u < 0.95) at(1 - smooth((u - 0.55) / 0.4))
      // agent chip: a small rounded square with a soft fill
      g.fillStyle = gray(0.5); g.strokeStyle = gray(1); g.lineWidth = 1.6
      g.beginPath(); g.roundRect(COL.agent - 14, r.y - 14, 28, 28, 5); g.fill(); g.stroke()
    }
    // people: one round avatar each (Yahya's spans his two agents)
    for (const [y] of [[52], [130], [208], [260]]) {
      g.fillStyle = gray(0.3); g.strokeStyle = gray(1); g.lineWidth = 1.6
      g.beginPath(); g.arc(COL.human, y, 16, 0, TAU); g.fill(); g.stroke()
      g.fillStyle = gray(1)
      g.beginPath(); g.arc(COL.human, y - 4, 4.5, 0, TAU); g.fill()
      g.beginPath(); g.arc(COL.human, y + 11, 8.5, Math.PI, TAU); g.fill()
    }
    // the shared board: a tall panel the dots post into
    g.fillStyle = gray(1); g.fillRect(BRD.x - BRD.w / 2, BRD.y0, BRD.w, BRD.y1 - BRD.y0)
  },
  overlay(g) {
    for (const [name, y] of [['IAN', 52], ['YAHYA', 130], ['EJ', 208], ['MICHAEL', 260]] as const) label(g, name, COL.human - 24, y, 17, 'right')
    for (const r of TEAM) {
      label(g, r.agent, COL.agent + 22, r.y - 7, 16)
      label(g, r.role, COL.agent + 22, r.y + 9, 13)
    }
    g.fillStyle = BG; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = '22px VT323, monospace'; g.fillText('SHARED', BRD.x, 130); g.fillText('BOARD', BRD.x, 150)
    g.font = '13px VT323, monospace'
    for (const [k, txt] of ['spec', 'tasks', 'status', 'bugs'].entries()) g.fillText(txt, BRD.x, 186 + k * 16)
    label(g, 'PEOPLE', COL.human, 304, 15, 'center')
    label(g, 'THEIR AI AGENTS', COL.agent + 50, 304, 15, 'center')
    label(g, 'ONE GITHUB ISSUE', BRD.x, 304, 15, 'center')
  },
}

// ---------- 4. The trade-offs ----------
const CELLS = [80, 240, 400, 560]
const ICON_Y = 142
export const TRADE_LABELS = ['No camera', 'Any laptop', 'Stays on device', 'Built for patients']

export const tradeoffs: Scene = {
  draw(g, t) {
    // a slow band of light drifts across the row and lifts each icon's fill a little
    const band = ((t / 9) % 1) * 900 - 130
    const lift = (x: number) => 0.2 * Math.exp(-(((x - band) / 90) ** 2))
    g.strokeStyle = gray(1); g.lineWidth = 1.2; g.setLineDash([2, 6])
    for (const x of [160, 320, 480]) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, 290); g.stroke() }
    g.setLineDash([])

    // no camera
    {
      const x = CELLS[0], y = ICON_Y
      g.fillStyle = gray(0.3 + lift(x)); g.strokeStyle = gray(1); g.lineWidth = 2.4
      g.beginPath(); g.rect(x - 15, y - 34, 30, 10); g.fill(); g.stroke()
      g.beginPath(); g.roundRect(x - 44, y - 25, 88, 58, 6); g.fill(); g.stroke()
      g.fillStyle = gray(0.7 + lift(x))
      g.beginPath(); g.arc(x, y + 4, 19, 0, TAU); g.fill(); g.stroke()
      g.fillStyle = gray(0); g.beginPath(); g.arc(x, y + 4, 9, 0, TAU); g.fill()
      g.strokeStyle = gray(0); g.lineWidth = 11
      g.beginPath(); g.moveTo(x - 52, y - 46); g.lineTo(x + 52, y + 52); g.stroke()
      g.strokeStyle = gray(1); g.lineWidth = 4
      g.beginPath(); g.moveTo(x - 52, y - 46); g.lineTo(x + 52, y + 52); g.stroke()
    }
    // any laptop: sound rings rise gently off the screen
    {
      const x = CELLS[1], y = ICON_Y
      g.fillStyle = gray(0.2 + lift(x)); g.strokeStyle = gray(1); g.lineWidth = 2.4
      g.beginPath(); g.rect(x - 44, y - 40, 88, 60); g.fill(); g.stroke()
      g.beginPath(); g.moveTo(x - 44, y + 22); g.lineTo(x + 44, y + 22); g.lineTo(x + 58, y + 36); g.lineTo(x - 58, y + 36); g.closePath(); g.fill(); g.stroke()
      g.save(); g.beginPath(); g.rect(x - 42, y - 38, 84, 56); g.clip()
      arcs(g, x, y + 12, -Math.PI / 2, 4, 48, t, { n: 3, speed: 12, spread: 0.85, width: 2 })
      g.restore()
    }
    // stays on device: a padlock
    {
      const x = CELLS[2], y = ICON_Y
      g.strokeStyle = gray(1); g.lineWidth = 7
      g.beginPath(); g.arc(x, y - 16, 21, Math.PI, TAU); g.moveTo(x - 21, y - 16); g.lineTo(x - 21, y - 2); g.moveTo(x + 21, y - 16); g.lineTo(x + 21, y - 2); g.stroke()
      g.fillStyle = gray(0.5 + lift(x)); g.lineWidth = 2.4
      g.beginPath(); g.rect(x - 36, y - 4, 72, 52); g.fill(); g.stroke()
      g.fillStyle = gray(0)
      g.beginPath(); g.arc(x, y + 16, 7, 0, TAU); g.fill(); g.fillRect(x - 3, y + 18, 6, 16)
    }
    // built for patients: a raised open hand with an echo arc
    {
      const x = CELLS[3], y = ICON_Y
      hand(g, x - 4, y + 16, 1.15, 0.4 + lift(x))
      arcs(g, x - 4, y - 6, 0, 36, 70, t, { n: 2, speed: 10, spread: 0.5, width: 2 })
    }
  },
  overlay(g) {
    for (let i = 0; i < 4; i++) label(g, TRADE_LABELS[i].toUpperCase(), CELLS[i], 258, 19, 'center')
  },
}
