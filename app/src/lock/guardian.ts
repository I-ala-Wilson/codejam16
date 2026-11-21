import { useEffect } from 'react'
import { engine } from '../engine.ts'
import { sendEvent } from '../events.ts'
import { sendToExtension } from '../extension.ts'
import { addEvent, emptyInput, loadPassword, type InputState } from './password.ts'

// Secret mode. Whenever the sonar is running (any page of the app, even in a background tab), the guardian listens
// for the hand-sign password. Each correct sign in order sends PROGRESS so the veiled page shows one more tiny dot;
// a wrong sign silently starts over. The full password toggles the lock: locked -> unlocked, unlocked -> locked.
// Nothing makes a sound and nothing is shown in the app, so someone who does not know it exists never finds it.

export const guardian = { paused: false } // the Lock setup page pauses it while a password is being typed

// Starts the sonar with no click, so a locked site is already listening when it loads. Runs when the app opens with
// a password set, and again whenever the extension pokes this tab (window.echoAutostart) because a veiled page loaded.
let starting: Promise<void> | null = null
export function autostart(): Promise<void> {
  if (!loadPassword() || engine.health().running) return Promise.resolve()
  starting ??= engine.start().then(() => engine.calibrate(3000)).then(() => undefined).catch(() => undefined).finally(() => { starting = null })
  return starting
}
declare global { interface Window { echoAutostart?: () => Promise<void> } }

export function useGuardian() {
  useEffect(() => {
    window.echoAutostart = autostart
    autostart()
  }, [])
  useEffect(() => {
    let state: InputState = emptyInput()
    let sent = 0
    const progress = (n: number) => { if (n !== sent) { sent = n; sendToExtension({ type: 'PROGRESS', n }).catch(() => {}) } }
    return engine.onGesture((e) => {
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
        state = emptyInput(); progress(0)
        sendToExtension({ type: 'STATUS' })
          .then((st) => sendToExtension(st.locked ? { type: 'UNLOCK' } : { type: 'LOCK', sites: lockSites(), appUrl: location.origin }))
          .then((r) => sendEvent('lock', r.locked ? 'locked' : 'unlock_ok'))
          .catch(() => {})
        return
      }
      progress(state.signs.length)
    })
  }, [])
}

export const lockSites = () => (localStorage.getItem('echo.lock.sites') ?? 'youtube.com,tiktok.com,roblox.com').split(',').filter(Boolean)
