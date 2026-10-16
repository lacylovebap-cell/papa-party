begin;
-- Management only, on top of badge rules v2. No catalog or business record rewrite.
create index papa_awards_recipients on public.papa_achievement_awards(space_id,streamer_id,code,player_id);

create function public.papa_achievement_player_in_room(s text,r text,p text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.papa_achievement_player_valid(s,p,true) and
 (exists(select 1 from public.papa_v2_entities e where e.space_id=s
   and e.kind in ('queue','ledger','cards','crowns','wishes')
   and e.data->>'streamer_id'=r and e.data->>'playerId'=p and coalesce(e.data->'test','false')<>'true'::jsonb)
  or exists(select 1 from public.papa_achievement_awards a where a.space_id=s and a.streamer_id=r and a.player_id=p));
$$;
revoke all on function public.papa_achievement_player_in_room(text,text,text) from public,anon,authenticated,service_role;

create or replace function public.papa_achievement_visibility_set(requested_space text,requested_room text,actor_context jsonb,requested_code text,requested_visibility text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;before_value text;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if requested_visibility is null or requested_visibility not in ('public','condition_hidden','hidden','after_award')
  or not exists(select 1 from public.papa_achievement_catalog where code=requested_code and not retired and badge_scope='streamer' and left(coalesce(badge_id,''),1) not in ('H','L')) then raise exception 'ACHIEVEMENT_SETTING_INVALID';end if;
 perform revision from public.papa_v2_revision where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended('medal-visibility|'||requested_space||'|'||requested_room||'|'||requested_code,0));
 select coalesce(v.visibility,c.default_visibility) into before_value from public.papa_achievement_catalog c
  left join public.papa_achievement_visibility v on v.space_id=requested_space and v.streamer_id=requested_room and v.code=c.code
  where c.code=requested_code;
 if before_value is not distinct from requested_visibility then return jsonb_build_object('ok',true);end if;
 insert into public.papa_achievement_visibility values(requested_space,requested_room,requested_code,requested_visibility)
 on conflict(space_id,streamer_id,code) do update set visibility=excluded.visibility;
 insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_account_id,actor_streamer_id,space_id,before_data,after_data)
 values(requested_room,'achievement',requested_code,'achievement_visibility',actor_context->>'role',(actor_context->>'account_id')::uuid,
  actor_context->>'actor_streamer_id',requested_space,jsonb_build_object('visibility',before_value),jsonb_build_object('visibility',requested_visibility));
 return jsonb_build_object('ok',true);
end $$;

-- Invalidate through the existing revision recovery; no new polling/subscriptions.
create function public.papa_achievement_signal() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and to_jsonb(old) is not distinct from to_jsonb(new) then return null;end if;
 -- Automatic awards are deferred inside the existing Core transaction. Core
 -- already owns its revision; adding another bump would stale its response.
 if tg_table_name='papa_achievement_awards' then
  if not new.manual_verified then return null;end if;
 end if;
 -- Scoped Realtime is not enabled in every deployed database yet.
 if to_regprocedure('public.papa_room_sync_bump(text,text,text,text)') is not null then
  perform public.papa_room_sync_bump('room',new.space_id,new.streamer_id,'settings');
 end if;
 update public.papa_v2_revision set revision=revision+1 where id=1;
 return null;
end $$;
revoke all on function public.papa_achievement_signal() from public,anon,authenticated,service_role;
create trigger papa_achievement_policy_signal after insert or update on public.papa_achievement_visibility
 for each row execute function public.papa_achievement_signal();
create trigger papa_achievement_award_signal after insert or update on public.papa_achievement_awards
 for each row execute function public.papa_achievement_signal();

-- Keep the proven certification operation as a private implementation.
alter function public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date)
 rename to papa_achievement_manual_certify;
revoke all on function public.papa_achievement_manual_certify(text,text,jsonb,text,text,text,date) from public,anon,authenticated,service_role;
create function public.papa_achievement_manual_grant(requested_space text,requested_room text,actor_context jsonb,
 requested_player text,requested_code text,requested_reason text,requested_show_day date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;duration text;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 -- Match existing Core lock ordering before any player/award lock. Recheck
 -- target validity under that lock so a concurrent archive cannot slip through.
 perform revision from public.papa_v2_revision where id=1 for update;
 if not public.papa_achievement_player_in_room(requested_space,requested_room,requested_player)
 then raise exception 'ACHIEVEMENT_ROOM_PLAYER_REQUIRED';end if;
 select lifetime into duration from public.papa_achievement_catalog where code=requested_code and not retired and badge_scope='streamer';
 if duration is null then raise exception 'ACHIEVEMENT_CERTIFICATION_INVALID';end if;
 if duration not in ('permanent','show') then raise exception 'ACHIEVEMENT_MANUAL_EXPIRY_UNDEFINED';end if;
 if exists(select 1 from public.papa_achievement_awards where space_id=requested_space and streamer_id=requested_room and player_id=requested_player and code=requested_code) then return jsonb_build_object('ok',true,'alreadyRecorded',true);end if;
 return public.papa_achievement_manual_certify(requested_space,requested_room,actor_context,
  requested_player,requested_code,requested_reason,requested_show_day);
end $$;

create function public.papa_achievement_manual_grant_batch(requested_space text,requested_room text,actor_context jsonb,
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

create or replace function public.papa_achievement_page(requested_space text,requested_room text,requested_player text,actor_context jsonb)
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
    and award.player_id=requested_player and award.code=c.code order by award.manual_verified desc,award.active desc,award.acquired_at desc limit 1) a on true
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

-- Manager overview and bounded lists; never return private profiles or business history.
create function public.papa_achievement_management(requested_space text,requested_room text,actor_context jsonb,
 requested_view text default 'catalog',requested_code text default null,query_text text default '',page_number int default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;result jsonb;rollover int;show_day text;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if requested_view not in ('catalog','recipients','candidates') or requested_view is null
  or query_text is null or length(query_text)>100 or page_number is null or page_number not between 0 and 100000
  or requested_view<>'catalog' and not exists(select 1 from public.papa_achievement_catalog where code=requested_code and not retired and badge_scope='streamer')
 then raise exception 'ACHIEVEMENT_MANAGEMENT_INVALID';end if;
 if requested_view='catalog' then
  with counts as(select code,count(distinct player_id)::int total from public.papa_achievement_awards
   where space_id=requested_space and streamer_id=requested_room group by code)
  select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'emoji',c.emoji,
   'badgeId',c.badge_id,'scope',c.badge_scope,'condition',c.condition_text,'lifetime',c.lifetime,'visibility',case when c.badge_scope='global' or left(coalesce(c.badge_id,''),1) in ('H','L') then c.default_visibility else coalesce(v.visibility,c.default_visibility) end,
   'recipientCount',case when c.badge_scope='global' then null else coalesce(a.total,0) end,'qualified',false,'manualAllowed',c.badge_scope='streamer' and c.lifetime in ('permanent','show')) order by c.code),'[]'::jsonb))
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
   bool_or(a.active and (a.manual_verified or (a.rule_version=2 or c.badge_id is null) and (a.expires_at is null or a.expires_at>now()) and public.papa_badge_dynamic_valid(requested_space,requested_room,a.player_id,a.code))) manual_active,
   bool_or(a.manual_verified) manual_verified,bool_or(not a.manual_verified) automatic
   from public.papa_achievement_awards a join public.papa_achievement_catalog c on c.code=a.code
   where a.space_id=requested_space and a.streamer_id=requested_room and a.code=requested_code group by a.player_id),
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

-- Publication is a streamer policy now. Preserve the retired choices and Audit.
create or replace function public.papa_achievement_public_set(requested_space text,requested_room text,actor_context jsonb,
 requested_code text,requested_enabled boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin raise exception 'ACHIEVEMENT_STREAMER_POLICY_REQUIRED';end $$;
revoke all on function public.papa_achievement_public_set(text,text,jsonb,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.papa_achievement_visibility_set(text,text,jsonb,text,text),
 public.papa_achievement_page(text,text,text,jsonb),
 public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date),
 public.papa_achievement_manual_grant_batch(text,text,jsonb,text[],text,text,date),
 public.papa_achievement_management(text,text,jsonb,text,text,text,int) from public,anon,authenticated;
grant execute on function public.papa_achievement_visibility_set(text,text,jsonb,text,text),
 public.papa_achievement_page(text,text,text,jsonb),
 public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date),
 public.papa_achievement_manual_grant_batch(text,text,jsonb,text[],text,text,date),
 public.papa_achievement_management(text,text,jsonb,text,text,text,int) to service_role;
create or replace function public.papa_achievement_public_refresh() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin return new;end$$;
notify pgrst,'reload schema';
commit;
