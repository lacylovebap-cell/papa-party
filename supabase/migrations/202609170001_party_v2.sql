-- Run after a database backup. V1 is left intact for export/rollback; V2 never writes it.
create table if not exists public.papa_v2_entities (
 kind text not null check(kind in ('players','songs','ledger','queue','crowns','cards','wishes','settings','meta')),
 id text not null, data jsonb not null, primary key(kind,id)
);
create table if not exists public.papa_v2_revision(id int primary key check(id=1), revision bigint not null default 0);
insert into public.papa_v2_revision values(1,0) on conflict do nothing;
create table if not exists public.papa_v2_sessions(token_hash text primary key,player_id text not null,login_id text,expires_at timestamptz not null);
alter table public.papa_v2_entities enable row level security;
alter table public.papa_v2_revision enable row level security;
alter table public.papa_v2_sessions enable row level security;
revoke all on public.papa_v2_entities, public.papa_v2_revision, public.papa_v2_sessions from anon, authenticated;
grant all on public.papa_v2_entities, public.papa_v2_revision, public.papa_v2_sessions to service_role;
create or replace function public.papa_v2_commit(expected bigint, changes jsonb, removed jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare current_version bigint; r jsonb;
begin
 select revision into current_version from papa_v2_revision where id=1 for update;
 if current_version <> expected then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 for r in select value from jsonb_array_elements(changes) loop
  insert into papa_v2_entities(kind,id,data) values(r->>'kind',r->>'id',r->'data')
  on conflict(kind,id) do update set data=excluded.data;
 end loop;
 for r in select value from jsonb_array_elements(removed) loop
  delete from papa_v2_entities where kind=r->>'kind' and id=r->>'id';
 end loop;
 update papa_v2_revision set revision=current_version+1 where id=1;
 return current_version+1;
end $$;
revoke all on function public.papa_v2_commit(bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.papa_v2_commit(bigint,jsonb,jsonb) to service_role;
-- A consistent snapshot avoids combining records and revision from different transactions.
create or replace function public.papa_v2_snapshot() returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('revision',(select revision from papa_v2_revision where id=1),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',id,'data',data)) from papa_v2_entities),'[]'::jsonb));
$$;
revoke all on function public.papa_v2_snapshot() from public,anon,authenticated;
grant execute on function public.papa_v2_snapshot() to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('papa-photos','papa-photos',true,3145728,array['image/webp','image/jpeg','image/png']) on conflict(id) do nothing;
-- No client upload policy: only the administrator endpoint writes photos.
