begin;
insert into public.papa_release_backups(release,snapshot) values('9.24-B-before',public.papa_v2_snapshot()) on conflict do nothing;
create table public.papa_notice_preferences(
 streamer_id text not null,recipient text not null,preferences jsonb not null default '{}',
 topic text not null default (gen_random_uuid()::text||gen_random_uuid()::text),primary key(streamer_id,recipient)
);
create table public.papa_notifications(
 id uuid primary key default gen_random_uuid(),streamer_id text not null,streamer_name text not null,recipient text not null,
 type text not null,level smallint not null,body text not null,entity_id text,created_at timestamptz not null default now(),read_at timestamptz
);
create index papa_notices_inbox on public.papa_notifications(streamer_id,recipient,created_at desc,id desc);
create table public.papa_push_subscriptions(
 id uuid primary key default gen_random_uuid(),streamer_id text not null,recipient text not null,endpoint text not null,
 subscription jsonb not null,session_hash text not null,created_at timestamptz not null default now(),unique(streamer_id,endpoint)
);
create table public.papa_push_jobs(
 id bigint generated always as identity primary key,notice_id uuid not null references public.papa_notifications(id),
 subscription_id uuid not null references public.papa_push_subscriptions(id) on delete cascade,
 attempts int not null default 0,available_at timestamptz not null default now(),lease uuid,status text not null default 'pending',last_error text,
 unique(notice_id,subscription_id)
);
create table public.papa_notice_config(id text primary key,value jsonb not null);
insert into public.papa_notice_config values('worker',jsonb_build_object('secret',gen_random_uuid()::text||gen_random_uuid()::text));
alter table public.papa_notice_preferences enable row level security;
alter table public.papa_notifications enable row level security;
alter table public.papa_push_subscriptions enable row level security;
alter table public.papa_push_jobs enable row level security;
alter table public.papa_notice_config enable row level security;
revoke all on public.papa_notice_preferences,public.papa_notifications,public.papa_push_subscriptions,public.papa_push_jobs,public.papa_notice_config from anon,authenticated;
grant all on public.papa_notice_preferences,public.papa_notifications,public.papa_push_subscriptions,public.papa_push_jobs,public.papa_notice_config to service_role;
grant usage,select on sequence public.papa_push_jobs_id_seq to service_role;

create function public.papa_notice_wakeup() returns trigger language plpgsql security definer set search_path=public as $$
declare ch text;
begin
 insert into papa_notice_preferences(streamer_id,recipient) values(NEW.streamer_id,NEW.recipient) on conflict do nothing;
 select topic into ch from papa_notice_preferences where streamer_id=NEW.streamer_id and recipient=NEW.recipient;
 -- Capability channel carries only an invalidation. Content always requires API authentication.
 begin perform realtime.send('{}'::jsonb,'changed','papa-notice:'||ch,false);exception when others then null;end;
 if TG_OP='INSERT' then
  insert into papa_push_jobs(notice_id,subscription_id) select NEW.id,id from papa_push_subscriptions where streamer_id=NEW.streamer_id and recipient=NEW.recipient;
 end if;
 return NEW;
end $$;
create trigger papa_notice_signal after insert or update on public.papa_notifications for each row execute function public.papa_notice_wakeup();
create function public.papa_preference_wakeup() returns trigger language plpgsql security definer set search_path=public as $$
begin
 begin perform realtime.send('{}'::jsonb,'changed','papa-notice:'||NEW.topic,false);exception when others then null;end;
 return NEW;
end $$;
create trigger papa_preference_signal after update on public.papa_notice_preferences for each row execute function public.papa_preference_wakeup();

create function public.papa_release_b_commit(expected bigint,changes jsonb,removed jsonb,actor_context jsonb,notices jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare rev bigint;
begin
 rev=papa_release_a_commit(expected,changes,removed,actor_context);
 insert into papa_notifications(id,streamer_id,streamer_name,recipient,type,level,body,entity_id,created_at)
 select x.id,x.streamer_id,x.streamer_name,x.recipient,x.type,x.level,x.body,x.entity_id,x.created_at
 from jsonb_to_recordset(notices) as x(id uuid,streamer_id text,streamer_name text,recipient text,type text,level smallint,body text,entity_id text,created_at timestamptz);
 return rev;
end $$;
create function public.papa_failed_notice() returns trigger language plpgsql security definer set search_path=public as $$
declare source_name text;
begin
 if NEW.action<>'request_failed' then return NEW;end if;
 select coalesce(r->>'display_name','主播') into source_name from papa_v2_entities e cross join lateral jsonb_array_elements(e.data->'streamers') r where e.kind='meta' and r->>'id'=NEW.streamer_id;
 source_name=coalesce(source_name,'主播');
 insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id)
 values(NEW.streamer_id,source_name,'__admin__','failed',1,source_name||'｜有存歌玩家因本小時額度已滿而提歌失敗',NEW.entity_id),
 (NEW.streamer_id,source_name,NEW.actor_player_id,'failed',1,source_name||'｜本小時提歌已滿，可改用現點',NEW.entity_id);
 return NEW;
end $$;
create trigger papa_failed_notice_event after insert on public.papa_events for each row when (NEW.action='request_failed') execute function public.papa_failed_notice();

create function public.papa_notice_inbox(room text,owner_id text,page_number int default 0) returns jsonb
language plpgsql security definer set search_path=public as $$
declare pref jsonb; result jsonb; unread jsonb; ch text;
begin
 insert into papa_notice_preferences(streamer_id,recipient) values(room,owner_id) on conflict do nothing;
 select preferences,topic into pref,ch from papa_notice_preferences where streamer_id=room and recipient=owner_id;
 select coalesce(jsonb_agg(to_jsonb(n)),'[]') into result from (select * from papa_notifications where streamer_id=room and recipient=owner_id order by created_at desc,id desc limit 51 offset greatest(0,page_number)*50) n;
 select coalesce(jsonb_object_agg(type,n),'{}') into unread from (select type,count(*) n from papa_notifications where streamer_id=room and recipient=owner_id and read_at is null group by type) c;
 return jsonb_build_object('rows',result,'preferences',pref,'unread',unread,'topic',ch);
end $$;
create function public.papa_claim_push() returns setof public.papa_push_jobs language sql security definer set search_path=public as $$
 update papa_push_jobs set attempts=attempts+1,available_at=now()+interval '2 minutes',lease=gen_random_uuid()
 where id in (select id from papa_push_jobs where status='pending' and available_at<=now() and attempts<5 order by id for update skip locked limit 20) returning *;
$$;
revoke all on function public.papa_notice_wakeup(),public.papa_preference_wakeup(),public.papa_failed_notice(),public.papa_release_b_commit(bigint,jsonb,jsonb,jsonb,jsonb),public.papa_notice_inbox(text,text,int),public.papa_claim_push() from public,anon,authenticated;
grant execute on function public.papa_release_b_commit(bigint,jsonb,jsonb,jsonb,jsonb),public.papa_notice_inbox(text,text,int),public.papa_claim_push() to service_role;
commit;

