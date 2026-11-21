# CONTRACT: events table and realtime (Supabase)

One table. The app (sensing laptop) inserts; the dashboard subscribes. backend/ owns the SQL; this file is the agreement.

```sql
create table public.events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  device_id   text not null,          -- e.g. 'ward-3-bed-2' or 'home-ipad'; free text, no accounts
  app         text not null check (app in ('care','lock','habit','engine')),
  kind        text not null,          -- see table below
  gesture     text,                   -- GestureType from contracts/engine.ts, when relevant
  payload     jsonb not null default '{}'
);
alter publication supabase_realtime add table public.events;
-- RLS: enabled; anon may INSERT and SELECT (demo, no accounts). No UPDATE/DELETE.
```

| app | kind | when | payload |
|---|---|---|---|
| care | `help` | patient does the help gesture (WAVE >= 2 s) | `{confidence}` |
| care | `help_cancelled` | double tap (UNDO) within 5 s of a help | `{}` |
| care | `inactive` | no motion for N s (demo: 30 s) | `{seconds}` |
| care | `activity` | every 10 s while running | `{level: 0..1, gestures: n}` |
| lock | `unlock_ok` | correct secret sequence | `{}` |
| lock | `unlock_fail` | wrong sequence | `{attempt: n}` |
| lock | `alarm` | 3 failed attempts in a row | `{attempts: 3}` |
| habit | `habit_detected` | REPETITIVE gesture while habit mode is on | `{seconds, habit: 'scratching'}` |
| habit | `snoozed` | UNDO gesture after a nudge | `{}` |
| engine | `test` | M1 smoke test | `{hello: 'world'}` |

Env vars (values only in `.env`, never committed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Dashboard subscribes with `supabase.channel('events').on('postgres_changes', {event:'INSERT', schema:'public', table:'events'}, cb)` and must show a new event within 1 s.
