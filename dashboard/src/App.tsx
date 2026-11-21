import { useEffect, useMemo, useRef, useState } from 'react'
import { Rule, Window } from '@ui/index.ts'
import Care from './views/Care'
import Parent from './views/Parent'
import { supabase } from './supabase.ts'

export interface EventRow {
  id: number
  created_at: string
  device_id: string
  app: 'care' | 'lock' | 'habit' | 'engine'
  kind: string
  gesture: string | null
  payload: Record<string, unknown>
}

const visibleKinds = new Set(['help', 'pain', 'yes', 'no', 'cancelled', 'help_cancelled', 'inactive', 'habit_detected', 'unlock_ok'])

function findActiveHelp(events: EventRow[]): EventRow | null {
  return events.reduceRight<EventRow | null>(applyAlert, null)
}

function recentRows(snapshot: EventRow[], arrivals: EventRow[], limit: number) {
  return Array.from(new Map([...snapshot, ...arrivals].map(row => [row.id, row])).values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, limit)
}

function applyAlert(current: EventRow | null, event: EventRow): EventRow | null {
  if (event.app !== 'care') return current
  if (event.kind === 'help' || event.kind === 'pain') return event
  if ((event.kind === 'cancelled' || event.kind === 'help_cancelled') &&
      current?.device_id === event.device_id && current.kind === (event.payload.cancelled_kind ?? 'help')) return null
  return current
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
  const [view, setView] = useState<'care' | 'lock'>('care')
  const [alarm, setAlarm] = useState<EventRow | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [activityEvents, setActivityEvents] = useState<EventRow[]>([])
  const [activeHelp, setActiveHelp] = useState<EventRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useRepeatingAlert(view === 'care' ? activeHelp !== null : alarm !== null)

  useEffect(() => {
    let active = true
    let initialArrivals: EventRow[] | null = []
    let snapshotStarted = false

    async function loadSnapshot() {
      snapshotStarted = true
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
        const arrivals = initialArrivals ?? []
        const rows = recentRows(recentResult.data ?? [], arrivals, 50)
        setEvents(rows)
        setActivityEvents(recentRows(activityResult.data ?? [], arrivals.filter(row => row.app === 'care' && row.kind === 'activity'), 60).reverse())
        setActiveHelp(findActiveHelp(rows))
        setAlarm(rows.find(row => row.app === 'lock' && row.kind === 'alarm') ?? null)
      }
      setLoading(false)
      initialArrivals = null
    }

    const channel = supabase
        .channel('events')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'events' },
          (payload) => {
            if (!active) return
            const event = payload.new as EventRow
            initialArrivals?.push(event)
            setEvents((current) => [event, ...current].slice(0, 50))
            if (event.app === 'care' && event.kind === 'activity') {
              setActivityEvents((current) => [...current.slice(-59), event])
            }
            setActiveHelp(current => applyAlert(current, event))
            if (event.app === 'lock' && event.kind === 'alarm') setAlarm(event)
          },
        )
        .subscribe((status) => {
          if (!active) return
          if (status === 'SUBSCRIBED' && !snapshotStarted) void loadSnapshot()
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setError('Realtime connection failed')
            if (!snapshotStarted) void loadSnapshot()
          }
        })
    return () => {
      active = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  const feed = useMemo(() => events.filter(event => event.app === view && (view === 'lock' || visibleKinds.has(event.kind))), [events, view])
  const latestInactive = events.find((event) => event.app === 'care' && event.kind === 'inactive')

  return (
    <>
      <Window title="ECHØ dashboard">
        <nav className="dashboard-views" aria-label="Dashboard view">
          <button aria-pressed={view === 'care'} onClick={() => setView('care')}>Care</button>
          <button aria-pressed={view === 'lock'} onClick={() => setView('lock')}>Parent{alarm ? ' · ALARM' : ''}</button>
        </nav>
        <div className="dashboard-status" aria-live="polite">
          <span className="dashboard-status__dot" /> {loading ? 'Connecting' : error ? 'Connection issue' : 'Live'} · {events.length} recent events
        </div>

        {loading && <p>Loading events…</p>}
        {error && <p role="alert">Unable to load events: {error}</p>}

        {view === 'care'
          ? <Care inactive={latestInactive} activity={activityEvents.map(event => numericPayload(event, 'level') ?? 0)} />
          : <Parent events={feed} alarm={alarm} acknowledge={() => setAlarm(null)} />}

        <Rule />

        <section aria-labelledby="feed-heading">
          <h2 id="feed-heading">Live feed</h2>
          {!loading && !error && feed.length === 0 && <p>No recent {view} events.</p>}
          {feed.length > 0 && (
            <ol className="event-feed" aria-label="Recent events">
              {feed.map((event) => (
                <li key={event.id} className={`event-feed__row event-feed__row--${event.kind}`}>
                  <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleTimeString()}</time>
                  <strong>{event.kind === 'yes' || event.kind === 'no' ? event.kind.toUpperCase() : event.kind.replaceAll('_', ' ')}</strong>
                  <span>{event.device_id}</span>
                  <small>{event.app}{event.gesture ? ` · ${event.gesture}` : ''}</small>
                </li>
              ))}
            </ol>
          )}
        </section>
      </Window>

      {view === 'care' && activeHelp && (
        <div role="alert" className="echo-alert care-alert" onClick={() => setActiveHelp(null)}>
          <div className="echo-alert__title">{activeHelp.kind.toUpperCase()} requested</div>
          <div className="echo-alert__sub">{activeHelp.device_id} · {new Date(activeHelp.created_at).toLocaleTimeString()}</div>
          <button autoFocus onClick={() => setActiveHelp(null)}>Acknowledge</button>
        </div>
      )}
    </>
  )
}
