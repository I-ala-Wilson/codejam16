import { useEffect, useRef, useState } from 'react'
import { engine } from './engine.ts'
import { sendEvent } from './events.ts'
import { chime, ensureSonar } from './sonar.ts'

// ECHØ Care, the bedside laptop. Wave for 2 s to call for help (camera-free, works in the dark); a double tap
// within 5 s cancels a false alarm. The sonar also tracks movement: an inactivity alert after INACTIVE_S with no
// motion, and an activity level every 10 s for the caregiver's restlessness timeline (contracts/events.md).

const messages = { WAVE: 'help', OPEN_CLOSE: 'pain', PUSH: 'yes', PULL: 'no' } as const
type Message = typeof messages[keyof typeof messages]
const CANCEL_MS = 5000
const INACTIVE_S = 30 // demo value; hours in real use
const MOTION = 0.12 // activity level that counts as movement

type Help = { kind: Message; at: number; cancelled: boolean } | null

export default function Care() {
  const [running, setRunning] = useState(engine.health().running)
  const [help, setHelp] = useState<Help>(null)
  const [now, setNow] = useState(Date.now())
  const [lastMove, setLastMove] = useState(Date.now())
  const [inactiveSent, setInactiveSent] = useState(false)
  const [history, setHistory] = useState<number[]>([])
  const [heard, setHeard] = useState('')
  const level = useRef(0)
  const peak = useRef(0)
  const gestures = useRef(0)
  const pendingPush = useRef<ReturnType<typeof setTimeout> | null>(null)
  const helpRef = useRef<Help>(null)

  const startListening = () => ensureSonar().then(ok => {
    if (ok) { setLastMove(Date.now()); setInactiveSent(false) }
    setRunning(ok)
  })
  useEffect(() => { void startListening() }, [])
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
      if (!engine.health().running) setRunning(false)
    }, 250)
    return () => clearInterval(id)
  }, [])

  // movement level from the echo energy
  useEffect(() => engine.onFrame((f) => {
    const e = Math.min(1, (Math.max(0, f.energyToward) + Math.max(0, f.energyAway)) / 30)
    level.current = level.current * 0.9 + e * 0.1
    peak.current = Math.max(peak.current, level.current)
    if (level.current > MOTION) { setLastMove(Date.now()); setInactiveSent(false) }
  }), [])

  // help and cancel
  useEffect(() => {
    function clearPush() {
      if (pendingPush.current !== null) clearTimeout(pendingPush.current)
      pendingPush.current = null
    }
    const stop = engine.onGesture((g) => {
    gestures.current++
    const t = Date.now()
    if (g.type !== 'HOLD') { setHeard(`heard ${g.type.replace('_', '/').toLowerCase()} ${Math.round(g.confidence * 100)}%`); setTimeout(() => setHeard(''), 1500) }
    const h = helpRef.current
    const canCancel = h && !h.cancelled && t - h.at < CANCEL_MS
    // Treat repeated detections during the cancellation window as one help call.
    if (g.type === 'WAVE' && canCancel && h.kind === 'help') return
    if (canCancel && (g.type === 'UNDO' || (g.type === 'PUSH' && pendingPush.current !== null))) {
      clearPush()
      helpRef.current = { ...h, cancelled: true }; setHelp(helpRef.current)
      chime(false); sendEvent('care', 'cancelled', { cancelled_kind: h.kind }, g.type)
      setTimeout(() => { if (helpRef.current?.cancelled) { helpRef.current = null; setHelp(null) } }, 2500)
      return
    }
    if (!(g.type in messages)) return
    const kind = messages[g.type as keyof typeof messages]
    const publish = () => {
      pendingPush.current = null
      helpRef.current = { kind, at: Date.now(), cancelled: false }; setHelp(helpRef.current)
      chime(true, 0.12); sendEvent('care', kind, { confidence: g.confidence }, g.type)
    }
    clearPush()
    if (canCancel && g.type === 'PUSH') pendingPush.current = setTimeout(publish, Math.min(1500, CANCEL_MS - (t - h.at)))
    else publish()
    })
    return () => { clearPush(); stop() }
  }, [])

  // activity every 10 s, for the timeline and the caregiver
  useEffect(() => {
    if (!running) return
    level.current = peak.current = gestures.current = 0
    const id = setInterval(() => {
      if (!engine.health().running) return
      const v = peak.current; peak.current = level.current
      setHistory((h) => [...h.slice(-59), v])
      sendEvent('care', 'activity', { level: Math.round(v * 100) / 100, gestures: gestures.current })
      gestures.current = 0
    }, 10000)
    return () => clearInterval(id)
  }, [running])

  const still = Math.floor((now - lastMove) / 1000)
  useEffect(() => {
    if (running && engine.health().running && still >= INACTIVE_S && !inactiveSent) { setInactiveSent(true); sendEvent('care', 'inactive', { seconds: still }) }
  }, [still, running, inactiveSent])

  if (help) {
    const left = Math.max(0, Math.ceil((CANCEL_MS - (now - help.at)) / 1000))
    return (
      <div className="lk lk--invert" onClick={() => { helpRef.current = null; setHelp(null) }}>
        <div className="lk__center">
          <div className="lk__eyebrow">ECHØ CARE</div>
          <div className="lk__huge">{help.cancelled ? 'CANCELLED' : help.kind.toUpperCase()}</div>
          <div className="lk__sub">{help.cancelled ? 'the caregiver was told it was a false alarm' : 'your caregiver has been alerted'}</div>
          {!help.cancelled && <div className="lk__status">{left > 0 ? `double tap to cancel · ${left}` : 'tap to dismiss'}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="lk">
      <div className="lk__center">
        <div className="lk__eyebrow">ECHØ CARE</div>
        <h1 className="lk__title">Wave for help.</h1>
        <p className="lk__sub">Wave your hand side to side at the screen, about 20 cm away. No camera, works in the dark.</p>
        {!running
          ? <div className="lk__row"><span role="status">Sensor offline · no activity readings</span><button className="lk__btn lk__btn--primary" onClick={startListening}>Start listening</button></div>
          : <>
            <Strip values={history} />
            <div className="lk__status">
              {heard || (still >= INACTIVE_S ? `no movement for ${still}s · caregiver told` : still < 3 ? 'movement' : `resting · last moved ${still}s ago`)}
            </div>
            <div className="lk__legend">{Object.entries(messages).map(([gesture, kind]) => <span key={gesture}>{gesture.replace('_', '/').toLowerCase()} = {kind}</span>)}<span>double tap = cancel</span></div>
          </>}
      </div>
    </div>
  )
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
// Last 10 minutes of movement (one bar per 10 s), 1-bit dithered like the rest of the app.
function Strip({ values }: { values: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const W = 120, H = 24
    c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(W, H)
    const v = [...Array(60 - Math.min(60, values.length)).fill(0), ...values.slice(-60)]
    for (let x = 0; x < W; x++) {
      const a = Math.min(1, v[Math.floor(x / 2)] * 1.6)
      for (let y = 0; y < H; y++) {
        const on = H - y <= Math.max(1, a * H) && 0.35 + 0.65 * a > BAYER4[(y & 3) * 4 + (x & 3)]
        const i = (y * W + x) * 4, g = on ? 242 : 0
        img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = on ? 240 : 0; img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [values])
  return <canvas ref={ref} className="lk__meter" style={{ height: 96 }} title="movement, last 10 minutes" />
}
