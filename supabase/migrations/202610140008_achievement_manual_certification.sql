begin;
-- A certification is dated when the manager verifies it; it does not invent a past award time.
alter table public.papa_achievement_awards add column manual_verified boolean not null default false;
alter table public.papa_achievement_awards add column certification_reason text;
create function public.papa_achievement_protect_manual() returns trigger language plpgsql as $$
begin
 -- Automatic recalculation cannot silently revoke a manager-certified historical fact.
 if old.manual_verified and new.source_event_id is distinct from old.source_event_id then return null;end if;
 return new;
end $$;
create trigger papa_achievement_protect_manual before update on public.papa_achievement_awards
 for each row execute function public.papa_achievement_protect_manual();
revoke all on function public.papa_achievement_protect_manual() from public,anon,authenticated,service_role;

create function public.papa_achievement_manual_grant(requested_space text,requested_room text,actor_context jsonb,
 requested_player text,requested_code text,requested_reason text,requested_show_day date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;item record;rollover int;show_day date;award_period text;existing record;event_id bigint;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if requested_player is null or not public.papa_achievement_player_valid(requested_space,requested_player,true)
  or requested_reason is null or length(btrim(requested_reason)) not between 4 and 500 then raise exception 'ACHIEVEMENT_CERTIFICATION_INVALID';end if;
 select code,lifetime into item from public.papa_achievement_catalog where code=requested_code;
 if not found then raise exception 'ACHIEVEMENT_CERTIFICATION_INVALID';end if;
 select accounting_rollover_hour into rollover from public.papa_spaces where id=requested_space;
 show_day=((now() at time zone 'Asia/Taipei')-make_interval(hours=>rollover))::date;
 if item.lifetime='show' then
  if requested_show_day is null or requested_show_day>show_day or requested_show_day<date '2020-01-01' then
   raise exception 'ACHIEVEMENT_SHOW_DAY_REQUIRED';end if;
  award_period=requested_show_day::text;
 else award_period='lifetime';end if;
 perform pg_advisory_xact_lock(hashtextextended(requested_space||'|'||requested_room||'|'||requested_player||'|'||requested_code||'|'||award_period,0));
 select a.code,a.manual_verified into existing from public.papa_achievement_awards a
 where a.space_id=requested_space and a.streamer_id=requested_room and a.player_id=requested_player
  and a.code=requested_code and a.period=award_period;
 if found then return jsonb_build_object('ok',true,'alreadyRecorded',true);end if;
 insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_account_id,actor_streamer_id,
  target_player_id,space_id,after_data)
 values(requested_room,'achievement',requested_code,'achievement_manual_certified',actor_context->>'role',
  (actor_context->>'account_id')::uuid,actor_context->>'actor_streamer_id',requested_player,requested_space,
  jsonb_build_object('playerId',requested_player,'code',requested_code,'period',award_period,'reason',btrim(requested_reason),
   'certified_at',now(),'historical_acquired_at','unknown')) returning id into event_id;
 insert into public.papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,changed_at,
  source_event_id,manual_verified,certification_reason)
 values(requested_space,requested_room,requested_player,requested_code,award_period,
  item.lifetime='permanent' or item.lifetime='show' and requested_show_day=show_day,now(),now(),event_id,true,btrim(requested_reason));
 return jsonb_build_object('ok',true,'alreadyRecorded',false);
end $$;

-- Self atlas includes certified historical achievements without changing the qualification thresholds.
create or replace function public.papa_achievement_page(requested_space text,requested_room text,requested_player text,actor_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;flags jsonb;result jsonb;rollover int;show_day text;manager boolean;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 manager=ctx->>'recipient' in ('__admin__','__super__');
 if not manager and ctx->>'recipient' is distinct from requested_player then raise exception 'ACHIEVEMENT_PLAYER_INVALID';end if;
 flags=public.papa_achievement_eligibility(requested_space,requested_room,requested_player);
 select accounting_rollover_hour into rollover from public.papa_spaces where id=requested_space;
 show_day=((now() at time zone 'Asia/Taipei')-make_interval(hours=>rollover))::date::text;
 with rows as(select c.code,c.name,c.condition_text,c.lifetime,
  coalesce(v.visibility,c.default_visibility) visibility,
  (coalesce((flags->>c.code)::boolean,false) or a.code is not null) qualified,
  case when a.code is not null then coalesce((flags->>c.code)::boolean,false) or
   coalesce(a.manual_verified,false) and c.lifetime='permanent' end current_active,
  a.acquired_at,a.code recorded_code,a.manual_verified
  from public.papa_achievement_catalog c
  left join public.papa_achievement_visibility v on v.space_id=requested_space and v.streamer_id=requested_room and v.code=c.code
  left join lateral(select award.code,award.acquired_at,award.manual_verified from public.papa_achievement_awards award
   where award.space_id=requested_space and award.streamer_id=requested_room and award.player_id=requested_player and award.code=c.code
   order by (award.period=show_day) desc,award.manual_verified desc,award.acquired_at desc limit 1) a on true)
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'lifetime',lifetime,'visibility',visibility,
  'condition',case when manager or visibility='public' or visibility='after_award' and qualified then condition_text end,
  'qualified',qualified,'currentActive',current_active,'acquiredAt',acquired_at,'recorded',recorded_code is not null,
  'manualVerified',coalesce(manual_verified,false)) order by code),'[]') into result
 from rows where manager or visibility not in ('hidden','after_award') or visibility='after_award' and qualified;
 return jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',requested_space,'streamerId',requested_room,'playerId',requested_player),'rows',result);
end $$;
revoke all on function public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date) from public,anon,authenticated;
grant execute on function public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date) to service_role;
notify pgrst,'reload schema';
commit;
