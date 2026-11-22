import { useEffect } from 'react'
import { calibratingLeft, engine } from '../engine.ts'
import { ensureSonar } from '../sonar.ts'
import { sendEvent } from '../events.ts'
import { sendToExtension } from '../extension.ts'
import { addEvent, emptyInput, loadPassword, RESET_AFTER_MS, type InputState } from './password.ts'

// Secret mode. Whenever the sonar is running (any page of the app, even in a background tab), the guardian listens
// for the hand-sign password. Each correct sign in order sends PROGRESS so the veiled page shows one more tiny dot;
// a wrong sign silently starts over. The full password toggles the lock: locked -> unlocked, unlocked -> locked.
// Nothing makes a sound and nothing is shown in the app, so someone who does not know it exists never finds it.

export const guardian = { paused: false } // the Lock setup page pauses it while a password is being typed

// Starts the sonar with no click, so a locked site is already listening when it loads. Runs when the app opens with
// a password set, and again whenever the extension pokes this tab (window.echoAutostart) because a veiled page loaded.
export function autostart(): Promise<void> {
  if (!loadPassword()) return Promise.resolve()
  return ensureSonar().then(() => undefined)
}
declare global { interface Window { echoAutostart?: () => Promise<void>; echoRecalibrate?: () => Promise<void> } }

const CALIB_MS = 3000
const CALIB_DOTS = 5
const CALIB_DONE_HOLD_MS = 500

// R on a veiled page (the extension pokes this tab): relearn the room floor with the hands still, and report to the
// extension so the veil can show five dots filling up (0 = five empty dots, 1..5 filled, -1 = hide). Ignored while a
// calibration is already running.
let recalibrating = false
export async function recalibrate(): Promise<void> {
  if (recalibrating || calibratingLeft() > 0) return
  recalibrating = true
  const tell = (n: number) => { sendToExtension({ type: 'CALIB', n }).catch(() => {}) }
  const step = CALIB_MS / CALIB_DOTS
  const timers: number[] = []
  try {
    await ensureSonar()
    tell(0)
    for (let i = 1; i < CALIB_DOTS; i++) timers.push(window.setTimeout(() => tell(i), i * step))
    await engine.calibrate(CALIB_MS)
  } finally {
    timers.forEach(clearTimeout)
    tell(CALIB_DOTS)
    window.setTimeout(() => tell(-1), CALIB_DONE_HOLD_MS)
    recalibrating = false
  }
}

export function useGuardian() {
  useEffect(() => {
    window.echoAutostart = autostart
    window.echoRecalibrate = recalibrate
    autostart()
  }, [])
  useEffect(() => {
    let state: InputState = emptyInput()
    let sent = 0
    let timer = 0
    const progress = (n: number) => { if (n !== sent) { sent = n; sendToExtension({ type: 'PROGRESS', n }).catch(() => {}) } }
    // a half-done attempt expires on the clock, so a stray sign never leaves dots on the next locked page
    const expireLater = () => { clearTimeout(timer); timer = window.setTimeout(() => { state = emptyInput(); progress(0) }, RESET_AFTER_MS) }
    const off = engine.onGesture((e) => {
      const password = loadPassword()
      if (!password || guardian.paused) return
      let next = addEvent(state, e)
      if (next === state) return
      // keep only a correct prefix; a wrong sign restarts, and counts as the first sign if it is one
      const ok = next.signs.every((s, i) => s === password[i])
      if (!ok) {
        const last = next.signs[next.signs.length - 1]
        next = { ...next, signs: last === password[0] ? [last] : [] }
        sendEvent('lock', 'wrong_sign')
      }
      state = next
      if (state.signs.length === password.length) {
        state = emptyInput(); progress(0); clearTimeout(timer)
        sendToExtension({ type: 'STATUS' })
          .then((st) => sendToExtension(st.locked ? { type: 'UNLOCK' } : { type: 'LOCK', sites: lockSites(), appUrl: location.origin }))
          .then((r) => sendEvent('lock', r.locked ? 'locked' : 'unlock_ok'))
          .catch(() => {})
        return
      }
      progress(state.signs.length)
      if (state.signs.length > 0) expireLater(); else clearTimeout(timer)
    })
    return () => { off(); clearTimeout(timer) }
  }, [])
}

export const lockSites = () => (localStorage.getItem('echo.lock.sites') ?? 'youtube.com,tiktok.com,roblox.com').split(',').filter(Boolean)
