-- Batch 2: players of a new (non-聲瑪) Space.
-- Each new Space keeps its own player list (user decision 2026-10-28): a player is
-- a Space profile bound to its own Account and player Membership, with a login
-- code and bcrypt password that work only in that Space. 聲瑪 players are
-- unchanged. Independent streamers and the president may add, edit and remove
-- players of an independent Space; hall streamers may not.
begin;
set local lock_timeout='3s';

alter table public.papa_v2_sessions add column if not exists space_id text references public.papa_spaces(id);

create table public.papa_space_player_credentials(
 space_id text not null references public.papa_spaces(id),
 player_id text not null,
 login_code text not null,
 password_hash text not null,
 enabled boolean not null default true,
 updated_at timestamptz not null default now(),
 primary key(space_id,player_id),
 foreign key(space_id,player_id) references public.papa_space_player_profiles(space_id,player_id),
 check(space_id<>'space-001'),
 check(login_code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
 check(password_hash ~ '^\$2[aby]\$')
);
create unique index papa_space_player_credentials_code on public.papa_space_player_credentials(space_id,login_code);
alter table public.papa_space_player_credentials enable row level security;
revoke all on public.papa_space_player_credentials from public,anon,authenticated;
grant all on public.papa_space_player_credentials to service_role;

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
  -- Batch 2: a player session of another open Space carries that Space; 聲瑪 keeps null.
  actor_role:='player';scope_id:=coalesce(sess.space_id,'space-001');
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

-- The room's open, non-聲瑪 Space and whether the actor may manage its players.
create function public.papa_space_player_scope(actor_context jsonb,requested_room text)
returns text language plpgsql stable security definer set search_path=public as $$
declare room_space text;space_kind text;actor_kind text;
begin
 select m.space_id,s.tenant_kind into room_space,space_kind from papa_space_streamers m join papa_spaces s on s.id=m.space_id
  where m.streamer_id=requested_room and m.deleted_at is null and s.deleted_at is null and s.status='active';
 if room_space is null or room_space='space-001' then raise exception 'SPACE_PLAYER_SCOPE_INVALID';end if;
 actor_kind=papa_room_native_actor_guard(actor_context,requested_room,room_space);
 if actor_kind='super_admin' or actor_kind='streamer_admin' and space_kind='independent' then return room_space;end if;
 raise exception 'SPACE_PLAYER_ACTOR_INVALID';
end $$;

create function public.papa_space_player_create(expected bigint,changes jsonb,removed jsonb,actor_context jsonb,notices jsonb,
 requested_room text,new_player text,login_code text,password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
#variable_conflict use_column
declare room_space text;code text;subject uuid;member uuid;next_revision bigint;
begin
 room_space=papa_space_player_scope(actor_context,requested_room);
 code=lower(btrim(coalesce(login_code,'')));
 if code !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then raise exception 'SPACE_PLAYER_CODE_INVALID';end if;
 if password is null or length(password)<4 or octet_length(password)>72 then raise exception 'SPACE_PLAYER_PASSWORD_INVALID';end if;
 if nullif(btrim(coalesce(new_player,'')),'') is null or length(new_player)>200 then raise exception 'SPACE_PLAYER_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('papa-space-player-code:'||room_space||':'||code,0));
 if exists(select 1 from papa_space_player_credentials where space_id=room_space and login_code=code)
 then raise exception 'SPACE_PLAYER_CODE_TAKEN';end if;
 insert into papa_accounts default values returning id into subject;
 insert into papa_space_memberships(account_id,space_id,role,status) values(subject,room_space,'player','active') returning id into member;
 next_revision=papa_room_admin_commit_with_player_bindings(expected,changes,removed,actor_context,notices,requested_room,
  jsonb_build_array(jsonb_build_object('player_id',new_player,'account_id',subject::text,'membership_id',member::text)));
 insert into papa_space_player_credentials(space_id,player_id,login_code,password_hash)
 values(room_space,new_player,code,crypt(password,gen_salt('bf',10)));
 return jsonb_build_object('revision',next_revision,'playerId',new_player,'loginCode',code);
end $$;

-- Change a player's login code, password or login switch; or remove the player
-- (archive the profile, stop the login and end its sessions). Passwords never
-- leave this function.
create function public.papa_space_player_access(actor_context jsonb,requested_room text,requested_player text,
 login_code text,password text,login_enabled boolean,remove boolean,expected bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
#variable_conflict use_column
declare room_space text;profile papa_space_player_profiles;credential papa_space_player_credentials;code text;
 current_revision bigint;previous_context text;subject uuid;
begin
 room_space=papa_space_player_scope(actor_context,requested_room);
 subject=(actor_context->>'account_id')::uuid;
 select * into profile from papa_space_player_profiles where space_id=room_space and player_id=requested_player for update;
 if not found then raise exception 'SPACE_PLAYER_TARGET_INVALID';end if;
 select * into credential from papa_space_player_credentials where space_id=room_space and player_id=requested_player for update;
 if coalesce(remove,false) then
  select revision into current_revision from papa_v2_revision where id=1 for update;
  if current_revision is distinct from expected then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from papa_v2_entities queue where queue.kind='queue' and queue.space_id=room_space
   and queue.data->>'playerId'=requested_player and queue.data->>'status' in ('pending','waiting'))
  then raise exception 'PLAYER_ARCHIVE_PENDING_QUEUE';end if;
  previous_context=current_setting('papa.actor_context',true);
  perform set_config('papa.actor_context',jsonb_build_object('role',actor_context->>'role','account_id',subject,
   'space_id',room_space,'streamer_id',requested_room,'player_id',null,'action','playerArchive')::text,true);
  update papa_space_player_profiles set data=profile.data||jsonb_build_object('archived',true,'archiveAt',now(),'archiveBy',subject)
   where space_id=room_space and player_id=requested_player;
  perform set_config('papa.actor_context',coalesce(previous_context,''),true);
  update papa_space_player_credentials set enabled=false,updated_at=now() where space_id=room_space and player_id=requested_player;
  delete from papa_v2_sessions where account_id=profile.account_id and space_id=room_space;
  update papa_v2_revision set revision=current_revision+1 where id=1;
  return jsonb_build_object('revision',current_revision+1,'playerId',requested_player,'removed',true);
 end if;
 code=case when login_code is null then credential.login_code else lower(btrim(login_code)) end;
 if code is null or code !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then raise exception 'SPACE_PLAYER_CODE_INVALID';end if;
 if password is not null and (length(password)<4 or octet_length(password)>72) then raise exception 'SPACE_PLAYER_PASSWORD_INVALID';end if;
 if credential.player_id is null and password is null then raise exception 'SPACE_PLAYER_PASSWORD_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('papa-space-player-code:'||room_space||':'||code,0));
 if exists(select 1 from papa_space_player_credentials where space_id=room_space and login_code=code and player_id<>requested_player)
 then raise exception 'SPACE_PLAYER_CODE_TAKEN';end if;
 if credential.player_id is null then
  insert into papa_space_player_credentials(space_id,player_id,login_code,password_hash,enabled)
  values(room_space,requested_player,code,crypt(password,gen_salt('bf',10)),coalesce(login_enabled,true));
 else
  update papa_space_player_credentials set login_code=code,
   password_hash=case when password is null then password_hash else crypt(password,gen_salt('bf',10)) end,
   enabled=coalesce(login_enabled,enabled),updated_at=now()
  where space_id=room_space and player_id=requested_player;
 end if;
 if password is not null or login_enabled is false or code is distinct from credential.login_code then
  delete from papa_v2_sessions where account_id=profile.account_id and space_id=room_space;
 end if;
 return jsonb_build_object('playerId',requested_player,'loginCode',code,
  'loginEnabled',(select enabled from papa_space_player_credentials where space_id=room_space and player_id=requested_player));
end $$;

-- Player login of a new Space: login code + password, rate limited like manager
-- logins. Creates a 30-day session bound to the player's Account and Space.
create function public.papa_space_player_login(requested_room text,login_code text,password text,session_hash text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
#variable_conflict use_column
declare room_id text;room_space text;code text;bucket_id text;credential papa_space_player_credentials;profile papa_space_player_profiles;valid boolean=false;
begin
 if session_hash !~ '^[a-f0-9]{64}$' or nullif(requested_room,'') is null or length(requested_room)>200 then return null;end if;
 select room->>'id' into room_id from papa_v2_entities e cross join lateral jsonb_array_elements(
  case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) room
  where e.kind='meta' and e.id='1' and (room->>'id'=requested_room or room->>'slug'=requested_room) limit 1;
 select m.space_id into room_space from papa_space_streamers m join papa_spaces s on s.id=m.space_id
  where m.streamer_id=room_id and m.deleted_at is null and s.deleted_at is null and s.status='active';
 if room_space is null or room_space='space-001' then return null;end if;
 code=lower(btrim(coalesce(login_code,'')));
 if code !~ '^[a-z0-9][a-z0-9_-]{1,39}$' then return null;end if;
 bucket_id='space-player:'||room_space||':'||code;
 perform pg_advisory_xact_lock(hashtextextended(bucket_id,0));
 if not papa_manager_attempt_allowed(bucket_id) then return null;end if;
 select * into credential from papa_space_player_credentials where space_id=room_space and login_code=code and enabled;
 if found and password is not null and password<>'' and octet_length(password)<=72 then
  select * into profile from papa_space_player_profiles where space_id=room_space and player_id=credential.player_id;
  valid=crypt(password,credential.password_hash)=credential.password_hash
   and coalesce(profile.data->'archived'<>'true'::jsonb,true)
   and papa_account_player_in_space(profile.account_id,room_space) is not distinct from credential.player_id;
 end if;
 if not coalesce(valid,false) then update papa_manager_attempts set failures=failures+1 where bucket=bucket_id;return null;end if;
 update papa_manager_attempts set failures=0 where bucket=bucket_id;
 insert into papa_v2_sessions(token_hash,player_id,login_id,role,expires_at,account_id,space_id)
 values(session_hash,credential.player_id,code,'player',now()+interval '30 days',profile.account_id,room_space);
 return jsonb_build_object('role','player','accountId',profile.account_id,'playerId',credential.player_id,'spaceId',room_space,'loginId',code);
end $$;

-- Login codes of one Space for its managers (never hashes).
create function public.papa_space_player_logins(actor_context jsonb,requested_room text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room_space text;
begin
 room_space=papa_space_player_scope(actor_context,requested_room);
 return coalesce((select jsonb_agg(jsonb_build_object('playerId',player_id,'loginCode',login_code,'enabled',enabled) order by login_code)
  from papa_space_player_credentials where space_id=room_space),'[]'::jsonb);
end $$;

revoke all on function public.papa_space_player_scope(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.papa_space_player_create(bigint,jsonb,jsonb,jsonb,jsonb,text,text,text,text),
 public.papa_space_player_access(jsonb,text,text,text,text,boolean,boolean,bigint),
 public.papa_space_player_login(text,text,text,text),public.papa_space_player_logins(jsonb,text) from public,anon,authenticated;
grant execute on function public.papa_space_player_create(bigint,jsonb,jsonb,jsonb,jsonb,text,text,text,text),
 public.papa_space_player_access(jsonb,text,text,text,text,boolean,boolean,bigint),
 public.papa_space_player_login(text,text,text,text),public.papa_space_player_logins(jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
