create table public.events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  device_id   text not null,
  app         text not null check (app in ('care','lock','habit','engine')),
  kind        text not null,
  gesture     text,
  payload     jsonb not null default '{}'
);

alter publication supabase_realtime add table public.events;

alter table public.events enable row level security;

grant select, insert on table public.events to anon;

create policy "anon can insert events"
on public.events
for insert
to anon
with check (true);

create policy "anon can select events"
on public.events
for select
to anon
using (true);
