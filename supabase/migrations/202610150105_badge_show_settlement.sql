begin;
create table public.papa_badge_show_settlements(
 space_id text not null,streamer_id text not null,show_day date not null,
 settled_at timestamptz not null default now(),source_event_id bigint references public.papa_events(id),
 primary key(space_id,streamer_id,show_day)
);
alter table public.papa_badge_show_settlements enable row level security;
revoke all on public.papa_badge_show_settlements from public,anon,authenticated,service_role;

create function public.papa_badge_show_candidates(s text,r text,d date)
returns jsonb language sql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
 with bounds as(select (d+time '19:00') at time zone 'Asia/Taipei' start_at,((d+1)+time '19:00') at time zone 'Asia/Taipei' end_at),
 requests as materialized(
  select e.id,e.data->>'playerId' player,lower(btrim(public.papa_badge_song_field(e.data,i.item,'title'))) title,
   public.papa_accounting_time(e.data->>'at') requested,
   case when e.data->>'status'='completed' then public.papa_accounting_time(e.data->>'completedAt') end finished,
   i.ordinality,series.n
  from public.papa_v2_entities e cross join bounds b
  cross join lateral jsonb_array_elements(case when jsonb_typeof(e.data->'items')='array' and jsonb_array_length(e.data->'items')>0
   then e.data->'items' else jsonb_build_array(jsonb_build_object('title',e.data->>'title')) end) with ordinality i(item,ordinality)
  cross join lateral generate_series(1,case when i.item->>'performances' ~ '^[0-9]{1,4}$'
   then greatest(1,least(1000,(i.item->>'performances')::int)) else 1 end) series(n)
  where e.kind='queue' and e.space_id=s and e.data->>'streamer_id'=r and e.data->>'kind' in ('live','saved')
   and e.data->>'status' in ('waiting','completed','stored') and public.papa_accounting_time(e.data->>'acceptedAt') is not null
   and coalesce(e.data->>'source',case when e.data->'selfProvided'='true' then 'self' else 'manual' end)='manual'
   and coalesce(e.data->'selfProvided','false')<>'true'
   and coalesce(e.data->'test','false')<>'true' and nullif(e.data->>'voided_at','') is null
   and nullif(e.data->>'performance_duplicate_of','') is null
   and public.papa_achievement_player_valid(s,e.data->>'playerId',false)
   and public.papa_accounting_time(e.data->>'at')>=b.start_at-interval '24 hours' and public.papa_accounting_time(e.data->>'at')<b.end_at
 ),current_requests as materialized(select q.id,q.player,q.title,q.requested,q.finished,q.ordinality,q.n from requests q,bounds b where q.requested>=b.start_at),
 done as materialized(select q.id,q.player,q.title,q.requested,q.finished,q.ordinality,q.n from current_requests q,bounds b where q.finished>=b.start_at and q.finished<b.end_at),
 popularity as(select title,count(distinct player) n from current_requests where nullif(title,'') is not null group by title),
 hottest as(select title from popularity where n>=2 and n=(select max(n) from popularity)),
 popular_winners as(select distinct on(q.title) q.player from done q join hottest h on h.title=q.title order by q.title,q.requested desc,q.id desc,q.ordinality desc,q.n desc),
 previous_tail as(select q.title,q.finished from requests q,bounds b where q.requested<b.start_at order by q.requested desc,q.id desc,q.ordinality desc,q.n desc limit 1),
 current_head as(select player,title from done order by requested,id,ordinality,n limit 1),
 majority as(select player from done group by player having count(*)>(select count(*) from done)/2.0 and (select count(*) from done)>=3),
 last_light as(select player from done order by finished desc,requested desc,id desc,ordinality desc,n desc limit 1),
 winners as(
  select 'P12' id,player from popular_winners
  union all select 'H04',h.player from current_head h,previous_tail t,bounds b where nullif(h.title,'') is not null and h.title=t.title and t.finished>=b.start_at-interval '24 hours' and t.finished<b.start_at
  union all select 'H06',player from majority union all select 'H07',player from last_light
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',c.badge_id,'code',c.code,'playerId',w.player,
  'period',case when c.badge_id='P12' then ((d+1)-date '1970-01-01')::text else 'lifetime' end,
  'acquiredAt',b.end_at,'expiresAt',public.papa_badge_expiry(c.lifetime,b.end_at),'active',
  public.papa_badge_expiry(c.lifetime,b.end_at)>now())),'[]')
 from winners w join public.papa_achievement_catalog c on c.badge_id=w.id cross join bounds b
$$;
revoke all on function public.papa_badge_show_candidates(text,text,date) from public,anon,authenticated,service_role;

create function public.papa_badge_settle_show(s text,r text,d date) returns integer
language plpgsql security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare candidates jsonb;source_id bigint;previous_context text;
begin
 if d is null or ((d+1)+time '19:00') at time zone 'Asia/Taipei'>now()
  or not exists(select 1 from public.papa_space_streamers where space_id=s and streamer_id=r) then raise exception 'BADGE_SETTLEMENT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('badge-settle:'||s||'|'||r||'|'||d::text,0));
 if exists(select 1 from public.papa_badge_show_settlements where space_id=s and streamer_id=r and show_day=d) then return 0;end if;
 candidates=public.papa_badge_show_candidates(s,r,d);
 if jsonb_array_length(candidates)>0 then
  previous_context=current_setting('papa.actor_context',true);
  perform set_config('papa.actor_context',jsonb_build_object('role','system','space_id',s,'streamer_id',r)::text,true);
  insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id,after_data)
   values(r,'achievement',d::text,'achievement_show_settled','system',s,jsonb_build_object('show_day',d,'rule_version',2)) returning id into source_id;
  perform public.papa_badge_apply(s,r,candidates,source_id);
  perform set_config('papa.actor_context',coalesce(previous_context,''),true);
 end if;
 insert into public.papa_badge_show_settlements(space_id,streamer_id,show_day,source_event_id) values(s,r,d,source_id);
 return jsonb_array_length(candidates);
end $$;
revoke all on function public.papa_badge_settle_show(text,text,date) from public,anon,authenticated,service_role;

create function public.papa_badge_settle_due() returns integer language plpgsql security definer
set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare item record;total integer=0;
begin
 -- A bounded seven-day catch-up handles a failed daily run. No client polling,
 -- Audit scan or historical random redraw; older history uses the release job.
 for item in
  select distinct e.space_id,e.data->>'streamer_id' room,
   (public.papa_accounting_time(e.data->>'at') at time zone 'Asia/Taipei'-interval '19 hours')::date show_date
  from public.papa_v2_entities e join public.papa_spaces s on s.id=e.space_id and s.status='active'
  where e.kind='queue' and public.papa_accounting_time(e.data->>'at')>=now()-interval '8 days'
   and public.papa_accounting_time(e.data->>'at')<date_trunc('day',now() at time zone 'Asia/Taipei'-interval '19 hours') at time zone 'Asia/Taipei'+interval '19 hours'
  order by e.space_id,room,show_date
 loop total=total+public.papa_badge_settle_show(item.space_id,item.room,item.show_date);end loop;
 return total;
end $$;
revoke all on function public.papa_badge_settle_due() from public,anon,authenticated,service_role;
-- Supabase pg_cron defaults to GMT. Verify this setting at the release gate.
do $$begin if to_regnamespace('cron') is not null then
 perform cron.schedule('papa-badge-show-settlement','0 11 * * *','select public.papa_badge_settle_due()');
end if;end$$;
commit;
