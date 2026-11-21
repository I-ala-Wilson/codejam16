import { useEffect, useRef, useState } from 'react'
import { Toast } from '@ui/index.ts'
import { engine } from '../engine.ts'
import { sendEvent } from '../events.ts'
import { chime, ensureSonar } from '../sonar.ts'
import { firstNudgeThisHour, habitOn, logHabit, snooze, snoozedUntil, today } from './store.ts'
import './habit.css'

// Habit mode runs app-wide, like the lock guardian: when the sonar hears repetitive hand motion (scratching,
// fidgeting) it plays a soft chime and shows a tiny corner note; the first nudge each hour also shows a gentle
// bar along the bottom for 2 s. A double tap (UNDO) snoozes it for 10 minutes at any time; while snoozed, double taps
// do nothing ('Resume now' on the Habit page is the only way to end a snooze early).
// Live test (EJ, MacBook Air): 14/15 scratches caught, but 5 false nudges in 2 min of typing, and the double tap never
// snoozed because the engine reports a natural double tap as PUSH, PUSH (issue #22). So: an UNDO or two PUSHes
// close together count as the snooze tap; REPETITIVE is ignored while the keyboard or trackpad is in use on this
// page; and one habit episode gives one nudge (a quiet cooldown after each nudge).
const SNOOZE_MS = 10 * 60 * 1000
const UNDO_WINDOW_MS = 6000
const TAP_PAIR_MS = 1500
const INPUT_QUIET_MS = 2500
const COOLDOWN_MS = 8000
const TOAST_MS = 3500
const BAR_MS = 2000

export default function HabitWatch() {
  const [note, setNote] = useState('')
  const [noteOn, setNoteOn] = useState(false)
  const [bar, setBar] = useState(false)
  const lastNudge = useRef(0)
  const lastPush = useRef(0)
  const lastInput = useRef(0)
  const hideNote = useRef(0)
  const hideBar = useRef(0)
  const show = (t: string) => {
    setNote(t); setNoteOn(true)
    clearTimeout(hideNote.current); hideNote.current = window.setTimeout(() => setNoteOn(false), TOAST_MS)
  }

  useEffect(() => {
    const start = () => { if (habitOn()) ensureSonar() }
    start(); window.addEventListener('echo-habit', start)
    return () => { window.removeEventListener('echo-habit', start); clearTimeout(hideNote.current); clearTimeout(hideBar.current) }
  }, [])

  useEffect(() => {
    const mark = () => { lastInput.current = Date.now() }
    const kinds = ['keydown', 'pointermove', 'pointerdown', 'wheel'] as const
    for (const k of kinds) window.addEventListener(k, mark, { passive: true })
    return () => { for (const k of kinds) window.removeEventListener(k, mark) }
  }, [])

  useEffect(() => engine.onGesture((g) => {
    if (!habitOn()) return
    const t = Date.now()
    const pair = g.type === 'PUSH' && t - lastPush.current < TAP_PAIR_MS
    if (g.type === 'PUSH') lastPush.current = pair ? 0 : t
    const doubleTap = g.type === 'UNDO' || pair
    // UNDO starts the snooze at any time; a PUSH,PUSH pair only counts right after a nudge (too easy to hit by accident).
    if (snoozedUntil() <= t && (g.type === 'UNDO' || (doubleTap && t - lastNudge.current < UNDO_WINDOW_MS))) {
      lastNudge.current = 0
      snooze(SNOOZE_MS); show('snoozed 10 min'); sendEvent('habit', 'snoozed', {}, 'UNDO')
      return
    }
    if (g.type !== 'REPETITIVE' || t < snoozedUntil()) return
    if (t - lastInput.current < INPUT_QUIET_MS || t - lastNudge.current < COOLDOWN_MS) return
    lastNudge.current = t
    logHabit(t); chime(true, 0.05)
    show(`hands · ${today().length} today`)
    if (firstNudgeThisHour()) {
      setBar(true); clearTimeout(hideBar.current); hideBar.current = window.setTimeout(() => setBar(false), BAR_MS)
    }
    sendEvent('habit', 'habit_detected', { seconds: 1.5, habit: 'scratching', confidence: g.confidence }, 'REPETITIVE')
  }), [])

  return (
    <>
      <Toast text={note} visible={noteOn} />
      <div className={`hb-bar${bar ? ' hb-bar--on' : ''}`} role="status" aria-hidden={!bar}>
        Hands down for a moment. Double tap any time to snooze for 10 minutes.
      </div>
    </>
  )
}
