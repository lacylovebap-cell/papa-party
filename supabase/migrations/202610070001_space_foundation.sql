begin;

-- Phase 1 bridge only. Existing APIs continue to use streamer_id and the
-- unchanged JSON entity contract. No player account is inferred from a name.
create table public.papa_spaces (
 id text primary key,
 slug text not null unique,
 display_name text not null,
 status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now()
);
insert into public.papa_spaces(id,slug,display_name)
values('space-001','papa-party','PA Party')
on conflict(id) do nothing;

create table public.papa_space_streamers (
 streamer_id text primary key,
 space_id text not null references public.papa_spaces(id),
 created_at timestamptz not null default now(),
 unique(streamer_id,space_id)
);
insert into public.papa_space_streamers(streamer_id,space_id)
select distinct streamer_id,'space-001' from (
 select value->>'id' as streamer_id
 from public.papa_v2_entities e
 cross join lateral jsonb_array_elements(
  case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end
 ) as room(value)
 where e.kind='meta'
 union
 select e.data->>'streamer_id' from public.papa_v2_entities e
 where e.kind in ('songs','ledger','queue','crowns','cards','wishes')
 union select 'papa'
) existing where streamer_id is not null and streamer_id<>''
on conflict(streamer_id) do nothing;

-- Account is a login identity; player business rows remain separate. Legacy
-- player IDs can be bound after a verified login, never guessed by name.
create table public.papa_accounts (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 disabled_at timestamptz
);
create table public.papa_account_legacy_players (
 account_id uuid primary key references public.papa_accounts(id),
 legacy_player_id text not null unique,
 verified_at timestamptz not null default now()
);
create table public.papa_space_memberships (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.papa_accounts(id),
 space_id text not null references public.papa_spaces(id),
 role text not null check(role in ('player','streamer_admin','space_admin')),
 streamer_id text,
 status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now(),
 check((role='streamer_admin')=(streamer_id is not null)),
 foreign key(streamer_id,space_id) references public.papa_space_streamers(streamer_id,space_id)
);
create unique index papa_membership_player_unique on public.papa_space_memberships(account_id,space_id,role)
where streamer_id is null;
create unique index papa_membership_streamer_unique on public.papa_space_memberships(account_id,space_id,role,streamer_id)
where streamer_id is not null;
create index papa_membership_space_active on public.papa_space_memberships(space_id,role,account_id)
where status='active';
create table public.papa_platform_roles (
 account_id uuid primary key references public.papa_accounts(id),
 role text not null check(role='president'),
 granted_at timestamptz not null default now()
);

-- A physical Space key on legacy operational rows makes the existing data's
-- Space 001 ownership explicit without changing the old snapshot payload.
alter table public.papa_v2_entities
 add column space_id text references public.papa_spaces(id);
update public.papa_v2_entities e set space_id=m.space_id
from public.papa_space_streamers m
where e.kind in ('songs','ledger','queue','crowns','cards','wishes')
 and e.data->>'streamer_id'=m.streamer_id;
do $$ begin
 if exists(select 1 from public.papa_v2_entities
  where kind in ('songs','ledger','queue','crowns','cards','wishes') and space_id is null)
 then raise exception 'SPACE_BACKFILL_INCOMPLETE'; end if;
end $$;
alter table public.papa_v2_entities
 add constraint papa_entity_space_scope check (
  (kind in ('players','settings','meta') and space_id is null)
  or (kind in ('songs','ledger','queue','crowns','cards','wishes') and space_id is not null)
 );
create index papa_entity_space_kind on public.papa_v2_entities(space_id,kind,id)
where space_id is not null;

create function public.papa_entity_space_guard() returns trigger
language plpgsql set search_path=public as $$
declare mapped text;
begin
 if new.kind in ('players','settings','meta') then
  new.space_id:=null;
  return new;
 end if;
 select m.space_id into mapped from papa_space_streamers m
 where m.streamer_id=new.data->>'streamer_id';
 if mapped is null then raise exception 'UNKNOWN_STREAMER_SPACE'; end if;
 if new.space_id is not null and new.space_id<>mapped then
  raise exception 'SPACE_SCOPE_MISMATCH';
 end if;
 if tg_op='UPDATE' and old.space_id is distinct from mapped then
  raise exception 'SPACE_MOVE_REQUIRES_EXPLICIT_MIGRATION';
 end if;
 new.space_id:=mapped;
 return new;
end $$;
create trigger papa_entity_space_guard_trigger
before insert or update on public.papa_v2_entities
for each row execute function public.papa_entity_space_guard();

-- Legacy "add streamer" saves meta first; keep that path usable in Space 001.
-- A future Space creator must insert an explicit mapping before its meta row.
create function public.papa_legacy_streamer_space_map() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.kind='meta' then
  insert into papa_space_streamers(streamer_id,space_id)
  select distinct value->>'id','space-001'
  from jsonb_array_elements(
   case when jsonb_typeof(new.data->'streamers')='array' then new.data->'streamers' else '[]'::jsonb end
  ) as room(value)
  where value->>'id' is not null and value->>'id'<>''
  on conflict(streamer_id) do nothing;
 end if;
 return new;
end $$;
create trigger papa_legacy_streamer_space_map_trigger
after insert or update of data on public.papa_v2_entities
for each row when (new.kind='meta')
execute function public.papa_legacy_streamer_space_map();

-- Edge must first authenticate an Account, then pass that verified account ID.
-- These functions are service-only: an arbitrary browser cannot enumerate
-- Spaces by choosing somebody else's account ID.
create function public.papa_account_space_list(subject uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'slug',s.slug,'name',s.display_name)
  order by s.slug),'[]'::jsonb)
 from papa_spaces s where s.status='active' and (
  exists(select 1 from papa_platform_roles p where p.account_id=subject and p.role='president')
  or exists(select 1 from papa_space_memberships m
   where m.account_id=subject and m.space_id=s.id and m.status='active')
 );
$$;
create function public.papa_account_space_by_slug(subject uuid,requested_slug text) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',s.id,'slug',s.slug,'name',s.display_name)
 from papa_spaces s where s.slug=requested_slug and s.status='active' and (
  exists(select 1 from papa_platform_roles p where p.account_id=subject and p.role='president')
  or exists(select 1 from papa_space_memberships m
   where m.account_id=subject and m.space_id=s.id and m.status='active')
 ) limit 1;
$$;
revoke all on function public.papa_account_space_list(uuid),public.papa_account_space_by_slug(uuid,text)
 from public,anon,authenticated;
grant execute on function public.papa_account_space_list(uuid),public.papa_account_space_by_slug(uuid,text)
 to service_role;

alter table public.papa_spaces enable row level security;
alter table public.papa_space_streamers enable row level security;
alter table public.papa_accounts enable row level security;
alter table public.papa_account_legacy_players enable row level security;
alter table public.papa_space_memberships enable row level security;
alter table public.papa_platform_roles enable row level security;
revoke all on public.papa_spaces,public.papa_space_streamers,public.papa_accounts,
 public.papa_account_legacy_players,public.papa_space_memberships,public.papa_platform_roles
 from public,anon,authenticated;
grant all on public.papa_spaces,public.papa_space_streamers,public.papa_accounts,
 public.papa_account_legacy_players,public.papa_space_memberships,public.papa_platform_roles
 to service_role;

commit;
