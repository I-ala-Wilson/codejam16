# Miguel982

## Now
- CARE communication board in `app/src/Care.tsx`, `app/src/Caregiver.tsx`, `app/src/care/*`, and `dashboard/*`.
- SPEC v6. Next: Dell Secret Lock live test, then guest Dataset recordings with EJ.

## Done
- WSL setup, GitHub authentication, sync, and recovery completed.
- SPEC v1 ACKed; ownership is `backend/*` and `dashboard/*`.
- Issue #4: events schema, realtime publication, RLS, anon SELECT/INSERT grants, and HTTP 201 live acceptance.
- Issue #8: dashboard loads the latest 50 events, receives realtime inserts, and implements the expanded caregiver display (HELP takeover/beep/cancel, inactivity, 60-sample activity strip, filtered feed, phone styling); live HELP delivered in 421 ms.
- Production dashboard: https://dashboard-pi-six-14.vercel.app
- Issue #10 closed after Michael verified Care and Parent alerts on his phone. Real insert-to-display checks on desktop at phone width took 103–676 ms.
- Issue #29 closed: an offline mic stops producing activity and inactivity events; the dashboard flags missing readings. Repeated WAVEs during one HELP cancellation window now send one alert (7c50356).
- CARE maps WAVE to HELP, OPEN_CLOSE to PAIN, PUSH to YES and PULL to NO. UNDO or a double PUSH cancels within five seconds.
- Five Dell breathing takes validated as mono 16-bit PCM at 48 kHz and pushed under `data/recordings/Miguel982/breath/`.
- Two 14-take Dell gesture batteries pushed under `data/recordings/Miguel982/` (f480e97, e8cadcf). Yahya accepted all 14 takes from battery1.

## How to run my lane
- Backend: execute `backend/schema.sql` in the Supabase SQL editor.
- Dashboard: `cd dashboard && npm install && npm run dev` (port 5174).
- Required root env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Gotchas and decisions
- Supabase credentials belong only in root `.env`; never commit or post them to the board.
- Anonymous users may INSERT and SELECT events only; no UPDATE or DELETE policies.

## Waiting on
- Michael: report successful real-hand unlocks out of five and blank locked loads out of ten. Finish with Unlock now. Automated tests with injected signs do not supply the real-hand count.
