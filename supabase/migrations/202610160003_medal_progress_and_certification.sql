begin;
-- Only the three explicitly supplied symbols change. No award/history rewrite.
update public.papa_achievement_catalog set emoji=case code
 when 'sung50' then '✴' when 'saved_failure' then '⛔' when 'saved_success' then '💖' end
 where code in ('sung50','saved_failure','saved_success');

-- One private aggregate, reused by the existing atlas RPC. Venue is deliberately
-- absent: sound/radio share each streamer achievement, global follows Account.
create function public.papa_badge_progress(s text,r text,p text,as_of timestamptz default now())
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
 random_rows as(select * from mine where source in ('draw','cross_draw','proxy_draw','streamer_draw','self','cross_self')),
 random_keys as(select distinct unnest(artists) artist from random_rows),
 random_sequence as(select u.*,k.artist,sum(case when k.artist=any(u.artists) and u.finished<=as_of then 0 else 1 end) over(partition by k.artist order by u.requested,u.event_key) artist_group
  from random_rows u cross join random_keys k),
 random_runs as(select artist,artist_group,count(*) n from random_sequence where artist=any(artists) and finished<=as_of group by artist,artist_group),
 activity as(select event_key,requested,kind from credits union all select event_key,requested,kind from mine where ordinary and kind='saved'),
 show_first as(select * from activity where ((requested at time zone 'Asia/Taipei')-interval '19 hours')::date=(select show_key from clock) order by requested,event_key limit 1),
 metrics(metric,current_value) as(
  select 'done',count(*)::numeric from done union all select 'saved',count(*) from done where kind='saved'
  union all select 'dice',count(*) from mine where source in ('draw','cross_draw','proxy_draw','streamer_draw') and finished<=as_of
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
  union all select 'dice_title3',coalesce(max(n),0) from(select count(*) n from mine where source in ('draw','cross_draw','proxy_draw','streamer_draw') and finished<=as_of
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
revoke all on function public.papa_badge_progress(text,text,text,timestamptz) from public,anon,authenticated,service_role;

-- Dynamic holdings are evaluated from both venues. Certification does not fake
-- a live balance or invent a completed performance to satisfy these predicates.
create function public.papa_badge_current_active(s text,r text,p text,c text,as_of timestamptz default now())
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select case when catalog.badge_scope='global' then exists(select 1 from public.papa_global_badge_awards g
  where g.account_id=public.papa_badge_account(s,p) and g.code=c and g.active and (g.expires_at is null or g.expires_at>as_of))
 else exists(select 1 from public.papa_achievement_awards a where a.space_id=s and a.streamer_id=r and a.player_id=p and a.code=c
  and a.active and (a.manual_verified or a.rule_version=2 or catalog.badge_id is null)
  and (a.expires_at is null or a.expires_at>as_of)
  and public.papa_badge_dynamic_valid(s,r,p,c,as_of)
  and case when c in ('stock50','stock100','stock500','stock1000') then
   (select coalesce(sum((e.data->>'amount')::numeric),0) from public.papa_v2_entities e where e.kind='ledger' and e.space_id=s
    and e.data->>'streamer_id'=r and e.data->>'playerId'=p and coalesce(e.data->'test','false')<>'true'
    and public.papa_accounting_time(e.data->>'at')<=as_of)>=case c when 'stock50' then 50 when 'stock100' then 100 when 'stock500' then 500 else 1000 end
   else true end) end
 from public.papa_achievement_catalog catalog where catalog.code=c and not catalog.retired;
$$;
revoke all on function public.papa_badge_current_active(text,text,text,text,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.papa_achievement_manual_grant(requested_space text,requested_room text,actor_context jsonb,
 requested_player text,requested_code text,requested_reason text,requested_show_day date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;c record;subject uuid;event_id bigint;effective_at timestamptz;expiry timestamptz;period_key text;exact_time boolean;
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
 if c.badge_scope='global' and subject is null then raise exception 'ACHIEVEMENT_ACCOUNT_REQUIRED';end if;
 if exists(select 1 from public.papa_achievement_awards where space_id=requested_space and streamer_id=requested_room and player_id=requested_player and code=requested_code)
  or c.badge_scope='global' and exists(select 1 from public.papa_global_badge_awards where account_id=subject and code=requested_code)
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
 insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_account_id,actor_streamer_id,target_player_id,space_id,after_data)
 values(requested_room,'achievement',requested_code,'achievement_manual_certified',actor_context->>'role',(actor_context->>'account_id')::uuid,
  actor_context->>'actor_streamer_id',requested_player,requested_space,jsonb_build_object('playerId',requested_player,'code',requested_code,
  'scope',c.badge_scope,'period',period_key,'reason',btrim(requested_reason),'certified_at',now(),
  'historical_acquired_at',case when exact_time then to_jsonb(effective_at) else to_jsonb('unknown'::text) end,
  'time_precision',case when exact_time then 'exact' when c.lifetime='show' then 'show' else 'certification' end,'expires_at',expiry)) returning id into event_id;
 insert into public.papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,changed_at,source_event_id,manual_verified,certification_reason,expires_at,rule_version)
 values(requested_space,requested_room,requested_player,requested_code,period_key,true,effective_at,now(),event_id,true,btrim(requested_reason),expiry,2);
 if c.badge_scope='global' then
  insert into public.papa_global_badge_awards(account_id,code,active,acquired_at,expires_at,source_event_id,manual_verified)
   values(subject,requested_code,true,effective_at,expiry,event_id,true);
 end if;
 return jsonb_build_object('ok',true,'alreadyRecorded',false);
end $$;

alter function public.papa_achievement_page(text,text,text,jsonb) rename to papa_achievement_page_medal_v3;
revoke all on function public.papa_achievement_page_medal_v3(text,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.papa_achievement_page(requested_space text,requested_room text,requested_player text,actor_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;progress jsonb;ctx jsonb;manager boolean;item jsonb;entries jsonb='[]';c record;
begin
 result=public.papa_achievement_page_medal_v3(requested_space,requested_room,requested_player,actor_context);
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');manager=ctx->>'recipient' in ('__admin__','__super__');
 progress=public.papa_badge_progress(requested_space,requested_room,requested_player);
 for item in select value from jsonb_array_elements(result->'rows') loop
  select * into c from public.papa_achievement_catalog where code=item->>'code';
  item=item||jsonb_build_object('manualAllowed',manager and (c.badge_scope<>'global' or ctx->>'recipient'='__super__'),
   'currentActive',coalesce(public.papa_badge_current_active(requested_space,requested_room,requested_player,c.code),false));
  if manager or left(coalesce(c.badge_id,''),1)<>'H' and (item->>'visibility'='public' or item->'recorded'='true') then
   item=item||jsonb_build_object('progress',progress->c.code);
  end if;
  entries=entries||jsonb_build_array(item);
 end loop;
 return jsonb_set(result,'{rows}',entries);
end $$;

revoke all on function public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date),public.papa_achievement_page(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date),public.papa_achievement_page(text,text,text,jsonb) to service_role;
-- The management/ranking definitions are appended below, keeping all existing
-- pagination, actor validation and publication policy.

create or replace function public.papa_achievement_management(requested_space text,requested_room text,actor_context jsonb,
 requested_view text default 'catalog',requested_code text default null,query_text text default '',page_number int default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;result jsonb;rollover int;show_day text;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if requested_view not in ('catalog','recipients','candidates') or requested_view is null
  or query_text is null or length(query_text)>100 or page_number is null or page_number not between 0 and 100000
  or requested_view<>'catalog' and not exists(select 1 from public.papa_achievement_catalog where code=requested_code and not retired and (badge_scope='streamer' or ctx->>'recipient'='__super__' and requested_view='candidates'))
 then raise exception 'ACHIEVEMENT_MANAGEMENT_INVALID';end if;
 if requested_view='catalog' then
  with counts as(select code,count(distinct player_id)::int total from public.papa_achievement_awards
   where space_id=requested_space and streamer_id=requested_room group by code)
  select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'emoji',c.emoji,
   'badgeId',c.badge_id,'scope',c.badge_scope,'condition',c.condition_text,'lifetime',c.lifetime,'visibility',case when c.badge_scope='global' or left(coalesce(c.badge_id,''),1) in ('H','L') then c.default_visibility else coalesce(v.visibility,c.default_visibility) end,
   'recipientCount',case when c.badge_scope='global' then null else coalesce(a.total,0) end,'qualified',false,'manualAllowed',c.badge_scope='streamer' or ctx->>'recipient'='__super__') order by c.code),'[]'::jsonb))
  into result from public.papa_achievement_catalog c
  left join public.papa_achievement_visibility v on v.space_id=requested_space and v.streamer_id=requested_room and v.code=c.code
  left join counts a on a.code=c.code where not c.retired;
 else
  select accounting_rollover_hour into rollover from public.papa_spaces where id=requested_space;
  show_day=((now() at time zone 'Asia/Taipei')-make_interval(hours=>rollover))::date::text;
  with participants as materialized(
   select distinct e.data->>'playerId' player_id from public.papa_v2_entities e
   where e.space_id=requested_space and e.kind in ('queue','ledger','cards','crowns','wishes')
    and e.data->>'streamer_id'=requested_room and coalesce(e.data->'test','false')<>'true'::jsonb
   union select a.player_id from public.papa_achievement_awards a where a.space_id=requested_space and a.streamer_id=requested_room),
  profile_data as materialized(
   select p.id player_id,p.data from public.papa_v2_entities p where requested_space='space-001' and p.kind='players'
   union all select p.player_id,p.data from public.papa_space_player_profiles p where requested_space<>'space-001' and p.space_id=requested_space),
  profiles as(
   select * from profile_data
   union all select distinct a.player_id,'{}'::jsonb from public.papa_achievement_awards a
    where requested_view='recipients' and a.space_id=requested_space and a.streamer_id=requested_room and a.code=requested_code
     and not exists(select 1 from profile_data p where p.player_id=a.player_id)),
  awards as(select a.player_id,min(a.acquired_at) acquired_at,
   bool_or(public.papa_badge_current_active(requested_space,requested_room,a.player_id,a.code)) manual_active,
   bool_or(a.manual_verified) manual_verified,bool_or(not a.manual_verified) automatic
   from public.papa_achievement_awards a join public.papa_achievement_catalog c on c.code=a.code
   where a.space_id=requested_space and a.streamer_id=requested_room and a.code=requested_code and c.badge_scope='streamer' group by a.player_id
   union all select f.player_id,g.acquired_at,public.papa_badge_current_active(requested_space,requested_room,f.player_id,g.code),g.manual_verified,not g.manual_verified
   from profile_data f join public.papa_global_badge_awards g on g.account_id=public.papa_badge_account(requested_space,f.player_id)
   where g.code=requested_code and ctx->>'recipient'='__super__'),
  matched as(select p.player_id,coalesce(nullif(p.data->>'name',''),'玩家') name,a.player_id is not null earned,
   a.acquired_at,a.manual_active,a.manual_verified,a.automatic
   from profiles p left join awards a on a.player_id=p.player_id
   where (requested_view='recipients' and a.player_id is not null
    or requested_view='candidates' and exists(select 1 from participants member where member.player_id=p.player_id)
     and coalesce(p.data->'archived','false')<>'true'::jsonb and coalesce(p.data->'test','false')<>'true'::jsonb)
   and position(lower(btrim(query_text)) in lower(coalesce(p.data->>'name','')))>0),
  paged as(select * from matched order by name,player_id limit 20 offset page_number*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('playerId',player_id,'name',name,'earned',earned,
   'acquiredAt',acquired_at,'currentActive',case when earned then coalesce(manual_active,false) end,'source',case when manual_verified and automatic then '自動達成／管理者授予'
    when manual_verified then '管理者授予' else '自動達成' end) order by name,player_id) from paged),'[]'::jsonb),
   'total',(select count(*) from matched),'page',page_number) into result;
 end if;
 return result||jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',requested_space,'streamerId',requested_room),'mode',requested_view);
end $$;


create or replace function public.papa_badge_rank_rows()
returns table(player_key text,account_id uuid,space_id text,streamer_id text,player_name text,code text,name text,badge_scope text)
language sql stable security definer set search_path=pg_catalog,public as $$
 with profiles as(
  select b.account_id,'space-001'::text space_id,p.id player_id,p.data from public.papa_account_legacy_players b
   join public.papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
  union all select account_id,space_id,player_id,data from public.papa_space_player_profiles
 ),valid_profiles as(
  select p.account_id,p.space_id,p.player_id,coalesce(nullif(p.data->>'name',''),'玩家') name
  from profiles p join public.papa_accounts a on a.id=p.account_id and a.disabled_at is null
   join public.papa_spaces s on s.id=p.space_id and s.status='active'
  where coalesce(p.data->'test','false')<>'true' and coalesce(p.data->'archived','false')<>'true'
   and exists(select 1 from public.papa_space_memberships m where m.account_id=p.account_id and m.space_id=p.space_id and m.role='player' and m.status='active')
 ),room_awards as(
  select distinct p.account_id,p.space_id,a.streamer_id,p.name player_name,c.code,c.name
  from valid_profiles p join public.papa_achievement_awards a on a.space_id=p.space_id and a.player_id=p.player_id
  join public.papa_achievement_catalog c on c.code=a.code and not c.retired and c.badge_scope='streamer'
  where public.papa_badge_current_active(p.space_id,a.streamer_id,p.player_id,c.code)
 ),global_awards as(
  select p.account_id,min(p.name) player_name,c.code,c.name from valid_profiles p
  join public.papa_global_badge_awards g on g.account_id=p.account_id and g.active
  join public.papa_achievement_catalog c on c.code=g.code and not c.retired and c.badge_scope='global'
  where g.expires_at is null or g.expires_at>now() group by p.account_id,c.code,c.name
 )
 select md5('public-medals:'||a.account_id::text),a.account_id,a.space_id,a.streamer_id,a.player_name,a.code,a.name,'streamer' from room_awards a
 union all select md5('public-medals:'||g.account_id::text),g.account_id,null,null,g.player_name,g.code,g.name,'global' from global_awards g
$$;
revoke all on function public.papa_badge_rank_rows() from public,anon,authenticated,service_role;


create or replace function public.papa_achievement_eligibility(s text,r text,p text,as_of timestamptz default now())
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_object_agg(c.code,coalesce(public.papa_badge_current_active(s,r,p,c.code,as_of),false)),'{}'::jsonb)
 from public.papa_achievement_catalog c where not c.retired;
$$;
notify pgrst,'reload schema';
commit;
