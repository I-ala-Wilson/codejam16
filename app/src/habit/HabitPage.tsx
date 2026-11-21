import { useEffect, useState } from 'react'
import { habitOn, setHabitOn, snooze, snoozedUntil, today } from './store.ts'

// ECHØ Habit: turn the watcher on, see today's nudges by hour and the time since the last one.
export default function HabitPage() {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick((n) => n + 1)
    window.addEventListener('echo-habit', f); const id = setInterval(f, 1000)
    return () => { window.removeEventListener('echo-habit', f); clearInterval(id) }
  }, [])
  const on = habitOn()
  const events = today()
  const last = events[events.length - 1]
  const since = last ? Math.floor((Date.now() - last) / 60000) : null
  const snoozeLeft = Math.max(0, Math.ceil((snoozedUntil() - Date.now()) / 60000))
  const hours = Array.from({ length: 24 }, (_, h) => events.filter((t) => new Date(t).getHours() === h).length)
  const max = Math.max(1, ...hours)
  const nowH = new Date().getHours()

  return (
    <div className="lk">
      <div className="lk__panel">
        <div className="lk__eyebrow">ECHØ HABIT</div>
        <div className="lk__state">{on ? 'Hands off.' : 'Habit mode off'}</div>
        <div className="lk__chips">
          <span className={on ? 'on' : ''}>{on ? 'watching' : 'not watching'}</span>
          {snoozeLeft > 0 && <span className="on">snoozed {snoozeLeft} min</span>}
        </div>
        <p className="lk__how">Leave this on while you work. When the sonar hears scratching or nail-biting it plays a soft chime and shows a tiny note in the corner. Double tap right after a nudge to snooze it for 10 minutes.</p>
        <div className="habit__nums">
          <div><div className="habit__big">{events.length}</div><div>nudges today</div></div>
          <div><div className="habit__big">{since === null ? '-' : since < 60 ? `${since}m` : `${Math.floor(since / 60)}h`}</div><div>since the last one</div></div>
        </div>
        <div className="habit__hours">
          {hours.map((n, h) => (
            <div key={h} className={`habit__bar${h === nowH ? ' now' : ''}`} title={`${h}:00 · ${n}`}>
              <i style={{ height: `${(n / max) * 100}%` }} />
              <span>{h % 6 === 0 ? `${h}h` : ''}</span>
            </div>
          ))}
        </div>
        <div className="lk__row lk__row--left">
          <button className="lk__btn lk__btn--primary" onClick={() => setHabitOn(!on)}>{on ? 'Turn off' : 'Turn on'}</button>
          {on && <button className="lk__btn" onClick={() => snooze(10 * 60 * 1000)}>Snooze 10 min</button>}
        </div>
      </div>
    </div>
  )
}
