begin;

-- Production's legacy identities remain authoritative. This standalone
-- release requires no Account, Membership, native profile, or Space tables.
insert into public.papa_release_backups(release,snapshot)
 values('10.09-QUOTA-before',public.papa_v2_snapshot()) on conflict do nothing;
create table public.papa_player_extra_quotas (
 streamer_id text not null check(length(streamer_id) between 1 and 200),
 player_id text not null check(length(player_id) between 1 and 200),
 space_id text not null default 'space-001' check(space_id='space-001'),
 extra_quota integer not null check(extra_quota between 0 and 100000),
 enabled boolean not null default true,
 updated_at timestamptz not null default now(),updated_by text not null,
 primary key(streamer_id,player_id)
);
create index papa_extra_quota_player_space on public.papa_player_extra_quotas(space_id,player_id)
 where enabled and extra_quota>0;
alter table public.papa_player_extra_quotas enable row level security;
revoke all on public.papa_player_extra_quotas from public,anon,authenticated;
grant select,insert,update on public.papa_player_extra_quotas to service_role;

create function public.papa_manage_player_extra_quota(expected bigint,requested_room text,target_player text,
 requested_extra integer,requested_enabled boolean,session_hash text)
returns bigint language plpgsql security definer set search_path=public as $$
declare current_revision bigint;actor_id text;actor_role text;actor_room text;
 room_name text;player_name text;previous jsonb;current_row jsonb;normalized_enabled boolean;
begin
 if expected is null or expected<0 or nullif(requested_room,'') is null or length(requested_room)>200
  or nullif(target_player,'') is null or length(target_player)>200
  or requested_extra is null or requested_extra not between 0 and 100000 or requested_enabled is null
 then raise exception 'EXTRA_QUOTA_INVALID';end if;
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception 'EXTRA_QUOTA_ACTOR_INVALID';end if;
 -- Share the original commit lock with requests, history edits and settings.
 select revision into current_revision from papa_v2_revision where id=1 for update;
 if current_revision is distinct from expected then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 select s.player_id,s.role,s.streamer_id into actor_id,actor_role,actor_room
 from papa_v2_sessions s where s.token_hash=session_hash and s.expires_at>now() for share;
 if actor_id='__admin__' and coalesce(actor_role,'super_admin')='super_admin' then actor_role='super_admin';
 elsif actor_role='streamer_admin' and actor_room=requested_room and actor_id='__streamer__:'||requested_room then
  perform 1 from papa_streamer_accounts where streamer_id=requested_room and enabled for share;
  if not found then raise exception 'EXTRA_QUOTA_ACTOR_INVALID';end if;
 else raise exception 'EXTRA_QUOTA_ACTOR_INVALID';end if;
 select coalesce(case when jsonb_typeof(r->'display_name')='string' then nullif(r->>'display_name','') end,requested_room)
 into room_name from papa_v2_entities m cross join lateral jsonb_array_elements(
  case when jsonb_typeof(m.data->'streamers')='array' then m.data->'streamers' else '[]'::jsonb end) r
 where m.kind='meta' and m.id='1' and r->>'id'=requested_room limit 1;
 if room_name is null then raise exception 'EXTRA_QUOTA_ROOM_INVALID';end if;
 select coalesce(case when jsonb_typeof(data->'name')='string' then nullif(data->>'name','') end,'玩家')
 into player_name from papa_v2_entities where kind='players' and id=target_player;
 if player_name is null then raise exception 'EXTRA_QUOTA_PLAYER_INVALID';end if;
 normalized_enabled=requested_enabled and requested_extra>0;
 select jsonb_build_object('streamer_id',streamer_id,'streamer_name',room_name,'playerId',player_id,
  'playerName',player_name,'extra_quota',extra_quota,'enabled',enabled) into previous
 from papa_player_extra_quotas where streamer_id=requested_room and player_id=target_player;
 if previous is not null and (previous->>'extra_quota')::integer=requested_extra
  and (previous->>'enabled')::boolean=normalized_enabled then return current_revision;end if;
 insert into papa_player_extra_quotas(streamer_id,player_id,extra_quota,enabled,updated_by)
 values(requested_room,target_player,requested_extra,normalized_enabled,actor_id)
 on conflict(streamer_id,player_id) do update set extra_quota=excluded.extra_quota,enabled=excluded.enabled,
  updated_at=now(),updated_by=excluded.updated_by;
 current_row=jsonb_build_object('streamer_id',requested_room,'streamer_name',room_name,'playerId',target_player,
  'playerName',player_name,'extra_quota',requested_extra,'enabled',normalized_enabled);
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,before_data,after_data)
 values(requested_room,'extra_quota',target_player,'extraQuota',actor_role,actor_id,previous,current_row);
 update papa_v2_revision set revision=current_revision+1 where id=1;
 return current_revision+1;
end $$;
revoke all on function public.papa_manage_player_extra_quota(bigint,text,text,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.papa_manage_player_extra_quota(bigint,text,text,integer,boolean,text) to service_role;

create function public.papa_extra_quota_snapshot_metadata(snapshot jsonb,requested_room text,target_player text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare directory jsonb;room_id text;grants jsonb;rights jsonb;
begin
 if nullif(requested_room,'') is null or length(requested_room)>200
  or target_player is not null and (nullif(target_player,'') is null or length(target_player)>200)
 then raise exception 'EXTRA_QUOTA_INVALID';end if;
 select e->'data'->'streamers' into directory from jsonb_array_elements(snapshot->'rows') e
 where e->>'kind'='meta' and e->>'id'='1';
 select r->>'id' into room_id from jsonb_array_elements(
  case when jsonb_typeof(directory)='array' then directory else '[]'::jsonb end) r
 where r->>'id'=requested_room or r->>'slug'=requested_room limit 1;
 if room_id is null then raise exception 'EXTRA_QUOTA_ROOM_INVALID';end if;
 if target_player is not null and not exists(select 1 from jsonb_array_elements(snapshot->'rows') e
  where e->>'kind'='players' and e->>'id'=target_player) then raise exception 'EXTRA_QUOTA_PLAYER_INVALID';end if;
 -- Core already receives these queue rows. Only their distinct saved-song
 -- participants (plus the selected player) need current-room allowance caps.
 with entries as materialized (
  select e->>'kind' kind,e->>'id' id,e->'data' data from jsonb_array_elements(snapshot->'rows') e
 ), known_players as materialized (
  select id from entries where kind='players'
 ), participants as materialized (
  select target_player player_id where target_player is not null
  union
  select data->>'playerId' from entries
  where kind='queue' and data->>'streamer_id'=room_id and data->>'kind'='saved'
   and data->>'status' in ('pending','waiting','completed')
 ), valid_participants as materialized (
  select p.player_id from participants p join known_players player on player.id=p.player_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('streamer_id',q.streamer_id,'player_id',q.player_id,
  'space_id',q.space_id,'extra_quota',q.extra_quota,'enabled',q.enabled) order by q.player_id),'[]'::jsonb)
 into grants from papa_player_extra_quotas q join valid_participants p on p.player_id=q.player_id where q.streamer_id=room_id;
 select coalesce(jsonb_agg(jsonb_build_object('streamer_id',q.streamer_id,'streamer_name',
  coalesce(case when jsonb_typeof(r->'display_name')='string' then nullif(r->>'display_name','') end,q.streamer_id),
  'extra_quota',q.extra_quota) order by q.streamer_id),'[]'::jsonb) into rights
 from papa_player_extra_quotas q join jsonb_array_elements(
  case when jsonb_typeof(directory)='array' then directory else '[]'::jsonb end) r on r->>'id'=q.streamer_id
  and coalesce(r->'active','true'::jsonb)='true'::jsonb
 where q.player_id=target_player and q.enabled and q.extra_quota>0;
 return snapshot||jsonb_build_object('extraQuotas',grants,'extraQuotaRights',
  case when target_player is null then '{}'::jsonb else jsonb_build_object(target_player,rights) end);
end $$;
revoke all on function public.papa_extra_quota_snapshot_metadata(jsonb,text,text) from public,anon,authenticated,service_role;

-- Preserve full backup rows, including inactive quota rights and audit labels.
-- Ordinary full/lean reads below call the original entity snapshot directly.
alter function public.papa_v2_snapshot() rename to papa_v2_snapshot_before_extra_quota;
revoke all on function public.papa_v2_snapshot_before_extra_quota() from public,anon,authenticated,service_role;
create function public.papa_v2_snapshot() returns jsonb
language sql stable security definer set search_path=public as $$
 select papa_v2_snapshot_before_extra_quota()||jsonb_build_object('extraQuotas',coalesce(
  (select jsonb_agg(jsonb_build_object('streamer_id',streamer_id,'player_id',player_id,'space_id',space_id,
   'extra_quota',extra_quota,'enabled',enabled,'updated_at',updated_at,'updated_by',updated_by)
   order by streamer_id,player_id) from papa_player_extra_quotas),'[]'::jsonb));
$$;
create function public.papa_v2_quota_snapshot(lean boolean default true,requested_room text default 'papa',target_player text default null)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_extra_quota_snapshot_metadata(case when lean then papa_v2_read_snapshot()
  else papa_v2_snapshot_before_extra_quota() end,requested_room,target_player);
$$;
revoke all on function public.papa_v2_snapshot(),public.papa_v2_quota_snapshot(boolean,text,text) from public,anon,authenticated;
grant execute on function public.papa_v2_snapshot(),public.papa_v2_quota_snapshot(boolean,text,text) to service_role;
notify pgrst,'reload schema';
commit;
