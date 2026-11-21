import { useEffect, useState, type ReactNode } from 'react'
import { Window } from '@ui/index.ts'
import { engine } from './engine.ts'
import { extensionId, sendToExtension, type ExtReply } from './extension.ts'
import { sendEvent } from './events.ts'
import { LABEL, LENGTH, loadPassword, matches, savePassword, type Sign } from './lock/password.ts'
import { useSignInput } from './lock/useSignInput.ts'

const DEFAULT_SITES = ['youtube.com', 'tiktok.com', 'roblox.com']
const MAX_FAILS = 3
const LOCKOUT_MS = 30000

type Mode = 'home' | 'set' | 'confirm' | 'unlock'

export default function Lock() {
  const params = new URLSearchParams(location.search)
  const returnUrl = params.get('return')
  const [mode, setMode] = useState<Mode>(params.get('unlock') ? 'unlock' : 'home')
  const [extId, setExtId] = useState(extensionId())
  const [sites, setSites] = useState(localStorage.getItem('echo.lock.sites') ?? DEFAULT_SITES.join(', '))
  const [status, setStatus] = useState<ExtReply | null>(null)
  const [password, setPassword] = useState<Sign[] | null>(loadPassword())
  const [draft, setDraft] = useState<Sign[]>([])
  const [running, setRunning] = useState(engine.health().running)
  const [fails, setFails] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const listening = (mode === 'set' || mode === 'unlock') && running && Date.now() >= lockedUntil
  const { signs, reset } = useSignInput(listening)

  useEffect(() => { localStorage.setItem('echo.lock.sites', sites) }, [sites])
  useEffect(() => { refresh() }, [])

  const refresh = async () => { try { setStatus(await sendToExtension({ type: 'STATUS' })) } catch { setStatus(null) } }
  const startSonar = async () => {
    setError('')
    try { await engine.start(); await engine.calibrate(3000); setRunning(true) } catch (e) { setError(String(e)) }
  }
  const lockNow = async () => {
    setError('')
    try {
      setStatus(await sendToExtension({ type: 'LOCK', sites: siteList(sites), appUrl: `${location.origin}/#lock` }))
      setMessage('Locked. Blocked sites now need the hand-sign password.')
    } catch (e) { setError(String(e)) }
  }

  // Setting: the 4th sign moves to the confirm screen.
  useEffect(() => {
    if (mode === 'set' && signs.length === LENGTH) { setDraft(signs); setMode('confirm'); reset() }
  }, [mode, signs])

  // Unlocking: the 4th sign is checked.
  useEffect(() => {
    if (mode !== 'unlock' || signs.length !== LENGTH || !password) return
    const attempt = signs
    reset()
    if (matches(attempt, password)) {
      setFails(0); setMessage('✓ Correct. Unlocked.')
      sendEvent('lock', 'unlock_ok')
      sendToExtension({ type: 'UNLOCK' }).then(setStatus).catch((e) => setError(String(e)))
      if (returnUrl) setTimeout(() => { location.href = returnUrl }, 1000)
      else setTimeout(() => setMode('home'), 1200)
    } else {
      const n = fails + 1
      setFails(n)
      sendEvent('lock', 'unlock_fail', { attempt: n })
      if (n >= MAX_FAILS) {
        alarm(); sendEvent('lock', 'alarm', { attempts: n })
        setLockedUntil(Date.now() + LOCKOUT_MS); setFails(0)
        setMessage(`✗ ${MAX_FAILS} wrong tries. Alarm sent to the parent. Try again in ${LOCKOUT_MS / 1000} s.`)
        setTimeout(() => setLockedUntil(0), LOCKOUT_MS)
      } else setMessage(`✗ Wrong signs (${n} of ${MAX_FAILS}).`)
    }
  }, [mode, signs, password])

  const save = async () => {
    savePassword(draft); setPassword(draft); setDraft([])
    await lockNow()
    setMode('home')
  }

  const locked = !!status?.locked
  const lockedOut = Date.now() < lockedUntil

  return (
    <Window title="Echo Lock">
      <p>
        <b>{status ? (locked ? 'LOCKED' : 'Unlocked') : 'Extension not connected'}</b>
        {status?.sites?.length ? ` · ${status.sites.join(', ')}` : ''}
        {' · '}{password ? 'hand-sign password set' : 'no password yet'}
        {' · '}{running ? 'sonar on' : <button onClick={startSonar}>Start sonar</button>}
      </p>

      {mode === 'home' && (
        <>
          <Box title="1. Set the hand-sign password">
            <p>Do {LENGTH} hand signs in a row (PUSH, PULL, WAVE, OPEN/CLOSE). A double tap deletes the last one. You'll see what it read and confirm.</p>
            <button onClick={() => { reset(); setMessage(''); setMode('set') }} disabled={!running}>
              {password ? 'Change password' : 'Set password'}
            </button>
            {!running && ' Start the sonar first.'}
          </Box>
          <Box title="2. Lock the browser">
            <p>Sites to block: <input value={sites} onChange={(e) => setSites(e.target.value)} style={{ width: 360 }} /></p>
            <button onClick={lockNow} disabled={!password}>Lock now</button>{' '}
            <button onClick={() => { reset(); setMessage(''); setMode('unlock') }} disabled={!password || !locked}>Unlock with hand signs</button>{' '}
            <button onClick={refresh}>Refresh status</button>
            {!password && ' Set a password first.'}
          </Box>
          <Box title="Extension setup (once)">
            Extension ID: <input value={extId} onChange={(e) => { const v = e.target.value.trim(); setExtId(v); localStorage.setItem('echo.extId', v) }} style={{ width: 300 }} />
            <p>Load <code>codejam16/extension</code> unpacked at chrome://extensions (Developer mode), then paste its ID here.</p>
          </Box>
        </>
      )}

      {mode === 'set' && (
        <Box title={`Do your ${LENGTH} hand signs`}>
          <Slots signs={signs} reveal />
          <p>One sign at a time, about 20 cm from the screen, hand back to rest after each. <b>Double tap</b> deletes the last sign.</p>
          <button onClick={() => { reset(); setMode('home') }}>Cancel</button>
        </Box>
      )}

      {mode === 'confirm' && (
        <Box title="Is this your password?">
          <Slots signs={draft} reveal />
          <p style={{ fontSize: 22 }}><b>{draft.map((s) => LABEL[s]).join('  →  ')}</b></p>
          <button onClick={save}>Keep it and lock</button>{' '}
          <button onClick={() => { setDraft([]); reset(); setMode('set') }}>Redo</button>
        </Box>
      )}

      {mode === 'unlock' && (
        <Box title={lockedOut ? 'Locked out' : `Do the ${LENGTH} hand signs to unlock`}>
          <Slots signs={signs} />
          {!running && <p><button onClick={startSonar}>Start sonar</button> to unlock.</p>}
          {returnUrl && <p>You'll go back to {hostOf(returnUrl)} when it's right.</p>}
          <p>Double tap deletes the last sign.</p>
          <button onClick={() => { reset(); setMode('home') }}>Back</button>
        </Box>
      )}

      {message && <p style={{ fontSize: 20 }}><b>{message}</b></p>}
      {error && <p><b>Problem:</b> {error}</p>}
    </Window>
  )
}

function Slots({ signs, reveal }: { signs: Sign[]; reveal?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
      {Array.from({ length: LENGTH }, (_, i) => (
        <div key={i} style={{ width: 130, height: 90, border: '2px solid #000', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: reveal ? 20 : 40, fontWeight: 800, background: signs[i] ? '#000' : '#fff', color: signs[i] ? '#fff' : '#000' }}>
          {signs[i] ? (reveal ? LABEL[signs[i]] : '●') : '○'}
        </div>
      ))}
    </div>
  )
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '2px solid #000', borderRadius: 8, padding: '12px 16px', marginBottom: 12, boxShadow: '3px 3px 0 #000' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  )
}

const siteList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const hostOf = (u: string) => { try { return new URL(u).hostname } catch { return u } }

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
