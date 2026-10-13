begin;
-- Additive awards only. No business backfill, replacement ledger or snapshots.
create table papa_achievement_catalog(
 code text primary key,name text not null,condition_text text not null,lifetime text not null,
 default_visibility text not null default 'public' check(default_visibility in ('public','condition_hidden','hidden','after_award'))
);
insert into papa_achievement_catalog values
 ('first_mic','今日第一麥','本場第一首真正完成演唱','show','public'),
 ('first_live','今日第一點','本場第一筆有效現點','show','public'),
 ('night','夜貓點歌台','01:00–05:00 累積現點 5 首','show','public'),
 ('no_sleep','今晚不睡','01:00–05:00 累積現點 5 首','show','public'),
 ('triple','三連發','30 分鐘內現點 3 首','24h','public'),
 ('comeback','突然殺出來','7 天未現點，回歸首場現點 5 首','permanent','public'),
 ('big_requester','點歌大戶','3 日內現點 100 首','rolling','public'),
 ('categories','什麼都聽','已知歌曲累積 10 種分類','permanent','public'),
 ('stock100','百曲藏家','未被唱掉的存歌 100 首','holding','public'),
 ('stock500','曲庫霸主','未被唱掉的存歌 500 首','holding','public'),
 ('stock1000','千曲帝國','未被唱掉的存歌 1000 首','holding','public'),
 ('saved10','今日很會提','本場成功提歌並完成演唱 10 首','show','public'),
 ('saved_success','提歌成功','提歌後真正完成演唱','permanent','public'),
 ('saved_failure','提歌失敗','有可用存歌、時段已滿，被系統阻擋；同時段不重複計算','permanent','public'),
 ('sung50','50首兵郎','累積完成演唱 50 首','permanent','public'),
 ('sung100','百歌王','累積完成演唱 100 首','permanent','public'),
 ('chosen','天選之人','每次真正完成演唱由伺服器獨立抽取，機率 0.5%','permanent','after_award'),
 ('stock50','囤歌症候群','未被唱掉的存歌 50 首','holding','public'),
 ('saved50','提歌達人','累積成功提歌並完成演唱 50 首','permanent','public'),
 ('saved100','提歌大戶','累積成功提歌並完成演唱 100 首','permanent','public'),
 ('saved500','清庫高手','累積成功提歌並完成演唱 500 首','permanent','public'),
 ('failure1','差一個名額','第 1 次有效提歌失敗','permanent','public'),
 ('failure10','又沒擠進去','累積 10 個時段有效提歌失敗','permanent','public'),
 ('failure50','到底輪到我沒','累積 50 個時段有效提歌失敗','permanent','public'),
 ('after_failure','這次有我','有效提歌失敗後，成功提歌並完成演唱','permanent','public'),
 ('sung500','點歌成癮','累積完成演唱 500 首','permanent','public'),
 ('repeat_show','今晚指定曲','同一首歌本場完成演唱 3 次','show','public'),
 ('seventh','幸運七號','自己的歌曲成為本場第 7 首完成演唱','show','public'),
 ('house','把這當自己家','7 個不同日期都有現點紀錄','permanent','public'),
 ('sad3','今晚有故事','本場連續現點 3 首傷感歌','show','public'),
 ('sweet3','甜度超標','本場連續現點 3 首甜歌／戀愛歌','show','public'),
 ('ancient3','穿越人士','本場現點 3 首古風歌','show','public'),
 ('sad5','失戀急診室','本場現點 5 首傷感歌','show','public'),
 ('sweet5','戀愛腦發作','本場現點 5 首甜歌／戀愛歌','show','public'),
 ('ancient5','今晚夢回古代','本場現點 5 首古風歌','show','public'),
 ('moods','人格分裂歌單','本場現點至少 4 種分類','show','public'),
 ('love10','我就愛這首','同一首歌累積現點 10 次','permanent','public'),
 ('dna30','DNA 裡有這首','同一首歌累積現點 30 次','permanent','public'),
 ('explorer','歌單探險家','累積現點 30 首不同歌曲','permanent','public'),
 ('regular','釘子戶','最近 30 天至少 20 天有現點','rolling30','public'),
 ('eighth','第八位客人','成為本場第 8 位不同現點玩家','show','public'),
 ('insomnia','陰間作息','01:00–05:00 現點','permanent','after_award'),
 ('same10','怎麼又是這首','本人第 10 次現點同一首歌','permanent','after_award'),
 ('lucky','今天運氣不錯','每次有效現點由伺服器獨立抽取，機率 1%','permanent','public'),
 ('legend','都市傳說','每次有效現點由伺服器獨立抽取，機率 0.1%','permanent','after_award');
create table papa_achievement_visibility(
 space_id text not null,streamer_id text not null,code text not null references papa_achievement_catalog,
 visibility text not null check(visibility in ('public','condition_hidden','hidden','after_award')),
 primary key(space_id,streamer_id,code)
);
create table papa_achievement_awards(
 space_id text not null,streamer_id text not null,player_id text not null,
 code text not null references papa_achievement_catalog,period text not null,
 active boolean not null,acquired_at timestamptz not null default now(),changed_at timestamptz not null default now(),
 source_event_id bigint not null references papa_events(id),
 primary key(space_id,streamer_id,player_id,code,period)
);
create table papa_achievement_draws(
 space_id text not null,streamer_id text not null,queue_id text not null,player_id text not null,
 won boolean not null,source_event_id bigint not null references papa_events(id),created_at timestamptz not null default now(),
 primary key(space_id,streamer_id,queue_id)
);
create table papa_achievement_request_draws(
 space_id text not null,streamer_id text not null,queue_id text not null,player_id text not null,
 lucky boolean not null,legend boolean not null,source_event_id bigint not null references papa_events(id),created_at timestamptz not null default now(),
 primary key(space_id,streamer_id,queue_id)
);
create index papa_awards_player on papa_achievement_awards(space_id,streamer_id,player_id,changed_at desc);
alter table papa_achievement_catalog enable row level security;
alter table papa_achievement_visibility enable row level security;
alter table papa_achievement_awards enable row level security;
alter table papa_achievement_draws enable row level security;
alter table papa_achievement_request_draws enable row level security;
revoke all on papa_achievement_catalog,papa_achievement_visibility,papa_achievement_awards,papa_achievement_draws,papa_achievement_request_draws from public,anon,authenticated,service_role;

-- Existing indexed room/player entities are the authority. This server query
-- returns bounded eligibility flags only, never downloads a history or song/lyric snapshot.
create function papa_achievement_player_valid(requested_space text,requested_player text,require_active boolean default true)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from papa_v2_entities p where requested_space='space-001' and p.kind='players' and p.id=requested_player
  and coalesce(p.data->'test','false')<>'true'::jsonb and (not require_active or coalesce(p.data->'archived','false')<>'true'::jsonb))
 or exists(select 1 from papa_space_player_profiles p where requested_space<>'space-001' and p.space_id=requested_space and p.player_id=requested_player
  and coalesce(p.data->'test','false')<>'true'::jsonb and (not require_active or coalesce(p.data->'archived','false')<>'true'::jsonb));
$$;
create function papa_achievement_eligibility(requested_space text,requested_room text,requested_player text,as_of timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare result jsonb;rollover int;show_start timestamptz;
begin
 if not exists(select 1 from papa_space_streamers r join papa_spaces s on s.id=r.space_id and s.status='active'
  where r.space_id=requested_space and r.streamer_id=requested_room)
 then raise exception 'ACHIEVEMENT_SCOPE_INVALID';end if;
 if not papa_achievement_player_valid(requested_space,requested_player,false)
 then return '{}'::jsonb;end if;
 select accounting_rollover_hour into rollover from papa_spaces where id=requested_space;
 show_start=((as_of at time zone 'Asia/Taipei')::date+make_interval(hours=>rollover)) at time zone 'Asia/Taipei';
 if show_start>as_of then show_start=show_start-interval '1 day';end if;
 with valid_players as materialized(
  select p.id from papa_v2_entities p where requested_space='space-001' and p.kind='players'
   and coalesce(p.data->'test','false')<>'true'::jsonb
  union all select p.player_id from papa_space_player_profiles p where requested_space<>'space-001' and p.space_id=requested_space
   and coalesce(p.data->'test','false')<>'true'::jsonb
 ), room_queue as materialized(
  select e.id,e.data,papa_accounting_time(e.data->>'at') at,
   papa_accounting_time(e.data->>'completedAt') completed,
   case when jsonb_typeof(e.data->'items')='array' and jsonb_array_length(e.data->'items')>0
    then (select sum(coalesce((i->>'performances')::numeric,1)) from jsonb_array_elements(e.data->'items') i) else 1 end units
  from papa_v2_entities e where e.space_id=requested_space and e.kind='queue' and e.data->>'streamer_id'=requested_room
   and coalesce(e.data->'test','false')<>'true'::jsonb and coalesce(e.data->'selfProvided','false')<>'true'::jsonb
   and e.data->>'kind' in ('live','saved') and nullif(e.data->>'performance_duplicate_of','') is null
   and nullif(e.data->>'receipt_voided_at','') is null
   and exists(select 1 from valid_players p where p.id=e.data->>'playerId')
 ), own_queue as materialized(select * from room_queue where data->>'playerId'=requested_player),
 live as materialized(select * from own_queue where data->>'kind'='live' and papa_accounting_time(data->>'acceptedAt') is not null and data->>'status' in ('pending','waiting','completed','stored') and at<=as_of),
 done as materialized(select * from own_queue where data->>'status'='completed' and completed<=as_of),
 live_counts as(select count(*) total,count(*) filter(where at>=as_of-interval '3 days') three_days,
  count(*) filter(where at>=show_start and extract(hour from at at time zone 'Asia/Taipei')>=1 and extract(hour from at at time zone 'Asia/Taipei')<5) night_count
  from live),
 known_songs as(select data from live union select data from done),
 categories as(select distinct tag from known_songs q cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(q.data->'achievement_tags')='array' then q.data->'achievement_tags' else '[]' end) tag),
 first_live as(select data->>'playerId' player from room_queue where data->>'kind'='live' and papa_accounting_time(data->>'acceptedAt') is not null and data->>'status' in ('pending','waiting','completed','stored') and at>=show_start and at<=as_of order by at,id limit 1),
 first_mic as(select data->>'playerId' player from room_queue where data->>'status'='completed' and completed>=show_start and completed<=as_of order by completed,id limit 1),
 triple as(select at, count(*) over(order by at range between interval '30 minutes' preceding and current row) n from live),
 daily as(select ((at at time zone 'Asia/Taipei')-make_interval(hours=>rollover))::date as show_date,min(at) first_at,count(*) n from live group by 1),
 comeback as(select d.*,(select max(at) from live where at<d.first_at) previous_at from daily d),
 show_live as materialized(select *,coalesce(data->'achievement_tags','[]') ? '傷感' sad,
  coalesce(data->'achievement_tags','[]') ?| array['甜歌','戀愛'] sweet,
  coalesce(data->'achievement_tags','[]') ? '古風' ancient from live where at>=show_start),
 sequence as(select *,lag(sad,1) over(order by at,id) sad1,lag(sad,2) over(order by at,id) sad2,
  lag(sweet,1) over(order by at,id) sweet1,lag(sweet,2) over(order by at,id) sweet2 from show_live),
 failures as materialized(select distinct e.hour_bucket,papa_accounting_time(e.effective_at) at from papa_events e
  where e.space_id=requested_space and e.streamer_id=requested_room and e.actor_player_id=requested_player
   and e.action='request_failed' and e.after_data->>'reason'='hourly_limit' and e.hour_bucket is not null),
 ranked_performances as(select id,data,units,sum(units) over(order by completed,id) ordinal
  from room_queue where data->>'status'='completed' and completed>=show_start and completed<=as_of),
 first_players as(select data->>'playerId' player,min(at) first_at from room_queue
  where data->>'kind'='live' and papa_accounting_time(data->>'acceptedAt') is not null
   and data->>'status' in ('waiting','completed','stored') and at>=show_start and at<=as_of group by 1),
 ordered_players as(select player,row_number() over(order by first_at,player) ordinal from first_players)
 select jsonb_build_object(
  'first_live',coalesce((select player=requested_player from first_live),false),
  'first_mic',coalesce((select player=requested_player from first_mic),false),
  '_first_live_player',(select player from first_live),'_first_mic_player',(select player from first_mic),
  'night',(select night_count>=5 from live_counts),'no_sleep',(select night_count>=5 from live_counts),
  'triple',exists(select 1 from triple where n>=3 and at>as_of-interval '24 hours'),
  'comeback',exists(select 1 from comeback where n>=5 and previous_at is not null and first_at-previous_at>=interval '7 days'),
  'big_requester',(select three_days>=100 from live_counts),'categories',(select count(*)>=10 from categories),
  'stock100',credits>=100,'stock500',credits>=500,'stock1000',credits>=1000,
  'saved10',coalesce((select sum(units)>=10 from done where data->>'kind'='saved' and completed>=show_start),false),
  'saved_success',exists(select 1 from done where data->>'kind'='saved'),
  'saved_failure',exists(select 1 from papa_events e where e.streamer_id=requested_room and e.space_id=requested_space
   and e.actor_player_id=requested_player and e.action='request_failed' and e.after_data->>'reason'='hourly_limit'),
  'sung50',coalesce((select sum(units)>=50 from done),false),'sung100',coalesce((select sum(units)>=100 from done),false),
  'chosen',exists(select 1 from papa_achievement_draws d join done q on q.id=d.queue_id
   where d.space_id=requested_space and d.streamer_id=requested_room and d.player_id=requested_player and d.won),
  'stock50',credits>=50,
  'saved50',coalesce((select sum(units)>=50 from done where data->>'kind'='saved'),false),
  'saved100',coalesce((select sum(units)>=100 from done where data->>'kind'='saved'),false),
  'saved500',coalesce((select sum(units)>=500 from done where data->>'kind'='saved'),false),
  'failure1',(select count(*)>=1 from failures),'failure10',(select count(*)>=10 from failures),'failure50',(select count(*)>=50 from failures),
  'after_failure',exists(select 1 from failures f join done d on d.completed>f.at and d.data->>'kind'='saved'),
  'sung500',coalesce((select sum(units)>=500 from done),false),
  'repeat_show',exists(select 1 from done where completed>=show_start group by data->>'songId' having sum(units)>=3),
  'seventh',exists(select 1 from ranked_performances where ordinal-units<7 and ordinal>=7 and data->>'playerId'=requested_player),
  'house',(select count(distinct (at at time zone 'Asia/Taipei')::date)>=7 from live),
  'sad3',exists(select 1 from sequence where sad and sad1 and sad2),
  'sweet3',exists(select 1 from sequence where sweet and sweet1 and sweet2),
  'ancient3',(select count(*) filter(where ancient)>=3 from show_live),
  'sad5',(select count(*) filter(where sad)>=5 from show_live),'sweet5',(select count(*) filter(where sweet)>=5 from show_live),
  'ancient5',(select count(*) filter(where ancient)>=5 from show_live),
  'moods',(select count(distinct tag)>=4 from show_live q cross join lateral jsonb_array_elements_text(case when jsonb_typeof(q.data->'achievement_tags')='array' then q.data->'achievement_tags' else '[]' end) tag),
  'love10',exists(select 1 from live where data->>'songId' is not null group by data->>'songId' having count(*)>=10),
  'same10',exists(select 1 from live where data->>'songId' is not null group by data->>'songId' having count(*)>=10),
  'dna30',exists(select 1 from live where data->>'songId' is not null group by data->>'songId' having count(*)>=30),
  'explorer',(select count(distinct data->>'songId')>=30 from live),
  'regular',(select count(distinct (at at time zone 'Asia/Taipei')::date)>=20 from live where at>=as_of-interval '30 days'),
  'eighth',exists(select 1 from ordered_players where ordinal=8 and player=requested_player),
  'insomnia',exists(select 1 from live where extract(hour from at at time zone 'Asia/Taipei')>=1 and extract(hour from at at time zone 'Asia/Taipei')<5),
  'lucky',exists(select 1 from papa_achievement_request_draws d join live q on q.id=d.queue_id where d.space_id=requested_space and d.streamer_id=requested_room and d.player_id=requested_player and d.lucky),
  'legend',exists(select 1 from papa_achievement_request_draws d join live q on q.id=d.queue_id where d.space_id=requested_space and d.streamer_id=requested_room and d.player_id=requested_player and d.legend)
 ) into result from (select coalesce(sum((e.data->>'amount')::numeric),0) credits from papa_v2_entities e
  where e.space_id=requested_space and e.kind='ledger' and e.data->>'streamer_id'=requested_room and e.data->>'playerId'=requested_player
   and coalesce(e.data->'test','false')<>'true'::jsonb) balance;
 return result;
end $$;

create function papa_achievement_draw_event() returns trigger
language plpgsql security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare scope text;player text;won boolean;
begin
 if NEW.entity_kind not in ('ledger','queue') or NEW.action in ('migrate','import') or NEW.action like 'import:%' then return NEW;end if;
 player=case when NEW.action='request_failed' then NEW.actor_player_id else coalesce(NEW.after_data->>'playerId',NEW.before_data->>'playerId') end;
 if player is null or NEW.space_id is null then return NEW;end if;
 scope=NEW.space_id;
 if NEW.after_data->>'kind'='live' and papa_accounting_time(NEW.after_data->>'acceptedAt') is not null
  and papa_accounting_time(NEW.before_data->>'acceptedAt') is null
  and NEW.after_data->>'status' in ('waiting','completed','stored')
  and coalesce(NEW.after_data->'test','false')<>'true'::jsonb and coalesce(NEW.after_data->'selfProvided','false')<>'true'::jsonb
  and nullif(NEW.after_data->>'performance_duplicate_of','') is null and papa_achievement_player_valid(scope,player)
 then
  insert into papa_achievement_request_draws values(scope,NEW.streamer_id,NEW.entity_id,player,
   ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint<42949673,
   ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint<4294968,NEW.id,now()) on conflict do nothing;
 end if;
 -- Draw only the first real completion transition, never on reads, revision
 -- recovery, archived updates, duplicate correction or effective-time edits.
 if NEW.entity_kind='queue' and NEW.after_data->>'status'='completed'
  and NEW.before_data->>'status' is distinct from 'completed'
  and NEW.after_data->>'kind' in ('live','saved') and nullif(NEW.after_data->>'performance_duplicate_of','') is null
  and coalesce(NEW.after_data->'test','false')<>'true'::jsonb and coalesce(NEW.after_data->'selfProvided','false')<>'true'::jsonb
  and papa_achievement_player_valid(scope,player)
 then
  won=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint<21474836;
  insert into papa_achievement_draws values(scope,NEW.streamer_id,NEW.entity_id,player,won,NEW.id,now()) on conflict do nothing;
 end if;
 return NEW;
end $$;
create trigger papa_achievement_draw_after_event after insert on papa_events
 for each row when (NEW.entity_kind='queue') execute function papa_achievement_draw_event();

-- Deferred until the existing atomic business transaction ends. Multiple
-- events for the same player evaluate once, after ALL completion draws.
create function papa_achievement_event() returns trigger
language plpgsql security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare scope text;player text;flags jsonb;item record;period_key text;rollover int;prior papa_achievement_awards;
 lock_key text;changed boolean;source_name text;recipient_player text;expired record;context_before text;
begin
 if NEW.entity_kind not in ('ledger','queue') or NEW.action in ('migrate','import') or NEW.action like 'import:%' then return NEW;end if;
 player=case when NEW.action='request_failed' then NEW.actor_player_id else coalesce(NEW.after_data->>'playerId',NEW.before_data->>'playerId') end;
 if player is null or NEW.space_id is null then return NEW;end if;
 scope=NEW.space_id;
 if not papa_achievement_player_valid(scope,player,false) then return NEW;end if;
 lock_key='papa.achievement_'||md5(scope||'|'||NEW.streamer_id||'|'||player);
 if current_setting(lock_key,true)='done' then return NEW;end if;
 perform set_config(lock_key,'done',true);
 flags=papa_achievement_eligibility(scope,NEW.streamer_id,player);
 select accounting_rollover_hour into rollover from papa_spaces where id=scope;
 period_key=((now() at time zone 'Asia/Taipei')-make_interval(hours=>rollover))::date::text;
 context_before=coalesce(nullif(current_setting('papa.actor_context',true),''),'{}');
 -- The system attribution is distinct from the initiating source Audit.
 perform set_config('papa.actor_context',jsonb_build_object('role','system','space_id',scope,'streamer_id',NEW.streamer_id)::text,true);
 for expired in update papa_achievement_awards a set active=false,changed_at=now(),source_event_id=NEW.id
  where a.space_id=scope and a.streamer_id=NEW.streamer_id and a.period=period_key and a.active
   and a.code in ('first_live','first_mic') and a.player_id is distinct from flags->>('_'||a.code||'_player') returning a.player_id,a.code loop
  insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id,target_player_id,before_data,after_data)
  values(NEW.streamer_id,'achievement',expired.code,'achievement_inactive','system',scope,expired.player_id,
   jsonb_build_object('playerId',expired.player_id,'active',true,'period',period_key),
   jsonb_build_object('playerId',expired.player_id,'active',false,'period',period_key,'source_event_id',NEW.id));
 end loop;
 select r->>'display_name' into source_name from papa_v2_entities e cross join lateral jsonb_array_elements(e.data->'streamers') r
  where e.kind='meta' and r->>'id'=NEW.streamer_id;
 for item in select c.code,c.name,c.lifetime,coalesce((flags->>c.code)::boolean,false) qualified from papa_achievement_catalog c loop
  recipient_player=player;
  if item.code in ('first_live','first_mic') then
   recipient_player=coalesce(flags->>('_'||item.code||'_player'),player);
   item.qualified=flags->>('_'||item.code||'_player') is not null;
  end if;
  period_key=case when item.lifetime='show' then ((now() at time zone 'Asia/Taipei')-make_interval(hours=>rollover))::date::text else 'lifetime' end;
  select a.* into prior from papa_achievement_awards a where a.space_id=scope and a.streamer_id=NEW.streamer_id and a.player_id=recipient_player and a.code=item.code and a.period=period_key;
  if not found and not item.qualified then continue;end if;
  changed=prior.code is null or prior.active is distinct from item.qualified;
  if not changed then continue;end if;
  insert into papa_achievement_awards values(scope,NEW.streamer_id,recipient_player,item.code,period_key,item.qualified,now(),now(),NEW.id)
  on conflict(space_id,streamer_id,player_id,code,period) do update set active=excluded.active,changed_at=excluded.changed_at,source_event_id=excluded.source_event_id
   where papa_achievement_awards.active is distinct from excluded.active returning true into changed;
  if not found then continue;end if;
  insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id,target_player_id,before_data,after_data)
  values(NEW.streamer_id,'achievement',item.code,case when item.qualified then 'achievement_awarded' else 'achievement_inactive' end,'system',scope,recipient_player,
   case when prior.code is not null then jsonb_build_object('active',prior.active,'period',prior.period) end,
   jsonb_build_object('playerId',recipient_player,'active',item.qualified,'period',period_key,'source_event_id',NEW.id));
  -- Hidden medals never disclose their name or condition through notifications.
  if item.qualified and coalesce((select visibility from papa_achievement_visibility where space_id=scope and streamer_id=NEW.streamer_id and code=item.code),
   (select default_visibility from papa_achievement_catalog where code=item.code))<>'hidden' then
   insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,space_id)
   values(NEW.streamer_id,coalesce(source_name,'主播'),recipient_player,'achievement',1,coalesce(source_name,'主播')||'｜取得勳章「'||item.name||'」',item.code,scope);
  end if;
 end loop;
 perform set_config('papa.actor_context',context_before,true);
 return NEW;
end $$;
create constraint trigger papa_achievement_after_event after insert on papa_events deferrable initially deferred
 for each row when (NEW.entity_kind in ('ledger','queue')) execute function papa_achievement_event();

create function papa_achievement_page(requested_space text,requested_room text,requested_player text,actor_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;flags jsonb;result jsonb;rollover int;show_day text;manager boolean;
begin
 ctx=papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 manager=ctx->>'recipient' in ('__admin__','__super__');
 if not manager and ctx->>'recipient' is distinct from requested_player then raise exception 'ACHIEVEMENT_PLAYER_INVALID';end if;
 flags=papa_achievement_eligibility(requested_space,requested_room,requested_player);
 select accounting_rollover_hour into rollover from papa_spaces where id=requested_space;
 show_day=((now() at time zone 'Asia/Taipei')-make_interval(hours=>rollover))::date::text;
 with rows as(select c.code,c.name,c.condition_text,c.lifetime,
  coalesce(v.visibility,c.default_visibility) visibility,coalesce((flags->>c.code)::boolean,false) qualified,a.acquired_at,
  a.active recorded_active from papa_achievement_catalog c
  left join papa_achievement_visibility v on v.space_id=requested_space and v.streamer_id=requested_room and v.code=c.code
  left join papa_achievement_awards a on a.space_id=requested_space and a.streamer_id=requested_room and a.player_id=requested_player and a.code=c.code
   and a.period=case when c.lifetime='show' then show_day else 'lifetime' end)
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'lifetime',lifetime,'visibility',visibility,
  'condition',case when manager or visibility='public' or visibility='after_award' and qualified then condition_text end,
  'qualified',qualified,'acquiredAt',acquired_at,'recorded',recorded_active is not null) order by code),'[]') into result
 from rows where manager or visibility not in ('hidden','after_award') or visibility='after_award' and qualified;
 return jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',requested_space,'streamerId',requested_room,'playerId',requested_player),'rows',result);
end $$;
create function papa_achievement_visibility_set(requested_space text,requested_room text,actor_context jsonb,requested_code text,requested_visibility text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;before_value text;
begin
 ctx=papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if requested_visibility is null or requested_visibility not in ('public','condition_hidden','hidden','after_award')
  or not exists(select 1 from papa_achievement_catalog where code=requested_code) then raise exception 'ACHIEVEMENT_SETTING_INVALID';end if;
 select visibility into before_value from papa_achievement_visibility where space_id=requested_space and streamer_id=requested_room and code=requested_code;
 if before_value is not distinct from requested_visibility then return jsonb_build_object('ok',true);end if;
 insert into papa_achievement_visibility values(requested_space,requested_room,requested_code,requested_visibility)
 on conflict(space_id,streamer_id,code) do update set visibility=excluded.visibility;
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_account_id,actor_streamer_id,space_id,before_data,after_data)
 values(requested_room,'achievement',requested_code,'achievement_visibility',actor_context->>'role',(actor_context->>'account_id')::uuid,
  actor_context->>'actor_streamer_id',requested_space,jsonb_build_object('visibility',before_value),jsonb_build_object('visibility',requested_visibility));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function papa_achievement_player_valid(text,text,boolean),papa_achievement_eligibility(text,text,text,timestamptz),papa_achievement_event(),papa_achievement_draw_event(),papa_achievement_page(text,text,text,jsonb),papa_achievement_visibility_set(text,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function papa_achievement_player_valid(text,text,boolean),papa_achievement_eligibility(text,text,text,timestamptz),papa_achievement_event(),papa_achievement_draw_event() from service_role;
grant execute on function papa_achievement_page(text,text,text,jsonb),papa_achievement_visibility_set(text,text,jsonb,text,text) to service_role;
notify pgrst,'reload schema';
commit;
