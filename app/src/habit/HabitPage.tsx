import { useEffect, useRef, useState } from 'react'
import { Timeline } from '@ui/index.ts'
import { engine } from '../engine.ts'
import { ensureSonar } from '../sonar.ts'
import { cancelSnooze, habitDemo, habitOn, hourCounts, lastWeek, longestCalm, setHabitDemo, setHabitOn, snooze, snoozedUntil, today } from './store.ts'
import './habit.css'

// ECHØ Habit: turn the watcher on (after a 10 s still-hands calibration), then see today's nudges by hour,
// the longest calm stretch, and the last 7 days.
const CALIBRATE_S = 10
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const span = (ms: number) => {
  const m = Math.floor(ms / 60000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export default function HabitPage() {
  const [, tick] = useState(0)
  const [count, setCount] = useState(0) // seconds left in calibration, 0 = not calibrating
  const [failed, setFailed] = useState(false)
  const run = useRef(0) // bumps on every Turn on, Cancel and unmount, so a stale calibration never finishes a newer one
  useEffect(() => {
    const f = () => tick((n) => n + 1)
    window.addEventListener('echo-habit', f); const id = setInterval(f, 1000)
    return () => { window.removeEventListener('echo-habit', f); clearInterval(id); run.current++ }
  }, [])

  const turnOn = async () => {
    const me = ++run.current
    setFailed(false); setCount(CALIBRATE_S)
    const id = setInterval(() => { if (run.current === me) setCount((c) => Math.max(1, c - 1)); else clearInterval(id) }, 1000)
    let ok = await ensureSonar()
    if (ok) { try { await engine.calibrate(CALIBRATE_S * 1000) } catch { ok = false } }
    clearInterval(id)
    if (run.current !== me) return
    setCount(0)
    if (!ok) { setFailed(true); return }
    setHabitOn(true)
  }

  const on = habitOn()
  const demo = habitDemo()
  const events = today()
  const hours = hourCounts()
  const max = Math.max(1, ...hours)
  const nowH = new Date().getHours()
  const week = lastWeek()
  const snoozeLeft = Math.max(0, Math.ceil((snoozedUntil() - Date.now()) / 60000))
  const calm = longestCalm()

  if (count > 0) {
    return (
      <div className="lk lk--invert">
        <div className="lk__center">
          <div className="lk__eyebrow">ECHØ HABIT · CALIBRATING</div>
          <div className="lk__huge">{count}</div>
          <div className="lk__sub">Keep your hands still.</div>
          <button className="lk__btn" onClick={() => { run.current++; setCount(0) }}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="lk">
      <div className="lk__panel">
        <div className="lk__eyebrow">ECHØ HABIT</div>
        <div className="lk__state">{on ? 'Watching.' : 'Habit mode off'}</div>
        <div className="lk__chips">
          <span className={on ? 'on' : ''}>{on ? 'watching' : 'not watching'}</span>
          {snoozeLeft > 0 && <span className="on">snoozed {snoozeLeft} min</span>}
          {snoozeLeft > 0 && <button className="lk__btn hb-resume" onClick={cancelSnooze}>Resume now</button>}
          {demo && <span className="on">demo data</span>}
        </div>
        <p className="lk__how">
          Leave this on while you work. When the sonar hears scratching it alarms you and shows a small note in the
          corner. Double tap toward the screen any time to snooze it for 10 minutes; press Resume now to end a snooze early.
        </p>
        {failed && <p className="hb-warn">The sonar did not start. Allow the microphone and try again.</p>}

        <div className="hb-nums">
          <div><div className="hb-big">{events.length}</div><div className="hb-label">nudges today</div></div>
          <div><div className="hb-big">{calm ? span(calm) : '-'}</div><div className="hb-label">longest calm stretch today</div></div>
        </div>

        <section className="hb-section">
          <h2>Today by hour</h2>
          <Timeline
            values={hours.map((n) => n / max)}
            marks={[0, 6, 12, 18].filter((h) => h !== nowH).map((h) => ({ i: h, label: `${h}h` })).concat({ i: nowH, label: 'now' })}
            height={96}
            barWidth={12}
          />
        </section>

        <section className="hb-section">
          <h2>Last 7 days</h2>
          <div className="hb-week">
            {week.map((d, i) => (
              <div key={d.day.getTime()} className={`hb-day${i === 6 ? ' hb-day--today' : ''}`}>
                <span className="hb-day__n">{d.count}</span>
                <span className="hb-day__name">{i === 6 ? 'today' : DAYS[d.day.getDay()]}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="lk__row lk__row--left">
          <button className="lk__btn lk__btn--primary" onClick={() => (on ? setHabitOn(false) : turnOn())}>{on ? 'Turn off' : 'Turn on'}</button>
          {on && <button className="lk__btn" onClick={() => snooze(10 * 60 * 1000)}>Snooze 10 min</button>}
          <button className="lk__btn" aria-pressed={demo} onClick={() => setHabitDemo(!demo)}>{demo ? 'Demo: on' : 'Demo: off'}</button>
        </div>
      </div>
    </div>
  )
}
