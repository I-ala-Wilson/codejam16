# Miguel982

## Now
- Issue #8: dashboard realtime event list.
- Next: add `dashboard/src/supabase.ts`, load the latest 50 events, and subscribe to realtime inserts in `dashboard/src/App.tsx`.

## Done
- WSL setup, GitHub authentication, sync, and recovery completed.
- SPEC v1 ACKed; ownership is `backend/*` and `dashboard/*`.
- Issue #4: events schema, realtime publication, RLS, anon SELECT/INSERT grants, and HTTP 201 live acceptance.

## How to run my lane
- Backend: execute `backend/schema.sql` in the Supabase SQL editor.
- Dashboard: `cd dashboard && npm install && npm run dev` (port 5174).
- Required root env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Gotchas and decisions
- Supabase credentials belong only in root `.env`; never commit or post them to the board.
- Anonymous users may INSERT and SELECT events only; no UPDATE or DELETE policies.

## Waiting on
- None.
