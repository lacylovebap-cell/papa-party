begin;
-- Keep the released hourly uniqueness guard; add immutable song identity to
-- NEW failures only. Older missing song-title evidence is not fabricated.
create or replace function public.papa_record_failed_request(room_id text,player_id text,song_id text,bucket bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare inserted_id bigint;s text;song record;
begin
 select space_id into s from public.papa_space_streamers where streamer_id=room_id;
 if s is null or not public.papa_achievement_player_valid(s,player_id,true) then raise exception 'FAILED_REQUEST_SCOPE_INVALID';end if;
 select data->>'title' title,data->>'artist' artist into song from public.papa_v2_entities
  where kind='songs' and id=song_id and space_id=s and data->>'streamer_id'=room_id;
 if not found or bucket not between floor(extract(epoch from now())/3600)-1 and floor(extract(epoch from now())/3600)
 then raise exception 'FAILED_REQUEST_INVALID';end if;
 insert into public.papa_events(streamer_id,space_id,entity_kind,entity_id,action,actor_role,actor_player_id,effective_at,hour_bucket,after_data)
 values(room_id,s,'queue',song_id,'request_failed','player',player_id,now()::text,bucket,
  jsonb_build_object('songId',song_id,'title',song.title,'artist',song.artist,'reason','hourly_limit'))
 on conflict do nothing returning id into inserted_id;
 return inserted_id is not null;
end $$;

create function public.papa_badge_recorded_candidates(s text,r text,p text,as_of timestamptz default now())
returns jsonb language sql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
 with failed as materialized(
  select distinct on(e.hour_bucket) e.hour_bucket,coalesce(public.papa_accounting_time(e.effective_at),e.created_at) at_time,
   lower(btrim(coalesce(e.after_data->>'title',e.after_data->'songSnapshot'->>'title'))) title
  from public.papa_events e where e.space_id=s and e.streamer_id=r and e.actor_player_id=p and e.action='request_failed'
   and e.after_data->>'reason'='hourly_limit' and e.hour_bucket is not null and e.created_at<=as_of
  order by e.hour_bucket,e.id
 ),numbered as(select at_time,row_number() over(order by at_time,hour_bucket) n from failed),
 completions as materialized(
  select e.id,e.data,public.papa_accounting_time(e.data->>'at') requested,public.papa_accounting_time(e.data->>'completedAt') finished
  from public.papa_v2_entities e where e.space_id=s and e.kind='queue' and e.data->>'streamer_id'=r and e.data->>'playerId'=p
   and e.data->>'status'='completed' and e.data->>'kind' in ('live','saved')
   and coalesce(e.data->>'source',case when e.data->'selfProvided'='true' then 'self' else 'manual' end)='manual'
   and coalesce(e.data->'selfProvided','false')<>'true'
   and coalesce(e.data->'test','false')<>'true' and nullif(e.data->>'voided_at','') is null
   and nullif(e.data->>'performance_duplicate_of','') is null and public.papa_accounting_time(e.data->>'completedAt')<=as_of
 ),candidates as(
  select t.code,min(n.at_time) at_time from numbered n join(values('failure1',1),('failure10',10),('failure50',50))t(code,n) on t.n=n.n group by t.code
  union all select 'after_failure',min(q.finished) from completions q join failed f
   on exists(select 1 from jsonb_array_elements(case when jsonb_typeof(q.data->'items')='array' and jsonb_array_length(q.data->'items')>0 then q.data->'items'
    else jsonb_build_array(jsonb_build_object('title',q.data->>'title')) end)i where f.title=lower(btrim(i->>'title')))
    and (f.at_time at time zone 'Asia/Taipei')::date+1=(q.requested at time zone 'Asia/Taipei')::date
   where q.data->>'kind'='saved' and (q.requested at time zone 'Asia/Taipei')::date=(q.finished at time zone 'Asia/Taipei')::date
  union all select 'chosen',max(d.created_at) from public.papa_achievement_draws d join completions q on q.id=d.queue_id
   where d.space_id=s and d.streamer_id=r and d.player_id=p and d.won and d.created_at<=as_of
  union all select t.code,max(d.created_at) from public.papa_achievement_request_draws d
   join public.papa_v2_entities q on q.space_id=s and q.kind=case when left(d.queue_id,7)='credit:' then 'ledger' else 'queue' end
    and q.id=case when left(d.queue_id,7)='credit:' then substr(d.queue_id,8) else d.queue_id end
   cross join lateral(values('lucky',d.lucky),('legend',d.legend))t(code,won)
   where d.space_id=s and d.streamer_id=r and d.player_id=p and t.won and d.created_at<=as_of
    and coalesce(q.data->'test','false')<>'true' and nullif(q.data->>'voided_at','') is null
    and nullif(q.data->>'performance_duplicate_of','') is null
    and (q.kind='queue' and q.data->>'status' in ('waiting','completed','stored')
     or q.kind='ledger' and q.data->>'accounting_kind'='receipt' and (q.data->>'amount')::numeric>0
      and coalesce(q.data->'conversion','false')<>'true' and coalesce(q.data->'openingBalance','false')<>'true')
    and coalesce(q.data->>'source',case when q.data->'selfProvided'='true' then 'self' else 'manual' end)='manual'
    and coalesce(q.data->'selfProvided','false')<>'true' group by t.code
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',c.badge_id,'code',c.code,'playerId',p,'period','lifetime',
  'acquiredAt',coalesce(t.at_time,as_of),'expiresAt',public.papa_badge_expiry(c.lifetime,coalesce(t.at_time,as_of)),
  'active',t.at_time is not null and (c.lifetime='permanent' or t.at_time+interval '24 hours'>as_of))),'[]')
 from public.papa_achievement_catalog c left join candidates t on t.code=c.code
 where c.code in ('failure1','failure10','failure50','after_failure','lucky','legend','chosen')
$$;
revoke all on function public.papa_badge_recorded_candidates(text,text,text,timestamptz) from public,anon,authenticated,service_role;
-- A separate deferred trigger runs after all draw inserts, once per player.
create function public.papa_badge_supplement_event() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare p text;k text;
begin
 if new.action in ('migrate','import') or new.action like 'import:%' then return new;end if;
 p=case when new.action='request_failed' then new.actor_player_id else coalesce(new.after_data->>'playerId',new.before_data->>'playerId') end;
 if p is null or not public.papa_achievement_player_valid(new.space_id,p,false) then return new;end if;
 k='papa.badge2_supplement_'||md5(new.space_id||'|'||new.streamer_id||'|'||p);
 if current_setting(k,true)='done' then return new;end if;
 perform set_config(k,'done',true);
 perform public.papa_badge_apply(new.space_id,new.streamer_id,public.papa_badge_recorded_candidates(new.space_id,new.streamer_id,p),new.id);
 return new;
end $$;
create constraint trigger papa_badge_supplement_after_event after insert on public.papa_events deferrable initially deferred
 for each row when(new.entity_kind in ('ledger','queue')) execute function public.papa_badge_supplement_event();
revoke all on function public.papa_badge_supplement_event() from public,anon,authenticated,service_role;
commit;
