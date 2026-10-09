begin;

-- Upgrade the released legacy table in place, preserving every quota value,
-- timestamp and text actor label. Prior labels never imply an Account binding.
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.papa_player_extra_quotas'::regclass
  and conname='papa_player_extra_quotas_space_id_check' and contype='c'
  and pg_get_constraintdef(oid)='CHECK ((space_id = ''space-001''::text))')
 then raise exception 'EXTRA_QUOTA_COMPAT_SCHEMA_INVALID';end if;
end $$;
alter table public.papa_player_extra_quotas drop constraint papa_player_extra_quotas_space_id_check;
alter table public.papa_player_extra_quotas
 add column updated_by_account uuid references public.papa_accounts(id),
 add constraint papa_extra_quota_room_space_fkey foreign key(streamer_id,space_id)
  references public.papa_space_streamers(streamer_id,space_id);

-- Preserve the released session-based signature. Its legacy identity cannot
-- address native profiles or inherit stale attribution from an Account edit.
alter function public.papa_manage_player_extra_quota(bigint,text,text,integer,boolean,text)
 rename to papa_manage_player_extra_quota_legacy_session;
revoke all on function public.papa_manage_player_extra_quota_legacy_session(bigint,text,text,integer,boolean,text)
 from public,anon,authenticated,service_role;
create function public.papa_manage_player_extra_quota(expected bigint,requested_room text,target_player text,
 requested_extra integer,requested_enabled boolean,session_hash text)
returns bigint language plpgsql security definer set search_path=public as $$
declare result bigint;previous_context text;
begin
 if not exists(select 1 from papa_space_streamers where streamer_id=requested_room and space_id='space-001')
 then raise exception 'EXTRA_QUOTA_ROOM_INVALID';end if;
 previous_context=current_setting('papa.actor_context',true);
 perform set_config('papa.actor_context','{}',true);
 result=papa_manage_player_extra_quota_legacy_session(expected,requested_room,target_player,requested_extra,requested_enabled,session_hash);
 if result is distinct from expected then
  update papa_player_extra_quotas set updated_by_account=null
   where streamer_id=requested_room and player_id=target_player and updated_by_account is not null;
 end if;
 perform set_config('papa.actor_context',coalesce(previous_context,''),true);
 return result;
end $$;

-- The existing native guard checks a verified active Account and canonical
-- manager/President authority. Both signatures share the original revision.
create function public.papa_manage_player_extra_quota(expected bigint,requested_room text,target_player text,
 requested_extra integer,requested_enabled boolean,actor_context jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare room_space text;actor_kind text;subject uuid;current_revision bigint;
 room_name text;player_name text;previous jsonb;current_row jsonb;normalized_enabled boolean;previous_context text;
begin
 if expected is null or expected<0 or nullif(requested_room,'') is null or length(requested_room)>200
  or nullif(target_player,'') is null or length(target_player)>200 or requested_extra is null
  or requested_extra not between 0 and 100000 or requested_enabled is null
 then raise exception 'EXTRA_QUOTA_INVALID';end if;
 select space_id into room_space from papa_space_streamers where streamer_id=requested_room;
 if room_space is null then raise exception 'EXTRA_QUOTA_ROOM_INVALID';end if;
 actor_kind=papa_room_native_actor_guard(actor_context,requested_room,room_space);
 if actor_kind not in ('streamer_admin','super_admin') then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 subject=(actor_context->>'account_id')::uuid;
 select revision into current_revision from papa_v2_revision where id=1 for update;
 if current_revision is distinct from expected then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 -- Keep Account/membership authority valid through this same transaction.
 perform 1 from papa_spaces where id=room_space for share;
 perform 1 from papa_space_streamers where streamer_id=requested_room for share;
 perform 1 from papa_accounts where id=subject or id in(select account_id from papa_space_player_profiles
  where space_id=room_space and player_id=target_player) order by id for share;
 perform 1 from papa_space_memberships where id in(select membership_id from papa_space_player_profiles
  where space_id=room_space and player_id=target_player)
  or actor_kind='streamer_admin' and account_id=subject and space_id=room_space and role='streamer_admin'
   and streamer_id=requested_room order by id for share;
 if actor_kind='super_admin' then perform 1 from papa_platform_roles where account_id=subject for share;end if;
 perform papa_room_native_actor_guard(actor_context,requested_room,room_space);
 if not exists(select 1 from papa_space_streamers where streamer_id=requested_room and space_id=room_space)
 then raise exception 'EXTRA_QUOTA_ROOM_INVALID';end if;
 if not papa_communication_player_exists(room_space,target_player) then raise exception 'EXTRA_QUOTA_PLAYER_INVALID';end if;
 select coalesce(case when jsonb_typeof(r->'display_name')='string' then nullif(r->>'display_name','') end,requested_room)
 into room_name from papa_v2_entities m cross join lateral jsonb_array_elements(
  case when jsonb_typeof(m.data->'streamers')='array' then m.data->'streamers' else '[]'::jsonb end) r
 where m.kind='meta' and m.id='1' and r->>'id'=requested_room limit 1;
 if room_name is null then raise exception 'EXTRA_QUOTA_ROOM_INVALID';end if;
 select coalesce(case when jsonb_typeof(source.name)='string' then nullif(source.name#>>'{}','') end,'玩家')
 into player_name from (
  select data->'name' name from papa_v2_entities where room_space='space-001' and kind='players' and id=target_player and space_id is null
  union all select data->'name' from papa_space_player_profiles where room_space<>'space-001' and space_id=room_space and player_id=target_player
 ) source;
 normalized_enabled=requested_enabled and requested_extra>0;
 select jsonb_build_object('streamer_id',streamer_id,'streamer_name',room_name,'playerId',player_id,
  'playerName',player_name,'extra_quota',extra_quota,'enabled',enabled) into previous
 from papa_player_extra_quotas where streamer_id=requested_room and player_id=target_player and space_id=room_space;
 if previous is not null and (previous->>'extra_quota')::integer=requested_extra
  and (previous->>'enabled')::boolean=normalized_enabled then return current_revision;end if;
 insert into papa_player_extra_quotas as quota(streamer_id,player_id,space_id,extra_quota,enabled,updated_by,updated_by_account)
 values(requested_room,target_player,room_space,requested_extra,normalized_enabled,subject::text,subject)
 on conflict(streamer_id,player_id) do update set extra_quota=excluded.extra_quota,enabled=excluded.enabled,
  updated_at=now(),updated_by=case when quota.updated_by_account is null then quota.updated_by else excluded.updated_by end,
  updated_by_account=excluded.updated_by_account;
 current_row=jsonb_build_object('streamer_id',requested_room,'streamer_name',room_name,'playerId',target_player,
  'playerName',player_name,'extra_quota',requested_extra,'enabled',normalized_enabled);
 previous_context=current_setting('papa.actor_context',true);
 perform set_config('papa.actor_context',(actor_context||jsonb_build_object('account_id',subject,'space_id',room_space,
  'streamer_id',requested_room,'action','extraQuota'))::text,true);
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,before_data,after_data)
 values(requested_room,'extra_quota',target_player,'extraQuota',actor_kind,previous,current_row);
 perform set_config('papa.actor_context',coalesce(previous_context,''),true);
 update papa_v2_revision set revision=current_revision+1 where id=1;
 return current_revision+1;
end $$;
revoke all on function public.papa_manage_player_extra_quota(bigint,text,text,integer,boolean,text),
 public.papa_manage_player_extra_quota(bigint,text,text,integer,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.papa_manage_player_extra_quota(bigint,text,text,integer,boolean,text),
 public.papa_manage_player_extra_quota(bigint,text,text,integer,boolean,jsonb) to service_role;

create function public.papa_extra_quota_snapshot_metadata(snapshot jsonb,requested_room text,allowed_space text,quota_player text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room_id text;directory jsonb;grants jsonb;rights jsonb;target_exists boolean;
begin
 if allowed_space is null or nullif(requested_room,'') is null or length(requested_room)>200
  or quota_player is not null and (nullif(quota_player,'') is null or length(quota_player)>200)
  or not exists(select 1 from papa_spaces where id=allowed_space and status='active')
 then raise exception 'UNKNOWN_STREAMER_SPACE';end if;
 select e->'data'->'streamers' into directory from jsonb_array_elements(snapshot->'rows') e where e->>'kind'='meta' and e->>'id'='1';
 directory=case when jsonb_typeof(directory)='array' then directory else '[]'::jsonb end;
 select r->>'id' into room_id from jsonb_array_elements(directory) r
 join papa_space_streamers scope on scope.streamer_id=r->>'id' and scope.space_id=allowed_space
 where r->>'id'=requested_room or r->>'slug'=requested_room limit 1;
 if room_id is null then raise exception 'UNKNOWN_STREAMER_SPACE';end if;
 target_exists=quota_player is not null and papa_communication_player_exists(allowed_space,quota_player);
 with entries as materialized (
  select e->>'kind' kind,e->>'id' id,e->'data' data from jsonb_array_elements(snapshot->'rows') e
 ), known_players as materialized (
  select id from entries where kind='players' and allowed_space='space-001'
  union all select e.id from entries e join papa_space_player_profiles p on p.space_id=allowed_space and p.player_id=e.id
   where e.kind='players' and allowed_space<>'space-001'
 ), participants as materialized (
  select quota_player player_id where quota_player is not null
  union select data->>'playerId' from entries where kind='queue' and data->>'streamer_id'=room_id
   and data->>'kind'='saved' and data->>'status' in ('pending','waiting','completed')
 ), valid_participants as materialized (
  select p.player_id from participants p join known_players player on player.id=p.player_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('streamer_id',q.streamer_id,'player_id',q.player_id,
  'extra_quota',q.extra_quota,'enabled',q.enabled) order by q.player_id),'[]'::jsonb) into grants
 from papa_player_extra_quotas q join valid_participants p on p.player_id=q.player_id
 where q.streamer_id=room_id and q.space_id=allowed_space;
 select coalesce(jsonb_agg(jsonb_build_object('streamer_id',q.streamer_id,'streamer_name',
  coalesce(case when jsonb_typeof(r->'display_name')='string' then nullif(r->>'display_name','') end,q.streamer_id),
  'extra_quota',q.extra_quota) order by q.streamer_id),'[]'::jsonb) into rights
 from papa_player_extra_quotas q join jsonb_array_elements(directory) r on r->>'id'=q.streamer_id
  and coalesce(r->'active','true'::jsonb)='true'::jsonb
 join papa_space_streamers scope on scope.streamer_id=q.streamer_id and scope.space_id=allowed_space
 where q.space_id=allowed_space and q.player_id=quota_player and q.enabled and q.extra_quota>0
  and target_exists;
 return snapshot||jsonb_build_object('extraQuotas',grants,'extraQuotaRights',
  case when quota_player is null or jsonb_array_length(rights)=0 then '{}'::jsonb else jsonb_build_object(quota_player,rights) end);
end $$;
revoke all on function public.papa_extra_quota_snapshot_metadata(jsonb,text,text,text) from public,anon,authenticated,service_role;

-- The released three-argument helper remains legacy-only even when the
-- complete snapshot also contains native rooms with matching player IDs.
create or replace function public.papa_extra_quota_snapshot_metadata(snapshot jsonb,requested_room text,target_player text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;grants jsonb;
begin
 result=papa_extra_quota_snapshot_metadata(snapshot,requested_room,'space-001',target_player);
 select coalesce(jsonb_agg(row||jsonb_build_object('space_id','space-001')),'[]'::jsonb) into grants
  from jsonb_array_elements(result->'extraQuotas') row;
 return result||jsonb_build_object('extraQuotas',grants,'extraQuotaRights',
  case when target_player is null then '{}'::jsonb else jsonb_build_object(target_player,
   coalesce(result->'extraQuotaRights'->target_player,'[]'::jsonb)) end);
end $$;
revoke all on function public.papa_extra_quota_snapshot_metadata(jsonb,text,text) from public,anon,authenticated,service_role;

alter function public.papa_v2_scoped_read_snapshot_in_space(text,text) rename to papa_scoped_snapshot_before_extra_quota;
revoke all on function public.papa_scoped_snapshot_before_extra_quota(text,text) from public,anon,authenticated,service_role;
create function public.papa_v2_scoped_read_snapshot_in_space(requested_room text,allowed_space text default 'space-001')
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_extra_quota_snapshot_metadata(papa_scoped_snapshot_before_extra_quota(requested_room,allowed_space),requested_room,allowed_space,null);
$$;
create function public.papa_v2_scoped_read_snapshot_with_quota(requested_room text,allowed_space text,quota_player text)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_extra_quota_snapshot_metadata(papa_scoped_snapshot_before_extra_quota(requested_room,allowed_space),requested_room,allowed_space,quota_player);
$$;
create function public.papa_v2_room_write_snapshot_with_quota(requested_room text,selected_song_ids text[],allowed_space text,quota_player text)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_extra_quota_snapshot_metadata(papa_v2_room_write_snapshot_in_space(requested_room,selected_song_ids,allowed_space),requested_room,allowed_space,quota_player);
$$;
create or replace function public.papa_v2_scoped_read_snapshot(requested_room text) returns jsonb
language sql stable security definer set search_path=public as $$
 select papa_v2_scoped_read_snapshot_in_space(requested_room,'space-001');
$$;
revoke all on function public.papa_v2_scoped_read_snapshot_in_space(text,text),
 public.papa_v2_scoped_read_snapshot_with_quota(text,text,text),public.papa_v2_room_write_snapshot_with_quota(text,text[],text,text)
 from public,anon,authenticated;
grant execute on function public.papa_v2_scoped_read_snapshot_in_space(text,text),
 public.papa_v2_scoped_read_snapshot_with_quota(text,text,text),public.papa_v2_room_write_snapshot_with_quota(text,text[],text,text)
 to service_role;
notify pgrst,'reload schema';
commit;
