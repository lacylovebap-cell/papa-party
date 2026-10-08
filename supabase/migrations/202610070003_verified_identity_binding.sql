begin;

-- Legacy credentials remain authoritative during the bridge. Only the Edge
-- service calls this function after the existing password check succeeded.
-- Old access sessions stay valid until their original expiry.
alter table public.papa_v2_sessions
 add column account_id uuid references public.papa_accounts(id);
create index papa_legacy_session_account on public.papa_v2_sessions(account_id)
 where account_id is not null;

create table public.papa_manager_account_links (
 manager_key text primary key,
 account_id uuid not null unique references public.papa_accounts(id),
 created_at timestamptz not null default now(),
 check(manager_key='president' or manager_key ~ '^streamer:.+')
);
alter table public.papa_manager_account_links enable row level security;
revoke all on public.papa_manager_account_links from public,anon,authenticated;
grant all on public.papa_manager_account_links to service_role;

create function public.papa_bind_verified_legacy_session(session_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare session_row public.papa_v2_sessions%rowtype;
 account_uuid uuid; scope_id text; identity_key text; member_role text;
begin
 if session_hash !~ '^[a-f0-9]{64}$' then return null; end if;
 select * into session_row from public.papa_v2_sessions
 where token_hash=session_hash and expires_at>now() for update;
 if not found then return null; end if;
 if session_row.player_id='__admin__' and coalesce(session_row.role,'super_admin')='super_admin' then
  identity_key:='president';
 elsif session_row.role='streamer_admin' and session_row.streamer_id is not null
  and session_row.player_id='__streamer__:'||session_row.streamer_id then
  identity_key:='streamer:'||session_row.streamer_id;
  select space_id into scope_id from public.papa_space_streamers
   where streamer_id=session_row.streamer_id;
  if scope_id is null then raise exception 'UNKNOWN_STREAMER_SPACE'; end if;
 elsif coalesce(session_row.role,'player')='player' and session_row.player_id not in ('__admin__','')
  and session_row.player_id not like '__streamer__:%' then
  scope_id:='space-001';
 else
  return null;
 end if;

 -- A token's canonical account cannot change after it was bound.
 if session_row.account_id is not null then
  account_uuid:=session_row.account_id;
 else
  perform pg_advisory_xact_lock(hashtext('papa-account:'||coalesce(identity_key,'player:'||session_row.player_id)));
  if identity_key is null then
   select account_id into account_uuid from public.papa_account_legacy_players
    where legacy_player_id=session_row.player_id;
  else
   select links.account_id into account_uuid from public.papa_manager_account_links links
    where links.manager_key=identity_key;
  end if;
  if account_uuid is null then
   insert into public.papa_accounts default values returning id into account_uuid;
   if identity_key is null then
    insert into public.papa_account_legacy_players(account_id,legacy_player_id)
     values(account_uuid,session_row.player_id);
   else
    insert into public.papa_manager_account_links(manager_key,account_id)
     values(identity_key,account_uuid);
   end if;
  end if;
  update public.papa_v2_sessions set account_id=account_uuid
   where token_hash=session_hash;
 end if;
 if not exists(select 1 from public.papa_accounts
  where id=account_uuid and disabled_at is null) then raise exception 'ACCOUNT_DISABLED'; end if;
 if identity_key is null then
  if not exists(select 1 from public.papa_account_legacy_players
   where account_id=account_uuid and legacy_player_id=session_row.player_id)
  then raise exception 'SESSION_ACCOUNT_MISMATCH'; end if;
 elsif not exists(select 1 from public.papa_manager_account_links
  where account_id=account_uuid and manager_key=identity_key)
 then raise exception 'SESSION_ACCOUNT_MISMATCH'; end if;

 if identity_key='president' then
  insert into public.papa_platform_roles(account_id,role)
   values(account_uuid,'president') on conflict(account_id) do nothing;
  return jsonb_build_object('accountId',account_uuid,'role','president','spaceId',null);
 end if;
 member_role:=case when identity_key is null then 'player' else 'streamer_admin' end;
 insert into public.papa_space_memberships(account_id,space_id,role,streamer_id)
 values(account_uuid,scope_id,member_role,
  case when member_role='streamer_admin' then session_row.streamer_id else null end)
 on conflict do nothing;
 if not exists(select 1 from public.papa_space_memberships
  where account_id=account_uuid and space_id=scope_id and role=member_role
   and streamer_id is not distinct from
    (case when member_role='streamer_admin' then session_row.streamer_id else null end)
   and status='active') then raise exception 'MEMBERSHIP_SUSPENDED'; end if;
 return jsonb_build_object('accountId',account_uuid,'role',member_role,
  'spaceId',scope_id,'streamerId',session_row.streamer_id);
end $$;
revoke all on function public.papa_bind_verified_legacy_session(text)
 from public,anon,authenticated;
grant execute on function public.papa_bind_verified_legacy_session(text)
 to service_role;

-- One bounded lookup replaces separate access-session and streamer-account
-- fetches. A bound session is denied immediately if its Account/Membership is
-- suspended. Pre-migration sessions may finish their old lifetime in Space 001.
create function public.papa_verified_session_actor(session_hash text,requested_room text default null)
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
   if not exists(select 1 from public.papa_account_legacy_players
    where account_id=sess.account_id and legacy_player_id=sess.player_id)
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
revoke all on function public.papa_verified_session_actor(text,text)
 from public,anon,authenticated;
grant execute on function public.papa_verified_session_actor(text,text)
 to service_role;

commit;
