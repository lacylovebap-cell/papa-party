begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
-- Private recovery point. No original song, credit or performance is deleted.
insert into papa_release_backups(release,snapshot)
select '10.05-CATALOG.2-before',jsonb_build_object('state',papa_v2_snapshot(),
 'languages',(select jsonb_agg(to_jsonb(x)) from papa_catalog_languages x),
 'variants',(select jsonb_agg(to_jsonb(x)) from papa_catalog_variants x),
 'candidates',(select jsonb_agg(to_jsonb(x)) from papa_catalog_candidates x),
 'links',(select jsonb_agg(to_jsonb(x)) from papa_catalog_song_links x),
 'filters',(select jsonb_agg(to_jsonb(x)) from papa_catalog_language_filter_items x))
on conflict do nothing;
select 1 from papa_v2_revision where id=1 for update;

-- Keep approvals and source-hash validity while changing only language values.
create temporary table catalog_language_sources on commit drop as
select id,papa_catalog_source_hash(data) old_hash from papa_v2_entities
where kind='songs' and data->>'cat'='國語';
alter table papa_v2_entities disable trigger papa_catalog_song_candidate;
update papa_v2_entities set data=jsonb_set(data,'{cat}','"華語"')
where kind='songs' and data->>'cat'='國語';
alter table papa_v2_entities enable trigger papa_catalog_song_candidate;
update papa_catalog_song_links l set source_hash=papa_catalog_source_hash(e.data)
from catalog_language_sources old,papa_v2_entities e
where e.kind='songs' and e.id=old.id and l.song_id=e.id and l.streamer_id=e.data->>'streamer_id' and l.source_hash=old.old_hash;
update papa_catalog_candidates c set source_hash=papa_catalog_source_hash(e.data)
from catalog_language_sources old,papa_v2_entities e
where e.kind='songs' and e.id=old.id and c.song_id=e.id and c.streamer_id=e.data->>'streamer_id' and c.source_hash=old.old_hash;
update papa_catalog_candidates set language_text='華語' where language_text='國語';
update papa_catalog_variants set language_text='華語' where language_text='國語';
do $$
declare chosen text; alias_id text;
begin
 select id into chosen from papa_catalog_languages where name='華語' order by (id='mandarin') desc,id limit 1;
 if chosen is null then
  select id into chosen from papa_catalog_languages where name='國語' order by (id='mandarin') desc,id limit 1;
  if chosen is null then chosen='mandarin';insert into papa_catalog_languages(id,name,sort_order) values(chosen,'華語',10);
  else update papa_catalog_languages set name='華語',active=true,updated_at=now() where id=chosen;end if;
 end if;
 for alias_id in select id from papa_catalog_languages where name='國語' and id<>chosen loop
  update papa_catalog_variants set language_id=chosen where language_id=alias_id;
  insert into papa_catalog_language_filter_items(streamer_id,language_id)
   select streamer_id,chosen from papa_catalog_language_filter_items where language_id=alias_id on conflict do nothing;
  delete from papa_catalog_language_filter_items where language_id=alias_id;
  update papa_catalog_languages set name='已合併至華語 · '||alias_id,active=false,updated_at=now() where id=alias_id;
 end loop;
end $$;
-- Correct the old alias lookup without replacing other established behavior.
do $$ declare definition text;begin
 select pg_get_functiondef('papa_catalog_review(text,uuid[],uuid,uuid,text,text,jsonb)'::regprocedure) into definition;
 definition=replace(definition,'case when c.language_text=''華語'' then ''國語'' else c.language_text end','case when c.language_text=''國語'' then ''華語'' else c.language_text end');
 execute definition;
end $$;

create function papa_catalog_review_v2(decision text,candidate_ids uuid[],target_variant uuid default null,
 target_family uuid default null,version_label text default '',actor_id text default '',expected_sources jsonb default null,
 common_metadata jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare c papa_catalog_candidates; selected papa_catalog_candidates; result jsonb; chosen uuid; family uuid;
 title_value text;artist_value text;language_value text;performer_value text;label_value text;language_key text;performer_key text; matches int;
begin
 if decision not in ('confirm_same','approve_new','link_variant','create_variant','reject','remove','unlink') or
  candidate_ids is null or cardinality(candidate_ids) not between 1 and 50 or
  (select count(distinct x) from unnest(candidate_ids) x)<>cardinality(candidate_ids) or
  expected_sources is null or coalesce(actor_id,'')='' or common_metadata is null or jsonb_typeof(common_metadata)<>'object' or
  exists(select 1 from jsonb_object_keys(common_metadata) k where k not in ('title','artist','language','performerType','versionLabel')) or
  exists(select 1 from jsonb_each(common_metadata) kv where jsonb_typeof(kv.value)<>'string' or length(kv.value #>> '{}')>300)
 then raise exception 'CATALOG_REVIEW_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 perform 1 from papa_v2_entities e join papa_catalog_candidates indexed on indexed.song_id=e.id
  where e.kind='songs' and indexed.id=any(candidate_ids) order by e.id for update of e;
 perform 1 from papa_catalog_candidates where id=any(candidate_ids) order by id for update;
 if (select count(*) from papa_catalog_candidates where id=any(candidate_ids))<>cardinality(candidate_ids) then raise exception 'CATALOG_CANDIDATE_MISSING';end if;
 if exists(select 1 from papa_catalog_candidates indexed left join papa_v2_entities e on e.kind='songs' and e.id=indexed.song_id
  where indexed.id=any(candidate_ids) and ((expected_sources->>indexed.id::text) is distinct from indexed.source_hash or
   e.data->>'streamer_id' is distinct from indexed.streamer_id or papa_catalog_source_hash(e.data) is distinct from indexed.source_hash))
 then raise exception 'CATALOG_SELECTION_STALE';end if;
 if decision not in ('confirm_same','approve_new') then
  return papa_catalog_review(decision,candidate_ids,target_variant,target_family,version_label,actor_id,expected_sources);
 end if;
 for selected in select * from papa_catalog_candidates where id=any(candidate_ids) order by array_position(candidate_ids,id) loop
  c=selected;
  if decision='confirm_same' and chosen is not null then
   perform papa_catalog_review('link_variant',array[c.id],chosen,null,'',actor_id,expected_sources);continue;
  end if;
  title_value=coalesce(common_metadata->>'title',c.title);artist_value=coalesce(common_metadata->>'artist',c.artist);
  language_value=coalesce(common_metadata->>'language',c.language_text);if language_value='國語' then language_value='華語';end if;
  performer_value=coalesce(common_metadata->>'performerType',c.performer_type_text);
  label_value=coalesce(common_metadata->>'versionLabel',nullif(version_label,''),c.version_label,'');
  if length(trim(title_value))=0 or length(label_value)>120 then raise exception 'CATALOG_METADATA_INVALID';end if;
  select count(*),min(v.id::text)::uuid into matches,chosen from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active
   left join papa_catalog_languages l on l.id=v.language_id left join papa_catalog_performer_types p on p.id=v.performer_type_id
   where v.active and papa_catalog_normalize(v.title)=papa_catalog_normalize(title_value)
    and papa_catalog_normalize(v.artist)=papa_catalog_normalize(artist_value)
    and coalesce(l.name,v.language_text)=language_value and coalesce(p.name,v.performer_type_text)=performer_value
    and papa_catalog_normalize(v.version_label)=papa_catalog_normalize(label_value);
  if matches>1 then raise exception 'CATALOG_AMBIGUOUS_TARGET';end if;
  if chosen is null then
   result=papa_catalog_review('approve_new',array[c.id],null,null,label_value,actor_id,expected_sources);
   chosen=(result->>'variantId')::uuid;
   select id into language_key from papa_catalog_languages where name=language_value and active;
   select id into performer_key from papa_catalog_performer_types where name=performer_value and active;
   update papa_catalog_variants set title=title_value,artist=artist_value,language_id=language_key,language_text=language_value,
    performer_type_id=performer_key,performer_type_text=performer_value,updated_at=clock_timestamp() where id=chosen;
   update papa_catalog_families set title=title_value where id=(select family_id from papa_catalog_variants where id=chosen);
  else perform papa_catalog_review('link_variant',array[c.id],chosen,null,'',actor_id,expected_sources);end if;
  if decision='approve_new' then chosen=null;end if;
 end loop;
 if decision='confirm_same' then
  select family_id into family from papa_catalog_variants where id=chosen;
  insert into papa_catalog_audit(actor_id,action,candidate_ids,family_id,variant_id,details)
  values(actor_id,'confirm_same',candidate_ids,family,chosen,jsonb_build_object('count',cardinality(candidate_ids),'title',title_value));
 end if;
 return jsonb_build_object('ok',true,'count',cardinality(candidate_ids),'variantId',chosen);
end $$;
revoke all on function papa_catalog_review_v2(text,uuid[],uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function papa_catalog_review_v2(text,uuid[],uuid,uuid,text,text,jsonb,jsonb) to service_role;

-- One event stream for both history screens; existing catalog audit remains as recovery evidence.
create function papa_catalog_audit_to_event() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,created_at,effective_at,after_data)
 values('__global__','shared_catalog','catalog:'||new.id,new.action,new.actor_id,new.created_at,new.created_at::text,
  papa_audit_redact(jsonb_build_object('actor',new.actor_id,'details',new.details,'variantId',new.variant_id,
   'titles',(select jsonb_agg(distinct c.title) from papa_catalog_candidates c where c.id=any(new.candidate_ids)),
   'rooms',(select jsonb_agg(distinct c.streamer_id) from papa_catalog_candidates c where c.id=any(new.candidate_ids)))));
 return new;
end $$;
create trigger papa_catalog_global_event after insert on papa_catalog_audit for each row execute function papa_catalog_audit_to_event();
insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,created_at,effective_at,after_data)
select '__global__','shared_catalog','catalog:'||a.id,a.action,a.actor_id,a.created_at,a.created_at::text,
 papa_audit_redact(jsonb_build_object('actor',a.actor_id,'details',a.details,'variantId',a.variant_id,
 'titles',(select jsonb_agg(distinct c.title) from papa_catalog_candidates c where c.id=any(a.candidate_ids)),
 'rooms',(select jsonb_agg(distinct c.streamer_id) from papa_catalog_candidates c where c.id=any(a.candidate_ids))))
from papa_catalog_audit a where not exists(select 1 from papa_events e where e.entity_kind='shared_catalog' and e.entity_id='catalog:'||a.id);
create function papa_event_page_v2(room_id text,page_number int default 0,include_global boolean default false,module_filter text default null,page_limit int default 50,page_offset int default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if coalesce(room_id,'')='' or page_number not between 0 and 200 or page_limit not between 1 and 50 or coalesce(page_offset,0) not between 0 and 10000 or module_filter is not null and module_filter<>'shared_catalog' then raise exception 'EVENT_PAGE_INVALID';end if;
 select coalesce(jsonb_agg(papa_audit_redact(to_jsonb(t)) order by t.created_at desc,t.id desc),'[]') into result from
  (select e.* from papa_events e where (include_global or e.streamer_id=room_id and e.entity_kind not in ('players','meta','shared_catalog'))
   and (module_filter is null or e.entity_kind=module_filter) order by e.created_at desc,e.id desc limit page_limit+1 offset coalesce(page_offset,page_number*50)) t;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(result) with ordinality t(x,n) where n<=page_limit),'[]'), 'hasMore',jsonb_array_length(result)>page_limit,'total',(select count(*) from papa_events e where (include_global or e.streamer_id=room_id and e.entity_kind not in ('players','meta','shared_catalog')) and (module_filter is null or e.entity_kind=module_filter)));
end $$;
revoke all on function papa_catalog_audit_to_event(),papa_event_page_v2(text,int,boolean,text,int,int) from public,anon,authenticated;
grant execute on function papa_event_page_v2(text,int,boolean,text,int,int) to service_role;
update papa_v2_revision set revision=revision+1 where id=1;
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
  select count(*) into n from papa_catalog_candidates c where c.status=papa_catalog_review_feed.status and (coalesce(query_text,'')='' or position(lower(query_text) in lower(c.title||' '||c.artist||' '||c.language_text))>0);
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
   where c.status=papa_catalog_review_feed.status and (coalesce(query_text,'')='' or position(lower(query_text) in lower(c.title||' '||c.artist||' '||c.language_text))>0) order by c.title_key,c.artist_key,c.version_label,c.id
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


revoke all on function papa_catalog_review_feed(text,text,int,int) from public,anon,authenticated;
grant execute on function papa_catalog_review_feed(text,text,int,int) to service_role;
create function papa_catalog_merge_same_versions(variant_ids uuid[],target_variant uuid,expected_versions jsonb,actor_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v papa_catalog_variants;n int=0;links_count int;family uuid;
begin
 if cardinality(variant_ids) not between 2 and 50 or target_variant is null or not target_variant=any(variant_ids) or
  (select count(distinct x) from unnest(variant_ids) x)<>cardinality(variant_ids) or coalesce(actor_id,'')='' then raise exception 'CATALOG_GOVERNANCE_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 for v in select * from papa_catalog_variants where id=any(variant_ids) order by id for update loop
  n=n+1;if v.updated_at is distinct from (expected_versions->>v.id::text)::timestamptz or not v.active then raise exception 'CATALOG_SELECTION_STALE';end if;
 end loop;
 if n<>cardinality(variant_ids) then raise exception 'CATALOG_VARIANT_MISSING';end if;
 select family_id into family from papa_catalog_variants where id=target_variant;
 update papa_catalog_song_links set variant_id=target_variant where variant_id=any(variant_ids) and variant_id<>target_variant;
 get diagnostics links_count=row_count;
 update papa_catalog_lyric_selections set variant_id=target_variant,updated_at=now() where variant_id=any(variant_ids) and variant_id<>target_variant;
 update papa_catalog_variants set active=false,updated_at=clock_timestamp() where id=any(variant_ids) and id<>target_variant;
 insert into papa_catalog_audit(actor_id,action,variant_id,family_id,details) values(actor_id,'confirm_same',target_variant,family,
  jsonb_build_object('variantIds',variant_ids,'links',links_count,'title',(select title from papa_catalog_variants where id=target_variant)));
 update papa_v2_revision set revision=revision+1 where id=1;
 return jsonb_build_object('ok',true,'links',links_count,'variantId',target_variant);
end $$;
revoke all on function papa_catalog_merge_same_versions(uuid[],uuid,jsonb,text) from public,anon,authenticated;
grant execute on function papa_catalog_merge_same_versions(uuid[],uuid,jsonb,text) to service_role;
create function papa_catalog_inactive_search(query_text text,page_limit int,page_offset int,room_id text)
returns jsonb language sql stable security definer set search_path=public as $$
 with matches as materialized (select v.id,v.family_id as "familyId",v.title,v.artist,coalesce(l.name,v.language_text) as language,
  coalesce(p.name,v.performer_type_text) as "performerType",v.version_label as "versionLabel",v.updated_at as "updatedAt",v.active,
  exists(select 1 from papa_catalog_song_links sl where sl.variant_id=v.id and sl.streamer_id=room_id) as "alreadyAdded"
 from papa_catalog_variants v left join papa_catalog_languages l on l.id=v.language_id left join papa_catalog_performer_types p on p.id=v.performer_type_id
 where not v.active and position(lower(coalesce(query_text,'')) in lower(v.title||' '||v.artist))>0),
 page as (select * from matches order by title,artist,id limit greatest(1,least(50,page_limit)) offset greatest(0,least(10000,page_offset)))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'total',(select count(*) from matches),'hasMore',page_offset+page_limit<(select count(*) from matches))
$$;
revoke all on function papa_catalog_inactive_search(text,int,int,text) from public,anon,authenticated;
grant execute on function papa_catalog_inactive_search(text,int,int,text) to service_role;
create index if not exists papa_events_module_feed on papa_events(entity_kind,created_at desc,id desc);
commit;
