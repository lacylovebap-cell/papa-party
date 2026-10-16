begin;
-- Nullable metadata only: no backfill, replay, deletion or business-data change.
alter table public.papa_achievement_awards add column revoked_at timestamptz, add column revoked_by uuid, add column revocation_reason text, add column revocation_event_id bigint;
alter table public.papa_global_badge_awards add column revoked_at timestamptz, add column revoked_by uuid, add column revocation_reason text, add column revocation_event_id bigint;


-- Source clarification explicitly confirmed by user; thresholds/Emoji/lifetimes unchanged.
update public.papa_achievement_catalog set condition_text=case code
 when 'dice20' then '實際使用玩家端骰子點歌或提歌，完成演唱累積20次；主播代骰、主播自骰及自帶不算。'
 when 'dice_repeat' then '3天內玩家端骰子點同名歌至少4次，4次也必須在這3天內全部完成演唱；主播代骰、主播自骰及自帶不算。'
 when 'cleaner' then '玩家端實際骰子點到同主播所有玩家從未點過的同名歌並唱完；曾點但未唱完仍不符合，主播代骰、主播自骰及自帶排除。'
 when 'destiny' then '本次玩家端骰子選歌前，本人普通現點或提歌已唱完次數最多且至少10次的同名歌，並列第一均符合；本次玩家骰子唱完才取得，主播代骰、主播自骰及自帶不算。'
 when 'coincidence' then '只看本人玩家端骰子順序，連續3次整段共有至少一位歌手且唱完；普通點歌不影響，主播代骰、主播自骰及自帶不算。'
 end where code in ('dice20','dice_repeat','cleaner','destiny','coincidence');

create or replace function public.papa_badge_progress(s text,r text,p text,as_of timestamptz default now())
returns jsonb language sql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
 with clock as(select (as_of at time zone 'Asia/Taipei')::date day_key,
  ((as_of at time zone 'Asia/Taipei')-interval '19 hours')::date show_key,
  ((as_of at time zone 'Asia/Taipei')-interval '23 hours')::date night),
 profiles as(
  select 'space-001'::text space_id,b.legacy_player_id player_id from public.papa_account_legacy_players b
   where b.account_id=public.papa_badge_account(s,p)
  union select f.space_id,f.player_id from public.papa_space_player_profiles f where f.account_id=public.papa_badge_account(s,p)
  union select s,p
 ),queues as materialized(
  select e.id,e.space_id,e.data,
   e.space_id=s and e.data->>'streamer_id'=r in_room,
   exists(select 1 from profiles f where f.space_id=e.space_id and f.player_id=e.data->>'playerId') mine_global,
   public.papa_accounting_time(e.data->>'at') requested,
   case when e.data->>'status'='completed' then public.papa_accounting_time(e.data->>'completedAt') end finished,
   coalesce(e.data->>'source',case when e.data->'selfProvided'='true' then 'self' else 'manual' end) source,
   case when jsonb_typeof(e.data->'items')='array' and jsonb_array_length(e.data->'items')>0 then e.data->'items'
    else jsonb_build_array(jsonb_build_object('title',e.data->>'title','artist',e.data->>'artist','performances',1)) end items
  from public.papa_v2_entities e where e.kind='queue' and e.data->>'kind' in ('live','saved','self')
   and (e.space_id=s and e.data->>'streamer_id'=r or exists(select 1 from profiles f where f.space_id=e.space_id and f.player_id=e.data->>'playerId'))
   and public.papa_achievement_player_valid(e.space_id,e.data->>'playerId',false)
   and coalesce(e.data->'test','false')<>'true' and nullif(e.data->>'voided_at','') is null
   and nullif(e.data->>'voidedAt','') is null and nullif(e.data->>'receipt_voided_at','') is null
   and nullif(e.data->>'performance_duplicate_of','') is null
   and public.papa_accounting_time(e.data->>'at')<=as_of
 ),units as materialized(
  select q.*,q.id||':'||i.n||':'||n.unit event_key,q.data->>'playerId' player_id,q.data->>'kind' kind,
   q.source='manual' and coalesce(q.data->'selfProvided','false')<>'true' ordinary,
   lower(btrim(public.papa_badge_song_field(q.data,i.item,'title'))) title,
   case when jsonb_typeof(i.item->'achievement_tags')='array' then i.item->'achievement_tags'
    when jsonb_array_length(q.items)=1 and jsonb_typeof(q.data->'achievement_tags')='array' then q.data->'achievement_tags' else '[]'::jsonb end tags,
   case when jsonb_typeof(i.item->'achievement_performers')='array' then array(select lower(btrim(x)) from jsonb_array_elements_text(i.item->'achievement_performers') x where btrim(x)<>'')
    else regexp_split_to_array(lower(coalesce(public.papa_badge_song_field(q.data,i.item,'artist'),'')),'\s*[+＋&＆]\s*') end artists,
   (q.requested at time zone 'Asia/Taipei')::date request_day,
   ((q.requested at time zone 'Asia/Taipei')-interval '19 hours')::date request_show,
   ((q.finished at time zone 'Asia/Taipei')-interval '19 hours')::date finish_show,
   extract(hour from q.requested at time zone 'Asia/Taipei')::int request_hour
  from queues q cross join lateral jsonb_array_elements(q.items) with ordinality i(item,n)
  cross join lateral generate_series(1,case when i.item->>'performances' ~ '^[0-9]{1,4}$' then greatest(1,least(1000,(i.item->>'performances')::int)) else 1 end) n(unit)
 ),mine as materialized(select * from units where in_room and player_id=p),
 done as materialized(select * from mine where ordinary and finished<=as_of),
 room_done as materialized(select * from units where in_room and ordinary and finished<=as_of),
 global_done as materialized(select * from units where mine_global and ordinary and finished<=as_of),
 credits as materialized(
  select event_key,requested,finished,request_day,request_hour,kind,1::numeric quantity from mine
   where ordinary and kind='live' and nullif(data->>'acceptedAt','') is not null and data->>'status' in ('waiting','completed','stored')
  union all select 'credit:'||e.id,public.papa_accounting_time(e.data->>'at'),null,
   (public.papa_accounting_time(e.data->>'at') at time zone 'Asia/Taipei')::date,
   extract(hour from public.papa_accounting_time(e.data->>'at') at time zone 'Asia/Taipei')::int,'credit',
   coalesce(nullif(e.data->>'receipt_quantity',''),e.data->>'amount')::numeric
  from public.papa_v2_entities e where e.kind='ledger' and e.space_id=s and e.data->>'streamer_id'=r and e.data->>'playerId'=p
   and e.data->>'accounting_kind'='receipt' and (e.data->>'amount')::numeric>0
   and coalesce(e.data->'test','false')<>'true' and coalesce(e.data->'conversion','false')<>'true'
   and coalesce(e.data->'openingBalance','false')<>'true' and coalesce(e.data->'excludeStats','false')<>'true'
   and coalesce(e.data->'accounting_adjustment','false')<>'true' and nullif(e.data->>'voided_at','') is null
   and public.papa_accounting_time(e.data->>'at')<=as_of
 ),failures as materialized(
  select distinct hour_bucket from public.papa_events where space_id=s and streamer_id=r and actor_player_id=p
   and action='request_failed' and after_data->>'reason'='hourly_limit' and hour_bucket is not null and created_at<=as_of
 ),tag_sources as materialized(
  select in_room,mine_global,data->>'playerId' player_id,requested,finished,case when jsonb_typeof(data->'achievement_tags')='array' then data->'achievement_tags' else '[]'::jsonb end tags
  from queues where source='manual' and coalesce(data->'selfProvided','false')<>'true' and finished<=as_of
  union all select in_room,mine_global,player_id,requested,finished,tags from units where ordinary and finished<=as_of
 ),tags as materialized(
  select t.*,lower(btrim(j.value#>>'{}')) keyword from tag_sources t cross join lateral jsonb_array_elements(tags) j(value)
  where jsonb_typeof(j.value)='string' and btrim(j.value#>>'{}')<>''
 ),days as(select distinct request_day from done),
 day_groups as(select request_day,request_day-row_number() over(order by request_day)::int grp from days),
 triple_recent as(select *,sum(case when finished is null or finished>as_of then 1 else 0 end) over(order by requested,event_key) grp
  from credits where requested>=as_of-interval '24 hours'),
 triple_windows as(select count(*) over(partition by grp order by requested range between interval '30 minutes' preceding and current row) n
  from triple_recent where finished<=as_of),
 show_live as materialized(select *,sum(case when finished is null or finished>as_of or request_show<>finish_show then 1 else 0 end) over(order by requested,event_key) grp
  from mine where ordinary and kind='live' and request_show=(select show_key from clock)),
 tag_keys as(select distinct k.keyword from show_live l cross join lateral jsonb_array_elements_text(l.tags)k(keyword)),
 tag_sequence as(select l.*,k.keyword,sum(case when l.tags ? k.keyword and l.finished<=as_of and l.request_show=l.finish_show then 0 else 1 end)
  over(partition by k.keyword order by l.requested,l.event_key) tag_group from show_live l cross join tag_keys k),
 tag_runs as(select keyword,tag_group,count(*) n from tag_sequence where tags ? keyword and finished<=as_of and request_show=finish_show group by keyword,tag_group),
 artist_keys as(select distinct unnest(artists) artist from units where in_room and ordinary and request_show=(select show_key from clock)),
 artist_sequence as(select u.*,k.artist,sum(case when k.artist=any(u.artists) then 0 else 1 end) over(partition by k.artist order by u.requested,u.event_key) artist_group
  from units u cross join artist_keys k where u.in_room and u.ordinary and u.request_show=(select show_key from clock)),
 artist_runs as(select artist,artist_group,count(distinct player_id) n from artist_sequence where artist=any(artists) and finished<=as_of and request_show=finish_show
  group by artist,artist_group having bool_or(player_id=p)),
 random_rows as(select * from mine where source in ('draw','cross_draw') and kind in ('live','saved')),
 random_keys as(select distinct unnest(artists) artist from random_rows),
 random_sequence as(select u.*,k.artist,sum(case when k.artist=any(u.artists) and u.finished<=as_of then 0 else 1 end) over(partition by k.artist order by u.requested,u.event_key) artist_group
  from random_rows u cross join random_keys k),
 random_runs as(select artist,artist_group,count(*) n from random_sequence where artist=any(artists) and finished<=as_of group by artist,artist_group),
 activity as(select event_key,requested,kind from credits union all select event_key,requested,kind from mine where ordinary and kind='saved'),
 show_first as(select * from activity where ((requested at time zone 'Asia/Taipei')-interval '19 hours')::date=(select show_key from clock) order by requested,event_key limit 1),
 metrics(metric,current_value) as(
  select 'done',count(*)::numeric from done union all select 'saved',count(*) from done where kind='saved'
  union all select 'dice',count(*) from mine where source in ('draw','cross_draw') and kind in ('live','saved') and finished<=as_of
  union all select 'explorer',count(distinct title) from mine where finished<=as_of and title<>''
  union all select 'failures',count(*) from failures
  union all select 'stock',greatest(0,coalesce(sum((data->>'amount')::numeric),0)) from public.papa_v2_entities
   where kind='ledger' and space_id=s and data->>'streamer_id'=r and data->>'playerId'=p and coalesce(data->'test','false')<>'true'
    and public.papa_accounting_time(data->>'at')<=as_of
  union all select 'global_title',coalesce(max(n),0) from(select count(*) n from global_done where title<>'' group by title)x
  union all select 'tags',count(distinct keyword) from tags where in_room and player_id=p
  union all select 'global_tags',count(distinct keyword) from tags where mine_global
  union all select 'show_tags',count(distinct keyword) from tags where in_room and player_id=p
   and ((requested at time zone 'Asia/Taipei')-interval '19 hours')::date=(select show_key from clock)
   and ((finished at time zone 'Asia/Taipei')-interval '19 hours')::date=(select show_key from clock)
  union all select 'live_days',count(distinct request_day) from done where kind='live' and request_day between (select day_key-29 from clock) and (select day_key from clock)
  union all select 'done_days',count(distinct request_day) from done where request_day between (select day_key-29 from clock) and (select day_key from clock)
  union all select 'attendance',count(distinct request_day) from credits where request_day between (select day_key-29 from clock) and (select day_key from clock)
  union all select 'streak',coalesce(max(n),0) from(select count(*) n from day_groups group by grp)x
  union all select 'credits3',coalesce(sum(quantity),0) from credits where request_day between (select day_key-2 from clock) and (select day_key from clock)
  union all select 'night_credit',coalesce(sum(quantity),0) from credits where request_day=(select day_key from clock) and request_hour>=1 and request_hour<5
  union all select 'night_done',count(*) from done where kind='live' and (request_hour>=23 or request_hour<5)
   and ((requested at time zone 'Asia/Taipei')-interval '23 hours')::date=(select night from clock)
   and ((finished at time zone 'Asia/Taipei')-interval '23 hours')::date=(select night from clock)
   and (extract(hour from finished at time zone 'Asia/Taipei')>=23 or extract(hour from finished at time zone 'Asia/Taipei')<5)
  union all select 'show_saved',count(*) from done where kind='saved' and request_show=(select show_key from clock) and finish_show=request_show
  union all select 'day_saved',count(*) from done where kind='saved' and request_day=(select day_key from clock)
  union all select 'show_repeat',coalesce(max(n),0) from(select count(*) n from done where title<>'' and request_show=(select show_key from clock) and finish_show=request_show group by title)x
  union all select 'show_people',coalesce(max(n),0) from(select count(distinct player_id) n from room_done where title in
    (select title from done where request_show=(select show_key from clock) and finish_show=request_show) and request_show=(select show_key from clock) and finish_show=request_show group by title)x
  union all select 'slots',count(distinct extract(hour from coalesce(public.papa_accounting_time(data->>'quota_effective_at'),requested) at time zone 'Asia/Taipei'))
   from done where request_show=(select show_key from clock) and finish_show=request_show
   and ((coalesce(public.papa_accounting_time(data->>'quota_effective_at'),requested) at time zone 'Asia/Taipei')-interval '19 hours')::date=request_show
   and extract(hour from coalesce(public.papa_accounting_time(data->>'quota_effective_at'),requested) at time zone 'Asia/Taipei') in (19,20,21,22,23,0)
  union all select 'triple',coalesce(max(n),0) from triple_windows
  union all select 'shared_tags',coalesce(max(n),0) from tag_runs
  union all select 'same_artist',coalesce(max(n),0) from artist_runs
  union all select 'random_artist',coalesce(max(n),0) from random_runs
  union all select 'late_days',count(distinct request_day) from credits where request_hour>=1 and request_hour<7 and request_day between (select day_key-29 from clock) and (select day_key from clock)
  union all select 'own_title',coalesce(max(n),0) from(select count(*) n from done where title<>'' group by title)x
  union all select 'return_show',count(*) from done where kind='live' and request_show=(select show_key from clock) and finish_show=request_show
   and exists(select 1 from show_first f where f.kind='live' and not exists(select 1 from activity a where a.requested<f.requested
    and (f.requested at time zone 'Asia/Taipei')::date-(a.requested at time zone 'Asia/Taipei')::date<=14))
  union all select 'dice_title3',coalesce(max(n),0) from(select count(*) n from mine where source in ('draw','cross_draw') and kind in ('live','saved') and finished<=as_of
    and request_day between (select day_key-2 from clock) and (select day_key from clock) and title<>'' group by title)x
 )
 select coalesce(jsonb_object_agg(t.code,jsonb_build_object('current',least(t.target,greatest(0,m.current_value)),'target',t.target,'unit',t.unit,'window',t.window_label)),'{}'::jsonb)
 from (values
 ('sung50','done',50,'首','累積'),('sung100','done',100,'首','累積'),('sung500','done',500,'首','累積'),
 ('saved_success','saved',1,'首','累積'),('saved50','saved',50,'首','累積'),('saved100','saved',100,'首','累積'),('saved500','saved',500,'首','累積'),
 ('saved_failure','failures',1,'次','有效時段'),('failure1','failures',1,'次','有效時段'),('failure10','failures',10,'次','有效時段'),('failure50','failures',50,'次','有效時段'),
 ('stock50','stock',50,'首','目前持有'),('stock100','stock',100,'首','目前持有'),('stock500','stock',500,'首','目前持有'),('stock1000','stock',1000,'首','目前持有'),
 ('love10','global_title',15,'首','全站同名歌'),('dna30','global_title',30,'首','全站同名歌'),('same10','global_title',50,'首','全站同名歌'),
 ('categories','tags',10,'個標籤','累積'),('all_tags','global_tags',20,'個標籤','全站累積'),('moods','show_tags',4,'個標籤','本場'),
 ('house','live_days',15,'日','近30日'),('regular','done_days',15,'日','近30日'),('attendance30','attendance',30,'日','近30日'),
 ('streak7','streak',7,'日','連續日期'),('fan15','streak',15,'日','連續日期'),
 ('big_requester','credits3',100,'首','近3個日曆日'),('no_sleep','night_credit',5,'首','本日01–05時'),('night','night_done',5,'首','本夜23–05時'),
 ('dice20','dice',20,'首','累積'),('explorer','explorer',50,'首不同歌曲','累積'),('saved10','show_saved',10,'首','本場'),
 ('repeat_show','show_repeat',3,'首同名歌','本場'),
 ('same_song_show','show_people',2,'位玩家','本場同名歌'),('five_players','show_people',5,'位玩家','本場同名歌'),
 ('every_hour','slots',6,'個時段','本場'),('triple','triple',3,'首','24小時內30分鐘連續'),('sad3','shared_tags',5,'首','本場連續共有標籤'),
 ('dice_repeat','dice_title3',4,'首同名歌','近3日'),('comeback','return_show',5,'首','回歸本場'),
 ('same_artist_show','same_artist',3,'位玩家','本場共同歌手'),('popular_show','show_people',2,'位玩家','本場同名歌'),
 ('insomnia','late_days',5,'日','近30日凌晨'),('destiny','own_title',10,'首同名歌','歷史'),('coincidence','random_artist',3,'首','連續共同歌手')
 )t(code,metric,target,unit,window_label) join metrics m on m.metric=t.metric;
$$;

create or replace function public.papa_badge_current_active(s text,r text,p text,c text,as_of timestamptz default now())
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 with identity as(select public.papa_badge_account(s,p) subject),target as(
  select subject,case when subject is null then p else public.papa_medal_target(s,subject) end local_player from identity),
 validity as(select t.*,case when subject is null then public.papa_achievement_player_valid(s,p,true)
  else exists(select 1 from public.papa_medal_profiles() registered where registered.valid and registered.account_id=t.subject) end registered,
  not exists(select 1 from public.papa_medal_profiles() p0 where p0.space_id=s and p0.account_id=t.subject)
   or exists(select 1 from public.papa_medal_profiles() p0 where p0.space_id=s and p0.account_id=t.subject and p0.valid) local_allowed from target t)
 select v.registered and case when catalog.badge_scope='global' then exists(select 1 from public.papa_global_badge_awards g
  where g.account_id=v.subject and g.code=c and g.revoked_at is null and g.active and (g.expires_at is null or g.expires_at>as_of))
 else v.local_allowed and exists(select 1 from public.papa_achievement_awards a where a.space_id=s and a.streamer_id=r and a.code=c
  and (a.player_id=p or v.subject is not null and public.papa_badge_account(s,a.player_id)=v.subject)
  and a.revoked_at is null and a.active and (a.manual_verified or a.rule_version=2 or catalog.badge_id is null) and (a.expires_at is null or a.expires_at>as_of)
  and public.papa_badge_dynamic_valid(s,r,v.local_player,c,as_of)
  and case when c in ('stock50','stock100','stock500','stock1000') then
   (select coalesce(sum((e.data->>'amount')::numeric),0) from public.papa_v2_entities e where e.kind='ledger' and e.space_id=s
    and e.data->>'streamer_id'=r and e.data->>'playerId'=v.local_player and coalesce(e.data->'test','false')<>'true'
    and public.papa_accounting_time(e.data->>'at')<=as_of)>=case c when 'stock50' then 50 when 'stock100' then 100 when 'stock500' then 500 else 1000 end
   else true end) end
 from public.papa_achievement_catalog catalog cross join validity v where catalog.code=c and not catalog.retired;
$$;

create or replace function public.papa_achievement_page_medal_v3(requested_space text,requested_room text,requested_player text,actor_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;manager boolean;result jsonb;subject uuid;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 manager=ctx->>'recipient' in ('__admin__','__super__');
 if not manager and ctx->>'recipient' is distinct from requested_player then raise exception 'ACHIEVEMENT_PLAYER_INVALID';end if;
 subject=public.papa_badge_account(requested_space,requested_player);
 with rows as(
  select c.code,c.badge_id,c.emoji,c.badge_scope,c.name,c.lifetime,
   case when c.badge_scope='global' or left(c.badge_id,1) in ('H','L') then c.default_visibility else coalesce(v.visibility,c.default_visibility) end visibility,c.condition_text,
   case when c.badge_scope='global' then g.acquired_at else a.acquired_at end acquired_at,
   case when c.badge_scope='global' then g.expires_at else a.expires_at end expires_at,
   case when c.badge_scope='global' then g.manual_verified else a.manual_verified end manual_verified,
   case when c.badge_scope='global' then g.revoked_at else a.revoked_at end revoked_at,
   case when c.badge_scope='global' then g.revocation_reason else a.revocation_reason end revocation_reason,
   coalesce(case when c.badge_scope='global' then g.revoked_at is null and g.active and (g.manual_verified or g.expires_at is null or g.expires_at>now())
    else a.revoked_at is null and a.active and (a.manual_verified or (a.rule_version=2 or c.badge_id is null) and (a.expires_at is null or a.expires_at>now())
     and public.papa_badge_dynamic_valid(requested_space,requested_room,requested_player,c.code)) end,false) current_active
  from public.papa_achievement_catalog c
  left join public.papa_achievement_visibility v on v.space_id=requested_space and v.streamer_id=requested_room and v.code=c.code
  left join lateral(select award.acquired_at,award.active,award.expires_at,award.manual_verified,award.rule_version,award.revoked_at,award.revocation_reason
   from public.papa_achievement_awards award where award.space_id=requested_space and award.streamer_id=requested_room
    and (award.player_id=requested_player or subject is not null and public.papa_badge_account(requested_space,award.player_id)=subject) and award.code=c.code
    order by (award.revoked_at is null) desc,(award.active and (award.expires_at is null or award.expires_at>now())) desc,award.acquired_at desc,award.manual_verified desc limit 1) a on true
  left join public.papa_global_badge_awards g on g.account_id=subject and g.code=c.code
  where not c.retired
 )
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'badgeId',case when not manager and visibility='after_award' and acquired_at is null then null else badge_id end,'emoji',case when not manager and visibility='after_award' and acquired_at is null then null else emoji end,'scope',badge_scope,
  'name',case when not manager and visibility='after_award' and acquired_at is null then '？？？' else name end,'lifetime',case when not manager and visibility='after_award' and acquired_at is null then null else lifetime end,'visibility',visibility,
  'condition',case when manager then condition_text when left(coalesce(badge_id,''),1)='H' then null when visibility='public' or acquired_at is not null then condition_text end,
  'managementKey',case when manager then md5('medal-manager:'||coalesce(subject::text,'legacy:'||requested_space||':'||requested_player)) end,'managementEvidenceKey',case when manager and acquired_at is not null then public.papa_medal_evidence_key(code,md5('medal-manager:'||coalesce(subject::text,'legacy:'||requested_space||':'||requested_player)),case when badge_scope='streamer' then requested_space end,case when badge_scope='streamer' then requested_room end,acquired_at) end,'qualified',acquired_at is not null and revoked_at is null,'revoked',revoked_at is not null,'revokedAt',revoked_at,'revocationReason',revocation_reason,'currentActive',current_active,'acquiredAt',acquired_at,'expiresAt',expires_at,
  'recorded',acquired_at is not null,'manualVerified',coalesce(manual_verified,false)) order by badge_id nulls last,code),'[]')
 into result from rows where manager or visibility<>'hidden' or acquired_at is not null;
 return jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',requested_space,'streamerId',requested_room,'playerId',requested_player),'rows',result,'totalDefinitions',(select count(*) from public.papa_achievement_catalog where not retired),'unlocked',(select count(*) from jsonb_array_elements(result) x where x->'recorded'='true' and x->'revoked'<>'true'));
end $$;

create or replace function public.papa_achievement_management_accounts_v5(requested_space text,requested_room text,actor_context jsonb,
 requested_view text default 'catalog',requested_code text default null,query_text text default '',page_number int default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;super boolean;chosen record;result jsonb;subject_key text;directory jsonb;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');super=ctx->>'recipient'='__super__';
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if requested_view is null or requested_view not in ('catalog','recipients','candidates','recipientRooms') or query_text is null or length(query_text)>100
  or page_number is null or page_number not between 0 and 100000 then raise exception 'ACHIEVEMENT_MANAGEMENT_INVALID';end if;
 if requested_view<>'catalog' then
  select * into chosen from public.papa_achievement_catalog where code=requested_code and not retired;
  if not found or chosen.badge_scope='global' and not super then raise exception 'ACHIEVEMENT_MANAGEMENT_INVALID';end if;
 end if;
 if requested_view='recipientRooms' then
  subject_key=actor_context->>'management_subject';
  if not super or chosen.badge_scope='global' or subject_key is null or subject_key !~ '^[a-f0-9]{32}$' then raise exception 'ACHIEVEMENT_MANAGEMENT_INVALID';end if;
 end if;
 if requested_view='catalog' then
  with identities as(
   select a.code,coalesce(public.papa_badge_account(a.space_id,a.player_id)::text,'legacy:'||a.space_id||':'||a.player_id) subject
   from public.papa_achievement_awards a join public.papa_achievement_catalog c on c.code=a.code and c.badge_scope='streamer'
   where a.revoked_at is null and (super or a.space_id=requested_space and a.streamer_id=requested_room)
   union all select code,account_id::text from public.papa_global_badge_awards where super and revoked_at is null),
  counts as(select code,count(distinct subject)::int total from identities group by code)
  select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'emoji',c.emoji,'badgeId',c.badge_id,
   'scope',c.badge_scope,'condition',c.condition_text,'lifetime',c.lifetime,
   'visibility',case when c.badge_scope='global' or left(coalesce(c.badge_id,''),1) in ('H','L') then c.default_visibility else coalesce(v.visibility,c.default_visibility) end,
   'recipientCount',coalesce(a.total,0),'qualified',false,'manualAllowed',c.badge_scope='streamer' or super) order by c.code),'[]')) into result
   from public.papa_achievement_catalog c left join counts a on a.code=c.code
   left join public.papa_achievement_visibility v on v.space_id=requested_space and v.streamer_id=requested_room and v.code=c.code
   where not c.retired and (super or c.badge_scope='streamer');
  select coalesce(jsonb_agg(jsonb_build_object('id',room->>'id','spaceId',room->>'spaceId','name',room->>'display_name') order by room->>'display_name'),'[]')
   into directory from jsonb_array_elements(public.papa_streamer_directory()) room
   where coalesce((room->>'active')::boolean,true) and (super or room->>'id'=requested_room and room->>'spaceId'=requested_space);
  result=result||jsonb_build_object('isSuper',super,'rooms',directory);
 elsif requested_view='candidates' then
  with accounts as materialized(select * from public.papa_medal_accounts()),
  local_profiles as materialized(select account_id,valid from public.papa_medal_profiles() where space_id=requested_space),
  held as materialized(
   select distinct public.papa_badge_account(a.space_id,a.player_id) account_id from public.papa_achievement_awards a
    where chosen.badge_scope='streamer' and a.space_id=requested_space and a.streamer_id=requested_room and a.code=requested_code and a.revoked_at is null
   union select account_id from public.papa_global_badge_awards where chosen.badge_scope='global' and code=requested_code and revoked_at is null),
  matched as(select a.*,held.account_id is not null earned from accounts a left join held on held.account_id=a.account_id
   where position(lower(btrim(query_text)) in a.search_text)>0 and
    (not exists(select 1 from local_profiles p where p.account_id=a.account_id) or exists(select 1 from local_profiles p where p.account_id=a.account_id and p.valid))),
  paged as(select * from matched order by name,account_id limit 20 offset page_number*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('playerId','account:'||account_id::text,'name',name,'publicIds',public_ids,'earned',earned) order by name,account_id) from paged),'[]'),
   'total',(select count(*) from matched),'page',page_number) into result;
 elsif requested_view='recipients' then
  with grouped as(select a.player_key,min(a.name) name,min(a.acquired_at) acquired_at,bool_or(a.manual_verified) manual_verified,
   bool_or(not a.manual_verified) automatic,bool_or(a.current_active) current_active,count(distinct (a.space_id,a.streamer_id))::int room_count
   from public.papa_medal_award_rows(requested_code) a where (super or a.space_id=requested_space and a.streamer_id=requested_room)
   group by a.player_key),
  matched as(select * from grouped where position(lower(btrim(query_text)) in lower(name))>0),
  paged as(select * from matched order by name,player_key limit 20 offset page_number*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('playerKey',player_key,'name',name,'earned',true,'acquiredAt',acquired_at,
   'currentActive',current_active,'source',case when manual_verified and automatic then '自動達成／管理者授予' when manual_verified then '管理者授予' else '自動達成' end,
   'canViewRooms',super and chosen.badge_scope='streamer','roomCount',case when chosen.badge_scope='global' then null else room_count end) order by name,player_key) from paged),'[]'),
   'total',(select count(*) from matched),'page',page_number) into result;
 else
  with grouped as(select a.space_id,a.streamer_id,coalesce(room->>'display_name','歷史主播') name,a.acquired_at,
   bool_or(a.manual_verified) manual_verified,bool_or(not a.manual_verified) automatic,bool_or(a.current_active) current_active
   from public.papa_medal_award_rows(requested_code) a left join lateral jsonb_array_elements(public.papa_streamer_directory()) room on room->>'id'=a.streamer_id and room->>'spaceId'=a.space_id
   where a.player_key=subject_key group by a.space_id,a.streamer_id,room->>'display_name',a.acquired_at),
  paged as(select * from grouped order by name,space_id,streamer_id,acquired_at desc limit 20 offset page_number*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('streamerId',streamer_id,'spaceId',space_id,'name',name,'acquiredAt',acquired_at,'currentActive',current_active,
   'source',case when manual_verified and automatic then '自動達成／管理者授予' when manual_verified then '管理者授予' else '自動達成' end) order by name,space_id,streamer_id,acquired_at desc) from paged),'[]'),
   'total',(select count(*) from grouped),'page',page_number) into result;
 end if;
 return result||jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',requested_space,'streamerId',requested_room),'mode',requested_view);
end $$;

create function public.papa_medal_award_key(c text,s text,r text,p text,period_key text,acquired timestamptz,source_event bigint)
returns text language sql immutable set search_path=pg_catalog as $$
 select md5(concat_ws('|','medal-award-v1',c,s,r,p,period_key,extract(epoch from acquired)::text,source_event::text));
$$;
revoke all on function public.papa_medal_award_key(text,text,text,text,text,timestamptz,bigint) from public,anon,authenticated,service_role;

create function public.papa_achievement_revoke(requested_space text,requested_room text,actor_context jsonb,requested_code text,requested_award text,requested_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;super boolean;c record;a record;event_id bigint;previous_context text;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');super=ctx->>'recipient'='__super__';
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if requested_award is null or requested_award !~ '^[a-f0-9]{32}$' or requested_reason is null or length(btrim(requested_reason)) not between 4 and 500
  or nullif(actor_context->>'account_id','') is null then raise exception 'ACHIEVEMENT_REVOCATION_INVALID';end if;
 select * into c from public.papa_achievement_catalog where code=requested_code and not retired;
 if not found then raise exception 'ACHIEVEMENT_REVOCATION_INVALID';end if;
 if c.badge_scope='global' and not super then raise exception 'ACHIEVEMENT_SUPER_REQUIRED';end if;
 perform revision from public.papa_v2_revision where id=1 for update;
 if c.badge_scope='streamer' then
  select x.* into a from public.papa_achievement_awards x where x.code=requested_code
   and (super or x.space_id=requested_space and x.streamer_id=requested_room)
   and public.papa_medal_award_key(x.code,x.space_id,x.streamer_id,x.player_id,x.period,x.acquired_at,x.source_event_id)=requested_award for update;
 else
  select x.*,null::text space_id,null::text streamer_id,'account:'||x.account_id::text player_id,'lifetime'::text period into a
   from public.papa_global_badge_awards x where x.code=requested_code
    and public.papa_medal_award_key(x.code,null,null,'account:'||x.account_id::text,'lifetime',x.acquired_at,x.source_event_id)=requested_award for update;
 end if;
 if not found then raise exception 'ACHIEVEMENT_REVOCATION_STALE';end if;
 if a.revoked_at is not null then return jsonb_build_object('ok',true,'alreadyRevoked',true);end if;
 previous_context=current_setting('papa.actor_context',true);
 -- No automatic award evaluation may be triggered by a correction Audit event.
 perform set_config('papa.actor_context',jsonb_build_object('role','system','space_id',coalesce(a.space_id,requested_space),'streamer_id',coalesce(a.streamer_id,requested_room),'badgeCorrection',true)::text,true);
 insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_account_id,actor_streamer_id,target_player_id,space_id,before_data,after_data)
 values(coalesce(a.streamer_id,requested_room),'achievement',requested_code,'achievement_revoked',actor_context->>'role',(actor_context->>'account_id')::uuid,
  actor_context->>'actor_streamer_id',a.player_id,coalesce(a.space_id,requested_space),
  jsonb_build_object('active',a.active,'acquired_at',a.acquired_at,'expires_at',a.expires_at,'manual_verified',a.manual_verified,'source_event_id',a.source_event_id,'period',a.period,'scope',c.badge_scope),
  jsonb_build_object('active',false,'reason',btrim(requested_reason),'reversal_of',a.source_event_id,'award_key',requested_award,'scope',c.badge_scope)) returning id into event_id;
 if c.badge_scope='streamer' then
  update public.papa_achievement_awards set active=false,revoked_at=now(),revoked_by=(actor_context->>'account_id')::uuid,
   revocation_reason=btrim(requested_reason),revocation_event_id=event_id,changed_at=now()
   where space_id=a.space_id and streamer_id=a.streamer_id and player_id=a.player_id and code=a.code and period=a.period;
  -- Manual certificates already bump through their existing signal trigger.
  if not a.manual_verified then
   if to_regprocedure('public.papa_room_sync_bump(text,text,text,text)') is not null then
    perform public.papa_room_sync_bump('room',a.space_id,a.streamer_id,'settings');end if;
   update public.papa_v2_revision set revision=revision+1 where id=1;
  end if;
 else
  update public.papa_global_badge_awards set active=false,revoked_at=now(),revoked_by=(actor_context->>'account_id')::uuid,
   revocation_reason=btrim(requested_reason),revocation_event_id=event_id,changed_at=now() where account_id=a.account_id and code=a.code;
  update public.papa_v2_revision set revision=revision+1 where id=1;
 end if;
 perform set_config('papa.actor_context',coalesce(previous_context,''),true);
 return jsonb_build_object('ok',true,'alreadyRevoked',false);
end $$;
revoke all on function public.papa_achievement_revoke(text,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.papa_achievement_revoke(text,text,jsonb,text,text,text) to service_role;


create or replace function public.papa_badge_apply(s text,r text,changes jsonb,event_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare b jsonb;c record;prior record;at_time timestamptz;expiry timestamptz;key text;is_active boolean;context_before text;room_name text;silent boolean;last_revoked timestamptz;
begin
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>50000 then raise exception 'BADGE_CHANGES_INVALID';end if;
 context_before=current_setting('papa.actor_context',true);
 silent=coalesce(nullif(context_before,'')::jsonb->>'badgeReplay','false')='true';
 select entry->>'display_name' into room_name from jsonb_array_elements(public.papa_streamer_directory_in_space(s)) entry where entry->>'id'=r limit 1;
 perform set_config('papa.actor_context',jsonb_build_object('role','system','space_id',s,'streamer_id',r)::text,true);
 for b in select value from jsonb_array_elements(changes) loop
  select code,lifetime,badge_id into c from public.papa_achievement_catalog where code=b->>'code' and badge_scope='streamer' and not retired;
  if not found or c.badge_id is distinct from b->>'id' or not public.papa_achievement_player_valid(s,b->>'playerId',false)
   or jsonb_typeof(b->'active') is distinct from 'boolean' then raise exception 'BADGE_CANDIDATE_INVALID';end if;
  at_time=public.papa_accounting_time(b->>'acquiredAt');expiry=public.papa_accounting_time(b->>'expiresAt');is_active=(b->>'active')::boolean;
  key=case when c.lifetime in ('show','day') and b->>'period' ~ '^-?[0-9]{1,7}$'
   then (date '1970-01-01'+(b->>'period')::int)::text else 'lifetime' end;
  if at_time is null or at_time>now()+interval '5 seconds' or (is_active and expiry is not null and expiry<=now())
   or c.lifetime in ('24h','7d','30d','show','day') and expiry is distinct from public.papa_badge_expiry(c.lifetime,at_time)
  then raise exception 'BADGE_CANDIDATE_TIME_INVALID';end if;
  select max(a.revoked_at) into last_revoked from public.papa_achievement_awards a where a.space_id=s and a.streamer_id=r and a.code=c.code
   and (a.player_id=b->>'playerId' or public.papa_badge_account(s,a.player_id)=public.papa_badge_account(s,b->>'playerId'));
  if last_revoked is not null then
   if at_time<=last_revoked then continue;end if;
   key=key||':after:'||md5(extract(epoch from last_revoked)::text);
  end if;
  select a.* into prior from public.papa_achievement_awards a
   where a.space_id=s and a.streamer_id=r and a.code=c.code and a.revoked_at is null and (a.player_id=b->>'playerId' and a.period=key
    or a.player_id='account:'||public.papa_badge_account(s,b->>'playerId')::text and a.manual_verified and a.active
     and (a.expires_at is null or a.expires_at>now()) and public.papa_badge_current_active(s,r,a.player_id,c.code))
   order by a.manual_verified desc,a.acquired_at desc limit 1 for update;
  -- A real automatic renewal must not overwrite an expired manual certificate.
  -- Keep that certificate/Audit, and reuse one separate automatic state row.
  if prior.manual_verified and prior.expires_at<=now() and is_active and c.lifetime in ('24h','7d','30d') then
   key=key||':auto';
     select a.* into prior from public.papa_achievement_awards a where a.space_id=s and a.streamer_id=r
    and a.player_id=b->>'playerId' and a.code=c.code and a.period=key for update;
  end if;
  if prior.manual_verified or prior.code is null and not is_active then continue;end if;
  if prior.code is not null and prior.active=is_active and prior.acquired_at=at_time and prior.expires_at is not distinct from expiry and prior.rule_version=2 then continue;end if;
  insert into public.papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,changed_at,source_event_id,expires_at,rule_version)
  values(s,r,b->>'playerId',c.code,key,is_active,at_time,now(),event_id,expiry,2)
  on conflict(space_id,streamer_id,player_id,code,period) do update set active=excluded.active,
   acquired_at=case when excluded.active then excluded.acquired_at else papa_achievement_awards.acquired_at end,
   changed_at=excluded.changed_at,source_event_id=excluded.source_event_id,expires_at=excluded.expires_at,rule_version=2;
  insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id,target_player_id,before_data,after_data)
  values(r,'achievement',c.code,case when is_active then 'achievement_awarded' else 'achievement_inactive' end,'system',s,b->>'playerId',
   case when prior.code is not null then jsonb_build_object('active',prior.active,'period',prior.period,'acquired_at',prior.acquired_at,'expires_at',prior.expires_at,'rule_version',prior.rule_version) end,
   jsonb_build_object('playerId',b->>'playerId','active',is_active,'period',key,'source_event_id',event_id,'rule_version',2,'acquired_at',at_time,'expires_at',expiry,'event_key',b->>'eventKey',
    'evidence',case when jsonb_typeof(b->'evidence')='object' then jsonb_strip_nulls(jsonb_build_object(
     'queueId',b->'evidence'->'queueId','eventKey',b->'evidence'->'eventKey','title',b->'evidence'->'title','artist',b->'evidence'->'artist',
     'source',b->'evidence'->'source','kind',b->'evidence'->'kind','requestAt',b->'evidence'->'requestAt','completedAt',b->'evidence'->'completedAt')) end));
  if is_active and not silent and (prior.code is null or not prior.active or prior.expires_at<=at_time) then
   insert into public.papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,space_id)
   select r,coalesce(room_name,'主播'),b->>'playerId','achievement',1,coalesce(room_name,'主播')||'｜取得勳章「'||name||'」',code,s
    from public.papa_achievement_catalog where code=c.code;
  end if;
 end loop;
 perform set_config('papa.actor_context',coalesce(context_before,''),true);
end $$;

create or replace function public.papa_achievement_manual_grant(requested_space text,requested_room text,actor_context jsonb,
 requested_player text,requested_code text,requested_reason text,requested_show_day date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;c record;subject uuid;event_id bigint;effective_at timestamptz;expiry timestamptz;period_key text;exact_time boolean;target_player text;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if requested_reason is null or length(btrim(requested_reason)) not between 4 and 500 then raise exception 'ACHIEVEMENT_CERTIFICATION_INVALID';end if;
 perform revision from public.papa_v2_revision where id=1 for update;
 if not public.papa_achievement_player_in_room(requested_space,requested_room,requested_player) then raise exception 'ACHIEVEMENT_ROOM_PLAYER_REQUIRED';end if;
 select * into c from public.papa_achievement_catalog where code=requested_code and not retired;
 if not found then raise exception 'ACHIEVEMENT_CERTIFICATION_INVALID';end if;
 if c.badge_scope='global' and ctx->>'recipient'<>'__super__' then raise exception 'ACHIEVEMENT_SUPER_REQUIRED';end if;
 subject=public.papa_badge_account(requested_space,requested_player);
 if subject is null then raise exception 'ACHIEVEMENT_ACCOUNT_REQUIRED';end if;
 target_player=public.papa_medal_target(requested_space,subject);
 if c.badge_scope='streamer' and exists(select 1 from public.papa_achievement_awards a where a.space_id=requested_space and a.streamer_id=requested_room
   and a.revoked_at is null and a.code=requested_code and public.papa_badge_account(requested_space,a.player_id)=subject)
  or c.badge_scope='global' and exists(select 1 from public.papa_global_badge_awards where account_id=subject and code=requested_code and revoked_at is null)
 then return jsonb_build_object('ok',true,'alreadyRecorded',true);end if;
 exact_time=nullif(actor_context->>'certification_at','') is not null;
 effective_at=case when exact_time then public.papa_accounting_time(actor_context->>'certification_at') else now() end;
 if effective_at is null or effective_at>now() or effective_at<date '2020-01-01' then raise exception 'ACHIEVEMENT_CERTIFICATION_TIME_INVALID';end if;
 if c.lifetime='show' then
  if requested_show_day is null or requested_show_day>((now() at time zone 'Asia/Taipei')-interval '19 hours')::date or requested_show_day<date '2020-01-01'
   then raise exception 'ACHIEVEMENT_SHOW_DAY_REQUIRED';end if;
  if exact_time and ((effective_at at time zone 'Asia/Taipei')-interval '19 hours')::date<>requested_show_day then raise exception 'ACHIEVEMENT_SHOW_DAY_REQUIRED';end if;
  if not exact_time and requested_show_day<>((now() at time zone 'Asia/Taipei')-interval '19 hours')::date then
   effective_at=(requested_show_day+time '19:00') at time zone 'Asia/Taipei';end if;
 end if;
 expiry=public.papa_badge_expiry(c.lifetime,effective_at);
 period_key=case when c.lifetime='show' then requested_show_day::text when c.lifetime='day' then (effective_at at time zone 'Asia/Taipei')::date::text else 'lifetime' end;
 insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_account_id,actor_streamer_id,target_player_id,space_id,before_data,after_data)
 values(requested_room,'achievement',requested_code,'achievement_manual_certified',actor_context->>'role',(actor_context->>'account_id')::uuid,
  actor_context->>'actor_streamer_id',target_player,requested_space,case when c.badge_scope='global' then (select to_jsonb(old) from public.papa_global_badge_awards old where old.account_id=subject and old.code=requested_code) end,jsonb_build_object('playerId',target_player,'accountId',subject,'code',requested_code,
  'scope',c.badge_scope,'period',period_key,'reason',btrim(requested_reason),'certified_at',now(),
  'historical_acquired_at',case when exact_time then to_jsonb(effective_at) else to_jsonb('unknown'::text) end,
  'time_precision',case when exact_time then 'exact' when c.lifetime='show' then 'show' else 'certification' end,'expires_at',expiry)) returning id into event_id;
 if c.badge_scope='streamer' then
 insert into public.papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,changed_at,source_event_id,manual_verified,certification_reason,expires_at,rule_version)
 values(requested_space,requested_room,target_player,requested_code,case when exists(select 1 from public.papa_achievement_awards old where old.space_id=requested_space and old.streamer_id=requested_room and old.player_id=target_player and old.code=requested_code and old.period=period_key) then period_key||':manual:'||event_id::text else period_key end,true,effective_at,now(),event_id,true,btrim(requested_reason),expiry,2);
 else
  insert into public.papa_global_badge_awards(account_id,code,active,acquired_at,expires_at,source_event_id,manual_verified)
   values(subject,requested_code,true,effective_at,expiry,event_id,true)
   on conflict(account_id,code) do update set active=true,acquired_at=excluded.acquired_at,expires_at=excluded.expires_at,
    source_event_id=excluded.source_event_id,manual_verified=true,changed_at=now(),revoked_at=null,revoked_by=null,revocation_reason=null,revocation_event_id=null;
  update public.papa_v2_revision set revision=revision+1 where id=1;
 end if;
 return jsonb_build_object('ok',true,'alreadyRecorded',false);
end $$;

create or replace function public.papa_achievement_event() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare ctx jsonb;global_candidates jsonb;player text;subject uuid;item record;flags jsonb;lock_key text;legacy_prior record;qualified boolean;inactive_global record;
begin
 if new.action='achievement_revoked' or coalesce(nullif(current_setting('papa.actor_context',true),''),'{}')::jsonb->>'badgeCorrection'='true' then return new;end if;
 if new.action in ('migrate','import') or new.action like 'import:%' then return new;end if;
 ctx=coalesce(nullif(current_setting('papa.actor_context',true),''),'{}')::jsonb;
 lock_key='papa.badge2_'||md5(new.space_id||'|'||new.streamer_id);
 if current_setting(lock_key,true) is distinct from 'done' and ctx->>'badgeRuleVersion'='2' then
  perform set_config(lock_key,'done',true);
  perform public.papa_badge_apply(new.space_id,new.streamer_id,coalesce(ctx->'badgeChangesByRoom'->new.streamer_id,ctx->'badgeChanges','[]'),new.id);
 end if;
 player=case when new.action='request_failed' then new.actor_player_id else coalesce(new.after_data->>'playerId',new.before_data->>'playerId') end;
 if player is null or not public.papa_achievement_player_valid(new.space_id,player,false) then return new;end if;
 lock_key='papa.badge2_global_'||md5(new.space_id||'|'||player);
 if current_setting(lock_key,true)='done' then return new;end if;
 perform set_config(lock_key,'done',true);subject=public.papa_badge_account(new.space_id,player);
 if subject is not null then
  insert into public.papa_global_badge_awards(account_id,code,active,acquired_at,source_event_id,manual_verified)
   select subject,a.code,bool_or(a.active),min(a.acquired_at),min(a.source_event_id),true
   from public.papa_achievement_awards a join public.papa_achievement_catalog c on c.code=a.code and c.badge_scope='global'
   where a.revoked_at is null and a.manual_verified and public.papa_badge_account(a.space_id,a.player_id)=subject group by a.code
  on conflict(account_id,code) do update set manual_verified=true,active=excluded.active,changed_at=now() where papa_global_badge_awards.revoked_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'acquired_at',c.acquired_at)),'[]') into global_candidates
   from public.papa_badge_global_candidates(new.space_id,player) c;
  -- Inactivate only computed awards with no remaining valid historical proof.
  perform set_config('papa.actor_context',jsonb_build_object('role','system','space_id',new.space_id,'streamer_id',new.streamer_id)::text,true);
  for inactive_global in update public.papa_global_badge_awards g set active=false,changed_at=now(),source_event_id=new.id
   where g.account_id=subject and g.active and not g.manual_verified and not exists(
    select 1 from jsonb_to_recordset(global_candidates) c(code text,acquired_at timestamptz) where c.code=g.code)
    returning g.code,g.acquired_at loop
   insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id,target_player_id,before_data,after_data)
   values(new.streamer_id,'achievement',inactive_global.code,'achievement_inactive','system',new.space_id,player,
    jsonb_build_object('active',true,'acquired_at',inactive_global.acquired_at,'badge_scope','global'),
    jsonb_build_object('playerId',player,'active',false,'acquired_at',inactive_global.acquired_at,'badge_scope','global','source_event_id',new.id));
  end loop;
  for item in select c.code,c.acquired_at from jsonb_to_recordset(global_candidates) c(code text,acquired_at timestamptz) loop
   select g.active,g.manual_verified,g.acquired_at into legacy_prior from public.papa_global_badge_awards g where g.account_id=subject and g.code=item.code;
   insert into public.papa_global_badge_awards(account_id,code,active,acquired_at,source_event_id)
   values(subject,item.code,true,item.acquired_at,new.id) on conflict(account_id,code) do update
    set active=true,acquired_at=excluded.acquired_at,changed_at=now(),source_event_id=excluded.source_event_id
    where papa_global_badge_awards.revoked_at is null and not papa_global_badge_awards.manual_verified and (not papa_global_badge_awards.active or papa_global_badge_awards.acquired_at<>excluded.acquired_at);
   if found then
    insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id,target_player_id,before_data,after_data)
    values(new.streamer_id,'achievement',item.code,case when coalesce(legacy_prior.active,false) then 'achievement_rejudged' else 'achievement_awarded' end,'system',new.space_id,player,
     case when legacy_prior.acquired_at is not null then jsonb_build_object('active',legacy_prior.active,'acquired_at',legacy_prior.acquired_at,'badge_scope','global') end,
     jsonb_build_object('playerId',player,'active',true,'acquired_at',item.acquired_at,'badge_scope','global','source_event_id',new.id));
    if coalesce(legacy_prior.active,false)=false and coalesce(ctx->>'badgeReplay','false')<>'true' then
    insert into public.papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,space_id)
     select new.streamer_id,'全站',player,'achievement',1,'全站｜取得勳章「'||c.name||'」',c.code,new.space_id
     from public.papa_achievement_catalog c where c.code=item.code;
    end if;
   end if;
  end loop;
 end if;
 -- The three out-of-workbook legacy medals are deliberately unchanged.
 flags=public.papa_achievement_eligibility_legacy(new.space_id,new.streamer_id,player);
 perform set_config('papa.actor_context',jsonb_build_object('role','system','space_id',new.space_id,'streamer_id',new.streamer_id)::text,true);
 for item in select code,name from public.papa_achievement_catalog where code in ('saved_success','saved_failure','sung50') loop
  qualified=coalesce((flags->>item.code)::boolean,false);
  select a.* into legacy_prior from public.papa_achievement_awards a where a.space_id=new.space_id and a.streamer_id=new.streamer_id
   and a.player_id=player and a.code=item.code and a.period='lifetime';
  if legacy_prior.revoked_at is not null or legacy_prior.manual_verified or legacy_prior.code is null and not qualified or legacy_prior.active is not distinct from qualified then continue;end if;
   insert into public.papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,source_event_id,rule_version)
   values(new.space_id,new.streamer_id,player,item.code,'lifetime',qualified,now(),new.id,2)
   on conflict(space_id,streamer_id,player_id,code,period) do update set active=excluded.active,changed_at=now(),source_event_id=excluded.source_event_id;
   insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id,target_player_id,after_data)
    values(new.streamer_id,'achievement',item.code,case when qualified then 'achievement_awarded' else 'achievement_inactive' end,'system',new.space_id,player,
    jsonb_build_object('playerId',player,'active',qualified,'period','lifetime','source_event_id',new.id));
   if qualified then insert into public.papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,space_id)
    values(new.streamer_id,'主播',player,'achievement',1,'主播｜取得勳章「'||item.name||'」',item.code,new.space_id);end if;
 end loop;
 perform set_config('papa.actor_context',ctx::text,true);
 return new;
end $$;

create or replace function public.papa_medal_evidence_page(s text,r text,actor jsonb,c text,subject_key text,evidence_key text,page_number int)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;super boolean;catalog record;result jsonb;entries jsonb='[]';item jsonb;trigger_data jsonb;songs jsonb;matching int;progress jsonb;subject_name text;
begin
 ctx=public.papa_notice_category_scope(s,r,actor,'room');super=ctx->>'recipient'='__super__';
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if subject_key is null or subject_key !~ '^[a-f0-9]{32}$' or evidence_key is not null and evidence_key !~ '^[a-f0-9]{32}$'
  or page_number is null or page_number not between 0 and 100000 then raise exception 'ACHIEVEMENT_EVIDENCE_INVALID';end if;
 select * into catalog from public.papa_achievement_catalog where code=c and not retired;
 if not found or catalog.badge_scope='global' and not super then raise exception 'ACHIEVEMENT_EVIDENCE_INVALID';end if;
 select a.name into subject_name from public.papa_medal_award_rows(c) a where a.player_key=subject_key limit 1;
 with awards as(
  select a.space_id,a.streamer_id,a.player_id,a.period,a.acquired_at,a.expires_at,a.active,a.manual_verified,a.certification_reason,a.source_event_id,a.rule_version,a.revoked_at,a.revocation_reason,
   md5('medal-manager:'||coalesce(public.papa_badge_account(a.space_id,a.player_id)::text,'legacy:'||a.space_id||':'||a.player_id)) player_key
  from public.papa_achievement_awards a where catalog.badge_scope='streamer' and a.code=c and (super or a.space_id=s and a.streamer_id=r)
  union all select null,null,'account:'||g.account_id::text,'lifetime',g.acquired_at,g.expires_at,g.active,g.manual_verified,null,g.source_event_id,2,g.revoked_at,g.revocation_reason,
   md5('medal-manager:'||g.account_id::text) from public.papa_global_badge_awards g where catalog.badge_scope='global' and g.code=c and super),
 filtered as(select * from awards where player_key=subject_key and (evidence_key is null or public.papa_medal_evidence_key(c,player_key,space_id,streamer_id,acquired_at)=evidence_key))
 select jsonb_build_object('records',coalesce((select jsonb_agg(to_jsonb(p)) from(select * from filtered order by acquired_at desc,space_id,streamer_id,player_id,period limit 20 offset page_number*20)p),'[]'),
  'total',(select count(*) from filtered)) into result;
 for item in select value from jsonb_array_elements(result->'records') loop
  trigger_data=null;songs='[]';matching=0;progress=null;
  if item->>'manual_verified'='true' then
   select jsonb_build_object('kind','manual','reason',coalesce(item->>'certification_reason',e.after_data->>'reason')) into trigger_data from public.papa_events e where e.id=(item->>'source_event_id')::bigint;
  else
   -- The existing module-feed index bounds this to achievement events. Only
   -- selected rule/song evidence is returned, never raw Audit JSON or messages.
   select e.after_data->'evidence' into trigger_data from public.papa_events e
    where e.entity_kind='achievement' and e.entity_id=c and e.action='achievement_awarded'
     and e.space_id=item->>'space_id' and e.streamer_id=item->>'streamer_id' and e.target_player_id=item->>'player_id'
     and e.after_data->>'source_event_id'=item->>'source_event_id' and e.after_data->>'period'=item->>'period'
     and public.papa_accounting_time(e.after_data->>'acquired_at')=public.papa_accounting_time(item->>'acquired_at')
     and jsonb_typeof(e.after_data->'evidence')='object' order by e.created_at desc,e.id desc limit 1;
   if trigger_data is not null then
    songs=jsonb_build_array(jsonb_build_object('title',left(trigger_data->>'title',300),'artist',left(trigger_data->>'artist',150),
     'source',trigger_data->>'source','kind',trigger_data->>'kind','requestAt',trigger_data->>'requestAt','completedAt',trigger_data->>'completedAt','recorded',true));matching=1;
   elsif catalog.badge_scope='streamer' then
    with candidates as materialized(select q.id,q.data from public.papa_v2_entities q where q.kind='queue' and q.space_id=item->>'space_id'
     and q.data->>'streamer_id'=item->>'streamer_id' and q.data->>'playerId'=item->>'player_id' and q.data->>'status'='completed'
     and public.papa_accounting_time(q.data->>'completedAt')=public.papa_accounting_time(item->>'acquired_at')
     and coalesce(q.data->'test','false')<>'true' and nullif(q.data->>'voided_at','') is null and nullif(q.data->>'voidedAt','') is null
     and nullif(q.data->>'performance_duplicate_of','') is null),
    units as(select q.id,i.ordinality item_number,i.value,q.data from candidates q cross join lateral jsonb_array_elements(
     case when jsonb_typeof(q.data->'items')='array' and jsonb_array_length(q.data->'items')>0 then q.data->'items'
      else jsonb_build_array(jsonb_build_object('title',q.data->>'title','artist',q.data->>'artist')) end) with ordinality i(value,ordinality)),
    preview as(select * from units order by id,item_number limit 20)
    select coalesce((select jsonb_agg(jsonb_build_object('title',left(coalesce(value->>'title',data->>'title'),300),'artist',left(coalesce(value->>'artist',data->>'artist'),150),
     'source',coalesce(data->>'source',case when data->'selfProvided'='true' then 'self' else 'manual' end),'kind',data->>'kind',
     'requestAt',data->>'at','completedAt',data->>'completedAt','recorded',false) order by id,item_number) from preview),'[]'),(select count(*) from units) into songs,matching;
   end if;
  end if;
  -- Only P22's clarified source rule is evaluated here. Other medals show the
  -- official condition and a clearly labelled historical progress recalculation.
  if c in ('cleaner','dice20','dice_repeat','destiny','coincidence') and item->>'manual_verified'<>'true' then
   select coalesce(jsonb_agg(v||jsonb_build_object('playerDice',v->>'source' in ('draw','cross_draw') and v->>'kind' in ('live','saved'),
    'earlierTitleRequests',case when c='cleaner' then (select count(*) from public.papa_v2_entities q where q.kind='queue' and q.space_id=item->>'space_id'
     and q.data->>'streamer_id'=item->>'streamer_id' and q.data->>'kind' in ('live','saved','self')
     and public.papa_achievement_player_valid(q.space_id,q.data->>'playerId',false) and coalesce(q.data->'test','false')<>'true' and nullif(q.data->>'voided_at','') is null
     and nullif(q.data->>'performance_duplicate_of','') is null and q.data->>'acceptedAt' is not null
     and q.data->>'status' in ('waiting','completed','stored') and public.papa_accounting_time(q.data->>'at')<public.papa_accounting_time(v->>'requestAt')
     and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(q.data->'items')='array' and jsonb_array_length(q.data->'items')>0
      then q.data->'items' else jsonb_build_array(jsonb_build_object('title',q.data->>'title')) end) song where lower(btrim(song->>'title'))=lower(btrim(v->>'title')))) end)),'[]')
    into songs from jsonb_array_elements(songs) v;
  end if;
  if catalog.badge_scope='streamer' and item->>'manual_verified'<>'true' and c<>'cleaner' then
   progress=public.papa_badge_progress(item->>'space_id',item->>'streamer_id',item->>'player_id',public.papa_accounting_time(item->>'acquired_at'))->c;
  end if;
  entries=entries||jsonb_build_array(jsonb_build_object('name',catalog.name,'emoji',catalog.emoji,'lifetime',catalog.lifetime,'condition',catalog.condition_text,
   'sourceRule',case when c in ('cleaner','dice20','dice_repeat','destiny','coincidence') then '只計玩家端骰子／玩家跨主播骰子；主播自己骰、主播代骰及一般自帶均排除。' end,
   'streamerName',case when catalog.badge_scope='global' then '全站勳章' else coalesce((select room->>'display_name' from jsonb_array_elements(public.papa_streamer_directory()) room
    where room->>'id'=item->>'streamer_id' and room->>'spaceId'=item->>'space_id' limit 1),'歷史主播') end,
   'playerName',coalesce(subject_name,'歷史玩家'),'awardKey',public.papa_medal_award_key(c,item->>'space_id',item->>'streamer_id',item->>'player_id',item->>'period',public.papa_accounting_time(item->>'acquired_at'),(item->>'source_event_id')::bigint),'revokedAt',item->'revoked_at','revocationReason',item->'revocation_reason','acquiredAt',item->'acquired_at','expiresAt',item->'expires_at','manualVerified',item->'manual_verified','manualReason',case when item->>'manual_verified'='true' then trigger_data->>'reason' end,
   'currentActive',item->>'revoked_at' is null and (item->>'active')::boolean and (item->>'expires_at' is null or public.papa_accounting_time(item->>'expires_at')>now()) and public.papa_badge_current_active(coalesce(item->>'space_id',s),coalesce(item->>'streamer_id',r),item->>'player_id',c),
   'evidenceType',case when item->>'manual_verified'='true' then 'manual' when trigger_data is not null then 'recorded' when matching>0 then 'candidate' else 'unavailable' end,
   'songs',songs,'matchingSongCount',matching,'progressRecalculated',progress));
 end loop;
 return jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',s,'streamerId',r),'mode','evidence','rows',entries,'total',result->'total','page',page_number);
end $$;

create or replace function public.papa_achievement_management(requested_space text,requested_room text,actor_context jsonb,
 requested_view text default 'catalog',requested_code text default null,query_text text default '',page_number int default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;entries jsonb='[]';item jsonb;held boolean;
begin
 if requested_view='evidence' then
  return public.papa_medal_evidence_page(requested_space,requested_room,actor_context,requested_code,actor_context->>'management_subject',actor_context->>'management_evidence',page_number);
 end if;
 result=public.papa_achievement_management_accounts_v5(requested_space,requested_room,actor_context,requested_view,requested_code,query_text,page_number);
 if requested_view in ('recipients','recipientRooms') then
  for item in select value from jsonb_array_elements(result->'rows') loop
   select exists(select 1 from public.papa_achievement_awards a where a.code=requested_code and a.revoked_at is null
    and md5('medal-manager:'||coalesce(public.papa_badge_account(a.space_id,a.player_id)::text,'legacy:'||a.space_id||':'||a.player_id))=coalesce(item->>'playerKey',actor_context->>'management_subject')
    and (requested_view='recipientRooms' and a.space_id=item->>'spaceId' and a.streamer_id=item->>'streamerId' and a.acquired_at=public.papa_accounting_time(item->>'acquiredAt')
     or requested_view='recipients' and (result->>'isSuper'='true' or actor_context->>'role'='super_admin' or a.space_id=requested_space and a.streamer_id=requested_room)))
    or exists(select 1 from public.papa_global_badge_awards g where g.code=requested_code and g.revoked_at is null and md5('medal-manager:'||g.account_id::text)=item->>'playerKey') into held;
   entries=entries||jsonb_build_array(item||jsonb_build_object('lifetime',(select lifetime from public.papa_achievement_catalog where code=requested_code),'earned',held,'revoked',not held,'evidenceKey',public.papa_medal_evidence_key(requested_code,actor_context->>'management_subject',item->>'spaceId',item->>'streamerId',public.papa_accounting_time(item->>'acquiredAt'))));
  end loop;
  result=jsonb_set(result,'{rows}',entries);
 end if;
 return result;
end $$;

notify pgrst,'reload schema';
commit;