import type { EventRow } from '../App'

export default function Parent({ events, alarm, acknowledge }: {
  events: EventRow[]
  alarm: EventRow | null
  acknowledge: () => void
}) {
  return <section aria-label="Parent">
    {alarm && <div role="alert" className="parent-alarm">
      <h2>ALARM · {alarm.device_id}</h2>
      <p>{new Date(alarm.created_at).toLocaleTimeString()}</p>
      <button onClick={acknowledge}>Acknowledge</button>
    </div>}
    <h2>Failed unlocks</h2>
    <p>{events.filter(event => event.kind === 'unlock_fail').length} in recent events</p>
  </section>
}
