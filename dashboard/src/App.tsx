import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertScreen, Rule, Timeline, Window } from '@ui/index.ts'
import { supabase } from './supabase.ts'

interface EventRow {
  id: number
  created_at: string
  device_id: string
  app: 'care' | 'lock' | 'habit' | 'engine'
  kind: string
  gesture: string | null
  payload: Record<string, unknown>
}

const visibleKinds = new Set(['help', 'help_cancelled', 'inactive', 'habit_detected', 'unlock_ok'])

function findActiveHelp(events: EventRow[]): EventRow | null {
  for (const event of events) {
    if (event.app !== 'care') continue
    if (event.kind === 'help_cancelled') return null
    if (event.kind === 'help') return event
  }
  return null
}

function numericPayload(event: EventRow | undefined, key: string): number | null {
  const value = event?.payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function useRepeatingAlert(active: boolean) {
  const contextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!active) return

    const beep = () => {
      const context = contextRef.current ?? new AudioContext()
      contextRef.current = context
      void context.resume().then(() => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = 880
        gain.gain.setValueAtTime(0.12, context.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start()
        oscillator.stop(context.currentTime + 0.2)
      })
    }

    beep()
    const interval = window.setInterval(beep, 900)
    return () => window.clearInterval(interval)
  }, [active])

  useEffect(
    () => () => {
      if (contextRef.current) void contextRef.current.close()
    },
    [],
  )
}

export default function App() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [activityEvents, setActivityEvents] = useState<EventRow[]>([])
  const [activeHelp, setActiveHelp] = useState<EventRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useRepeatingAlert(activeHelp !== null)

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function connect() {
      const [recentResult, activityResult] = await Promise.all([
        supabase.from('events').select('*').order('created_at', { ascending: false }).limit(50),
        supabase
          .from('events')
          .select('*')
          .eq('app', 'care')
          .eq('kind', 'activity')
          .order('created_at', { ascending: false })
          .limit(60),
      ])

      if (!active) return
      const loadError = recentResult.error ?? activityResult.error
      if (loadError) {
        setError(loadError.message)
      } else {
        const rows = (recentResult.data ?? []) as EventRow[]
        setEvents(rows)
        setActivityEvents(((activityResult.data ?? []) as EventRow[]).reverse())
        setActiveHelp(findActiveHelp(rows))
      }
      setLoading(false)

      channel = supabase
        .channel('events')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'events' },
          (payload) => {
            const event = payload.new as EventRow
            setEvents((current) => [event, ...current].slice(0, 50))
            if (event.app === 'care' && event.kind === 'activity') {
              setActivityEvents((current) => [...current.slice(-59), event])
            }
            if (event.app === 'care' && event.kind === 'help') setActiveHelp(event)
            if (event.app === 'care' && event.kind === 'help_cancelled') setActiveHelp(null)
          },
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setError('Realtime connection failed')
          }
        })
    }

    void connect()
    return () => {
      active = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  const feed = useMemo(() => events.filter((event) => visibleKinds.has(event.kind)), [events])
  const latestInactive = events.find((event) => event.app === 'care' && event.kind === 'inactive')
  const inactiveSeconds = numericPayload(latestInactive, 'seconds')

  return (
    <>
      <Window title="ECHØ caregiver dashboard">
        <div className="dashboard-status" aria-live="polite">
          <span className="dashboard-status__dot" /> Live · {events.length} recent events
        </div>

        {loading && <p>Loading events…</p>}
        {error && <p role="alert">Unable to load events: {error}</p>}

        {latestInactive && (
          <section className="inactive-notice" aria-label="Inactivity alert">
            <span>Inactivity</span>
            <strong>No movement for {inactiveSeconds ?? '—'}s</strong>
            <small>{latestInactive.device_id}</small>
          </section>
        )}

        <section aria-labelledby="activity-heading">
          <h2 id="activity-heading">Restlessness · last 60 samples</h2>
          {activityEvents.length === 0 ? (
            <p className="activity-empty">Awaiting activity</p>
          ) : (
            <Timeline values={activityEvents.map((event) => numericPayload(event, 'level') ?? 0)} />
          )}
        </section>

        <Rule />

        <section aria-labelledby="feed-heading">
          <h2 id="feed-heading">Live feed</h2>
          {!loading && !error && feed.length === 0 && <p>No care, habit, or lock events yet.</p>}
          {feed.length > 0 && (
            <ol className="event-feed" aria-label="Recent events">
              {feed.map((event) => (
                <li key={event.id} className={`event-feed__row event-feed__row--${event.kind}`}>
                  <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleTimeString()}</time>
                  <strong>{event.kind.replaceAll('_', ' ')}</strong>
                  <span>{event.device_id}</span>
                  <small>{event.app}{event.gesture ? ` · ${event.gesture}` : ''}</small>
                </li>
              ))}
            </ol>
          )}
        </section>
      </Window>

      {activeHelp && (
        <AlertScreen
          title={`HELP · ${activeHelp.device_id}`}
          sub={`Care alert · ${new Date(activeHelp.created_at).toLocaleTimeString()} · tap to silence`}
          onDismiss={() => setActiveHelp(null)}
        />
      )}
    </>
  )
}
