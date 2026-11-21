import { Timeline } from '@ui/index.ts'
import type { EventRow } from '../App'

export default function Care({ inactive, activity }: { inactive?: EventRow; activity: number[] }) {
  return <>
    {inactive && <section className="inactive-notice" aria-label="Inactivity alert">
      <span>Inactivity</span><strong>No movement for {String(inactive.payload.seconds ?? '—')}s</strong>
      <small>{inactive.device_id}</small>
    </section>}
    <section aria-labelledby="activity-heading">
      <h2 id="activity-heading">Restlessness · last 60 samples</h2>
      {activity.length ? <Timeline values={activity} /> : <p className="activity-empty">Awaiting activity</p>}
    </section>
  </>
}
