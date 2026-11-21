import { useEffect, useRef, useState } from 'react'
import { Toast } from '@ui/index.ts'
import { engine } from '../engine.ts'
import { sendEvent } from '../events.ts'
import { chime, ensureSonar } from '../sonar.ts'
import { firstNudgeThisHour, habitOn, logHabit, snooze, snoozedUntil, today } from './store.ts'
import './habit.css'

// Habit mode runs app-wide, like the lock guardian: when the sonar hears repetitive hand motion (scratching,
// nail-biting) it plays a soft chime and shows a tiny corner note; the first nudge each hour also shows a gentle
// bar along the bottom for 2 s. A double tap right after a nudge snoozes it for 10 minutes.
const SNOOZE_MS = 10 * 60 * 1000
const UNDO_WINDOW_MS = 4000
const TOAST_MS = 3500
const BAR_MS = 2000

export default function HabitWatch() {
  const [note, setNote] = useState('')
  const [noteOn, setNoteOn] = useState(false)
  const [bar, setBar] = useState(false)
  const lastNudge = useRef(0)
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
        Hands down for a moment. Double tap to snooze.
      </div>
    </>
  )
}
