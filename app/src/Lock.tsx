import { useEffect, useRef, useState } from 'react'
import { engine } from './engine.ts'
import { extensionId, sendToExtension, type ExtReply } from './extension.ts'
import { LABEL, LENGTH, loadPassword, matches, savePassword, type Sign } from './lock/password.ts'
import { guardian } from './lock/guardian.ts'
import { useSignInput } from './lock/useSignInput.ts'

const DEFAULT_SITES = ['youtube.com', 'tiktok.com', 'roblox.com']

type Mode = 'home' | 'verify' | 'set' | 'confirm'
const GLYPH: Record<Sign, string> = { PUSH: '>>', PULL: '<<', WAVE: '~~', OPEN_CLOSE: '<>' }

export default function Lock() {
  const [mode, setMode] = useState<Mode>('home')
  const [extId, setExtId] = useState(extensionId())
  const [sites, setSites] = useState<string[]>(() => siteList(localStorage.getItem('echo.lock.sites') ?? DEFAULT_SITES.join(',')))
  const [newSite, setNewSite] = useState('')
  const [status, setStatus] = useState<ExtReply | null>(null)
  const [password, setPassword] = useState<Sign[] | null>(loadPassword())
  const [draft, setDraft] = useState<Sign[]>([])
  const [running, setRunning] = useState(engine.health().running)
  const [message, setMessage] = useState('')
  const [shake, setShake] = useState(0)
  const [error, setError] = useState('')
  const [heard, setHeard] = useState('')
  const listening = (mode === 'set' || mode === 'verify') && running
  const { signs, reset } = useSignInput(listening)

  useEffect(() => { localStorage.setItem('echo.lock.sites', sites.join(',')) }, [sites])
  useEffect(() => { refresh() }, [])
  // the secret guardian must not act on a password being typed here
  useEffect(() => { guardian.paused = mode !== 'home'; return () => { guardian.paused = false } }, [mode])
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
      setStatus(await sendToExtension({ type: 'LOCK', sites }))
      setMessage('')
    } catch (e) { setError(String(e)) }
  }
  const unlockNow = async () => { setError(''); try { setStatus(await sendToExtension({ type: 'UNLOCK' })) } catch (e) { setError(String(e)) } }
  const go = (m: Mode, msg = '') => { reset(); setMessage(msg); setMode(m) }

  // Setting: the 4th sign moves to the confirm screen.
  useEffect(() => {
    if (mode === 'set' && signs.length === LENGTH) { setDraft(signs); setMode('confirm'); reset() }
  }, [mode, signs])

  // Verifying: the 4th sign is checked against the current password before it can be changed.
  useEffect(() => {
    if (mode !== 'verify' || signs.length !== LENGTH || !password) return
    const attempt = signs
    reset()
    if (matches(attempt, password)) go('set', 'Now do your new password.')
    else { setShake((n) => n + 1); setMessage('That is not the current password.') }
  }, [mode, signs, password])

  const save = async () => {
    savePassword(draft); setPassword(draft); setDraft([])
    await lockNow()
    go('home')
  }

  const locked = !!status?.locked

  // ---- focused full-screen views ----
  if (mode !== 'home') {
    const reveal = mode === 'set' || mode === 'confirm'
    const shown = mode === 'confirm' ? draft : signs
    const title = mode === 'verify' ? 'First, the current password.'
      : mode === 'set' ? 'Make your password.'
      : 'Is this your password?'
    const sub = mode === 'confirm' ? draft.map((s) => LABEL[s]).join('  ·  ')
      : `Do ${LENGTH} hand signs, one at a time, about 20 cm from the screen.`
    return (
      <div className="lk">
        <div className="lk__center">
          <div className="lk__eyebrow">ECHO Ø LOCK</div>
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
          <button className="lk__back" onClick={() => go('home')}>back</button>
        </div>
      </div>
    )
  }

  // ---- control panel ----
  return (
    <div className="lk">
      <div className="lk__panel">
        <div className="lk__eyebrow">ECHO Ø LOCK</div>
        <div className="lk__state">{status ? (locked ? 'LOCKED' : 'UNLOCKED') : 'NOT CONNECTED'}</div>
        <div className="lk__chips">
          <span className={running ? 'on' : ''}>sonar {running ? 'on' : 'off'}</span>
          <span className={status ? 'on' : ''}>extension {status ? 'connected' : 'missing'}</span>
          <span className={password ? 'on' : ''}>password {password ? 'set' : 'not set'}</span>
        </div>

        <p className="lk__how">Secret mode. While the sonar is on in this tab, doing your 4 signs anywhere locks or unlocks the browser. A locked site just looks like it can't be reached; each right sign adds a tiny dot at the bottom of that page.</p>

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
                ? <button className="lk__btn lk__btn--primary" onClick={unlockNow}>Unlock now</button>
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
