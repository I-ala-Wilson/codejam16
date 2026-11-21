import { Timeline } from '@ui/index.ts'
import { useState, useEffect } from 'react'
import type { EventRow } from '../App'

export default function Care({ inactive, activity, readings }: { inactive?: EventRow; activity: number[]; readings: EventRow[] }) {
  const [opened] = useState(Date.now)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const latest = new Map(readings.map(row => [row.device_id, Date.parse(row.created_at)]))
  const stale = (time: number) => now - time >= 30000
  return <>
    {!latest.size && stale(opened) && <p role="status">Sensor offline or disconnected · no activity readings received</p>}
    {Array.from(latest, ([device, time]) => stale(time) && <p key={device} role="status">{device}: sensor offline or disconnected · last reading {new Date(time).toLocaleTimeString()}</p>)}
    {inactive && !stale(Math.max(latest.get(inactive.device_id) ?? 0, Date.parse(inactive.created_at))) && <section className="inactive-notice" aria-label="Inactivity alert">
      <span>Inactivity</span><strong>No movement for {String(inactive.payload.seconds ?? '—')}s</strong>
      <small>{inactive.device_id}</small>
    </section>}
    <section aria-labelledby="activity-heading">
      <h2 id="activity-heading">Restlessness · last 60 samples</h2>
      {activity.length ? <Timeline values={activity} /> : <p className="activity-empty">Awaiting activity</p>}
    </section>
  </>
}
