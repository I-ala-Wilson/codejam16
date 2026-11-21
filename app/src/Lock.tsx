import { useEffect, useRef, useState } from 'react'
import { engine } from './engine.ts'
import { extensionId, sendToExtension, type ExtReply } from './extension.ts'
import { sendEvent } from './events.ts'
import { LABEL, LENGTH, loadPassword, matches, savePassword, type Sign } from './lock/password.ts'
import { useSignInput } from './lock/useSignInput.ts'

const DEFAULT_SITES = ['youtube.com', 'tiktok.com', 'roblox.com']
const MAX_FAILS = 3
const LOCKOUT_MS = 30000

type Mode = 'home' | 'verify' | 'set' | 'confirm' | 'unlock' | 'done'
const GLYPH: Record<Sign, string> = { PUSH: '>>', PULL: '<<', WAVE: '~~', OPEN_CLOSE: '<>' }

export default function Lock() {
  const params = new URLSearchParams(location.search)
  const returnUrl = params.get('return')
  // only ever redirect to a real web page (blocks javascript:, data: and other schemes in a crafted link)
  const safeReturn = (() => { try { const u = new URL(returnUrl ?? ''); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null } catch { return null } })()
  const [mode, setMode] = useState<Mode>(params.get('unlock') ? 'unlock' : 'home')
  const [extId, setExtId] = useState(extensionId())
  const [sites, setSites] = useState<string[]>(() => siteList(localStorage.getItem('echo.lock.sites') ?? DEFAULT_SITES.join(',')))
  const [newSite, setNewSite] = useState('')
  const [status, setStatus] = useState<ExtReply | null>(null)
  const [password, setPassword] = useState<Sign[] | null>(loadPassword())
  const [draft, setDraft] = useState<Sign[]>([])
  const [running, setRunning] = useState(engine.health().running)
  const [fails, setFails] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [message, setMessage] = useState('')
  const [shake, setShake] = useState(0)
  const [error, setError] = useState('')
  const [heard, setHeard] = useState('')
  const lockedOut = now < lockedUntil
  const listening = (mode === 'set' || mode === 'unlock' || mode === 'verify') && running && !lockedOut
  const { signs, reset } = useSignInput(listening)

  useEffect(() => { localStorage.setItem('echo.lock.sites', sites.join(',')) }, [sites])
  useEffect(() => { refresh() }, [])
  useEffect(() => {
    if (!lockedOut) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [lockedOut])
  // what the sonar just heard, so the user sees that a move registered even when it is not a password sign
  useEffect(() => {
    if (!listening) return
    let timer = 0
    const off = engine.onGesture((g) => {
      if (g.type === 'HOLD') return
      setHeard(g.type === 'UNDO' ? 'double tap: last sign deleted' : `heard ${g.type.replace('_', '/').toLowerCase()}`)
      clearTimeout(timer); timer = window.setTimeout(() => setHeard(''), 1400)
    })
    return () => { off(); clearTimeout(timer) }
  }, [listening])

  const refresh = async () => { try { setStatus(await sendToExtension({ type: 'STATUS' })) } catch { setStatus(null) } }
  const startSonar = async () => {
    setError('')
    try { await engine.start(); await engine.calibrate(3000); setRunning(true) } catch (e) { setError(String(e)) }
  }
  const lockNow = async () => {
    setError('')
    try {
      setStatus(await sendToExtension({ type: 'LOCK', sites, appUrl: `${location.origin}/#lock` }))
      setMessage('')
    } catch (e) { setError(String(e)) }
  }
  const go = (m: Mode, msg = '') => { reset(); setMessage(msg); setMode(m) }

  // Setting: the 4th sign moves to the confirm screen.
  useEffect(() => {
    if (mode === 'set' && signs.length === LENGTH) { setDraft(signs); setMode('confirm'); reset() }
  }, [mode, signs])

  // Unlocking / verifying: the 4th sign is checked.
  useEffect(() => {
    if ((mode !== 'unlock' && mode !== 'verify') || signs.length !== LENGTH || !password) return
    const attempt = signs
    reset()
    if (mode === 'verify') {
      if (matches(attempt, password)) { setFails(0); go('set', 'Now do your new password.') }
      else { setShake((n) => n + 1); setMessage('That is not the current password.') }
      return
    }
    if (matches(attempt, password)) {
      setFails(0); setMode('done'); setMessage('')
      sendEvent('lock', 'unlock_ok')
      sendToExtension({ type: 'UNLOCK' }).then(setStatus).catch((e) => setError(String(e)))
      setTimeout(() => { if (safeReturn) location.href = safeReturn; else setMode('home') }, 1400)
    } else {
      const n = fails + 1
      setFails(n); setShake((k) => k + 1)
      sendEvent('lock', 'unlock_fail', { attempt: n })
      if (n >= MAX_FAILS) {
        alarm(); sendEvent('lock', 'alarm', { attempts: n })
        const until = Date.now() + LOCKOUT_MS
        setLockedUntil(until); setNow(Date.now()); setFails(0); setMessage('')
      } else setMessage(`Wrong signs. ${MAX_FAILS - n} ${MAX_FAILS - n === 1 ? 'try' : 'tries'} left.`)
    }
  }, [mode, signs, password])

  const save = async () => {
    savePassword(draft); setPassword(draft); setDraft([])
    await lockNow()
    go('home')
  }

  const locked = !!status?.locked
  const blockedHost = returnUrl ? hostOf(returnUrl) : null

  // ---- focused full-screen views ----
  if (lockedOut) {
    return (
      <div className="lk lk--invert">
        <div className="lk__center">
          <div className="lk__eyebrow">{MAX_FAILS} wrong tries · alarm sent to the parent</div>
          <div className="lk__huge">LOCKED OUT</div>
          <div className="lk__count">{Math.ceil((lockedUntil - now) / 1000)}s</div>
        </div>
      </div>
    )
  }
  if (mode === 'done') {
    return (
      <div className="lk lk--invert">
        <div className="lk__center">
          <div className="lk__huge">UNLOCKED</div>
          <div className="lk__eyebrow">{safeReturn ? `back to ${hostOf(safeReturn)}` : 'browser unlocked'}</div>
        </div>
      </div>
    )
  }
  if (mode === 'set' || mode === 'verify' || mode === 'unlock' || mode === 'confirm') {
    const reveal = mode === 'set' || mode === 'confirm'
    const shown = mode === 'confirm' ? draft : signs
    const title = mode === 'unlock' ? (blockedHost ? `${blockedHost} is locked.` : 'Unlock the browser.')
      : mode === 'verify' ? 'First, the current password.'
      : mode === 'set' ? 'Make your password.'
      : 'Is this your password?'
    const sub = mode === 'confirm' ? draft.map((s) => LABEL[s]).join('  ·  ')
      : `Do ${LENGTH} hand signs, one at a time, about 20 cm from the screen.`
    return (
      <div className="lk">
        <div className="lk__center">
          <div className="lk__eyebrow">ECHO\0 LOCK</div>
          <h1 className="lk__title">{title}</h1>
          <p className="lk__sub">{sub}</p>
          <div className="lk__slots" key={shake} data-shake={shake > 0 && mode !== 'confirm' ? 1 : 0}>
            {Array.from({ length: LENGTH }, (_, i) => {
              const s = shown[i]
              return (
                <div key={i} className={`lk__slot${s ? ' lk__slot--on' : ''}${i === shown.length && mode !== 'confirm' ? ' lk__slot--next' : ''}`}>
                  {s ? (reveal ? <><span className="lk__glyph">{GLYPH[s]}</span><span className="lk__name">{LABEL[s]}</span></> : <span className="lk__glyph">*</span>) : null}
                </div>
              )
            })}
          </div>
          {mode === 'confirm' ? (
            <div className="lk__row">
              <button className="lk__btn lk__btn--primary" onClick={save}>Keep it and lock</button>
              <button className="lk__btn" onClick={() => { setDraft([]); go('set') }}>Redo</button>
            </div>
          ) : !running ? (
            <div className="lk__row"><button className="lk__btn lk__btn--primary" onClick={startSonar}>Start listening</button></div>
          ) : (
            <>
              <SonarMeter />
              <div className="lk__status">{message || heard || 'listening'}</div>
              <div className="lk__legend">
                {(['PUSH', 'PULL', 'WAVE', 'OPEN_CLOSE'] as Sign[]).map((s) => <span key={s}><b>{GLYPH[s]}</b> {LABEL[s].toLowerCase()}</span>)}
                <span><b>xx</b> double tap = delete</span>
              </div>
            </>
          )}
          {error && <div className="lk__status">Problem: {error}</div>}
          <button className="lk__back" onClick={() => go('home')}>{mode === 'unlock' ? 'cancel' : 'back'}</button>
        </div>
      </div>
    )
  }

  // ---- control panel ----
  return (
    <div className="lk">
      <div className="lk__panel">
        <div className="lk__eyebrow">ECHO\0 LOCK</div>
        <div className="lk__state">{status ? (locked ? 'LOCKED' : 'UNLOCKED') : 'NOT CONNECTED'}</div>
        <div className="lk__chips">
          <span className={running ? 'on' : ''}>sonar {running ? 'on' : 'off'}</span>
          <span className={status ? 'on' : ''}>extension {status ? 'connected' : 'missing'}</span>
          <span className={password ? 'on' : ''}>password {password ? 'set' : 'not set'}</span>
        </div>

        <div className="lk__cols">
          <section>
            <h2>Password</h2>
            <div className="lk__mini">
              {Array.from({ length: LENGTH }, (_, i) => <div key={i} className={`lk__minislot${password ? ' on' : ''}`}>{password ? '*' : ''}</div>)}
            </div>
            <p>{password ? 'Four hand signs. Only someone who knows them can change them.' : 'Four hand signs that only you know.'}</p>
            {!running
              ? <button className="lk__btn lk__btn--primary" onClick={startSonar}>Start sonar</button>
              : <button className="lk__btn lk__btn--primary" onClick={() => go(password ? 'verify' : 'set')}>{password ? 'Change password' : 'Set password'}</button>}
          </section>

          <section>
            <h2>Blocked sites</h2>
            <div className="lk__sites">
              {sites.map((s) => <span key={s} className="lk__site">{s}<button aria-label={`remove ${s}`} onClick={() => setSites(sites.filter((x) => x !== s))}>x</button></span>)}
              <form onSubmit={(e) => { e.preventDefault(); setSites([...new Set([...sites, ...siteList(newSite)])]); setNewSite('') }}>
                <input value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="add a site" />
              </form>
            </div>
            <div className="lk__row lk__row--left">
              {locked
                ? <button className="lk__btn lk__btn--primary" onClick={() => go('unlock')} disabled={!password}>Unlock with hand signs</button>
                : <button className="lk__btn lk__btn--primary" onClick={lockNow} disabled={!password || !status || !sites.length}>Lock now</button>}
              {locked && <button className="lk__btn" onClick={lockNow}>Update sites</button>}
            </div>
            {!password && <p>Set a password first.</p>}
          </section>
        </div>

        {error && <div className="lk__status">Problem: {error}</div>}

        <details className="lk__setup" open={!status}>
          <summary>Extension setup</summary>
          <p>Load <code>codejam16/extension</code> unpacked at chrome://extensions (Developer mode), then paste its ID here.</p>
          <input value={extId} onChange={(e) => { const v = e.target.value.trim(); setExtId(v); localStorage.setItem('echo.extId', v) }} placeholder="extension ID" />
          <button className="lk__btn" onClick={refresh}>Connect</button>
        </details>
      </div>
    </div>
  )
}

// A live strip of the echo energy, 1-bit Bayer dithered, so the user can see the sonar hearing the hand.
function SonarMeter() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const W = 120, H = 12
    c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    const hist = new Float32Array(W)
    let level = 0
    const off = engine.onFrame((f) => { level = Math.max(level * 0.8, Math.min(1, (Math.max(0, f.energyToward) + Math.max(0, f.energyAway)) / 30)) })
    const id = setInterval(() => {
      hist.copyWithin(0, 1); hist[W - 1] = level
      const img = ctx.createImageData(W, H)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const amp = hist[x], d = Math.abs(y - (H - 1) / 2) / (H / 2)
        const g = d < amp + 0.08 ? 0.25 + 0.75 * amp : 0
        const lit = g > BAYER4[(y & 3) * 4 + (x & 3)]
        const i = (y * W + x) * 4, v = lit ? 242 : 30
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = lit ? 240 : 33; img.data[i + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
    }, 40)
    return () => { off(); clearInterval(id) }
  }, [])
  return <canvas ref={ref} className="lk__meter" />
}
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)

// accept 'youtube.com', 'www.youtube.com', 'https://www.youtube.com/watch?v=x' alike: keep only the bare host
const siteList = (s: string) => [...new Set(s.split(',').map((x) => x.trim().toLowerCase())
  .map((x) => x.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0]).filter(Boolean))]
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

let actx: AudioContext | null = null
function alarm() {
  actx ??= new AudioContext()
  const o = actx.createOscillator(); const g = actx.createGain()
  o.type = 'square'; g.gain.value = 0.2
  o.connect(g).connect(actx.destination)
  const t = actx.currentTime
  for (let i = 0; i < 8; i++) o.frequency.setValueAtTime(i % 2 ? 660 : 990, t + i * 0.25)
  o.start(t); o.stop(t + 2)
}
