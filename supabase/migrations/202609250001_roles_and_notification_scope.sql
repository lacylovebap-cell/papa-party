begin;
insert into papa_release_backups(release,snapshot) values('9.24-B.1-before',papa_v2_snapshot()) on conflict do nothing;
alter table papa_v2_sessions add column if not exists role text;
alter table papa_v2_sessions add column if not exists streamer_id text;
create table papa_streamer_accounts(streamer_id text primary key,password_hash text not null,enabled boolean not null default true,updated_at timestamptz not null default now());
create table papa_streamer_login_attempts(streamer_id text primary key,failures int not null default 0,window_at timestamptz not null default now());
alter table papa_streamer_accounts enable row level security;
alter table papa_streamer_login_attempts enable row level security;
revoke all on papa_streamer_accounts,papa_streamer_login_attempts from anon,authenticated;
grant all on papa_streamer_accounts,papa_streamer_login_attempts to service_role;
create function papa_set_streamer_login(room text,password text,active boolean) returns void language plpgsql security definer set search_path=public,extensions as $$
begin
 if password is not null and length(password)>0 then
  if length(password)<4 or length(password)>72 then raise exception 'INVALID_PASSWORD';end if;
  insert into papa_streamer_accounts values(room,crypt(password,gen_salt('bf',10)),active,now()) on conflict(streamer_id) do update set password_hash=excluded.password_hash,enabled=excluded.enabled,updated_at=now();
 else
  if not exists(select 1 from papa_streamer_accounts where streamer_id=room) then raise exception 'PASSWORD_REQUIRED';end if;
  update papa_streamer_accounts set enabled=active,updated_at=now() where streamer_id=room;
 end if;
 delete from papa_v2_sessions where role='streamer_admin' and streamer_id=room;
 delete from papa_push_subscriptions where recipient='__admin__' and streamer_id=room;
 delete from papa_streamer_login_attempts where streamer_id=room;
end $$;
create function papa_check_streamer_login(room text,password text) returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare a papa_streamer_login_attempts;account papa_streamer_accounts;
begin
 insert into papa_streamer_login_attempts(streamer_id) values(room) on conflict do nothing;
 select * into a from papa_streamer_login_attempts where streamer_id=room for update;
 if a.window_at<now()-interval '15 minutes' then update papa_streamer_login_attempts set failures=0,window_at=now() where streamer_id=room;a.failures=0;end if;
 if a.failures>=10 then return false;end if;
 select * into account from papa_streamer_accounts where streamer_id=room and enabled;
 if account.streamer_id is null or password is null or crypt(password,account.password_hash)<>account.password_hash then update papa_streamer_login_attempts set failures=failures+1 where streamer_id=room;return false;end if;
 update papa_streamer_login_attempts set failures=0 where streamer_id=room;return true;
end $$;
revoke all on function papa_set_streamer_login(text,text,boolean),papa_check_streamer_login(text,text) from public,anon,authenticated;
grant execute on function papa_set_streamer_login(text,text,boolean),papa_check_streamer_login(text,text) to service_role;

create or replace function papa_notice_wakeup() returns trigger language plpgsql security definer set search_path=public as $$
declare ch text;pref_room text;
begin
 pref_room=case when NEW.recipient='__super__' then '__global__' else NEW.streamer_id end;
 insert into papa_notice_preferences(streamer_id,recipient) values(pref_room,NEW.recipient) on conflict do nothing;
 select topic into ch from papa_notice_preferences where streamer_id=pref_room and recipient=NEW.recipient;
 begin perform realtime.send('{}'::jsonb,'changed','papa-notice:'||ch,false);exception when others then null;end;
 if TG_OP='INSERT' then
  insert into papa_push_jobs(notice_id,subscription_id) select NEW.id,id from papa_push_subscriptions where streamer_id=pref_room and recipient=NEW.recipient;
  if NEW.recipient='__admin__' then
   insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,created_at) values(NEW.streamer_id,NEW.streamer_name,'__super__',NEW.type,NEW.level,NEW.body,NEW.entity_id,NEW.created_at);
  end if;
 end if;
 return NEW;
end $$;
-- Copy only management history; leave player notices private and existing read state intact.
insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,created_at,read_at)
select streamer_id,streamer_name,'__super__',type,level,body,entity_id,created_at,read_at from papa_notifications where recipient='__admin__';
create or replace function papa_notice_inbox(room text,owner_id text,page_number int default 0) returns jsonb language plpgsql security definer set search_path=public as $$
declare pref jsonb;result jsonb;unread jsonb;ch text;
begin
 insert into papa_notice_preferences(streamer_id,recipient) values(room,owner_id) on conflict do nothing;
 select preferences,topic into pref,ch from papa_notice_preferences where streamer_id=room and recipient=owner_id;
 select coalesce(jsonb_agg(to_jsonb(n)),'[]') into result from (select * from papa_notifications where recipient=owner_id and (streamer_id=room or (room='__global__' and owner_id='__super__')) order by created_at desc,id desc limit 51 offset greatest(0,page_number)*50) n;
 select coalesce(jsonb_object_agg(type,n),'{}') into unread from (select type,count(*) n from papa_notifications where recipient=owner_id and (streamer_id=room or (room='__global__' and owner_id='__super__')) and read_at is null group by type) c;
 return jsonb_build_object('rows',result,'preferences',pref,'unread',unread,'topic',ch);
end $$;
commit;
