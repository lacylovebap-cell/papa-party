begin;
-- Public identity fields only. Never project passwords, notes, contact data,
-- balances, another streamer's activity or a full profile JSON to management.
create function public.papa_medal_profiles()
returns table(account_id uuid,space_id text,player_id text,name text,aliases jsonb,public_ids jsonb,valid boolean)
language sql stable security definer set search_path=pg_catalog,public as $$
 with profiles as(
  select b.account_id,'space-001'::text space_id,e.id player_id,e.data from public.papa_v2_entities e
   left join public.papa_account_legacy_players b on b.legacy_player_id=e.id where e.kind='players'
  union all select account_id,space_id,player_id,data from public.papa_space_player_profiles
 ) select p.account_id,p.space_id,p.player_id,coalesce(nullif(p.data->>'name',''),'玩家'),
  case when jsonb_typeof(p.data->'names')='array' then p.data->'names' else '[]'::jsonb end,
  case when jsonb_typeof(p.data->'ids')='array' then p.data->'ids' else '[]'::jsonb end,
  a.id is not null and a.disabled_at is null and coalesce(p.data->'archived','false')<>'true' and coalesce(p.data->'test','false')<>'true'
   and exists(select 1 from public.papa_spaces s where s.id=p.space_id and s.status='active')
   and exists(select 1 from public.papa_space_memberships m where m.account_id=p.account_id and m.space_id=p.space_id and m.role='player' and m.status='active')
 from profiles p left join public.papa_accounts a on a.id=p.account_id;
$$;
revoke all on function public.papa_medal_profiles() from public,anon,authenticated,service_role;

create function public.papa_medal_accounts()
returns table(account_id uuid,name text,search_text text,public_ids jsonb)
language sql stable security definer set search_path=pg_catalog,public as $$
 with profiles as materialized(select * from public.papa_medal_profiles() where valid),
 labels as(select account_id,(array_agg(name order by (space_id='space-001') desc,space_id,player_id))[1] name,
  string_agg(name||' '||aliases::text||' '||public_ids::text,' ') search_text from profiles group by account_id),
 ids as(select p.account_id,jsonb_agg(distinct i.value) public_ids from profiles p cross join lateral jsonb_array_elements(p.public_ids)i(value)
  where jsonb_typeof(i.value)='string' group by p.account_id)
 select l.account_id,l.name,lower(l.search_text),coalesce(i.public_ids,'[]') from labels l left join ids i using(account_id);
$$;
revoke all on function public.papa_medal_accounts() from public,anon,authenticated,service_role;

-- Abort rather than reinterpret a pre-existing profile/award identifier.
do $$ begin
 if exists(select 1 from public.papa_v2_entities where kind='players' and id like 'account:%')
  or exists(select 1 from public.papa_space_player_profiles where player_id like 'account:%')
  or exists(select 1 from public.papa_achievement_awards where player_id like 'account:%')
 then raise exception 'ACHIEVEMENT_ACCOUNT_NAMESPACE_CONFLICT';end if;
end $$;

-- An Account key can be held in the existing award.player_id field before that
-- account has a profile in this Space. It creates no membership or business row.
alter function public.papa_badge_account(text,text) rename to papa_badge_account_medal_v4;
revoke all on function public.papa_badge_account_medal_v4(text,text) from public,anon,authenticated,service_role;
create function public.papa_badge_account(s text,p text) returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
 select case when p ~ '^account:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  then case when public.papa_badge_account_medal_v4(s,p) is null or public.papa_badge_account_medal_v4(s,p)=substring(p from 9)::uuid
   then substring(p from 9)::uuid end else public.papa_badge_account_medal_v4(s,p) end;
$$;
revoke all on function public.papa_badge_account(text,text) from public,anon,authenticated,service_role;

create function public.papa_medal_target(s text,subject uuid) returns text language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select player_id from public.papa_medal_profiles() where space_id=s and account_id=subject and valid order by player_id limit 1),'account:'||subject::text);
$$;
revoke all on function public.papa_medal_target(text,uuid) from public,anon,authenticated,service_role;
create or replace function public.papa_achievement_player_in_room(s text,r text,p text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.papa_medal_profiles() a where a.valid and a.account_id=public.papa_badge_account(s,p))
  and (not exists(select 1 from public.papa_medal_profiles() p0 where p0.space_id=s and p0.account_id=public.papa_badge_account(s,p))
   or exists(select 1 from public.papa_medal_profiles() p0 where p0.space_id=s and p0.account_id=public.papa_badge_account(s,p) and p0.valid))
  and exists(select 1 from jsonb_array_elements(public.papa_streamer_directory()) room
   where room->>'id'=r and room->>'spaceId'=s and coalesce((room->>'active')::boolean,true));
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
  where g.account_id=v.subject and g.code=c and g.active and (g.expires_at is null or g.expires_at>as_of))
 else v.local_allowed and exists(select 1 from public.papa_achievement_awards a where a.space_id=s and a.streamer_id=r and a.code=c
  and (a.player_id=p or v.subject is not null and public.papa_badge_account(s,a.player_id)=v.subject)
  and a.active and (a.manual_verified or a.rule_version=2 or catalog.badge_id is null) and (a.expires_at is null or a.expires_at>as_of)
  and public.papa_badge_dynamic_valid(s,r,v.local_player,c,as_of)
  and case when c in ('stock50','stock100','stock500','stock1000') then
   (select coalesce(sum((e.data->>'amount')::numeric),0) from public.papa_v2_entities e where e.kind='ledger' and e.space_id=s
    and e.data->>'streamer_id'=r and e.data->>'playerId'=v.local_player and coalesce(e.data->'test','false')<>'true'
    and public.papa_accounting_time(e.data->>'at')<=as_of)>=case c when 'stock50' then 50 when 'stock100' then 100 when 'stock500' then 500 else 1000 end
   else true end) end
 from public.papa_achievement_catalog catalog cross join validity v where catalog.code=c and not catalog.retired;
$$;

-- One private projection for deduplicated recipients and on-demand room detail.
create function public.papa_medal_award_rows(code_filter text)
returns table(player_key text,account_id uuid,player_id text,name text,space_id text,streamer_id text,acquired_at timestamptz,manual_verified boolean,current_active boolean)
language sql stable security definer set search_path=pg_catalog,public as $$
 with profiles as materialized(select * from public.papa_medal_profiles()),
 labels as(select account_id,(array_agg(name order by valid desc,(space_id='space-001') desc,space_id,player_id))[1] name from profiles where account_id is not null group by account_id),
 local_awards as(select a.*,c.badge_id,public.papa_badge_account(a.space_id,a.player_id) subject from public.papa_achievement_awards a
  join public.papa_achievement_catalog c on c.code=a.code and c.badge_scope='streamer' where a.code=code_filter)
 select md5('medal-manager:'||coalesce(a.subject::text,'legacy:'||a.space_id||':'||a.player_id)),a.subject,a.player_id,
  coalesce(l.name,(select p.name from profiles p where p.space_id=a.space_id and p.player_id=a.player_id limit 1),'歷史玩家'),
  a.space_id,a.streamer_id,a.acquired_at,a.manual_verified,a.active and (a.manual_verified or a.rule_version=2 or a.badge_id is null)
  and (a.expires_at is null or a.expires_at>now()) and coalesce(public.papa_badge_current_active(a.space_id,a.streamer_id,a.player_id,a.code),false)
 from local_awards a left join labels l on l.account_id=a.subject
 union all select md5('medal-manager:'||g.account_id::text),g.account_id,'account:'||g.account_id::text,
  coalesce(l.name,'歷史玩家'),null,null,g.acquired_at,g.manual_verified,
  g.active and (g.expires_at is null or g.expires_at>now()) and exists(select 1 from public.papa_medal_profiles() a where a.valid and a.account_id=g.account_id)
 from public.papa_global_badge_awards g left join labels l on l.account_id=g.account_id where g.code=code_filter;
$$;
revoke all on function public.papa_medal_award_rows(text) from public,anon,authenticated,service_role;

create or replace function public.papa_achievement_management(requested_space text,requested_room text,actor_context jsonb,
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
   where super or a.space_id=requested_space and a.streamer_id=requested_room
   union all select code,account_id::text from public.papa_global_badge_awards where super),
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
    where chosen.badge_scope='streamer' and a.space_id=requested_space and a.streamer_id=requested_room and a.code=requested_code
   union select account_id from public.papa_global_badge_awards where chosen.badge_scope='global' and code=requested_code),
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

-- Grant/account read projections and the small automatic dedup guard follow.

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
   and a.code=requested_code and public.papa_badge_account(requested_space,a.player_id)=subject)
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
  actor_context->>'actor_streamer_id',target_player,requested_space,jsonb_build_object('playerId',target_player,'accountId',subject,'code',requested_code,
  'scope',c.badge_scope,'period',period_key,'reason',btrim(requested_reason),'certified_at',now(),
  'historical_acquired_at',case when exact_time then to_jsonb(effective_at) else to_jsonb('unknown'::text) end,
  'time_precision',case when exact_time then 'exact' when c.lifetime='show' then 'show' else 'certification' end,'expires_at',expiry)) returning id into event_id;
 if c.badge_scope='streamer' then
 insert into public.papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,changed_at,source_event_id,manual_verified,certification_reason,expires_at,rule_version)
 values(requested_space,requested_room,target_player,requested_code,period_key,true,effective_at,now(),event_id,true,btrim(requested_reason),expiry,2);
 else
  insert into public.papa_global_badge_awards(account_id,code,active,acquired_at,expires_at,source_event_id,manual_verified)
   values(subject,requested_code,true,effective_at,expiry,event_id,true);
  update public.papa_v2_revision set revision=revision+1 where id=1;
 end if;
 return jsonb_build_object('ok',true,'alreadyRecorded',false);
end $$;

create or replace function public.papa_achievement_manual_grant_batch(requested_space text,requested_room text,actor_context jsonb,
 requested_players text[],requested_code text,requested_reason text,requested_show_day date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;p text;result jsonb;added int=0;skipped int=0;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if requested_players is null or cardinality(requested_players) not between 1 and 50
  or exists(select 1 from unnest(requested_players) x where x is null or length(x) not between 1 and 200)
  or cardinality(requested_players)<>(select count(distinct x) from unnest(requested_players) x)
 then raise exception 'ACHIEVEMENT_BATCH_INVALID';end if;
 if cardinality(requested_players)<>(select count(distinct public.papa_badge_account(requested_space,x)) from unnest(requested_players) x) then raise exception 'ACHIEVEMENT_BATCH_IDENTITY_INVALID';end if;
 -- Validate every target before any award is written. Sorted locks avoid deadlocks.
 foreach p in array requested_players loop
  if not public.papa_achievement_player_in_room(requested_space,requested_room,p)
  then raise exception 'ACHIEVEMENT_ROOM_PLAYER_REQUIRED';end if;
 end loop;
 for p in select x from unnest(requested_players) x order by x loop
  result=public.papa_achievement_manual_grant(requested_space,requested_room,actor_context,p,requested_code,requested_reason,requested_show_day);
  if (result->>'alreadyRecorded')::boolean then skipped=skipped+1;else added=added+1;end if;
 end loop;
 return jsonb_build_object('ok',true,'granted',added,'alreadyRecorded',skipped);
end $$;

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
   coalesce(case when c.badge_scope='global' then g.active and (g.manual_verified or g.expires_at is null or g.expires_at>now())
    else a.active and (a.manual_verified or (a.rule_version=2 or c.badge_id is null) and (a.expires_at is null or a.expires_at>now())
     and public.papa_badge_dynamic_valid(requested_space,requested_room,requested_player,c.code)) end,false) current_active
  from public.papa_achievement_catalog c
  left join public.papa_achievement_visibility v on v.space_id=requested_space and v.streamer_id=requested_room and v.code=c.code
  left join lateral(select award.acquired_at,award.active,award.expires_at,award.manual_verified,award.rule_version
   from public.papa_achievement_awards award where award.space_id=requested_space and award.streamer_id=requested_room
    and (award.player_id=requested_player or subject is not null and public.papa_badge_account(requested_space,award.player_id)=subject) and award.code=c.code
    order by (award.active and (award.expires_at is null or award.expires_at>now())) desc,award.acquired_at desc,award.manual_verified desc limit 1) a on true
  left join public.papa_global_badge_awards g on g.account_id=subject and g.code=c.code
  where not c.retired
 )
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'badgeId',case when not manager and visibility='after_award' and acquired_at is null then null else badge_id end,'emoji',case when not manager and visibility='after_award' and acquired_at is null then null else emoji end,'scope',badge_scope,
  'name',case when not manager and visibility='after_award' and acquired_at is null then '？？？' else name end,'lifetime',case when not manager and visibility='after_award' and acquired_at is null then null else lifetime end,'visibility',visibility,
  'condition',case when manager then condition_text when left(coalesce(badge_id,''),1)='H' then null when visibility='public' or acquired_at is not null then condition_text end,
  'qualified',acquired_at is not null,'currentActive',current_active,'acquiredAt',acquired_at,'expiresAt',expires_at,
  'recorded',acquired_at is not null,'manualVerified',coalesce(manual_verified,false)) order by badge_id nulls last,code),'[]')
 into result from rows where manager or visibility<>'hidden' or acquired_at is not null;
 return jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',requested_space,'streamerId',requested_room,'playerId',requested_player),'rows',result,'totalDefinitions',(select count(*) from public.papa_achievement_catalog where not retired),'unlocked',(select count(*) from jsonb_array_elements(result) x where x->'recorded'='true'));
end $$;

create or replace function public.papa_badge_apply(s text,r text,changes jsonb,event_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare b jsonb;c record;prior record;at_time timestamptz;expiry timestamptz;key text;is_active boolean;context_before text;room_name text;silent boolean;
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
  select a.* into prior from public.papa_achievement_awards a
   where a.space_id=s and a.streamer_id=r and a.code=c.code and (a.player_id=b->>'playerId' and a.period=key
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
   jsonb_build_object('playerId',b->>'playerId','active',is_active,'period',key,'source_event_id',event_id,'rule_version',2,'acquired_at',at_time,'expires_at',expiry));
  if is_active and not silent and (prior.code is null or not prior.active or prior.expires_at<=at_time) then
   insert into public.papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,space_id)
   select r,coalesce(room_name,'主播'),b->>'playerId','achievement',1,coalesce(room_name,'主播')||'｜取得勳章「'||name||'」',code,s
    from public.papa_achievement_catalog where code=c.code;
  end if;
 end loop;
 perform set_config('papa.actor_context',coalesce(context_before,''),true);
end $$;


create or replace function public.papa_badge_rank_rows()
returns table(player_key text,account_id uuid,space_id text,streamer_id text,player_name text,code text,name text,badge_scope text)
language sql stable security definer set search_path=pg_catalog,public as $$
 with accounts as materialized(select * from public.papa_medal_accounts()),
 local_awards as(select a.*,public.papa_badge_account(a.space_id,a.player_id) subject from public.papa_achievement_awards a),
 room_awards as(select distinct p.account_id,a.space_id,a.streamer_id,p.name player_name,c.code,c.name
  from local_awards a join accounts p on p.account_id=a.subject
  join public.papa_achievement_catalog c on c.code=a.code and not c.retired and c.badge_scope='streamer'
  where public.papa_badge_current_active(a.space_id,a.streamer_id,a.player_id,c.code)
   and exists(select 1 from jsonb_array_elements(public.papa_streamer_directory()) room
    where room->>'id'=a.streamer_id and room->>'spaceId'=a.space_id and coalesce((room->>'active')::boolean,true))),
 global_awards as(select p.account_id,p.name player_name,c.code,c.name from accounts p
  join public.papa_global_badge_awards g on g.account_id=p.account_id and g.active
  join public.papa_achievement_catalog c on c.code=g.code and not c.retired and c.badge_scope='global'
  where g.expires_at is null or g.expires_at>now())
 select md5('public-medals:'||a.account_id::text),a.account_id,a.space_id,a.streamer_id,a.player_name,a.code,a.name,'streamer' from room_awards a
 union all select md5('public-medals:'||g.account_id::text),g.account_id,null,null,g.player_name,g.code,g.name,'global' from global_awards g;
$$;

create or replace function public.papa_achievement_public_rows()
returns table(player_key text,account_id uuid,space_id text,streamer_id text,player_id text,player_name text,streamer_name text,
 code text,name text,lifetime text,visibility text,condition_text text,acquired_at timestamptz,recorded_active boolean)
language sql stable security definer set search_path=pg_catalog,public as $$
 with rooms as(select room->>'id' id,room->>'spaceId' space_id,room->>'display_name' name from jsonb_array_elements(public.papa_streamer_directory()) room
  where coalesce((room->>'active')::boolean,true)),
 rows as(select held.*,public.papa_medal_target(held.space_id,held.account_id) player_id,rooms.name streamer_name,c.lifetime,c.condition_text,c.badge_id,
  case when left(coalesce(c.badge_id,''),1) in ('H','L') then c.default_visibility else coalesce(v.visibility,c.default_visibility) end visibility,
  (select min(a.acquired_at) from public.papa_achievement_awards a where a.space_id=held.space_id and a.streamer_id=held.streamer_id
    and public.papa_badge_account(a.space_id,a.player_id)=held.account_id and a.code=held.code) acquired_at
  from public.papa_badge_rank_rows() held join rooms on rooms.id=held.streamer_id and rooms.space_id=held.space_id
  join public.papa_achievement_catalog c on c.code=held.code
  left join public.papa_achievement_visibility v on v.space_id=held.space_id and v.streamer_id=held.streamer_id and v.code=held.code
  where held.badge_scope='streamer')
 select player_key,account_id,space_id,streamer_id,player_id,player_name,streamer_name,code,name,lifetime,visibility,
  case when left(coalesce(badge_id,''),1)='H' or visibility='condition_hidden' then null else condition_text end,acquired_at,true
 from rows where visibility<>'hidden';
$$;
revoke all on function public.papa_badge_rank_rows(),public.papa_achievement_public_rows(),
 public.papa_achievement_page_medal_v3(text,text,text,jsonb),public.papa_badge_apply(text,text,jsonb,bigint),
 public.papa_badge_current_active(text,text,text,text,timestamptz),public.papa_achievement_player_in_room(text,text,text)
 from public,anon,authenticated,service_role;
revoke all on function public.papa_achievement_management(text,text,jsonb,text,text,text,int),
 public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date),public.papa_achievement_manual_grant_batch(text,text,jsonb,text[],text,text,date)
 from public,anon,authenticated;
grant execute on function public.papa_achievement_management(text,text,jsonb,text,text,text,int),
 public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date),public.papa_achievement_manual_grant_batch(text,text,jsonb,text[],text,text,date) to service_role;
notify pgrst,'reload schema';
commit;
