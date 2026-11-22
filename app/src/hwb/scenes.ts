import type { Scene } from './DitherCanvas.tsx'

// The four How-we-built visuals. Everything is drawn in grayscale in a 640 x 320 design space and dithered by
// DitherCanvas. Outgoing sound is solid arcs, the returning echo is dashed arcs, as in the How it works explainer.

const TAU = Math.PI * 2
const INK = '#f2f2f0', BG = '#000000'
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
    label(g, '7 OUTPUTS', OUT.x + 3, 276, 17)
  },
}

// ---------- 3. The agents ----------
// Five AI agents, each driven by one of us, never talk to each other directly: every message goes through one shared
// board (a GitHub issue). Labelled messages travel sender -> board -> recipient, and the board keeps a running log.
type AgentNode = { key: string; agent: string; role: string; who: string; x: number; y: number }
const CLAUDE_PATH = new Path2D('m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z')
const NODES: AgentNode[] = [
  { key: 'lead', agent: 'CLAUDE', role: 'lead: app + lock', who: 'IAN', x: 96, y: 50 },
  { key: 'ml', agent: 'CLAUDE', role: 'model + engine', who: 'YAHYA', x: 544, y: 50 },
  { key: 'qa', agent: 'CLAUDE', role: 'tester', who: 'YAHYA', x: 544, y: 214 },
  { key: 'ui', agent: 'CLAUDE', role: 'design + pitch', who: 'EJ', x: 96, y: 214 },
  { key: 'dash', agent: 'CODEX', role: 'dashboard', who: 'MICHAEL', x: 320, y: 236 },
]
const HUB = { x: 320, y: 128, w: 150, h: 92 }
// Yahya drives two agents (model + tester), so one Yahya node sits between them on the right
const humanAt = (n: AgentNode) => n.who === 'YAHYA' ? { x: 616, y: 132 } : (Math.abs(n.x - HUB.x) < 40 ? { x: n.x - 64, y: n.y } : { x: n.x + (n.x < HUB.x ? -58 : 58), y: n.y })
const node = (k: string) => NODES.find((n) => n.key === k)!
const MSGS: { from: string; to: string[]; text: string }[] = [
  { from: 'qa', to: ['lead'], text: 'BUG FOUND' },
  { from: 'lead', to: ['ml', 'qa', 'ui', 'dash'], text: 'SPEC v5' },
  { from: 'ml', to: ['lead'], text: 'NEW MODEL' },
  { from: 'lead', to: ['ui'], text: 'TASK' },
  { from: 'dash', to: ['lead'], text: 'DONE' },
  { from: 'ui', to: ['qa'], text: 'PLEASE TEST' },
]
const STEP = 2.6 // seconds per message
const hubEdge = (n: AgentNode) => {
  const dx = n.x - HUB.x, dy = n.y - HUB.y
  const k = Math.min((HUB.w / 2) / Math.abs(dx || 1e-6), (HUB.h / 2) / Math.abs(dy || 1e-6))
  return { x: HUB.x + dx * k, y: HUB.y + dy * k }
}
const nodeEdge = (n: AgentNode) => {
  const dx = HUB.x - n.x, dy = HUB.y - n.y, l = Math.hypot(dx, dy)
  return { x: n.x + (dx / l) * 20, y: n.y + (dy / l) * 20 }
}
// where the current message is: 0..0.42 sender -> hub, 0.42..0.58 at the hub, 0.58..1 hub -> recipients
const msgAt = (t: number) => {
  const k = Math.floor(t / STEP), u = (t / STEP) % 1
  return { m: MSGS[k % MSGS.length], u, k }
}

export const agents: Scene = {
  draw(g, t) {
    const { m, u } = msgAt(t)
    for (const n of NODES) {
      const a = nodeEdge(n), b = hubEdge(n)
      const live = n.key === m.from ? u < 0.45 : m.to.includes(n.key) ? u > 0.55 : false
      g.strokeStyle = gray(live ? 1 : 0.55); g.lineWidth = live ? 2 : 1.2; g.setLineDash(live ? [] : [2, 5])
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([])
      // the person who drives this agent, joined by a short solid line
      const h = humanAt(n), hl = Math.hypot(h.x - n.x, h.y - n.y), ux = (h.x - n.x) / hl, uy = (h.y - n.y) / hl
      g.strokeStyle = gray(1); g.lineWidth = 1.6
      const sx0 = n.who === 'YAHYA' ? n.x + 18 : n.x + ux * 20, sy0 = n.who === 'YAHYA' ? n.y : n.y + uy * 20 // Yahya's links leave from the tile's right side, clear of the labels
      g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(h.x - ux * 15, h.y - uy * 15); g.stroke()
    }
    // the board itself pulses when a message lands
    const land = u > 0.4 && u < 0.6 ? 1 - Math.abs(u - 0.5) * 10 : 0
    g.fillStyle = gray(0); g.strokeStyle = gray(1); g.lineWidth = 2 + 3 * land
    g.beginPath(); g.rect(HUB.x - HUB.w / 2, HUB.y - HUB.h / 2, HUB.w, HUB.h); g.fill(); g.stroke()
  },
  overlay(g, t) {
    const { m, u, k } = msgAt(t)
    // agent tiles and icons drawn crisp (no dither): a sparkle for Claude, a terminal prompt for Codex
    for (const n of NODES) {
      const live = n.key === m.from ? u < 0.45 : m.to.includes(n.key) ? u > 0.55 : false
      g.fillStyle = live ? INK : BG; g.strokeStyle = INK; g.lineWidth = 1.5
      g.beginPath(); g.roundRect(n.x - 17, n.y - 17, 34, 34, 7); g.fill(); g.stroke()
      g.fillStyle = live ? BG : INK; g.strokeStyle = live ? BG : INK; g.lineCap = 'round'; g.lineJoin = 'round'
      if (n.agent === 'CLAUDE') {
        // the official Claude symbol (Wikimedia Commons, File:Claude_AI_symbol.svg), drawn in ink at 24 px
        g.save(); g.translate(n.x - 12, n.y - 12); g.scale(0.24, 0.24); g.fill(CLAUDE_PATH); g.restore()
      } else {
        g.lineWidth = 2.4
        g.beginPath(); g.moveTo(n.x - 9, n.y - 6); g.lineTo(n.x - 2, n.y); g.lineTo(n.x - 9, n.y + 6); g.stroke()
        g.beginPath(); g.moveTo(n.x + 2, n.y + 7); g.lineTo(n.x + 10, n.y + 7); g.stroke()
      }
      g.lineCap = 'butt'; g.lineJoin = 'miter'
    }
    // people drawn crisp too: a ring with a head and shoulders (Yahya once, for both of his agents)
    for (const n of NODES) {
      if (n.key === 'qa') continue
      const h = humanAt(n)
      g.fillStyle = BG; g.strokeStyle = INK; g.lineWidth = 1.5
      g.beginPath(); g.arc(h.x, h.y, 14, 0, Math.PI * 2); g.fill(); g.stroke()
      g.save(); g.beginPath(); g.arc(h.x, h.y, 13, 0, Math.PI * 2); g.clip()
      g.fillStyle = INK
      g.beginPath(); g.arc(h.x, h.y - 4, 4.2, 0, Math.PI * 2); g.fill()
      g.beginPath(); g.ellipse(h.x, h.y + 12, 8.5, 7, 0, Math.PI, Math.PI * 2); g.fill() // rounded shoulders, the standard person icon
      g.restore()
    }
    // labels sit under each chip and each person, clear of the spokes that leave the chips toward the board
    for (const n of NODES) {
      label(g, n.agent, n.x, n.y + 31, 15, 'center')
      label(g, n.role, n.x, n.y + 45, 12, 'center')
      if (n.key !== 'qa') { const h = humanAt(n); label(g, n.who, h.x, h.y + 31, 13, 'center') } // one label per person
    }
    // the board is drawn crisp on top (no dither) so its log stays readable
    { const land = u > 0.4 && u < 0.6 ? 1 - Math.abs(u - 0.5) * 10 : 0
      g.fillStyle = BG; g.fillRect(HUB.x - HUB.w / 2, HUB.y - HUB.h / 2, HUB.w, HUB.h)
      g.strokeStyle = INK; g.lineWidth = 1.5 + 2.5 * land; g.strokeRect(HUB.x - HUB.w / 2, HUB.y - HUB.h / 2, HUB.w, HUB.h) }
    // board header + running log of the last three messages
    label(g, 'SHARED BOARD', HUB.x, HUB.y - 34, 17, 'center')
    label(g, 'one GitHub issue', HUB.x, HUB.y - 19, 12, 'center')
    const shown = u >= 0.5 ? k : k - 1
    for (let r = 0; r < 3; r++) {
      const idx = shown - r
      if (idx < 0) continue
      const mm = MSGS[((idx % MSGS.length) + MSGS.length) % MSGS.length]
      const to = mm.to.length > 1 ? 'ALL' : node(mm.to[0]).who
      label(g, `${node(mm.from).who} > ${mm.text} > ${to}`, HUB.x, HUB.y + 6 + r * 15, 13, 'center')
    }
    // the travelling message tag
    const from = node(m.from)
    const tagAt = (a: { x: number; y: number }, b: { x: number; y: number }, p: number) => tag(g, m.text, a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p, 13)
    if (u < 0.42) tagAt(nodeEdge(from), hubEdge(from), 0.22 + 0.78 * smooth(u / 0.42)) // starts clear of the sender's label
    else if (u > 0.58) for (const key of m.to) { const n = node(key); tagAt(hubEdge(n), nodeEdge(n), 0.78 * smooth((u - 0.58) / 0.42)) }
    label(g, 'Each of us drives an agent. Agents never talk directly: every task, bug and update goes through the board.', 320, 312, 12, 'center')
  },
}

// ---------- 4. The trade-offs ----------
// What sound gives up: the same gestures in a quiet room, a noisy room and on a weaker laptop. What it gains: three tags.
const ROOMS = [
  { name: 'QUIET ROOM', word: 'READ', conf: 0.95, noise: 0.06, speck: 0, bursts: 0, carrier: 0.92, strength: 1, other: 0 },
  { name: 'NOISY ROOM', word: 'UNSURE', conf: 0.5, noise: 0.12, speck: 0.7, bursts: 0.55, carrier: 0.92, strength: 0.8, other: 0 },
  { name: 'SECOND ECHØ NEARBY', word: 'CONFUSED', conf: 0.3, noise: 0.06, speck: 0, bursts: 0, carrier: 0.92, strength: 0.9, other: 0.85 },
]
const RB = { xs: [16, 228, 440], w: 184, y0: 40, y1: 140 }
const GAINS = [
  { name: '$0 HARDWARE', sub: 'runs on what you own' },
  { name: 'WORKS IN THE DARK', sub: 'no light needed' },
  { name: 'NO IMAGE, EVER', sub: 'only echoes, no pictures' },
]
const GY = 276, GSTEP = 2.4

export const tradeoffs: Scene = {
  draw(g, t) {
    const cell = 2, { w, y0, y1 } = RB
    const nowCol = Math.floor(t * SCROLL)
    ROOMS.forEach((r, i) => {
      const x0 = RB.xs[i]
      for (let c = 0; c < w; c += cell) {
        const col = nowCol - (w - c), cc = Math.floor(col / cell)
        const s = streak(col / SCROLL)
        // a noisy room: random bright speckle plus loud broadband bursts (claps, voices) that smear the whole column
        const burst = r.bursts && hash(Math.floor(cc / 3), 7) > 0.82 ? r.bursts * hash(Math.floor(cc / 3), 9) : 0
        for (let y = y0; y < y1; y += cell) {
          const fy = -((y - y0) / (y1 - y0)) * 2 + 1
          let v = 0.03 + hash(cc + i * 97, y) * r.noise + burst * (0.4 + 0.6 * hash(cc, y * 3))
          if (r.speck) v += r.speck * hash(cc * 3 + 11, y * 7 + 5) ** 3
          v += r.carrier * Math.exp(-((fy / 0.035) ** 2))
          if (s.on > 0) {
            v += s.on * r.strength * Math.exp(-(((fy - s.shift) / 0.07) ** 2))
            v += s.on * r.strength * 0.3 * Math.exp(-(((fy - s.shift * 0.55) / 0.2) ** 2))
          }
          if (r.other) {
            // another laptop's tone a little higher up, with its own user's gestures crossing ours
            const o = streak(col / SCROLL + 1.7)
            v += r.other * Math.exp(-(((fy - 0.45) / 0.035) ** 2))
            if (o.on > 0) v += o.on * r.other * Math.exp(-(((fy - 0.45 - o.shift * 0.7) / 0.07) ** 2))
          }
          g.fillStyle = gray(v)
          g.fillRect(x0 + c, y, cell, cell)
        }
      }
      g.strokeStyle = gray(1); g.lineWidth = 1.5
      g.strokeRect(x0, y0, w, y1 - y0)
    })
    g.strokeStyle = gray(1); g.lineWidth = 1.2; g.setLineDash([2, 6])
    g.beginPath(); g.moveTo(16, 208); g.lineTo(624, 208); g.stroke(); g.setLineDash([])

    // gains: three small line pictograms in solid ink, each with a slow animation
    g.fillStyle = gray(1); g.strokeStyle = gray(1); g.lineWidth = 2.4
    { // a laptop sending sound from its own speaker
      const x = RB.xs[0] + 26, y = GY
      g.strokeRect(x - 20, y - 18, 40, 26)
      g.beginPath(); g.moveTo(x - 26, y + 14); g.lineTo(x + 26, y + 14); g.lineTo(x + 20, y + 8); g.lineTo(x - 20, y + 8); g.closePath(); g.stroke()
      g.save(); g.beginPath(); g.rect(x - 18, y - 16, 36, 22); g.clip()
      arcs(g, x, y + 4, -Math.PI / 2, 3, 22, t, { n: 2, speed: 9, spread: 0.9, width: 2 })
      g.restore()
    }
    { // a crescent moon with two blinking stars
      const x = RB.xs[1] + 26, y = GY
      g.beginPath(); g.arc(x - 2, y, 16, 0, TAU); g.fill()
      g.fillStyle = gray(0); g.beginPath(); g.arc(x + 6, y - 6, 14, 0, TAU); g.fill()
      g.fillStyle = gray(1)
      for (const [sx, sy, ph] of [[x + 18, y + 10, 0], [x + 12, y - 18, 1.7]]) if (Math.sin(t * 2 + ph) > -0.3) g.fillRect(sx - 1.5, sy - 1.5, 3, 3)
    }
    { // a camera, crossed out
      const x = RB.xs[2] + 26, y = GY
      g.strokeRect(x - 20, y - 12, 40, 26); g.strokeRect(x - 7, y - 17, 14, 5)
      g.beginPath(); g.arc(x, y + 1, 7, 0, TAU); g.stroke()
      g.lineWidth = 3; g.beginPath(); g.moveTo(x - 24, y - 20); g.lineTo(x + 24, y + 20); g.stroke()
    }
  },
  overlay(g, t) {
    label(g, 'WHAT SOUND GIVES UP', 16, 22, 17)
    ROOMS.forEach((r, i) => {
      const x = RB.xs[i]
      label(g, r.name, x, 156, 16)
      // how sure the model is in each condition, and the verdict
      const bw = 112
      g.strokeStyle = INK; g.lineWidth = 1.2; g.strokeRect(x, 172, bw, 12)
      g.fillStyle = INK; g.fillRect(x + 2, 174, (bw - 4) * r.conf, 8)
      tag(g, r.word, x + RB.w, 178, 16, 'right')
    })
    label(g, 'WHAT IT GAINS', 16, 230, 17)
    const a = Math.floor(t / GSTEP) % GAINS.length
    GAINS.forEach((s, i) => {
      const x = RB.xs[i] + 62
      if (i === a) tag(g, s.name, x - 5, GY - 7, 17, 'left'); else label(g, s.name, x, GY - 7, 17)
      label(g, s.sub, x, GY + 13, 13)
    })
  },
}

// ---------- 1b. How the model was made: record -> label -> train -> model -> run ----------
// Five pictograms on one line; a pulse walks from stage to stage and the active stage lights up.
const STAGES = [
  { name: 'RECORD', note: '5 people · 202 takes' },
  { name: 'LABEL', note: 'cue = label' },
  { name: 'TRAIN', note: '3 min · 1 GPU' },
  { name: 'MODEL', note: '32k params · 128 KB' },
  { name: 'RUN', note: 'in browser · 12/s' },
]
const PSTEP = 1.2, PX = [64, 192, 320, 448, 576], PY = 70
// one continuous pulse travels the whole line; the stage it is passing is the active one
const CYCLE = PSTEP * STAGES.length
const pulseX = (t: number) => PX[0] + (PX[4] - PX[0]) * ((t % CYCLE) / CYCLE)
const activeStage = (t: number) => Math.min(4, Math.max(0, Math.round((pulseX(t) - PX[0]) / (PX[1] - PX[0]))))

export const pipeline: Scene = {
  draw(g, t) {
    // clean line pictograms in solid ink (dim ink still dithers to dots, so only the active stage gets the full glow)
    g.strokeStyle = gray(1); g.lineWidth = 2
    g.beginPath(); g.moveTo(PX[0] + 42, PY); g.lineTo(PX[4] - 42, PY); g.stroke()
    // the pulse glides at constant speed, fading in at the start and out at the end of the line
    const px = pulseX(t), u = (t % CYCLE) / CYCLE, fade = Math.min(1, u * 12, (1 - u) * 12)
    // a sleek light streak: a solid bar whose tail tapers to a point behind it (solid white, so it stays crisp in the dither)
    if (fade > 0.05) {
      const len = 46 * fade, hh = 3.5
      g.fillStyle = gray(1)
      g.beginPath(); g.moveTo(px + 6, PY); g.lineTo(px, PY - hh); g.lineTo(px - len, PY - 0.6); g.lineTo(px - len, PY + 0.6); g.lineTo(px, PY + hh); g.closePath(); g.fill()
    }
    STAGES.forEach((_, i) => {
      const x = PX[i], y = PY
      g.fillStyle = gray(1); g.strokeStyle = gray(1); g.lineWidth = 2.5
      if (i === 0) {
        for (let k = 0; k < 5; k++) { const px = x - 28 + k * 14, b = Math.max(0, Math.sin(t * 2.2 - k * 0.9)) * 2.5; g.beginPath(); g.arc(px, y - 9 - b, 4.5, 0, TAU); g.fill(); g.beginPath(); g.arc(px, y + 9, 7, Math.PI, 0); g.fill() }
      } else if (i === 1) {
        g.beginPath()
        for (let k = 0; k <= 48; k++) { const xx = x - 30 + k * 60 / 48, yy = y + Math.sin(k * 0.55 - t * 1.6) * 10; k ? g.lineTo(xx, yy) : g.moveTo(xx, yy) }
        g.stroke()
        for (const cx of [-18, 2, 22]) g.fillRect(x + cx, y - 28, 2.5, 9)
      } else if (i === 2) {
        g.strokeRect(x - 26, y - 20, 52, 40)
        for (let k = 0; k < 4; k++) { g.fillRect(x - 19 + k * 12, y - 28, 3, 7); g.fillRect(x - 19 + k * 12, y + 21, 3, 7) }
        g.fillRect(x - 18, y - 4, 36 * smooth(((t * 0.35) % 1.2) / 1), 8)
      } else if (i === 3) {
        for (let k = 0; k < 3; k++) { g.strokeRect(x - 22 + k * 12, y - 24 + k * 6, 14, 48 - k * 12); if (Math.floor(t * 1.5) % 3 === k) g.fillRect(x - 19 + k * 12, y - 21 + k * 6, 8, 42 - k * 12) }
      } else {
        g.strokeRect(x - 32, y - 24, 64, 48); g.fillRect(x - 32, y - 24, 64, 7)
        for (let k = 0; k < 7; k++) { const h = 3 + 12 * Math.pow(0.5 + 0.5 * Math.sin(t * 1.3 - k * 0.9), 3); g.fillRect(x - 26 + k * 8, y + 19 - h, 5, h) }
      }
    })
  },
  overlay(g, t) {
    const a = activeStage(t)
    STAGES.forEach((s, i) => {
      if (i === a) tag(g, s.name, PX[i], 140, 18); else label(g, s.name, PX[i], 140, 18, 'center')
      label(g, s.note, PX[i], 166, 14, 'center')
    })
  },
}

// ---------- Honest numbers: where it falls short ----------
// Five small pictograms in solid ink (3 on top, 2 below), each with a two-word tag and a short line.
const LIMITS = [
  { name: 'RECALIBRATE OFTEN', sub: ['redo calibration whenever the', 'room or laptop position changes'], x: 107, y: 44 },
  { name: 'SMALL DATASET', sub: ['only 5 people trained it, so new', 'users are read less reliably'], x: 320, y: 44 },
  { name: 'HANDS VARY', sub: ['people do the same sign', 'differently, open/close most'], x: 533, y: 44 },
  { name: 'ECHØS CLASH', sub: ['two laptops running ECHØ a few', 'metres apart interfere'], x: 107, y: 190 },
  { name: 'TUNED CUTOFFS', sub: ['weaker signs needed their own', 'confidence threshold to work'], x: 320, y: 190 },
  { name: 'PROOF OF CONCEPT', sub: ['built in 36 hours, not a', 'finished medical device'], x: 533, y: 190 },
]

function miniLaptop(g: CanvasRenderingContext2D, x: number, y: number) {
  g.strokeRect(x - 18, y - 22, 36, 24)
  g.beginPath(); g.moveTo(x - 24, y + 8); g.lineTo(x + 24, y + 8); g.lineTo(x + 18, y + 2); g.lineTo(x - 18, y + 2); g.closePath(); g.stroke()
}

export const limits: Scene = {
  draw(g, t) {
    // every icon starts at the same top line T, so a row reads as one clean band
    g.fillStyle = gray(1); g.strokeStyle = gray(1); g.lineWidth = 2.4
    { // recalibrate often: a refresh arrow that keeps turning, over a laptop
      const { x, y } = LIMITS[0], T = y - 40
      const cx = x, cy = T + 11, r = 11, a0 = t * 2.2, a1 = a0 + Math.PI * 1.55
      g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke()
      const hx = cx + r * Math.cos(a1), hy = cy + r * Math.sin(a1), tx = -Math.sin(a1), ty = Math.cos(a1), nx = Math.cos(a1), ny = Math.sin(a1)
      g.beginPath(); g.moveTo(hx + tx * 7, hy + ty * 7); g.lineTo(hx + nx * 6 - tx * 2, hy + ny * 6 - ty * 2); g.lineTo(hx - nx * 6 - tx * 2, hy - ny * 6 - ty * 2); g.closePath(); g.fill()
      miniLaptop(g, x, T + 57)
    }
    { // small dataset: five people, one stepping forward at a time
      const { x, y } = LIMITS[1], T = y - 40
      for (let k = 0; k < 5; k++) {
        const px = x - 40 + k * 20, b = Math.floor(t * 1.2) % 5 === k ? 4 : 0
        g.beginPath(); g.arc(px, T + 8 + b, 6, 0, TAU); g.fill()
        g.beginPath(); g.arc(px, T + 36 + b, 10, Math.PI, 0); g.fill()
      }
    }
    { // hands vary: a left hand (mirrored) and a right hand, palms out, each rocking at its own rhythm
      const { x, y } = LIMITS[2], T = y - 40
      for (const [dx, mirror, base, sp, ph] of [[-30, -1, -0.12, 1.6, 0], [30, 1, 0.12, 2.3, 1.3]]) {
        g.save(); g.translate(x + dx, T + 34); g.scale(mirror, 1); g.rotate(base * mirror + 0.12 * Math.sin(t * sp + ph))
        hand(g, 0, 0, 0.66, 0)
        g.restore()
      }
    }
    { // echos clash: two laptops, waves crossing in the middle
      const { x, y } = LIMITS[3], T = y - 40
      miniLaptop(g, x - 44, T + 22); miniLaptop(g, x + 44, T + 22)
      g.save(); g.beginPath(); g.rect(x - 100, T, 200, 31); g.clip()
      arcs(g, x - 44, T + 12, 0, 22, 70, t, { n: 2, speed: 14, spread: 0.45, width: 2 })
      arcs(g, x + 44, T + 12, Math.PI, 22, 70, t + 0.4, { n: 2, speed: 14, spread: 0.45, width: 2, dashed: true })
      g.restore()
    }
    { // tuned cutoffs: four bars, each with its own threshold tick that settles
      const { x, y } = LIMITS[4], T = y - 40
      for (let k = 0; k < 4; k++) {
        const bx = x - 30 + k * 18, h = 46
        g.strokeRect(bx, T + 2, 10, h)
        const lvl = [0.85, 0.45, 0.92, 0.7][k] + 0.05 * Math.sin(t * 0.9 + k)
        g.fillRect(bx - 5, T + 2 + h * (1 - lvl) - 2, 20, 4)
      }
    }
    { // proof of concept: a medical cross whose outline is still being drawn
      const { x, y } = LIMITS[5], T = y - 40, c = T + 25, a = 8, b = 23
      g.setLineDash([5, 4]); g.lineDashOffset = -t * 10
      g.beginPath()
      g.moveTo(x - a, c - b); g.lineTo(x + a, c - b); g.lineTo(x + a, c - a); g.lineTo(x + b, c - a); g.lineTo(x + b, c + a); g.lineTo(x + a, c + a)
      g.lineTo(x + a, c + b); g.lineTo(x - a, c + b); g.lineTo(x - a, c + a); g.lineTo(x - b, c + a); g.lineTo(x - b, c - a); g.lineTo(x - a, c - a); g.closePath()
      g.stroke(); g.setLineDash([]); g.lineDashOffset = 0
    }
  },
  overlay(g, t) {
    const a = Math.floor(t / 2.2) % LIMITS.length
    LIMITS.forEach((l, i) => {
      if (i === a) tag(g, l.name, l.x, l.y + 40, 17); else label(g, l.name, l.x, l.y + 40, 17, 'center')
      l.sub.forEach((line, k) => label(g, line, l.x, l.y + 58 + k * 14, 12, 'center'))
    })
  },
}
