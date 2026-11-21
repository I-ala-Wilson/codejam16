import { useEffect, useState } from 'react'
import { onLocalEvent, type LocalEvent } from './events.ts'
import { chime } from './sonar.ts'

// Caregiver view inside the app, for a second window on the same laptop: every event the sensing side sends,
// newest first, and a help call takes over the screen until it is cancelled or tapped. Michael's dashboard is the
// phone version of this over Supabase realtime.
export default function Caregiver() {
  const [events, setEvents] = useState<LocalEvent[]>([])
  const [alert, setAlert] = useState<LocalEvent | null>(null)
  useEffect(() => onLocalEvent((e) => {
    setEvents((l) => [e, ...l].slice(0, 80))
    if (e.app !== 'care') return
    if (e.kind === 'help' || e.kind === 'pain') setAlert(e)
    if (e.kind === 'cancelled' || e.kind === 'help_cancelled') {
      const kind = e.payload.cancelled_kind ?? 'help'
      setAlert(current => current?.device_id === e.device_id && current.kind === kind ? null : current)
    }
  }), [])
  useEffect(() => {
    if (!alert) return
    chime(true, 0.15); const id = setInterval(() => chime(true, 0.15), 1500)
    return () => clearInterval(id)
  }, [alert])

  const activity = events.filter((e) => e.app === 'care' && e.kind === 'activity').slice(0, 30).reverse()
  if (alert) {
    return (
      <div className="lk lk--invert" onClick={() => setAlert(null)}>
        <div className="lk__center">
          <div className="lk__eyebrow">ECHØ CAREGIVER</div>
          <div className="lk__huge">{alert.kind.toUpperCase()}</div>
          <div className="lk__sub">{alert.device_id} · {new Date(alert.at).toLocaleTimeString()}</div>
          <div className="lk__status">tap when you are on your way</div>
        </div>
      </div>
    )
  }
  return (
    <div className="lk">
      <div className="lk__panel">
        <div className="lk__eyebrow">ECHØ CAREGIVER</div>
        <div className="lk__state">{events.length ? 'Watching' : 'Waiting'}</div>
        <p className="lk__how">Open Care in another window on this laptop. Help calls, cancellations, inactivity and habit nudges appear here as they happen.</p>
        <div className="habit__hours" title="movement, newest right">
          {activity.map((e, i) => <div key={i} className="habit__bar"><i style={{ height: `${Math.min(1, Number(e.payload.level ?? 0) * 1.6) * 100}%` }} /><span /></div>)}
        </div>
        <div className="cg__feed">
          {events.filter((e) => e.kind !== 'activity').map((e, i) => (
            <div key={i} className={`cg__row${e.kind === 'help' ? ' on' : ''}`}>
              <span>{new Date(e.at).toLocaleTimeString()}</span><span>{label(e)}</span>
            </div>
          ))}
          {!events.some((e) => e.kind !== 'activity') && <div className="cg__row"><span>-</span><span>nothing yet</span></div>}
        </div>
      </div>
    </div>
  )
}

const label = (e: LocalEvent) =>
  e.kind === 'help' ? `HELP from ${e.device_id}` : e.kind === 'help_cancelled' ? 'help cancelled (false alarm)'
    : e.kind === 'inactive' ? `no movement for ${e.payload.seconds}s` : e.kind === 'habit_detected' ? 'habit nudge'
      : e.kind === 'snoozed' ? 'habit snoozed' : `${e.app} ${e.kind.replace('_', ' ')}`
