begin;
create function public.papa_badge_dynamic_valid(s text,r text,p text,code text,as_of timestamptz default now())
returns boolean language sql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
 select case when code not in ('house','regular') then true else (
 select count(distinct (public.papa_accounting_time(e.data->>'at') at time zone 'Asia/Taipei')::date)>=15
 from public.papa_v2_entities e where e.kind='queue' and e.space_id=s and e.data->>'streamer_id'=r and e.data->>'playerId'=p
  and e.data->>'status'='completed' and e.data->>'kind'=any(case when code='house' then array['live'] else array['live','saved'] end)
  and coalesce(e.data->>'source',case when e.data->'selfProvided'='true' then 'self' else 'manual' end)='manual'
  and coalesce(e.data->'selfProvided','false')<>'true'
  and coalesce(e.data->'test','false')<>'true' and nullif(e.data->>'voided_at','') is null
  and nullif(e.data->>'performance_duplicate_of','') is null
  and public.papa_accounting_time(e.data->>'completedAt')<=as_of
  and (public.papa_accounting_time(e.data->>'at') at time zone 'Asia/Taipei')::date
   between (as_of at time zone 'Asia/Taipei')::date-29 and (as_of at time zone 'Asia/Taipei')::date) end
$$;
revoke all on function public.papa_badge_dynamic_valid(text,text,text,text,timestamptz) from public,anon,authenticated,service_role;

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
   case when left(c.badge_id,1) in ('H','L') then c.default_visibility else coalesce(v.visibility,c.default_visibility) end visibility,c.condition_text,
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
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'badgeId',badge_id,'emoji',emoji,'scope',badge_scope,
  'name',name,'lifetime',lifetime,'visibility',visibility,
  'condition',case when visibility='condition_hidden' then null when manager or visibility='public' or visibility='after_award' and current_active then condition_text end,
  'qualified',acquired_at is not null,'currentActive',current_active,'acquiredAt',acquired_at,'expiresAt',expires_at,
  'recorded',acquired_at is not null,'manualVerified',coalesce(manual_verified,false)) order by badge_id nulls last,code),'[]')
 into result from rows where manager or visibility not in ('hidden','after_award') or visibility='after_award' and acquired_at is not null;
 return jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',requested_space,'streamerId',requested_room,'playerId',requested_player),'rows',result);
end $$;

-- Certification keeps its released authorization, reason and idempotency checks.
-- Global manual certifications are projected to the canonical Account once.
alter function public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date) rename to papa_achievement_manual_grant_badge_legacy;
create function public.papa_achievement_manual_grant(requested_space text,requested_room text,actor_context jsonb,
 requested_player text,requested_code text,requested_reason text,requested_show_day date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;subject uuid;source record;
begin
 if not exists(select 1 from public.papa_achievement_catalog where code=requested_code and not retired) then raise exception 'ACHIEVEMENT_CERTIFICATION_INVALID';end if;
 result=public.papa_achievement_manual_grant_badge_legacy(requested_space,requested_room,actor_context,requested_player,requested_code,requested_reason,requested_show_day);
 if exists(select 1 from public.papa_achievement_catalog where code=requested_code and badge_scope='global') then
  subject=public.papa_badge_account(requested_space,requested_player);
  if subject is null then raise exception 'ACHIEVEMENT_ACCOUNT_REQUIRED';end if;
  select acquired_at,source_event_id,active into source from public.papa_achievement_awards where space_id=requested_space
   and streamer_id=requested_room and player_id=requested_player and code=requested_code order by acquired_at limit 1;
  insert into public.papa_global_badge_awards(account_id,code,active,acquired_at,source_event_id,manual_verified)
   values(subject,requested_code,source.active,source.acquired_at,source.source_event_id,true)
  on conflict(account_id,code) do update set active=true,manual_verified=true,changed_at=now();
 end if;
 return result;
end $$;
revoke all on function public.papa_achievement_manual_grant_badge_legacy(text,text,jsonb,text,text,text,date) from public,anon,authenticated,service_role;
revoke all on function public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date),public.papa_achievement_page(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.papa_achievement_manual_grant(text,text,jsonb,text,text,text,date),public.papa_achievement_page(text,text,text,jsonb) to service_role;
commit;
