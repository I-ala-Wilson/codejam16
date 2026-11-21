// App -> Supabase events (contracts/events.md). No-op until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY exist.
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const DEVICE = (import.meta.env.VITE_DEVICE_ID as string | undefined) ?? 'demo-ward-1'

// Same-laptop copy of every event, so the in-app caregiver view works with no Supabase and no internet.
const local = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('echo-events')
export type LocalEvent = { app: string; kind: string; payload: Record<string, unknown>; gesture: string | null; at: number; device_id: string }
export const onLocalEvent = (cb: (e: LocalEvent) => void) => {
  const ch = new BroadcastChannel('echo-events'); ch.onmessage = (m) => cb(m.data as LocalEvent); return () => ch.close()
}

export async function sendEvent(app: 'care' | 'lock' | 'habit' | 'engine', kind: string, payload: object = {}, gesture?: string) {
  const row = { device_id: DEVICE, app, kind, gesture: gesture ?? null, payload }
  local?.postMessage({ ...row, at: Date.now() })
  if (!URL_ || !KEY) { console.info('[events] Supabase not configured, would send', row); return }
  try {
    await fetch(`${URL_}/rest/v1/events`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    })
  } catch (e) { console.warn('[events] send failed', e) }
}
