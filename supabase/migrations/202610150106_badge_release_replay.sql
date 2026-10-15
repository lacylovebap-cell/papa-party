begin;
create table public.papa_badge_replay_batches(batch_key text primary key,source_revision bigint not null,applied_at timestamptz not null default now());
alter table public.papa_badge_replay_batches enable row level security;
revoke all on public.papa_badge_replay_batches from public,anon,authenticated,service_role;
-- Release-only service RPCs. Keyset pages expose only rule facts, never song
-- notes, lyrics, profile credentials, full Audit rows or the generic snapshot.
create function public.papa_badge_replay_rooms() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('spaceId',r.space_id,'streamerId',r.streamer_id) order by r.space_id,r.streamer_id),'[]')
 from public.papa_space_streamers r join public.papa_spaces s on s.id=r.space_id and s.status='active'
$$;
create function public.papa_badge_replay_page(s text,r text,k text,cursor_id text default '',expected_revision bigint default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare current_revision bigint;rows jsonb;next_id text;
begin
 if k not in ('queue','ledger','players') or k is null or cursor_id is null
  or not exists(select 1 from public.papa_space_streamers where space_id=s and streamer_id=r) then raise exception 'BADGE_REPLAY_SCOPE_INVALID';end if;
 select revision into current_revision from public.papa_v2_revision where id=1;
 if expected_revision is not null and current_revision<>expected_revision then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 if k='players' then
  with profiles as(
   select p.id,p.data from public.papa_v2_entities p where s='space-001' and p.kind='players' and p.id>cursor_id
    and (exists(select 1 from public.papa_v2_entities e where e.space_id=s and e.kind in ('queue','ledger') and e.data->>'streamer_id'=r and e.data->>'playerId'=p.id)
     or exists(select 1 from public.papa_achievement_awards a where a.space_id=s and a.streamer_id=r and a.player_id=p.id))
   union all select p.player_id,p.data from public.papa_space_player_profiles p where s<>'space-001' and p.space_id=s and p.player_id>cursor_id
    and (exists(select 1 from public.papa_v2_entities e where e.space_id=s and e.kind in ('queue','ledger') and e.data->>'streamer_id'=r and e.data->>'playerId'=p.player_id)
     or exists(select 1 from public.papa_achievement_awards a where a.space_id=s and a.streamer_id=r and a.player_id=p.player_id))
  ),page as(select id,jsonb_build_object('playerId',id,'test',coalesce(data->'test','false'),'archived',coalesce(data->'archived','false')) data from profiles order by id limit 100)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'data',data) order by id),'[]'),max(id) into rows,next_id from page;
 else
  with page as(select e.id,e.data from public.papa_v2_entities e where e.space_id=s and e.kind=k and e.data->>'streamer_id'=r and e.id>cursor_id order by e.id limit 100),
  projected as(select id,case when k='queue' then jsonb_strip_nulls(jsonb_build_object(
   'id',id,'playerId',data->'playerId','streamer_id',r,'kind',data->'kind','source',data->'source','selfProvided',data->'selfProvided',
   'title',data->'title','artist',data->'artist','at',data->'at','acceptedAt',data->'acceptedAt','completedAt',data->'completedAt',
   'status',data->'status','test',data->'test','voided_at',data->'voided_at','performance_duplicate_of',data->'performance_duplicate_of',
   'quota_effective_at',data->'quota_effective_at','achievement_tags',data->'achievement_tags',
   'items',(select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('songId',i->'songId','title',i->'title','artist',i->'artist',
    'performances',i->'performances','achievement_tags',i->'achievement_tags','achievement_performers',i->'achievement_performers')))
    from jsonb_array_elements(case when jsonb_typeof(data->'items')='array' then data->'items' else '[]' end)i)))
   else jsonb_strip_nulls(jsonb_build_object('id',id,'playerId',data->'playerId','streamer_id',r,'at',data->'at','amount',data->'amount',
    'accounting_kind',data->'accounting_kind','receipt_quantity',data->'receipt_quantity','test',data->'test','voided_at',data->'voided_at',
    'conversion',data->'conversion','excludeStats',data->'excludeStats','openingBalance',data->'openingBalance',
    'accounting_adjustment',data->'accounting_adjustment')) end data from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'data',data) order by id),'[]'),max(id) into rows,next_id from projected;
 end if;
 return jsonb_build_object('revision',current_revision,'rows',rows,'nextCursor',case when jsonb_array_length(rows)=100 then next_id end);
end $$;

create function public.papa_badge_replay_apply(s text,r text,expected_revision bigint,players jsonb,changes jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_revision bigint;source_id bigint;p text;subject uuid;item record;global_candidates jsonb;context_before text;updated_count integer;v_batch_key text;
begin
 if jsonb_typeof(players) is distinct from 'array' or jsonb_array_length(players)>25
  or jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>50000
  or not exists(select 1 from public.papa_space_streamers where space_id=s and streamer_id=r)
  or exists(select 1 from jsonb_array_elements_text(players) candidate_player(value) where not public.papa_achievement_player_valid(s,candidate_player.value,false))
  or exists(select 1 from jsonb_array_elements(changes) b where not players? (b->>'playerId'))
 then raise exception 'BADGE_REPLAY_BATCH_INVALID';end if;
 select revision into current_revision from public.papa_v2_revision where id=1 for update;
 if expected_revision is null or expected_revision<>current_revision then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 v_batch_key=md5(s||'|'||r||'|'||expected_revision::text||'|'||players::text||'|'||changes::text);
 if exists(select 1 from public.papa_badge_replay_batches b where b.batch_key=v_batch_key) then
  return jsonb_build_object('ok',true,'alreadyRecorded',true,'players',jsonb_array_length(players),'revision',current_revision);
 end if;
 context_before=current_setting('papa.actor_context',true);
 perform set_config('papa.actor_context',jsonb_build_object('role','system','space_id',s,'streamer_id',r,'badgeReplay',true)::text,true);
 insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id,after_data)
 values(r,'achievement','badge-rules-v2','achievement_release_rejudged','system',s,
  jsonb_build_object('rule_version',2,'source_revision',current_revision,'player_count',jsonb_array_length(players))) returning id into source_id;
 -- Reclassification is additive; original award rows and Audit remain. Manual
 -- certification is explicitly exempt, including the five retired histories.
 update public.papa_achievement_awards a set active=false,rule_version=2,changed_at=now(),source_event_id=source_id
 from public.papa_achievement_catalog c where c.code=a.code and c.badge_id is not null and not a.manual_verified
  and a.space_id=s and a.streamer_id=r and players?a.player_id
  and a.active and (a.rule_version<>2 or not exists(select 1 from jsonb_array_elements(changes)b where b->>'playerId'=a.player_id and b->>'code'=a.code
   and coalesce((b->>'active')::boolean,false)));
 get diagnostics updated_count=row_count;
 perform public.papa_badge_apply(s,r,changes,source_id);
 for p in select jsonb_array_elements_text(players) loop
  perform public.papa_badge_apply(s,r,public.papa_badge_recorded_candidates(s,r,p),source_id);
  subject=public.papa_badge_account(s,p);
  if subject is null then continue;end if;
  insert into public.papa_global_badge_awards(account_id,code,active,acquired_at,source_event_id,manual_verified)
   select subject,a.code,bool_or(a.active),min(a.acquired_at),min(a.source_event_id),true
   from public.papa_achievement_awards a join public.papa_achievement_catalog c on c.code=a.code and c.badge_scope='global'
   where a.manual_verified and public.papa_badge_account(a.space_id,a.player_id)=subject group by a.code
  on conflict(account_id,code) do update set manual_verified=true,active=excluded.active,changed_at=now();
  select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'acquired_at',c.acquired_at)),'[]') into global_candidates from public.papa_badge_global_candidates(s,p)c;
  update public.papa_global_badge_awards g set active=false,changed_at=now(),source_event_id=source_id
   where g.account_id=subject and g.active and not g.manual_verified and not exists(select 1 from jsonb_array_elements(global_candidates)c where c->>'code'=g.code);
  for item in select x.code,x.acquired_at from jsonb_to_recordset(global_candidates)x(code text,acquired_at timestamptz) loop
   insert into public.papa_global_badge_awards(account_id,code,active,acquired_at,source_event_id)
   values(subject,item.code,true,item.acquired_at,source_id) on conflict(account_id,code) do update
    set active=true,acquired_at=excluded.acquired_at,changed_at=now(),source_event_id=source_id where not papa_global_badge_awards.manual_verified;
  end loop;
 end loop;
 perform set_config('papa.actor_context',coalesce(context_before,''),true);
 insert into public.papa_badge_replay_batches values(v_batch_key,current_revision,now());
 return jsonb_build_object('ok',true,'players',jsonb_array_length(players),'reclassified',updated_count,'revision',current_revision);
end $$;
revoke all on function public.papa_badge_replay_rooms(),public.papa_badge_replay_page(text,text,text,text,bigint),
 public.papa_badge_replay_apply(text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.papa_badge_replay_rooms(),public.papa_badge_replay_page(text,text,text,text,bigint),
 public.papa_badge_replay_apply(text,text,bigint,jsonb,jsonb) to service_role;
commit;
