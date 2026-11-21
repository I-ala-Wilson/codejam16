import { useEffect, useState } from 'react'
import { Window } from '@ui/index.ts'
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

export default function App() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function connect() {
      const { data, error: loadError } = await supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (!active) return
      if (loadError) {
        setError(loadError.message)
      } else {
        setEvents((data ?? []) as EventRow[])
      }
      setLoading(false)

      const channel = supabase
        .channel('events')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'events' },
          (payload) => {
            setEvents((current) => [payload.new as EventRow, ...current].slice(0, 50))
          },
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setError('Realtime connection failed')
          }
        })

      if (!active) void supabase.removeChannel(channel)
    }

    void connect()
    return () => {
      active = false
      void supabase.removeAllChannels()
    }
  }, [])

  return (
    <Window title="Echo caregiver dashboard">
      {loading && <p>Loading events…</p>}
      {error && <p role="alert">Unable to load events: {error}</p>}
      {!loading && !error && events.length === 0 && <p>No events yet.</p>}
      {events.length > 0 && (
        <ol aria-label="Recent events">
          {events.map((event) => (
            <li key={event.id}>
              {new Date(event.created_at).toLocaleTimeString()} · {event.app} · {event.kind} · {event.gesture ?? '—'}
            </li>
          ))}
        </ol>
      )}
    </Window>
  )
}
