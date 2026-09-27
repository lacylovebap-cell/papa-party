begin;
-- Keep a private recovery point before adding authentication metadata. No business rows are rewritten.
insert into papa_release_backups(release,snapshot) values('priority-1-auth-before',jsonb_build_object(
 'business',papa_v2_snapshot(),
 'streamer_accounts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from papa_streamer_accounts a))) on conflict do nothing;
create table if not exists papa_president_accounts(
 account_key text primary key,password_hash text not null,updated_at timestamptz not null default now()
);
create table if not exists papa_manager_attempts(
 bucket text primary key,failures int not null default 0,window_at timestamptz not null default now()
);
alter table papa_president_accounts enable row level security;
alter table papa_manager_attempts enable row level security;
revoke all on papa_president_accounts,papa_manager_attempts from public,anon,authenticated;
grant all on papa_president_accounts,papa_manager_attempts to service_role;

-- Called only by the service role. An Auth-backed installation preserves its existing bcrypt
-- password without exposing it or changing the Supabase account. PA Party thereafter owns its
-- credential and revocable sessions; external Auth tokens are not PA Party sessions.
create or replace function papa_president_hash(auth_user text default null) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare account_id text; stored text; original text;
begin
 perform pg_advisory_xact_lock(hashtext('papa-manager-credentials'));
 account_id='president:'||coalesce(nullif(auth_user,''),'legacy');
 select password_hash into stored from papa_president_accounts where account_key=account_id;
 if stored is not null then return stored;end if;
 if nullif(auth_user,'') is not null then
  select encrypted_password into original from auth.users where id::text=auth_user;
  if original is null or original !~ '^\$2[aby]\$' then return null;end if;
  stored=original;
 else
  select data#>>'{settings,adminPassword}' into original from party_state where id=1;
  if original is null or original='' then return null;end if;
  stored=crypt(original,gen_salt('bf',10));
 end if;
 insert into papa_president_accounts(account_key,password_hash) values(account_id,stored);
 return stored;
end $$;

create or replace function papa_manager_attempt_allowed(bucket_id text) returns boolean
language plpgsql security definer set search_path=public as $$
declare attempt papa_manager_attempts;
begin
 insert into papa_manager_attempts(bucket) values(bucket_id) on conflict do nothing;
 select * into attempt from papa_manager_attempts where bucket=bucket_id for update;
 if attempt.window_at<now()-interval '15 minutes' then
  update papa_manager_attempts set failures=0,window_at=now() where bucket=bucket_id;return true;
 end if;
 return attempt.failures<10;
end $$;

create or replace function papa_manager_login(kind text,room text,password text,auth_user text,session_hash text) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
declare president_hash text; streamer_hash text; bucket_id text; valid boolean=false;
begin
 if kind not in ('president','streamer') or session_hash !~ '^[a-f0-9]{64}$' then return false;end if;
 -- Login and password changes share a transaction lock: an old-password login cannot insert
 -- a new session after a concurrent password change has revoked its prior sessions.
 perform pg_advisory_xact_lock(hashtext('papa-manager-credentials'));
 president_hash=papa_president_hash(auth_user);
 bucket_id=case when kind='president' then 'president' else 'streamer:'||coalesce(room,'') end;
 if not papa_manager_attempt_allowed(bucket_id) then return false;end if;
 if password is not null and password<>'' and octet_length(password)<=72 then
  if kind='president' then valid=president_hash is not null and crypt(password,president_hash)=president_hash;
  else
   select password_hash into streamer_hash from papa_streamer_accounts where streamer_id=room and enabled;
   valid=streamer_hash is not null and crypt(password,streamer_hash)=streamer_hash
     and president_hash is not null and crypt(password,president_hash)<>president_hash;
  end if;
 end if;
 if not coalesce(valid,false) then update papa_manager_attempts set failures=failures+1 where bucket=bucket_id;return false;end if;
 update papa_manager_attempts set failures=0 where bucket=bucket_id;
 insert into papa_v2_sessions(token_hash,player_id,login_id,role,streamer_id,expires_at)
 values(session_hash,case when kind='president' then '__admin__' else '__streamer__:'||room end,'',
  case when kind='president' then 'super_admin' else 'streamer_admin' end,
  case when kind='president' then null else room end,now()+interval '12 hours');
 return true;
end $$;

create or replace function papa_change_manager_password(kind text,room text,current_password text,new_password text,auth_user text,session_hash text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare president_hash text; existing_hash text; bucket_id text; account_id text;
begin
 if kind not in ('president','streamer') then return jsonb_build_object('ok',false,'reason','invalid_role');end if;
 perform pg_advisory_xact_lock(hashtext('papa-manager-credentials'));
 -- Recheck the authenticated session under the same lock, not just in the Edge handler.
 if not exists(select 1 from papa_v2_sessions where token_hash=session_hash and expires_at>now()
  and (case when kind='president' then player_id='__admin__' and coalesce(role,'super_admin')='super_admin'
       else role='streamer_admin' and streamer_id=room end)) then return jsonb_build_object('ok',false,'reason','expired');end if;
 president_hash=papa_president_hash(auth_user);
 bucket_id='change:'||case when kind='president' then 'president' else 'streamer:'||coalesce(room,'') end;
 if not papa_manager_attempt_allowed(bucket_id) then return jsonb_build_object('ok',false,'reason','rate_limit');end if;
 if kind='president' then existing_hash=president_hash;
 else select password_hash into existing_hash from papa_streamer_accounts where streamer_id=room and enabled;end if;
 if existing_hash is null or current_password is null or octet_length(current_password)>72
  or crypt(current_password,existing_hash)<>existing_hash then
  update papa_manager_attempts set failures=failures+1 where bucket=bucket_id;
  return jsonb_build_object('ok',false,'reason','invalid_current');
 end if;
 if new_password is null or length(new_password)<(case when kind='president' then 8 else 4 end) or octet_length(new_password)>72 then
  return jsonb_build_object('ok',false,'reason','weak_password');end if;
 if crypt(new_password,existing_hash)=existing_hash then return jsonb_build_object('ok',false,'reason','same_password');end if;
 if kind='streamer' and (president_hash is null or crypt(new_password,president_hash)=president_hash) then
  return jsonb_build_object('ok',false,'reason','same_as_president');end if;
 if kind='president' and exists(select 1 from papa_streamer_accounts where crypt(new_password,password_hash)=password_hash) then
  return jsonb_build_object('ok',false,'reason','same_as_streamer');end if;
 if kind='president' then
  account_id='president:'||coalesce(nullif(auth_user,''),'legacy');
  update papa_president_accounts set password_hash=crypt(new_password,gen_salt('bf',10)),updated_at=now() where account_key=account_id;
  delete from papa_v2_sessions where player_id='__admin__' and coalesce(role,'super_admin')='super_admin';
  delete from papa_push_subscriptions where recipient='__super__';
  -- The old value was retained only to permit rollback before the first explicit password change.
  if nullif(auth_user,'') is null then update party_state set data=data#-'{settings,adminPassword}' where id=1;end if;
 else
  update papa_streamer_accounts set password_hash=crypt(new_password,gen_salt('bf',10)),updated_at=now() where streamer_id=room;
  delete from papa_v2_sessions where role='streamer_admin' and streamer_id=room;
  delete from papa_push_subscriptions where recipient='__admin__' and streamer_id=room;
 end if;
 delete from papa_manager_attempts where bucket=bucket_id or bucket=case when kind='president' then 'president' else 'streamer:'||room end;
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,after_data)
 values(case when kind='president' then 'platform' else room end,'manager_account',case when kind='president' then 'president' else room end,
  'change_password',case when kind='president' then 'super_admin' else 'streamer_admin' end,'{"changed":true}'::jsonb);
 return jsonb_build_object('ok',true);
end $$;

create or replace function papa_manage_streamer_login(room text,password text,active boolean,auth_user text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare president_hash text;
begin
 perform pg_advisory_xact_lock(hashtext('papa-manager-credentials'));
 if room is null or room='' then return jsonb_build_object('ok',false,'reason','invalid_room');end if;
 president_hash=papa_president_hash(auth_user);
 if password is not null and password<>'' then
  if length(password)<4 or octet_length(password)>72 then return jsonb_build_object('ok',false,'reason','weak_password');end if;
  if president_hash is null or crypt(password,president_hash)=president_hash then return jsonb_build_object('ok',false,'reason','same_as_president');end if;
  insert into papa_streamer_accounts(streamer_id,password_hash,enabled,updated_at) values(room,crypt(password,gen_salt('bf',10)),active,now())
  on conflict(streamer_id) do update set password_hash=excluded.password_hash,enabled=excluded.enabled,updated_at=now();
 else
  if not exists(select 1 from papa_streamer_accounts where streamer_id=room) then return jsonb_build_object('ok',false,'reason','password_required');end if;
  update papa_streamer_accounts set enabled=active,updated_at=now() where streamer_id=room;
 end if;
 delete from papa_v2_sessions where role='streamer_admin' and streamer_id=room;
 delete from papa_push_subscriptions where recipient='__admin__' and streamer_id=room;
 delete from papa_manager_attempts where bucket in ('streamer:'||room,'change:streamer:'||room);
 delete from papa_streamer_login_attempts where streamer_id=room;
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,after_data)
 values(room,'manager_account',room,'set_streamer_account','super_admin',jsonb_build_object('enabled',active,'passwordChanged',password is not null and password<>''));
 return jsonb_build_object('ok',true);
end $$;

revoke all on function papa_president_hash(text),papa_manager_attempt_allowed(text),papa_manager_login(text,text,text,text,text),papa_change_manager_password(text,text,text,text,text,text),papa_manage_streamer_login(text,text,boolean,text) from public,anon,authenticated;
grant execute on function papa_president_hash(text),papa_manager_attempt_allowed(text),papa_manager_login(text,text,text,text,text),papa_change_manager_password(text,text,text,text,text,text),papa_manage_streamer_login(text,text,boolean,text) to service_role;
-- Seed only the legacy hash if present. This does not replace or change an existing credential.
do $$ begin perform papa_president_hash(null);end $$;
commit;
