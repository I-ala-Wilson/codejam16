import { useEffect, useRef, useState } from 'react'
import { engine } from '../engine.ts'
import { sendEvent } from '../events.ts'
import { chime, ensureSonar } from '../sonar.ts'
import { habitOn, logHabit, snooze, snoozedUntil, today } from './store.ts'

// Habit mode runs app-wide, like the lock guardian: when the sonar hears repetitive hand motion (scratching,
// nail-biting) it plays a soft chime and shows a tiny corner note. A double tap right after a nudge snoozes it.
const SNOOZE_MS = 10 * 60 * 1000
const UNDO_WINDOW_MS = 4000

export default function HabitWatch() {
  const [note, setNote] = useState('')
  const lastNudge = useRef(0)
  const hide = useRef(0)
  const show = (t: string) => { setNote(t); clearTimeout(hide.current); hide.current = window.setTimeout(() => setNote(''), 3500) }

  useEffect(() => {
    const start = () => { if (habitOn()) ensureSonar() }
    start(); window.addEventListener('echo-habit', start)
    return () => window.removeEventListener('echo-habit', start)
  }, [])

  useEffect(() => engine.onGesture((g) => {
    if (!habitOn()) return
    const t = Date.now()
    if (g.type === 'UNDO' && t - lastNudge.current < UNDO_WINDOW_MS) {
      lastNudge.current = 0; snooze(SNOOZE_MS); show('snoozed 10 min'); sendEvent('habit', 'snoozed', {}, 'UNDO')
      return
    }
    if (g.type !== 'REPETITIVE' || t < snoozedUntil()) return
    lastNudge.current = t
    logHabit(t); chime(true, 0.05)
    const n = today().length
    show(`hands · ${n} today`)
    sendEvent('habit', 'habit_detected', { seconds: 1.5, habit: 'scratching', confidence: g.confidence }, 'REPETITIVE')
  }), [])

  return <div className={`habit-toast${note ? ' on' : ''}`}>{note}</div>
}
