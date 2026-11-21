# Miguel982

## Now
- Issue #4: Supabase events schema and realtime.
- `backend/schema.sql` is implemented and repo checks pass.
- Next: Michael creates the Supabase project and fills root `.env`; then run the SQL in Supabase and execute the acceptance curl.

## Done
- WSL setup, GitHub authentication, sync, and recovery completed.
- SPEC v1 ACKed; ownership is `backend/*` and `dashboard/*`.

## How to run my lane
- Backend: execute `backend/schema.sql` in the Supabase SQL editor.
- Dashboard: `cd dashboard && npm install && npm run dev` (port 5174).
- Required root env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Gotchas and decisions
- Supabase credentials belong only in root `.env`; never commit or post them to the board.
- Anonymous users may INSERT and SELECT events only; no UPDATE or DELETE policies.

## Waiting on
- Michael: create the Supabase project, fill `.env`, and privately share credentials with the team.
