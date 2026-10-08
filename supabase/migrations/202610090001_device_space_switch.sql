begin;

-- Preferences store only public navigation identifiers. They never establish
-- Memberships or copy player profiles, credentials, or room business data.
create table papa_device_space_preferences (
 account_id uuid not null references papa_accounts(id),
 installation_id uuid not null references papa_installations(id),
 session_kind text not null check(session_kind in ('player','manager')),
 role text not null check(role in ('player','streamer_admin','president')),
 home_space_id text not null references papa_spaces(id),
 home_streamer_id text,
 last_space_id text not null references papa_spaces(id),
 last_streamer_id text,
 last_session_id uuid not null references papa_device_sessions(id),
 updated_at timestamptz not null default now(),
 primary key(account_id,installation_id,session_kind),
 check((session_kind='player')=(role='player')),
 foreign key(home_streamer_id,home_space_id) references papa_space_streamers(streamer_id,space_id),
 foreign key(last_streamer_id,last_space_id) references papa_space_streamers(streamer_id,space_id)
);
alter table papa_device_space_preferences enable row level security;
revoke all on papa_device_space_preferences from public,anon,authenticated;
grant all on papa_device_space_preferences to service_role;

-- Keep the original row-lock rotation and revocation semantics while making
-- null credentials fail closed. A NULL comparison must never grant a session.
create or replace function papa_rotate_device_session(session_id uuid,old_hash text,new_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_value papa_device_sessions%rowtype;
begin
 if session_id is null or old_hash is null or new_hash is null
  or new_hash !~ '^[a-f0-9]{64}$' or old_hash !~ '^[a-f0-9]{64}$' or new_hash=old_hash
 then raise exception 'INVALID_REFRESH_HASH';end if;
 select * into row_value from papa_device_sessions where id=session_id for update;
 if not found or row_value.revoked_at is not null or row_value.expires_at<=now()
  or row_value.refresh_hash is distinct from old_hash then return null;end if;
 update papa_device_sessions set refresh_hash=new_hash,rotation=rotation+1,
  last_seen_at=now(),expires_at=now()+interval '90 days' where id=session_id returning * into row_value;
 update papa_installations set last_seen_at=now() where id=row_value.installation_id;
 return jsonb_build_object('sessionId',row_value.id,'accountId',row_value.account_id,
  'kind',row_value.session_kind,'role',row_value.role,'spaceId',row_value.space_id,
  'streamerId',row_value.streamer_id,'loginId',row_value.login_id,'rotation',row_value.rotation,
  'expiresAt',row_value.expires_at);
end $$;
create or replace function papa_revoke_device_with_refresh(chosen_session uuid,current_refresh_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare row_value papa_device_sessions%rowtype;
begin
 if chosen_session is null or current_refresh_hash is null or current_refresh_hash !~ '^[a-f0-9]{64}$'
 then return false;end if;
 select * into row_value from papa_device_sessions where id=chosen_session for update;
 if not found or row_value.revoked_at is not null
  or row_value.refresh_hash is distinct from current_refresh_hash then return false;end if;
 update papa_device_sessions set revoked_at=now() where id=chosen_session;
 return true;
end $$;

create function papa_device_space_scope_allowed(subject uuid,actor_role text,chosen_space text,chosen_streamer text)
returns boolean language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
 then return false;end if;
 if actor_role='president' then
  if not exists(select 1 from papa_platform_roles where account_id=subject and role='president')
   or not exists(select 1 from papa_manager_account_links where account_id=subject and manager_key='president')
  then return false;end if;
  if chosen_space is null then return chosen_streamer is null;end if;
 end if;
 if not exists(select 1 from papa_spaces where id=chosen_space and status='active') then return false;end if;
 if chosen_streamer is not null and not exists(
  select 1 from papa_v2_entities e cross join lateral jsonb_array_elements(
   case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id' and scope.space_id=chosen_space
  where e.kind='meta' and e.id='1' and room->>'id'=chosen_streamer
   and coalesce(room->>'active','true')='true') then return false;end if;
 if actor_role='president' then return true;
 elsif actor_role='streamer_admin' then
  return exists(select 1 from papa_space_memberships m
   join papa_streamer_accounts streamer on streamer.streamer_id=m.streamer_id and streamer.enabled
   join papa_manager_account_links link on link.account_id=m.account_id and link.manager_key='streamer:'||m.streamer_id
   where m.account_id=subject and m.space_id=chosen_space and m.role='streamer_admin'
    and m.streamer_id=chosen_streamer and m.status='active');
 elsif actor_role='player' then
  if chosen_space='space-001' then
   return exists(select 1 from papa_space_memberships m
    join papa_account_legacy_players binding on binding.account_id=m.account_id
    join papa_v2_entities player on player.kind='players' and player.id=binding.legacy_player_id
    where m.account_id=subject and m.space_id=chosen_space and m.role='player' and m.status='active');
  end if;
  return exists(select 1 from papa_space_player_profiles p
   join papa_space_memberships m on m.id=p.membership_id and m.account_id=p.account_id and m.space_id=p.space_id
   where p.account_id=subject and p.space_id=chosen_space and m.role='player' and m.status='active');
 end if;
 return false;
end $$;

create function papa_device_space_public_scope(subject uuid,actor_role text,chosen_space text,chosen_streamer text)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'slug',slug,'name',display_name,'streamerId',chosen_streamer)
 from papa_spaces where id=chosen_space and status='active'
  and papa_device_space_scope_allowed(subject,actor_role,chosen_space,chosen_streamer);
$$;

-- A session ID or installation ID alone never authorizes preference reads.
-- Stored destinations are revalidated; a suspended scope returns no metadata.
create function papa_read_device_space_preferences(chosen_session uuid,current_refresh_hash text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare device papa_device_sessions%rowtype;preference papa_device_space_preferences%rowtype;
begin
 if chosen_session is null or current_refresh_hash is null or current_refresh_hash !~ '^[a-f0-9]{64}$'
 then return null;end if;
 select * into device from papa_device_sessions where id=chosen_session;
 if not found or device.revoked_at is not null or device.expires_at<=now()
  or device.refresh_hash is distinct from current_refresh_hash
  or not papa_device_space_scope_allowed(device.account_id,device.role,device.space_id,device.streamer_id)
 then return null;end if;
 select * into preference from papa_device_space_preferences
 where account_id=device.account_id and installation_id=device.installation_id
  and session_kind=device.session_kind and role=device.role;
 return jsonb_build_object('homeSpace',papa_device_space_public_scope(
  device.account_id,device.role,preference.home_space_id,preference.home_streamer_id),
  'lastSpace',papa_device_space_public_scope(device.account_id,device.role,preference.last_space_id,preference.last_streamer_id));
end $$;

-- Normal refresh still rotates and issues access in the original transaction.
-- Navigation metadata joins that response without another database request.
create or replace function papa_refresh_device_access(
 chosen_session uuid,old_refresh_hash text,new_refresh_hash text,new_access_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare refreshed jsonb;canonical_player text;canonical_role text;preferences jsonb;selected_space jsonb;subject uuid;
begin
 if new_access_hash is null or new_access_hash !~ '^[a-f0-9]{64}$'
 then raise exception 'ACCESS_HASH_INVALID';end if;
 refreshed=papa_rotate_device_session(chosen_session,old_refresh_hash,new_refresh_hash);
 if refreshed is null then return null;end if;
 subject=(refreshed->>'accountId')::uuid;
 if not papa_device_space_scope_allowed(subject,refreshed->>'role',refreshed->>'spaceId',refreshed->>'streamerId')
 then raise exception 'DEVICE_IDENTITY_MISMATCH';end if;
 if refreshed->>'role'='player' then
  canonical_player=papa_account_player_in_space(subject,refreshed->>'spaceId');canonical_role='player';
 elsif refreshed->>'role'='president' then canonical_player='__admin__';canonical_role='super_admin';
 elsif refreshed->>'role'='streamer_admin' then
  canonical_player='__streamer__:'||(refreshed->>'streamerId');canonical_role='streamer_admin';
 else raise exception 'DEVICE_ROLE_UNSUPPORTED';end if;
 if canonical_player is null then raise exception 'DEVICE_IDENTITY_MISMATCH';end if;
 insert into papa_v2_sessions(token_hash,player_id,login_id,role,streamer_id,expires_at,account_id,device_session_id)
 values(new_access_hash,canonical_player,coalesce(refreshed->>'loginId',''),canonical_role,
  nullif(refreshed->>'streamerId',''),now()+interval '12 hours',subject,chosen_session);
 preferences=papa_read_device_space_preferences(chosen_session,new_refresh_hash);
 if refreshed->>'role'='president' or preferences->'lastSpace'->>'id'=refreshed->>'spaceId' then
  selected_space=preferences->'lastSpace';
 else selected_space=papa_device_space_public_scope(subject,refreshed->>'role',refreshed->>'spaceId',refreshed->>'streamerId');end if;
 return refreshed||jsonb_build_object('playerId',case when canonical_role='player' then canonical_player else null end,
  'selectedSpace',selected_space,'selectedStreamerId',selected_space->>'streamerId','spaceSlug',selected_space->>'slug')||preferences;
end $$;

create function papa_switch_device_space(chosen_session uuid,current_refresh_hash text,
 requested_slug text,requested_streamer text,new_refresh_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare device papa_device_sessions%rowtype;installation papa_installations%rowtype;
 target_space text;target_streamer text;target_player text;started jsonb;preferences jsonb;
 home_space text;home_streamer text;
begin
 if chosen_session is null or current_refresh_hash is null or new_refresh_hash is null
  or current_refresh_hash !~ '^[a-f0-9]{64}$' or new_refresh_hash !~ '^[a-f0-9]{64}$'
  or new_refresh_hash=current_refresh_hash or requested_slug is null
  or nullif(btrim(requested_slug),'') is null or length(requested_slug)>100
  or requested_streamer is not null and (nullif(btrim(requested_streamer),'') is null or length(requested_streamer)>200)
 then raise exception 'DEVICE_SWITCH_INVALID';end if;
 select * into device from papa_device_sessions where id=chosen_session;
 if not found then return null;end if;
 -- Match start's installation lock, then lock the old credential row. Do not
 -- lock the installation row first: existing refresh locks session then updates
 -- installation, and reversing that order would deadlock refresh against switch.
 perform pg_advisory_xact_lock(hashtext('installation:'||device.installation_id::text));
 select * into device from papa_device_sessions where id=chosen_session for update;
 if not found or device.revoked_at is not null or device.expires_at<=now()
  or device.refresh_hash is distinct from current_refresh_hash then return null;end if;
 if not papa_device_space_scope_allowed(device.account_id,device.role,device.space_id,device.streamer_id)
 then raise exception 'DEVICE_SWITCH_IDENTITY_INVALID';end if;
 select id into target_space from papa_spaces where slug=requested_slug and status='active';
 if target_space is null then raise exception 'DEVICE_SWITCH_SPACE_INVALID';end if;
 if requested_streamer is not null then
  select room->>'id' into target_streamer from papa_v2_entities e
  cross join lateral jsonb_array_elements(case when jsonb_typeof(e.data->'streamers')='array'
   then e.data->'streamers' else '[]'::jsonb end) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id' and scope.space_id=target_space
  where e.kind='meta' and e.id='1' and (room->>'id'=requested_streamer or room->>'slug'=requested_streamer)
   and coalesce(room->>'active','true')='true' limit 1;
  if target_streamer is null then raise exception 'DEVICE_SWITCH_ROOM_INVALID';end if;
 elsif device.role='streamer_admin' then target_streamer=device.streamer_id;end if;
 if device.role='streamer_admin' and target_streamer is distinct from device.streamer_id
 then raise exception 'DEVICE_SWITCH_ROOM_INVALID';end if;
 if not papa_device_space_scope_allowed(device.account_id,device.role,target_space,target_streamer)
 then raise exception 'DEVICE_SWITCH_MEMBERSHIP_REQUIRED';end if;
 if device.role='player' then
  target_player=papa_account_player_in_space(device.account_id,target_space);
  if target_player is null then raise exception 'DEVICE_SWITCH_PROFILE_REQUIRED';end if;
 end if;
 select * into installation from papa_installations where id=device.installation_id;
 if not found then raise exception 'DEVICE_SWITCH_INSTALLATION_INVALID';end if;
 -- Preserve the original role and immutable scope model. President devices
 -- remain global; their selected Space is a navigation preference, not a grant.
 started=papa_start_device_session(device.account_id,device.installation_id,installation.platform,
  installation.app_version,device.role,case when device.role='president' then null else target_space end,
  case when device.role='streamer_admin' then target_streamer else null end,new_refresh_hash,
  case when device.role='player' and device.space_id=target_space then device.login_id else '' end);
 home_space=case when device.role='president' then target_space else device.space_id end;
 home_streamer=case when device.role='president' then target_streamer else device.streamer_id end;
 insert into papa_device_space_preferences as previous(account_id,installation_id,session_kind,role,
  home_space_id,home_streamer_id,last_space_id,last_streamer_id,last_session_id)
 values(device.account_id,device.installation_id,device.session_kind,device.role,home_space,home_streamer,
  target_space,target_streamer,(started->>'sessionId')::uuid)
 on conflict(account_id,installation_id,session_kind) do update set
  home_space_id=case when previous.role=excluded.role then previous.home_space_id else excluded.home_space_id end,
  home_streamer_id=case when previous.role=excluded.role then previous.home_streamer_id else excluded.home_streamer_id end,
  role=excluded.role,last_space_id=excluded.last_space_id,last_streamer_id=excluded.last_streamer_id,
  last_session_id=excluded.last_session_id,updated_at=now();
 preferences=papa_read_device_space_preferences((started->>'sessionId')::uuid,new_refresh_hash);
 return started||jsonb_build_object('playerId',target_player,'spaceSlug',requested_slug,
  'selectedSpace',papa_device_space_public_scope(device.account_id,device.role,target_space,target_streamer),
  'selectedStreamerId',target_streamer)||preferences;
end $$;

revoke all on function papa_device_space_scope_allowed(uuid,text,text,text),
 papa_device_space_public_scope(uuid,text,text,text),papa_read_device_space_preferences(uuid,text),
 papa_switch_device_space(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function papa_read_device_space_preferences(uuid,text),
 papa_switch_device_space(uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
