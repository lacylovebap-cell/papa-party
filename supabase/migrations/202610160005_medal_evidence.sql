begin;
-- Add selected evidence to NEW automatic Audit only. Never replay or rewrite old awards.
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


create function public.papa_medal_evidence_key(c text,p text,s text,r text,acquired timestamptz)
returns text language sql immutable set search_path=pg_catalog as $$
 select md5(concat_ws('|','medal-evidence-v1',c,p,s,r,extract(epoch from acquired)::text));
$$;
revoke all on function public.papa_medal_evidence_key(text,text,text,text,timestamptz) from public,anon,authenticated,service_role;

create function public.papa_medal_evidence_page(s text,r text,actor jsonb,c text,subject_key text,evidence_key text,page_number int)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public set timezone='Asia/Taipei' as $$
declare ctx jsonb;super boolean;catalog record;result jsonb;entries jsonb='[]';item jsonb;trigger_data jsonb;songs jsonb;matching int;progress jsonb;
begin
 ctx=public.papa_notice_category_scope(s,r,actor,'room');super=ctx->>'recipient'='__super__';
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 if subject_key is null or subject_key !~ '^[a-f0-9]{32}$' or evidence_key is not null and evidence_key !~ '^[a-f0-9]{32}$'
  or page_number is null or page_number not between 0 and 100000 then raise exception 'ACHIEVEMENT_EVIDENCE_INVALID';end if;
 select * into catalog from public.papa_achievement_catalog where code=c and not retired;
 if not found or catalog.badge_scope='global' and not super then raise exception 'ACHIEVEMENT_EVIDENCE_INVALID';end if;
 with awards as(
  select a.space_id,a.streamer_id,a.player_id,a.period,a.acquired_at,a.expires_at,a.active,a.manual_verified,a.certification_reason,a.source_event_id,a.rule_version,
   md5('medal-manager:'||coalesce(public.papa_badge_account(a.space_id,a.player_id)::text,'legacy:'||a.space_id||':'||a.player_id)) player_key
  from public.papa_achievement_awards a where catalog.badge_scope='streamer' and a.code=c and (super or a.space_id=s and a.streamer_id=r)
  union all select null,null,'account:'||g.account_id::text,'lifetime',g.acquired_at,g.expires_at,g.active,g.manual_verified,null,g.source_event_id,2,
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
  if c='cleaner' and item->>'manual_verified'<>'true' then
   select coalesce(jsonb_agg(v||jsonb_build_object('playerDice',v->>'source' in ('draw','cross_draw') and v->>'kind' in ('live','saved'),
    'earlierTitleRequests',(select count(*) from public.papa_v2_entities q where q.kind='queue' and q.space_id=item->>'space_id'
     and q.data->>'streamer_id'=item->>'streamer_id' and q.data->>'kind' in ('live','saved','self')
     and public.papa_achievement_player_valid(q.space_id,q.data->>'playerId',false) and coalesce(q.data->'test','false')<>'true' and nullif(q.data->>'voided_at','') is null
     and nullif(q.data->>'performance_duplicate_of','') is null and q.data->>'acceptedAt' is not null
     and q.data->>'status' in ('waiting','completed','stored') and public.papa_accounting_time(q.data->>'at')<public.papa_accounting_time(v->>'requestAt')
     and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(q.data->'items')='array' and jsonb_array_length(q.data->'items')>0
      then q.data->'items' else jsonb_build_array(jsonb_build_object('title',q.data->>'title')) end) song where lower(btrim(song->>'title'))=lower(btrim(v->>'title')))))),'[]')
    into songs from jsonb_array_elements(songs) v;
  end if;
  if catalog.badge_scope='streamer' and item->>'manual_verified'<>'true' and c<>'cleaner' then
   progress=public.papa_badge_progress(item->>'space_id',item->>'streamer_id',item->>'player_id',public.papa_accounting_time(item->>'acquired_at'))->c;
  end if;
  entries=entries||jsonb_build_array(jsonb_build_object('name',catalog.name,'emoji',catalog.emoji,'condition',catalog.condition_text,
   'sourceRule',case when c='cleaner' then '只計玩家端骰子／玩家跨主播骰子；主播自己骰、主播代骰及一般自帶均排除。' end,
   'streamerName',case when catalog.badge_scope='global' then '全站勳章' else coalesce((select room->>'display_name' from jsonb_array_elements(public.papa_streamer_directory()) room
    where room->>'id'=item->>'streamer_id' and room->>'spaceId'=item->>'space_id' limit 1),'歷史主播') end,
   'acquiredAt',item->'acquired_at','expiresAt',item->'expires_at','manualVerified',item->'manual_verified','manualReason',case when item->>'manual_verified'='true' then trigger_data->>'reason' end,
   'currentActive',(item->>'active')::boolean and (item->>'expires_at' is null or public.papa_accounting_time(item->>'expires_at')>now()) and public.papa_badge_current_active(coalesce(item->>'space_id',s),coalesce(item->>'streamer_id',r),item->>'player_id',c),
   'evidenceType',case when item->>'manual_verified'='true' then 'manual' when trigger_data is not null then 'recorded' when matching>0 then 'candidate' else 'unavailable' end,
   'songs',songs,'matchingSongCount',matching,'progressRecalculated',progress));
 end loop;
 return jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',s,'streamerId',r),'mode','evidence','rows',entries,'total',result->'total','page',page_number);
end $$;
revoke all on function public.papa_medal_evidence_page(text,text,jsonb,text,text,text,int) from public,anon,authenticated,service_role;

alter function public.papa_achievement_management(text,text,jsonb,text,text,text,int) rename to papa_achievement_management_accounts_v5;
revoke all on function public.papa_achievement_management_accounts_v5(text,text,jsonb,text,text,text,int) from public,anon,authenticated,service_role;
create function public.papa_achievement_management(requested_space text,requested_room text,actor_context jsonb,
 requested_view text default 'catalog',requested_code text default null,query_text text default '',page_number int default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;entries jsonb='[]';item jsonb;
begin
 if requested_view='evidence' then
  return public.papa_medal_evidence_page(requested_space,requested_room,actor_context,requested_code,actor_context->>'management_subject',actor_context->>'management_evidence',page_number);
 end if;
 result=public.papa_achievement_management_accounts_v5(requested_space,requested_room,actor_context,requested_view,requested_code,query_text,page_number);
 if requested_view='recipientRooms' then
  for item in select value from jsonb_array_elements(result->'rows') loop
   entries=entries||jsonb_build_array(item||jsonb_build_object('evidenceKey',public.papa_medal_evidence_key(requested_code,actor_context->>'management_subject',item->>'spaceId',item->>'streamerId',public.papa_accounting_time(item->>'acquiredAt'))));
  end loop;
  result=jsonb_set(result,'{rows}',entries);
 end if;
 return result;
end $$;
revoke all on function public.papa_achievement_management(text,text,jsonb,text,text,text,int) from public,anon,authenticated;
grant execute on function public.papa_achievement_management(text,text,jsonb,text,text,text,int) to service_role;
notify pgrst,'reload schema';
commit;
