# Miguel982

## Now
- Issue #10: dashboard Care + Parent views with alert banners.
- Next: build the two filtered views on top of the realtime event list and test each event kind.

## Done
- WSL setup, GitHub authentication, sync, and recovery completed.
- SPEC v1 ACKed; ownership is `backend/*` and `dashboard/*`.
- Issue #4: events schema, realtime publication, RLS, anon SELECT/INSERT grants, and HTTP 201 live acceptance.
- Issue #8: dashboard loads the latest 50 events and receives realtime inserts; live smoke test delivered in 790 ms.

## How to run my lane
- Backend: execute `backend/schema.sql` in the Supabase SQL editor.
- Dashboard: `cd dashboard && npm install && npm run dev` (port 5174).
- Required root env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Gotchas and decisions
- Supabase credentials belong only in root `.env`; never commit or post them to the board.
- Anonymous users may INSERT and SELECT events only; no UPDATE or DELETE policies.

## Waiting on
- None.
