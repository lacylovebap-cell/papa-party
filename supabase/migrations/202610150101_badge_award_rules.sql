begin;
create function public.papa_badge_song_field(queue_data jsonb,item jsonb,attribute_name text) returns text
language sql immutable set search_path=pg_catalog as $$
 select coalesce(item->>attribute_name,case when
  case when jsonb_typeof(queue_data->'items')='array' then jsonb_array_length(queue_data->'items') else 0 end>1
  then null else queue_data->>attribute_name end)
$$;
revoke all on function public.papa_badge_song_field(jsonb,jsonb,text) from public,anon,authenticated,service_role;
-- Global evaluation stays inside PostgreSQL: no cross-streamer history leaves
-- the database. The Edge reuses its existing room snapshot for room rules.
create function public.papa_badge_global_candidates(s text,p text,as_of timestamptz default now())
returns table(code text,acquired_at timestamptz) language sql stable security definer
set search_path=pg_catalog,public as $$
 with subject as(select public.papa_badge_account(s,p) id),
 profiles as(
  select 'space-001'::text space_id,b.legacy_player_id player_id from public.papa_account_legacy_players b
   join public.papa_v2_entities profile on profile.kind='players' and profile.id=b.legacy_player_id,subject
   where b.account_id=subject.id and coalesce(profile.data->'test','false')<>'true'
  union all select f.space_id,f.player_id from public.papa_space_player_profiles f,subject where f.account_id=subject.id and coalesce(f.data->'test','false')<>'true'
 ),queues as materialized(
  select e.id,e.data,public.papa_accounting_time(e.data->>'completedAt') finished
  from profiles f join public.papa_v2_entities e on e.kind='queue' and e.space_id=f.space_id and e.data->>'playerId'=f.player_id
  where e.data->>'kind' in ('live','saved') and e.data->>'status'='completed'
   and coalesce(e.data->>'source',case when e.data->'selfProvided'='true' then 'self' else 'manual' end)='manual'
   and coalesce(e.data->'selfProvided','false')<>'true'
   and coalesce(e.data->'test','false')<>'true' and nullif(e.data->>'voided_at','') is null
   and nullif(e.data->>'performance_duplicate_of','') is null
   and public.papa_accounting_time(e.data->>'completedAt')<=as_of
 ),units as(
  select q.id,lower(btrim(public.papa_badge_song_field(q.data,i.item,'title'))) title,q.finished,i.ordinality,series.n
  from queues q cross join lateral jsonb_array_elements(
   case when jsonb_typeof(q.data->'items')='array' and jsonb_array_length(q.data->'items')>0 then q.data->'items'
   else jsonb_build_array(jsonb_build_object('title',q.data->>'title','performances',1)) end) with ordinality i(item,ordinality)
  cross join lateral generate_series(1,case when i.item->>'performances' ~ '^[0-9]{1,4}$'
   then greatest(1,least(1000,(i.item->>'performances')::int)) else 1 end) series(n)
 ),numbered as(select title,finished,row_number() over(partition by title order by finished,id,ordinality,n) n from units where nullif(title,'') is not null),
 tag_sources as(
  select q.finished,q.data->'achievement_tags' tags from queues q
  union all select q.finished,i.item->'achievement_tags' from queues q cross join lateral jsonb_array_elements(
   case when jsonb_typeof(q.data->'items')='array' then q.data->'items' else '[]' end)i(item)
 ),tags as(
  select lower(btrim(t.value#>>'{}')) keyword,min(q.finished) finished
  from tag_sources q cross join lateral jsonb_array_elements(
   case when jsonb_typeof(q.tags)='array' then q.tags else '[]' end) t(value)
  where jsonb_typeof(t.value)='string' and btrim(t.value#>>'{}')<>'' group by lower(btrim(t.value#>>'{}'))
 ),tag_numbered as(select finished,row_number() over(order by finished,keyword) n from tags)
 select thresholds.code,min(n.finished) from numbered n join (values('love10',15),('dna30',30),('same10',50)) thresholds(code,n)
 on thresholds.n=n.n group by thresholds.code
 union all select 'all_tags',finished from tag_numbered where n=20
$$;
revoke all on function public.papa_badge_global_candidates(text,text,timestamptz) from public,anon,authenticated,service_role;

alter function public.papa_achievement_eligibility(text,text,text,timestamptz) rename to papa_achievement_eligibility_legacy;
create function public.papa_achievement_eligibility(s text,r text,p text,as_of timestamptz default now())
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_object_agg(code,active),'{}'::jsonb) from(
 select c.code,bool_or(a.active and (a.manual_verified or (a.rule_version=2 or c.badge_id is null) and (a.expires_at is null or a.expires_at>as_of))) active
 from public.papa_achievement_catalog c join public.papa_achievement_awards a on a.code=c.code
 where not c.retired and c.badge_scope='streamer' and a.space_id=s and a.streamer_id=r and a.player_id=p group by c.code
 union all select g.code,g.active and (g.manual_verified or g.expires_at is null or g.expires_at>as_of)
 from public.papa_global_badge_awards g where g.account_id=public.papa_badge_account(s,p)
 ) flags
$$;
revoke all on function public.papa_achievement_eligibility(text,text,text,timestamptz),public.papa_achievement_eligibility_legacy(text,text,text,timestamptz) from public,anon,authenticated,service_role;

-- Applies only changed, server-calculated candidates in the same revision lock
-- and transaction as the source business operation. Manual records are protected
-- by the released protection trigger. Raw queue/ledger/Audit rows are untouched.
create function public.papa_badge_apply(s text,r text,changes jsonb,event_id bigint)
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
   where a.space_id=s and a.streamer_id=r and a.player_id=b->>'playerId' and a.code=c.code and a.period=key for update;
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
revoke all on function public.papa_badge_apply(text,text,jsonb,bigint) from public,anon,authenticated,service_role;

create or replace function public.papa_achievement_event() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare ctx jsonb;global_candidates jsonb;player text;subject uuid;item record;flags jsonb;lock_key text;legacy_prior record;qualified boolean;inactive_global record;
begin
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
   where a.manual_verified and public.papa_badge_account(a.space_id,a.player_id)=subject group by a.code
  on conflict(account_id,code) do update set manual_verified=true,active=excluded.active,changed_at=now();
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
    where not papa_global_badge_awards.manual_verified and (not papa_global_badge_awards.active or papa_global_badge_awards.acquired_at<>excluded.acquired_at);
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
  if legacy_prior.manual_verified or legacy_prior.code is null and not qualified or legacy_prior.active is not distinct from qualified then continue;end if;
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
revoke all on function public.papa_achievement_event() from public,anon,authenticated,service_role;
commit;
