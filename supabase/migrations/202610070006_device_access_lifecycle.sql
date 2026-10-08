begin;

-- Edge passes only a verified Account identity from an existing access
-- session. Client-provided installation/platform strings never grant a role.
create function public.papa_start_device_session(
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
 if chosen_role='player' and not exists(select 1 from public.papa_account_legacy_players
  where account_id=subject)
  or chosen_role='president' and not exists(select 1 from public.papa_manager_account_links
   where account_id=subject and manager_key='president')
  or chosen_role='streamer_admin' and not exists(select 1 from public.papa_manager_account_links
   where account_id=subject and manager_key='streamer:'||chosen_streamer)
 then raise exception 'DEVICE_IDENTITY_MISMATCH'; end if;
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

-- Access issuance and one-time refresh rotation share one transaction. Any
-- failed access insert rolls the rotation back, so no device is stranded.
create function public.papa_refresh_device_access(
 chosen_session uuid,old_refresh_hash text,new_refresh_hash text,new_access_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare refreshed jsonb; canonical_player text; canonical_role text;
begin
 if new_access_hash !~ '^[a-f0-9]{64}$' then raise exception 'ACCESS_HASH_INVALID'; end if;
 refreshed=public.papa_rotate_device_session(chosen_session,old_refresh_hash,new_refresh_hash);
 if refreshed is null then return null; end if;
 if refreshed->>'role'='player' then
  select legacy_player_id into canonical_player from public.papa_account_legacy_players
   where account_id=(refreshed->>'accountId')::uuid;
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
 return refreshed;
end $$;

-- Explicit logout also works if the short access token has expired.
create function public.papa_revoke_device_with_refresh(chosen_session uuid,current_refresh_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare row_value public.papa_device_sessions%rowtype;
begin
 if current_refresh_hash !~ '^[a-f0-9]{64}$' then return false; end if;
 select * into row_value from public.papa_device_sessions
 where id=chosen_session for update;
 if not found or row_value.revoked_at is not null
  or row_value.refresh_hash<>current_refresh_hash then return false; end if;
 update public.papa_device_sessions set revoked_at=now() where id=chosen_session;
 return true;
end $$;

create function public.papa_revoke_device_access() returns trigger
language plpgsql set search_path=public as $$
begin
 if old.revoked_at is null and new.revoked_at is not null then
  delete from public.papa_v2_sessions where device_session_id=new.id;
 end if;
 return new;
end $$;
create trigger papa_revoke_device_access_trigger
after update of revoked_at on public.papa_device_sessions
for each row execute function public.papa_revoke_device_access();

-- Existing password-changing paths still own password validation. This
-- trigger only invalidates durable manager sessions after a real change.
create function public.papa_manager_device_revoke() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_table_name='papa_president_accounts' then
  if old.password_hash is distinct from new.password_hash then
   update public.papa_device_sessions d set revoked_at=now()
   from public.papa_manager_account_links l
   where l.manager_key='president' and d.account_id=l.account_id
    and d.session_kind='manager' and d.revoked_at is null;
  end if;
 elsif old.password_hash is distinct from new.password_hash
  or old.enabled is distinct from new.enabled then
  update public.papa_device_sessions d set revoked_at=now()
  from public.papa_manager_account_links l
  where l.manager_key='streamer:'||new.streamer_id and d.account_id=l.account_id
   and d.session_kind='manager' and d.revoked_at is null;
 end if;
 return new;
end $$;
create trigger papa_president_device_revoke_trigger
after update on public.papa_president_accounts for each row
execute function public.papa_manager_device_revoke();
create trigger papa_streamer_device_revoke_trigger
after update on public.papa_streamer_accounts for each row
execute function public.papa_manager_device_revoke();

create function public.papa_player_device_revoke() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.kind='players' and old.data->>'password' is distinct from new.data->>'password' then
  update public.papa_device_sessions d set revoked_at=now()
  from public.papa_account_legacy_players l
  where l.legacy_player_id=new.id and d.account_id=l.account_id
   and d.session_kind='player' and d.revoked_at is null;
 end if;
 return new;
end $$;
create trigger papa_player_device_revoke_trigger
after update of data on public.papa_v2_entities
for each row when (new.kind='players')
execute function public.papa_player_device_revoke();

revoke all on function public.papa_start_device_session(uuid,uuid,text,text,text,text,text,text,text),
 public.papa_refresh_device_access(uuid,text,text,text),
 public.papa_revoke_device_with_refresh(uuid,text),
 public.papa_manager_device_revoke(),public.papa_player_device_revoke(),
 public.papa_revoke_device_access()
 from public,anon,authenticated;
grant execute on function public.papa_start_device_session(uuid,uuid,text,text,text,text,text,text,text),
 public.papa_refresh_device_access(uuid,text,text,text),
 public.papa_revoke_device_with_refresh(uuid,text)
 to service_role;

commit;
