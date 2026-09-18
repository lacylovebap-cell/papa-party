-- Additive migration: retain V1 and an immutable cutover snapshot.
create table if not exists public.papa_v1_cutover_backup (
 id bigint generated always as identity primary key,
 captured_at timestamptz not null default now(), data jsonb not null
);
alter table public.papa_v1_cutover_backup enable row level security;
revoke all on public.papa_v1_cutover_backup from anon, authenticated;
grant all on public.papa_v1_cutover_backup to service_role;
insert into public.papa_v1_cutover_backup(data)
select data from public.party_state where id=1
and not exists (select 1 from public.papa_v1_cutover_backup);
create index if not exists papa_room_kind on public.papa_v2_entities(kind,(data->>'streamer_id'));
create index if not exists papa_room_player on public.papa_v2_entities((data->>'streamer_id'),(data->>'playerId'));
create index if not exists papa_room_song on public.papa_v2_entities((data->>'streamer_id'),(data->>'songId'));
create index if not exists papa_room_status on public.papa_v2_entities((data->>'streamer_id'),(data->>'status'));
create index if not exists papa_room_time on public.papa_v2_entities((data->>'streamer_id'),(data->>'at'));
-- Streamer definitions and each room's settings live in service-only meta JSON.
-- Every operational entity carries streamer_id; players remain platform-wide.
