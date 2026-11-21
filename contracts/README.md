# Contracts

The exact interfaces between lanes. Owned by the lead; changes need a NEED to I-ala-Wilson and a SPEC bump.

- `engine.ts`: sonar engine API and gesture events (engine/ implements, app/ uses)
- `events.md`: Supabase `events` table + realtime (backend/ + dashboard/ implement, app/ inserts)
- `extension.md`: app <-> Chrome extension messages (extension/ + app/)
- `recording.md`: recorded session files (engine/ writes, ml/ + qa/ read)
