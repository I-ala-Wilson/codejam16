import type { GestureType } from '@contracts/engine.ts'

// Echo Lock password: 4 hand signs. UNDO (double tap) deletes the last sign instead of being a sign.
export const SIGNS = ['PUSH', 'PULL', 'WAVE', 'OPEN_CLOSE'] as const
export type Sign = (typeof SIGNS)[number]
export const LENGTH = 4
export const MIN_CONFIDENCE = 0.6
export const DEBOUNCE_MS = 400 // the same sign twice within this window is one move
export const RESET_AFTER_MS = 8000 // a pause this long starts the attempt over

const KEY = 'echo.lock.password'
export const loadPassword = (): Sign[] | null => {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return Array.isArray(p) && p.length === LENGTH ? p : null } catch { return null }
}
export const savePassword = (p: Sign[]) => localStorage.setItem(KEY, JSON.stringify(p))
export const matches = (attempt: Sign[], password: Sign[]) =>
  attempt.length === password.length && attempt.every((s, i) => s === password[i])

export type InputState = { signs: Sign[]; lastAt: number; lastType: string }
export const emptyInput = (): InputState => ({ signs: [], lastAt: 0, lastType: '' })

/** Pure reducer: fold one gesture event into the sign sequence being entered. */
export function addEvent(s: InputState, e: { type: GestureType; confidence: number; t: number }): InputState {
  if (e.type === 'HOLD' || e.confidence < MIN_CONFIDENCE) return s
  if (e.type === s.lastType && e.t - s.lastAt < DEBOUNCE_MS) return s
  const base = s.signs.length && e.t - s.lastAt > RESET_AFTER_MS ? [] : s.signs
  if (e.type === 'UNDO') {
    // a wave is often misread as UNDO at its tail: ignore weak UNDOs and any UNDO right after a WAVE
    if (e.confidence < 0.9 || (s.lastType === 'WAVE' && e.t - s.lastAt < 1500)) return s
    return { signs: base.slice(0, -1), lastAt: e.t, lastType: e.type }
  }
  if (!(SIGNS as readonly string[]).includes(e.type) || base.length >= LENGTH) return { ...s, signs: base }
  return { signs: [...base, e.type as Sign], lastAt: e.t, lastType: e.type }
}

export const LABEL: Record<Sign, string> = { PUSH: 'PUSH', PULL: 'PULL', WAVE: 'WAVE', OPEN_CLOSE: 'OPEN/CLOSE' }
