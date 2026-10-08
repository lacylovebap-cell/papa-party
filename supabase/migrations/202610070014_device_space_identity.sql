begin;

-- Resolve a business player from Account + active Membership + Space, never
-- from the global legacy player ID alone. Existing Space 001 IDs stay intact.
create function papa_account_player_in_space(subject uuid,chosen_space text) returns text
language plpgsql stable security definer set search_path=public as $$
declare result text;
begin
 if not exists(select 1 from papa_accounts a join papa_space_memberships m on m.account_id=a.id
  join papa_spaces s on s.id=m.space_id where a.id=subject and a.disabled_at is null
  and m.space_id=chosen_space and m.role='player' and m.status='active' and s.status='active')
 then return null;end if;
 if chosen_space='space-001' then select legacy_player_id into result from papa_account_legacy_players where account_id=subject;
 else select player_id into result from papa_space_player_profiles where account_id=subject and space_id=chosen_space;end if;
 return result;
end $$;

create or replace function public.papa_start_device_session(
 subject uuid,chosen_installation uuid,chosen_platform text,chosen_version text,
 chosen_role text,chosen_space text,chosen_streamer text,new_refresh_hash text,
 chosen_login_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare existing_platform text; chosen_kind text; new_session uuid;
begin
 if chosen_installation is null or chosen_platform not in ('web','android','desktop','ios')
  or length(coalesce(chosen_version,''))>64
  or new_refresh_hash !~ '^[a-f0-9]{64}$'
 then raise exception 'DEVICE_START_INVALID'; end if;
 if chosen_role not in ('player','president','streamer_admin')
 then raise exception 'DEVICE_ROLE_UNSUPPORTED'; end if;
 chosen_kind:=case when chosen_role='player' then 'player' else 'manager' end;
 perform pg_advisory_xact_lock(hashtext('installation:'||chosen_installation::text));
 select platform into existing_platform from public.papa_installations
 where id=chosen_installation for update;
 if existing_platform is not null and existing_platform<>chosen_platform
 then raise exception 'INSTALLATION_PLATFORM_MISMATCH'; end if;
 if exists(select 1 from public.papa_device_sessions
  where installation_id=chosen_installation and session_kind=chosen_kind
   and revoked_at is null and account_id<>subject)
 then raise exception 'INSTALLATION_ACCOUNT_CONFLICT'; end if;
 if chosen_role='player' and papa_account_player_in_space(subject,chosen_space) is null
  or chosen_role='president' and not exists(select 1 from public.papa_manager_account_links
   where account_id=subject and manager_key='president')
  or chosen_role='streamer_admin' and not exists(select 1 from public.papa_manager_account_links
   where account_id=subject and manager_key='streamer:'||chosen_streamer)
 then raise exception 'DEVICE_IDENTITY_MISMATCH'; end if;
 if chosen_role='player' and chosen_space<>'space-001' and not exists(
  select 1 from papa_space_player_profiles where account_id=subject and space_id=chosen_space
   and coalesce(data->'ids','[]'::jsonb) ? coalesce(chosen_login_id,''))
 then chosen_login_id='';end if;
 insert into public.papa_installations(id,platform,app_version)
 values(chosen_installation,chosen_platform,coalesce(chosen_version,''))
 on conflict(id) do update set app_version=excluded.app_version,last_seen_at=now();
 if chosen_role='streamer_admin' and not exists(select 1 from public.papa_streamer_accounts
  where streamer_id=chosen_streamer and enabled)
 then raise exception 'STREAMER_DISABLED'; end if;
 update public.papa_device_sessions set revoked_at=now()
 where installation_id=chosen_installation and session_kind=chosen_kind
  and revoked_at is null;
 insert into public.papa_device_sessions(
  installation_id,account_id,session_kind,role,space_id,streamer_id,
  refresh_hash,expires_at,login_id)
 values(chosen_installation,subject,chosen_kind,chosen_role,
  chosen_space,chosen_streamer,new_refresh_hash,now()+interval '90 days',
  case when chosen_role='player' then coalesce(chosen_login_id,'') else '' end)
 returning id into new_session;
 return jsonb_build_object('sessionId',new_session,'installationId',chosen_installation,
  'kind',chosen_kind,'role',chosen_role,'spaceId',chosen_space,
  'streamerId',chosen_streamer);
end $$;

create or replace function public.papa_refresh_device_access(
 chosen_session uuid,old_refresh_hash text,new_refresh_hash text,new_access_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare refreshed jsonb; canonical_player text; canonical_role text;
begin
 if new_access_hash !~ '^[a-f0-9]{64}$' then raise exception 'ACCESS_HASH_INVALID'; end if;
 refreshed=public.papa_rotate_device_session(chosen_session,old_refresh_hash,new_refresh_hash);
 if refreshed is null then return null; end if;
 if refreshed->>'role'='player' then
  canonical_player=papa_account_player_in_space((refreshed->>'accountId')::uuid,refreshed->>'spaceId');
  canonical_role:='player';
 elsif refreshed->>'role'='president' then
  if not exists(select 1 from public.papa_manager_account_links
   where account_id=(refreshed->>'accountId')::uuid and manager_key='president')
  then raise exception 'DEVICE_IDENTITY_MISMATCH'; end if;
  canonical_player:='__admin__';canonical_role:='super_admin';
 elsif refreshed->>'role'='streamer_admin' then
  if not exists(select 1 from public.papa_manager_account_links
   where account_id=(refreshed->>'accountId')::uuid
    and manager_key='streamer:'||(refreshed->>'streamerId'))
   or not exists(select 1 from public.papa_streamer_accounts
    where streamer_id=refreshed->>'streamerId' and enabled)
  then raise exception 'DEVICE_IDENTITY_MISMATCH'; end if;
  canonical_player:='__streamer__:'||(refreshed->>'streamerId');
  canonical_role:='streamer_admin';
 else raise exception 'DEVICE_ROLE_UNSUPPORTED'; end if;
 if canonical_player is null then raise exception 'DEVICE_IDENTITY_MISMATCH'; end if;
 insert into public.papa_v2_sessions(
  token_hash,player_id,login_id,role,streamer_id,expires_at,account_id,device_session_id)
 values(new_access_hash,canonical_player,coalesce(refreshed->>'loginId',''),canonical_role,
  nullif(refreshed->>'streamerId',''),now()+interval '12 hours',
  (refreshed->>'accountId')::uuid,chosen_session);
 return refreshed||jsonb_build_object('playerId',case when canonical_role='player' then canonical_player else null end);
end $$;

create or replace function public.papa_verified_session_actor(session_hash text,requested_room text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare sess public.papa_v2_sessions%rowtype; device public.papa_device_sessions%rowtype;
 scope_id text; actor_role text; requested_id text; requested_space text;
begin
 if session_hash !~ '^[a-f0-9]{64}$' then return null; end if;
 select * into sess from public.papa_v2_sessions
 where token_hash=session_hash and expires_at>now();
 if not found then return null; end if;
 if sess.player_id='__admin__' and coalesce(sess.role,'super_admin')='super_admin' then
  actor_role:='super_admin';
 elsif sess.role='streamer_admin' and sess.streamer_id is not null
  and sess.player_id='__streamer__:'||sess.streamer_id
  and exists(select 1 from public.papa_streamer_accounts
   where streamer_id=sess.streamer_id and enabled) then
  actor_role:='streamer_admin';
  select space_id into scope_id from public.papa_space_streamers
   where streamer_id=sess.streamer_id;
  if scope_id is null then return null; end if;
 elsif coalesce(sess.role,'player')='player' and sess.player_id not in ('__admin__','')
  and sess.player_id not like '__streamer__:%' then
  actor_role:='player';scope_id:='space-001';
 else return null; end if;
 if sess.device_session_id is not null then
  select * into device from public.papa_device_sessions
   where id=sess.device_session_id and account_id=sess.account_id
    and revoked_at is null and expires_at>now();
  if not found or (actor_role='super_admin' and device.role<>'president')
   or (actor_role='streamer_admin' and
    (device.role<>'streamer_admin' or device.streamer_id<>sess.streamer_id
     or device.space_id<>scope_id))
   or (actor_role='player' and device.role<>'player')
  then return null; end if;
  if actor_role='player' then scope_id:=device.space_id; end if;
 end if;
 if sess.account_id is null then
  if scope_id is not null and scope_id<>'space-001' then return null; end if;
 else
  if not exists(select 1 from public.papa_accounts
   where id=sess.account_id and disabled_at is null) then return null; end if;
  if actor_role='player' then
   if sess.player_id is distinct from papa_account_player_in_space(sess.account_id,scope_id)
   then return null; end if;
  elsif not exists(select 1 from public.papa_manager_account_links
   where account_id=sess.account_id and manager_key=
    (case when actor_role='super_admin' then 'president' else 'streamer:'||sess.streamer_id end))
  then return null; end if;
  if actor_role='super_admin' then
   if not exists(select 1 from public.papa_platform_roles
    where account_id=sess.account_id and role='president') then return null; end if;
  elsif not exists(select 1 from public.papa_space_memberships m
   join public.papa_spaces s on s.id=m.space_id
   where m.account_id=sess.account_id and m.space_id=scope_id
    and m.role=actor_role and m.status='active' and s.status='active'
    and (m.streamer_id is not distinct from
     (case when actor_role='streamer_admin' then sess.streamer_id else null end))) then
   return null;
  end if;
 end if;
 if nullif(requested_room,'') is not null then
  select room->>'id' into requested_id from public.papa_v2_entities e
  cross join lateral jsonb_array_elements(
   case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end
  ) room where e.kind='meta' and e.id='1'
   and (room->>'id'=requested_room or room->>'slug'=requested_room) limit 1;
  if requested_id is null then return null; end if;
  select space_id into requested_space from public.papa_space_streamers
   where streamer_id=requested_id;
  if requested_space is null or
   (actor_role<>'super_admin' and requested_space<>scope_id) or
   (actor_role='streamer_admin' and requested_id<>sess.streamer_id)
  then return null; end if;
 end if;
 return jsonb_build_object('role',actor_role,'accountId',sess.account_id,
  'spaceId',scope_id,'playerId',case when actor_role='player' then sess.player_id else null end,
  'loginId',case when actor_role='player' then sess.login_id else null end,
  'streamerId',sess.streamer_id,'deviceSessionId',sess.device_session_id);
end $$;

create or replace function public.papa_device_push_recipient(chosen_device uuid,chosen_room text,chosen_recipient text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from papa_device_sessions d
  join papa_accounts a on a.id=d.account_id and a.disabled_at is null
  left join papa_space_streamers map on map.streamer_id=chosen_room
  where d.id=chosen_device and d.revoked_at is null and d.expires_at>now() and (
   (chosen_recipient='__super__' and d.role='president' and exists(
    select 1 from papa_platform_roles r where r.account_id=d.account_id and r.role='president'))
   or (d.space_id=map.space_id and exists(
    select 1 from papa_space_memberships m join papa_spaces s on s.id=m.space_id and s.status='active'
    where m.account_id=d.account_id and m.space_id=d.space_id and m.role=d.role
     and m.streamer_id is not distinct from d.streamer_id and m.status='active'
   ) and (
    (d.role='player' and chosen_recipient=papa_account_player_in_space(d.account_id,d.space_id))
    or (d.role='streamer_admin' and d.streamer_id=chosen_room and chosen_recipient='__admin__'
     and exists(select 1 from papa_streamer_accounts s where s.streamer_id=d.streamer_id and s.enabled))
   ))
  )
 );
$$;

revoke all on function papa_account_player_in_space(uuid,text) from public,anon,authenticated;
grant execute on function papa_account_player_in_space(uuid,text) to service_role;
commit;
