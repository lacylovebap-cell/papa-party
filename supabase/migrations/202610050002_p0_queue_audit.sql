begin;
insert into public.papa_release_backups(release,snapshot)
values('10.05-P0-before',public.papa_v2_snapshot()) on conflict do nothing;

-- A room-leading index cannot serve the president's global ordered feed.
-- Before this index, production's 50-row read took 15.5 seconds.
create index if not exists papa_events_global_feed on public.papa_events(created_at desc,id desc);
create or replace function public.papa_event_page_v2(room_id text,page_number int default 0,include_global boolean default false,module_filter text default null,page_limit int default 50,page_offset int default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; total_rows bigint;
begin
 if coalesce(room_id,'')='' or page_number not between 0 and 200 or page_limit not between 1 and 50 or coalesce(page_offset,0) not between 0 and 10000 or module_filter is not null and module_filter<>'shared_catalog' then raise exception 'EVENT_PAGE_INVALID';end if;
 -- Explicit branches let PostgreSQL choose the correct global, module or room index.
 if module_filter='shared_catalog' then
  select coalesce(jsonb_agg(papa_audit_redact(to_jsonb(t)) order by t.created_at desc,t.id desc),'[]') into result from
   (select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,created_at,effective_at,before_data,after_data from papa_events e where e.entity_kind='shared_catalog' and (include_global or e.streamer_id=room_id) order by e.created_at desc,e.id desc limit page_limit+1 offset coalesce(page_offset,page_number*50)) t;
  select count(*) into total_rows from papa_events e where e.entity_kind='shared_catalog' and (include_global or e.streamer_id=room_id);
 elsif include_global then
  select coalesce(jsonb_agg(papa_audit_redact(to_jsonb(t)) order by t.created_at desc,t.id desc),'[]') into result from
   (select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,created_at,effective_at,before_data,after_data from papa_events e order by e.created_at desc,e.id desc limit page_limit+1 offset coalesce(page_offset,page_number*50)) t;
 else
  select coalesce(jsonb_agg(papa_audit_redact(to_jsonb(t)) order by t.created_at desc,t.id desc),'[]') into result from
   (select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,created_at,effective_at,before_data,after_data from papa_events e where e.streamer_id=room_id and e.entity_kind not in ('players','meta','shared_catalog') order by e.created_at desc,e.id desc limit page_limit+1 offset coalesce(page_offset,page_number*50)) t;
 end if;
 -- Ordinary history only needs hasMore, so no full-table count on each page.
 return jsonb_build_object('rows',coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(result) with ordinality t(x,n) where n<=page_limit),'[]'),'hasMore',jsonb_array_length(result)>page_limit,'total',total_rows);
end $$;

-- Capture names at event time, before a song is renamed, detached or removed.
create function public.papa_event_song_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
declare source jsonb; song_data jsonb; variant_data record;
begin
 source=coalesce(new.after_data,new.before_data,'{}');
 if new.entity_kind in ('songs','queue','crowns','wishes','request') then
  select data into song_data from papa_v2_entities where kind='songs' and id=coalesce(source->>'songId',source->>'song_id');
  source=source||jsonb_build_object('songSnapshot',jsonb_build_object('title',coalesce(source->>'title',song_data->>'title'),'artist',coalesce(source->>'artist',song_data->>'artist')));
 elsif new.entity_kind='shared_catalog' then
  select title,artist into variant_data from papa_catalog_variants where id::text=source->>'variantId';
  source=source||jsonb_build_object('songSnapshot',jsonb_build_object('title',coalesce(variant_data.title,source->'titles'->>0,source->'details'->>'title'),'artist',variant_data.artist));
 else return new;end if;
 if new.after_data is not null then new.after_data=papa_audit_redact(source);else new.before_data=papa_audit_redact(source);end if;
 return new;
end $$;
create trigger papa_event_song_snapshot before insert on public.papa_events for each row execute function public.papa_event_song_snapshot();

-- Scheduled readiness uses the existing notification / push pipeline, not browser polling.
create index if not exists papa_queue_preparation_due on public.papa_v2_entities((data->>'preparationEndsAt'))
where kind='queue' and data->>'status'='waiting' and data->>'preparationEndsAt' is not null and coalesce(data->>'readyAt','')='';
create function public.papa_queue_prepare_due() returns int language plpgsql security definer set search_path=public as $$
declare row_data record; q jsonb; room_name text; done int=0; due_time timestamptz=clock_timestamp();
begin
 -- Serialize with normal commits; bump revision only when a queue changes.
 if not exists(select 1 from papa_v2_entities where kind='queue' and data->>'status'='waiting' and data->>'preparationEndsAt'<=to_char(due_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') and coalesce(data->>'readyAt','')='') then return 0;end if;
 perform 1 from papa_v2_revision where id=1 for update;
 perform set_config('papa.actor_context','{"role":"system","action":"queue:ready"}',true);
 for row_data in select id,data from papa_v2_entities where kind='queue' and data->>'status'='waiting' and data->>'preparationEndsAt'<=to_char(due_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') and coalesce(data->>'readyAt','')='' and coalesce(data->>'awaitingAcknowledgment','false')<>'true' and coalesce(data->>'awaitingPreparation','false')<>'true' order by data->>'preparationEndsAt' limit 50 for update loop
  q=row_data.data;
  update papa_v2_entities set data=data||jsonb_build_object('readyAt',due_time,'stage','已準備好') where kind='queue' and id=row_data.id;
  if nullif(q->>'playerId','') is not null then
   select r->>'display_name' into room_name from papa_v2_entities m cross join lateral jsonb_array_elements(m.data->'streamers') r where m.kind='meta' and m.id='1' and r->>'id'=q->>'streamer_id';
   insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,entity_id,body)
   values(q->>'streamer_id',coalesce(room_name,'主播'),q->>'playerId','ready',2,row_data.id,coalesce(room_name,'主播')||'｜《'||coalesce(q->>'title','歌曲')||'》準備好了，即將演唱');
  end if;
  done=done+1;
 end loop;
 if done>0 then update papa_v2_revision set revision=revision+1 where id=1;end if;
 return done;
end $$;
revoke all on function papa_event_song_snapshot(),papa_queue_prepare_due(),papa_event_page_v2(text,int,boolean,text,int,int) from public,anon,authenticated;
grant execute on function papa_queue_prepare_due(),papa_event_page_v2(text,int,boolean,text,int,int) to service_role;
-- Reuse the existing minute worker. Deadline delivery is at most one scheduler tick late.
do $outer$ begin
 if exists(select 1 from pg_namespace where nspname='cron') then
  perform cron.schedule('papa-notification-retry','* * * * *',$job$
   select public.papa_queue_prepare_due();
   select net.http_post(
    url:='https://zwhcgqwbtummydapuori.supabase.co/functions/v1/party-api',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:=jsonb_build_object('op','pushWorker','secret',(select value->>'secret' from public.papa_notice_config where id='worker')),
    timeout_milliseconds:=10000
   ) where exists(select 1 from public.papa_push_jobs where status='pending' and available_at<=now());
  $job$);
 end if;
end $outer$;
create function public.papa_catalog_variant_rooms(chosen_variant uuid,page_limit int default 50,page_offset int default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;
begin
 if page_limit not between 1 and 50 or page_offset not between 0 and 10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows_json from (
  select sl.streamer_id as "streamerId",sl.song_id as "songId",e.data->>'title' as title,e.data->>'artist' as artist
  from papa_catalog_song_links sl join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
  where sl.variant_id=chosen_variant order by sl.streamer_id,sl.song_id limit page_limit+1 offset page_offset
 ) t;
 return jsonb_build_object('items',coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(rows_json) with ordinality a(x,n) where n<=page_limit),'[]'),'hasMore',jsonb_array_length(rows_json)>page_limit);
end $$;
revoke all on function papa_catalog_variant_rooms(uuid,int,int) from public,anon,authenticated;
grant execute on function papa_catalog_variant_rooms(uuid,int,int) to service_role;
-- Reuse the bounded review feed for normalized cross-page groups.
create or replace function public.papa_catalog_review_feed(status text default 'pending',query_text text default '',page_limit int default 30,
 page_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare n int; rows_json jsonb;
begin
 if coalesce(status,'') not in ('pending','approved','rejected','removed','history') or
  page_limit is null or page_offset is null or page_limit<1 or page_limit>50 or
  page_offset<0 or page_offset>10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 if status='history' then
  select count(*) into n from papa_catalog_audit;
  select coalesce(jsonb_agg(to_jsonb(page_rows)),'[]'::jsonb) into rows_json from (
   select id,actor_id as "actorId",action,candidate_ids as "candidateIds",family_id as "familyId",
    variant_id as "variantId",details,created_at as "createdAt"
   from papa_catalog_audit order by created_at desc,id desc limit page_limit offset page_offset
  ) page_rows;
 else
  select count(*) into n from papa_catalog_candidates c where c.status=papa_catalog_review_feed.status and (coalesce(query_text,'')='' or position(papa_catalog_normalize(query_text) in papa_catalog_normalize(c.title||' '||c.artist||' '||c.language_text))>0);
  with current_page as materialized (
   select c.id,c.streamer_id as "streamerId",c.song_id as "songId",c.title,c.artist,
    c.language_text as language,c.performer_type_text as "performerType",c.version_label as "versionLabel",
    c.title_key,c.artist_key,c.status,c.source_hash as "sourceHash",c.source_revision as "sourceRevision",
    c.created_at as "createdAt",c.updated_at as "updatedAt",sl.variant_id as "variantId",v.updated_at as "variantUpdatedAt",
    e.id is not null as source_valid
   from papa_catalog_candidates c left join papa_catalog_song_links sl
    on sl.streamer_id=c.streamer_id and sl.song_id=c.song_id
   left join papa_catalog_variants v on v.id=sl.variant_id
   left join papa_v2_entities e on e.kind='songs' and e.id=c.song_id
    and e.data->>'streamer_id'=c.streamer_id and papa_catalog_source_hash(e.data)=c.source_hash
   where c.status=papa_catalog_review_feed.status and (coalesce(query_text,'')='' or position(papa_catalog_normalize(query_text) in papa_catalog_normalize(c.title||' '||c.artist||' '||c.language_text))>0) order by c.title_key,c.artist_key,c.version_label,c.id
   limit page_limit offset page_offset
  )
  select coalesce(jsonb_agg(to_jsonb(page_rows) order by papa_catalog_normalize(page_rows.title),papa_catalog_normalize(page_rows.artist),page_rows."versionLabel",page_rows.id),'[]'::jsonb)
  into rows_json from (
   select p.id,p."streamerId",p."songId",p.title,p.artist,p.language,p."performerType",p."versionLabel",
    p.status,p."sourceHash",p."sourceRevision",p."createdAt",p."updatedAt",p."variantId",p."variantUpdatedAt",
    coalesce(s.items,'[]'::jsonb) as "suggestedVariants",coalesce(peers.items,'[]'::jsonb) as "suggestedCandidates"
   from current_page p
   left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('id',match.id,'title',match.title,'artist',match.artist,
      'versionLabel',match.version_label) order by match.id),'[]'::jsonb) as items
    from (
     select v.id,v.title,v.artist,v.version_label
     from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active
     where p.status='pending' and p.title_key<>'' and p.artist_key<>'' and v.active
      and public.papa_catalog_normalize(v.title)=p.title_key
      and public.papa_catalog_normalize(v.artist)=p.artist_key
     order by v.id limit 3
    ) match
   ) s on true
   -- Only the materialized page (at most 50 rows) performs peer probes. Both
   -- sides must still describe live source songs; removed, rejected, deleted,
   -- moved-room, and stale-index rows cannot become suggestions.
   left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('id',peer.id,'streamerId',peer.streamer_id,
      'songId',peer.song_id,'title',peer.title,'artist',peer.artist,'language',peer.language_text,
      'performerType',peer.performer_type_text,'versionLabel',peer.version_label,'matchType',
      case when p.artist_key='' or peer.artist_key='' or p.artist_key<>peer.artist_key then 'same_title'
       when (p.language<>'' and peer.language_text<>'' and
        papa_catalog_normalize(case when p.language in ('華語','中文') then '華語' else p.language end)<>
        papa_catalog_normalize(case when peer.language_text in ('華語','中文') then '華語' else peer.language_text end))
        or papa_catalog_normalize(p."versionLabel")<>papa_catalog_normalize(peer.version_label)
        then 'possible_version' else 'possible_same' end) order by peer.id),'[]'::jsonb) as items
    from (
     select c.id,c.streamer_id,c.song_id,c.title,c.artist,c.artist_key,c.language_text,
      c.performer_type_text,c.version_label
     from papa_catalog_candidates c join papa_v2_entities e on e.kind='songs' and e.id=c.song_id
      and e.data->>'streamer_id'=c.streamer_id and papa_catalog_source_hash(e.data)=c.source_hash
     where p.status='pending' and p.source_valid and p.title_key<>''
      and c.title_key=p.title_key and c.id<>p.id and c.status in ('pending','approved')
     order by c.id limit 3
    ) peer
   ) peers on true
  ) page_rows;
 end if;
 return jsonb_build_object('rows',rows_json,'total',n,'hasMore',page_offset+page_limit<n);
end $$;
notify pgrst,'reload schema';
commit;
