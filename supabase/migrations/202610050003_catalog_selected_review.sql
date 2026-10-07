begin;
-- Additive review metadata. Original streamer songs and private fields are not rewritten.
alter table papa_catalog_candidates add column if not exists review_group text;
alter table papa_catalog_candidates add column if not exists preferred_family uuid references papa_catalog_families(id);
alter table papa_catalog_candidates add column if not exists edited_metadata jsonb not null default '{}';
create index if not exists papa_catalog_candidate_group on papa_catalog_candidates(review_group,status,id);
create table if not exists papa_catalog_negative_decisions(
 candidate_a uuid references papa_catalog_candidates(id),candidate_b uuid references papa_catalog_candidates(id),
 actor_id text not null,created_at timestamptz not null default now(),primary key(candidate_a,candidate_b),check(candidate_a<candidate_b));
create table if not exists papa_catalog_custom_archives(
 id bigint generated always as identity primary key,streamer_id text not null,song_id text not null,
 body text not null,created_at timestamptz not null default now());
create table if not exists papa_catalog_lyric_proposals(
 variant_id uuid references papa_catalog_variants(id),streamer_id text not null,song_id text not null,
 status text not null default 'pending' check(status in ('pending','skipped','adopted')),updated_at timestamptz not null default now(),
 primary key(variant_id,streamer_id,song_id));
alter table papa_catalog_negative_decisions enable row level security;
alter table papa_catalog_custom_archives enable row level security;
alter table papa_catalog_lyric_proposals enable row level security;
revoke all on papa_catalog_negative_decisions,papa_catalog_custom_archives,papa_catalog_lyric_proposals from public,anon,authenticated;
grant all on papa_catalog_negative_decisions,papa_catalog_custom_archives,papa_catalog_lyric_proposals to service_role;
grant usage,select on sequence papa_catalog_custom_archives_id_seq to service_role;

create function papa_catalog_group_candidate() returns trigger language plpgsql security definer set search_path=public as $$
declare peer uuid; family uuid;
begin
 if new.status<>'pending' then return new;end if;
 if tg_op='UPDATE' and old.status<>'pending' then new.review_group=null;end if;
 if tg_op='UPDATE' and old.source_hash is distinct from new.source_hash then new.edited_metadata='{}';end if;
 select (e.data->>'catalogCandidateFamily')::uuid into family from papa_v2_entities e
  where e.kind='songs' and e.id=new.song_id and e.data->>'catalogCandidateFamily'~'^[a-f0-9-]{36}$';
 if family is not null and exists(select 1 from papa_catalog_families f where f.id=family and active) then
  new.preferred_family=family;new.review_group='family:'||family;return new;
 end if;
 select c.id into peer from papa_catalog_candidates c where c.title_key=new.title_key and c.id<>new.id
  and c.status in ('pending','approved') and new.title_key<>''
  and not exists(select 1 from papa_catalog_negative_decisions n where n.candidate_a=least(c.id,new.id) and n.candidate_b=greatest(c.id,new.id))
  order by c.id limit 1;
 if peer is not null then
  new.review_group=coalesce((select c.review_group from papa_catalog_candidates c where c.id=peer),'title:'||new.title_key);
 end if;
 return new;
end $$;
create trigger papa_catalog_candidate_group before insert or update of title_key,status,source_hash on papa_catalog_candidates
 for each row execute function papa_catalog_group_candidate();
-- Keep the remaining member of a reviewed group visible until explicitly decided.
update papa_catalog_candidates c set review_group='title:'||c.title_key where c.status='pending' and c.title_key<>'' and
 exists(select 1 from papa_catalog_candidates p where p.title_key=c.title_key and p.id<>c.id and p.status in ('pending','approved'));

create function papa_catalog_review_rows(chosen_group text default null) returns table(
 id uuid,"streamerId" text,"songId" text,title text,artist text,language text,"performerType" text,"versionLabel" text,
 "sourceHash" text,"updatedAt" timestamptz,"groupId" text,"preferredFamily" uuid,"hasCustomLyrics" boolean,"hasSharedLyrics" boolean)
 language sql stable security definer set search_path=public as $$
 select c.id,c.streamer_id,c.song_id,coalesce(c.edited_metadata->>'title',c.title),coalesce(c.edited_metadata->>'artist',c.artist),
  coalesce(c.edited_metadata->>'language',c.language_text),coalesce(c.edited_metadata->>'performerType',c.performer_type_text),
  coalesce(c.edited_metadata->>'versionLabel',c.version_label),c.source_hash,c.updated_at,
  coalesce(c.review_group,case when exists(select 1 from papa_catalog_candidates p where p.title_key=c.title_key and p.id<>c.id and p.status='pending' and not exists(select 1 from papa_catalog_negative_decisions n where n.candidate_a=least(c.id,p.id) and n.candidate_b=greatest(c.id,p.id))) then 'title:'||c.title_key end),c.preferred_family,
  case when ls.mode in ('own','copy') then coalesce(trim(ls.body),'')<>'' when ls.mode='shared' then false else coalesce(trim(e.data->>'lyrics'),'')<>'' end,
  exists(select 1 from papa_catalog_lyric_revisions r where r.variant_id=sl.variant_id and r.active and trim(r.body)<>'')
 from papa_catalog_candidates c join papa_v2_entities e on e.kind='songs' and e.id=c.song_id and e.data->>'streamer_id'=c.streamer_id
  and papa_catalog_source_hash(e.data)=c.source_hash
 left join papa_catalog_song_links sl on sl.streamer_id=c.streamer_id and sl.song_id=c.song_id
 left join papa_catalog_lyric_selections ls on ls.streamer_id=c.streamer_id and ls.song_id=c.song_id
 where c.status='pending' and (chosen_group is null or c.review_group=chosen_group or c.review_group is null and 'title:'||c.title_key=chosen_group and
  exists(select 1 from papa_catalog_candidates peer where peer.title_key=c.title_key and peer.id<>c.id and peer.status='pending' and
   not exists(select 1 from papa_catalog_negative_decisions n where n.candidate_a=least(c.id,peer.id) and n.candidate_b=greatest(c.id,peer.id))))
$$;

create function papa_catalog_review_page(section text,query_text text default '',language_name text default '',page_limit int default 20,
 page_offset int default 0,chosen_group text default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;n int;single_count int;duplicate_count int;
begin
 if section not in ('singles','duplicates') or page_limit not between 1 and 50 or page_offset not between 0 and 10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with groups as (select "groupId" from papa_catalog_review_rows() where "groupId" is not null group by "groupId")
 select (select count(*) from papa_catalog_review_rows() where "groupId" is null),(select count(*) from groups) into single_count,duplicate_count;
 if chosen_group is not null then
  select count(*) into n from papa_catalog_review_rows(chosen_group);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select * from papa_catalog_review_rows(chosen_group) order by id limit 100 offset page_offset) r;
  return jsonb_build_object('rows',result,'total',n,'hasMore',page_offset+100<n);
 end if;
 if section='singles' then
  select count(*) into n from papa_catalog_review_rows() r where "groupId" is null and
   (query_text='' or position(lower(query_text) in lower(r.title||' '||r.artist))>0) and (language_name='' or r.language=language_name);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select * from papa_catalog_review_rows() r where "groupId" is null and
   (query_text='' or position(lower(query_text) in lower(r.title||' '||r.artist))>0) and (language_name='' or r.language=language_name)
   order by title,artist,id limit page_limit offset page_offset) r;
 else
  with matched as (select "groupId" from papa_catalog_review_rows() r where "groupId" is not null and
   (query_text='' or position(lower(query_text) in lower(r.title||' '||r.artist))>0) and (language_name='' or r.language=language_name) group by "groupId")
  select count(*) into n from matched;
  with matched as materialized (select "groupId" from papa_catalog_review_rows() r where "groupId" is not null and
   (query_text='' or position(lower(query_text) in lower(r.title||' '||r.artist))>0) and (language_name='' or r.language=language_name)
   group by "groupId" order by "groupId" limit page_limit offset page_offset),
  members as (select r.*,row_number() over(partition by r."groupId" order by r.id) rn,count(*) over(partition by r."groupId") total
   from papa_catalog_review_rows() r join matched m on m."groupId"=r."groupId")
  select coalesce(jsonb_agg(jsonb_build_object('id',g."groupId",'total',g.total,'rows',g.rows)),'[]') into result from
   (select "groupId",max(total) total,jsonb_agg(to_jsonb(m)-'rn'-'total' order by id) rows from members m where rn<=100 group by "groupId") g;
 end if;
 return jsonb_build_object('rows',result,'total',n,'hasMore',page_offset+page_limit<n,'counts',jsonb_build_object('singles',single_count,'duplicates',duplicate_count));
end $$;

create function papa_catalog_candidate_edit(candidate_id uuid,expected_source text,metadata jsonb,actor_id text) returns jsonb
 language plpgsql security definer set search_path=public as $$
begin
 if coalesce(actor_id,'')='' or jsonb_typeof(metadata)<>'object' or exists(select 1 from jsonb_each(metadata) kv
  where kv.key not in ('title','artist','language','performerType','versionLabel') or jsonb_typeof(kv.value)<>'string' or length(kv.value #>> '{}')>300)
  or length(trim(coalesce(metadata->>'title','')))=0 then raise exception 'CATALOG_METADATA_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 update papa_catalog_candidates c set edited_metadata=metadata,title_key=papa_catalog_normalize(metadata->>'title'),
  artist_key=papa_catalog_normalize(metadata->>'artist'),review_group=null,updated_at=now()
  where c.id=candidate_id and c.status='pending' and c.source_hash=expected_source and exists(select 1 from papa_v2_entities e
   where e.kind='songs' and e.id=c.song_id and papa_catalog_source_hash(e.data)=c.source_hash);
 if not found then raise exception 'CATALOG_SELECTION_STALE';end if;
 insert into papa_catalog_audit(actor_id,action,candidate_ids,details) values(actor_id,'candidate_edit',array[candidate_id],metadata);
 return jsonb_build_object('ok',true);
end $$;

-- One transaction and one summary event per selected decision; no source-song fan-out writes.
create function papa_catalog_review_selected(decision text,candidate_ids uuid[],expected_sources jsonb,actor_id text,
 target_family uuid default null,target_variant uuid default null,common_metadata jsonb default '{}',lyrics_source uuid default null,
 shared_body text default null,version_labels jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare candidate record;family uuid=target_family;variant uuid=target_variant;first_id uuid;target_title text;mapping jsonb='{}';lyric text;source_group text;
begin
 if decision not in ('confirm_same','different_versions','independent','approve_new','link_variant','create_variant') or coalesce(actor_id,'')='' or
  candidate_ids is null or cardinality(candidate_ids) not between 1 and 50 or cardinality(candidate_ids)<>(select count(distinct x) from unnest(candidate_ids) x) or
  (decision in ('confirm_same','different_versions') and cardinality(candidate_ids)<2) or length(coalesce(shared_body,''))>100000 or
  expected_sources is null or common_metadata is null or jsonb_typeof(common_metadata)<>'object' or version_labels is null or jsonb_typeof(version_labels)<>'object' or
  exists(select 1 from jsonb_each(version_labels) kv where not kv.key=any(candidate_ids::text[]) or jsonb_typeof(kv.value)<>'string' or length(trim(kv.value #>> '{}')) not between 1 and 120) or
  exists(select 1 from jsonb_each(common_metadata) kv where kv.key not in ('title','artist','language','performerType','versionLabel') or jsonb_typeof(kv.value)<>'string' or length(kv.value #>> '{}')>300 or kv.key='title' and length(trim(kv.value #>> '{}'))=0)
 then raise exception 'CATALOG_REVIEW_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 perform 1 from papa_v2_entities e join papa_catalog_candidates c on c.song_id=e.id where e.kind='songs' and c.id=any(candidate_ids) order by e.id for update of e;
 perform 1 from papa_catalog_candidates where id=any(candidate_ids) order by id for update;
 if (select count(*) from papa_catalog_candidates c join papa_v2_entities e on e.kind='songs' and e.id=c.song_id and e.data->>'streamer_id'=c.streamer_id
  where c.id=any(candidate_ids) and c.status='pending' and c.source_hash=expected_sources->>c.id::text and c.source_hash=papa_catalog_source_hash(e.data))<>cardinality(candidate_ids)
 then raise exception 'CATALOG_SELECTION_STALE';end if;
 first_id=candidate_ids[1];
 if decision='create_variant' and family is null or decision='link_variant' and variant is null then raise exception 'CATALOG_TARGET_MISSING';end if;
 -- Freeze group identity before taking members out; a final member stays in the duplicate tab.
 with groups as (select distinct "groupId" from papa_catalog_review_rows() where id=any(candidate_ids) and "groupId" is not null),
 members as (select r.id,r."groupId" from papa_catalog_review_rows() r join groups g on g."groupId"=r."groupId")
 update papa_catalog_candidates indexed set review_group=m."groupId" from members m where indexed.id=m.id;
 select coalesce(common_metadata->>'title',c.edited_metadata->>'title',c.title),c.review_group into target_title,source_group from papa_catalog_candidates c where c.id=first_id;
 if variant is not null then
  select v.family_id into family from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active where v.id=variant and v.active;
  if family is null then raise exception 'CATALOG_VARIANT_MISSING';end if;
 elsif family is not null then
  if not exists(select 1 from papa_catalog_families where id=family and active) then raise exception 'CATALOG_FAMILY_MISSING';end if;
 end if;
 if decision in ('independent','approve_new') then
  insert into papa_catalog_negative_decisions(candidate_a,candidate_b,actor_id)
   select distinct least(a.id,b.id),greatest(a.id,b.id),actor_id from papa_catalog_candidates a join papa_catalog_candidates b on b.title_key=a.title_key and b.id<>a.id
   where a.id=any(candidate_ids) and (not b.id=any(candidate_ids) or a.id<b.id) on conflict do nothing;
 end if;
 for candidate in select r.*,e.data, r.edited_metadata||common_metadata m from papa_catalog_candidates r join papa_v2_entities e on e.kind='songs' and e.id=r.song_id
  where r.id=any(candidate_ids) order by array_position(candidate_ids,r.id) loop
  if decision in ('independent','approve_new') then family=null;variant=null;end if;
  if family is null then insert into papa_catalog_families(title) values(coalesce(candidate.m->>'title',candidate.title)) returning id into family;end if;
  if variant is null or decision='different_versions' then
   insert into papa_catalog_variants(family_id,title,artist,language_id,language_text,performer_type_id,performer_type_text,version_label)
   values(family,coalesce(candidate.m->>'title',candidate.title),coalesce(candidate.m->>'artist',candidate.artist),
    (select id from papa_catalog_languages where name=coalesce(candidate.m->>'language',candidate.language_text) and active limit 1),coalesce(candidate.m->>'language',candidate.language_text),
    (select id from papa_catalog_performer_types where name=coalesce(candidate.m->>'performerType',candidate.performer_type_text) and active limit 1),coalesce(candidate.m->>'performerType',candidate.performer_type_text),
    coalesce(version_labels->>candidate.id::text,candidate.m->>'versionLabel',nullif(candidate.version_label,''),case when decision='different_versions' then '版本 '||array_position(candidate_ids,candidate.id) else '' end)) returning id into variant;
  end if;
  mapping=mapping||jsonb_build_object(candidate.id::text,variant);
 end loop;
 insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash)
  select c.streamer_id,c.song_id,(mapping->>c.id::text)::uuid,c.source_hash from papa_catalog_candidates c where c.id=any(candidate_ids)
  on conflict(streamer_id,song_id) do update set variant_id=excluded.variant_id,source_hash=excluded.source_hash,linked_at=now();
 insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body)
  select c.streamer_id,c.song_id,(mapping->>c.id::text)::uuid,case when trim(coalesce(e.data->>'lyrics',''))<>'' then 'own' else 'shared' end,
   nullif(e.data->>'lyrics','') from papa_catalog_candidates c join papa_v2_entities e on e.kind='songs' and e.id=c.song_id where c.id=any(candidate_ids)
  on conflict(streamer_id,song_id) do update set variant_id=excluded.variant_id;
 -- Only the explicitly selected source can establish new shared lyrics, never replace existing shared lyrics.
 if lyrics_source is not null or shared_body is not null then
  if decision not in ('confirm_same','link_variant','create_variant') or lyrics_source is not null and not lyrics_source=any(candidate_ids) then raise exception 'CATALOG_LYRIC_SOURCE_INVALID';end if;
  variant=(mapping->>first_id::text)::uuid;
  if exists(select 1 from papa_catalog_lyric_revisions r where r.variant_id=variant and r.active and trim(r.body)<>'') then raise exception 'CATALOG_SHARED_LYRIC_EXISTS';end if;
  if lyrics_source is not null then
   select coalesce(s.body,e.data->>'lyrics') into lyric from papa_catalog_candidates c join papa_v2_entities e on e.kind='songs' and e.id=c.song_id
    left join papa_catalog_lyric_selections s on s.streamer_id=c.streamer_id and s.song_id=c.song_id and s.mode in ('copy','own') where c.id=lyrics_source;
  else lyric=shared_body;end if;
  if trim(coalesce(lyric,''))<>'' then perform papa_catalog_save_lyric(variant,lyric,actor_id,true);end if;
 end if;
 update papa_catalog_candidates set status='approved',reviewed_by=actor_id,reviewed_at=now(),updated_at=now() where id=any(candidate_ids);
 insert into papa_catalog_audit(actor_id,action,candidate_ids,family_id,variant_id,details)
  values(actor_id,decision,candidate_ids,family,variant,jsonb_build_object('count',cardinality(candidate_ids),'title',target_title,'lyricsSource',lyrics_source));
 update papa_v2_revision set revision=revision+1 where id=1;
 return jsonb_build_object('ok',true,'count',cardinality(candidate_ids),'familyId',family,'variantId',variant);
end $$;

-- Lightweight room metadata; no lyric bodies leave the database with song lists.
create or replace function papa_catalog_song_metadata(room_id text) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('songId',e.id,'title',v.title,'artist',v.artist,
  'cat',coalesce(l.name,v.language_text),'artistType',coalesce(p.name,v.performer_type_text),'version',v.version_label,'catalogVariantId',v.id,
  'hasLyrics',case when ls.mode in ('copy','own') then trim(coalesce(ls.body,''))<>'' when v.id is not null then trim(coalesce(lr.body,''))<>'' else trim(coalesce(e.data->>'lyrics',''))<>'' end,
  'lyricsMode',coalesce(ls.mode,case when trim(coalesce(e.data->>'lyrics',''))<>'' then 'own' else 'shared' end))) order by e.id),'[]')
 from papa_v2_entities e left join papa_catalog_song_links sl on sl.streamer_id=room_id and sl.song_id=e.id and sl.source_hash=papa_catalog_source_hash(e.data)
 left join papa_catalog_variants v on v.id=sl.variant_id and v.active and exists(select 1 from papa_catalog_families f where f.id=v.family_id and f.active)
 left join papa_catalog_languages l on l.id=v.language_id left join papa_catalog_performer_types p on p.id=v.performer_type_id
 left join papa_catalog_lyric_selections ls on ls.streamer_id=room_id and ls.song_id=e.id
 left join papa_catalog_lyric_revisions lr on lr.variant_id=v.id and lr.active
 where e.kind='songs' and e.data->>'streamer_id'=room_id
$$;

create function papa_catalog_families_page(query_text text default '',page_limit int default 20,page_offset int default 0,lyrics_only boolean default false)
 returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;n int;
begin
 if page_limit not between 1 and 50 or page_offset not between 0 and 10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with matched as (select f.id from papa_catalog_families f where f.active and exists(select 1 from papa_catalog_variants v where v.family_id=f.id and v.active
  and (query_text='' or position(lower(query_text) in lower(v.title||' '||v.artist||' '||v.version_label))>0) and (not lyrics_only or exists(select 1 from papa_catalog_lyric_proposals p where p.variant_id=v.id and p.status='pending'))))
 select count(*) into n from matched;
 with page as materialized (select f.id,f.title from papa_catalog_families f where f.active and exists(select 1 from papa_catalog_variants v where v.family_id=f.id and v.active
  and (query_text='' or position(lower(query_text) in lower(v.title||' '||v.artist||' '||v.version_label))>0) and (not lyrics_only or exists(select 1 from papa_catalog_lyric_proposals p where p.variant_id=v.id and p.status='pending')))
  order by f.title,f.id limit page_limit offset page_offset),counts as (select sl.variant_id,count(*) n from papa_catalog_song_links sl join papa_catalog_variants v on v.id=sl.variant_id join page f on f.id=v.family_id group by sl.variant_id)
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'variants',g.rows) order by f.title,f.id),'[]') into result from page f join lateral
 (select jsonb_agg(jsonb_build_object('id',v.id,'variantId',v.id,'familyId',v.family_id,'title',v.title,'artist',v.artist,'versionLabel',v.version_label,
  'updatedAt',v.updated_at,'variantUpdatedAt',v.updated_at,'language',coalesce(l.name,v.language_text),'languageId',v.language_id,
  'performerType',coalesce(p.name,v.performer_type_text),'performerTypeId',v.performer_type_id,'streamerCount',coalesce(c.n,0),
  'hasSharedLyrics',exists(select 1 from papa_catalog_lyric_revisions r where r.variant_id=v.id and r.active and trim(r.body)<>''),
  'lyricProposalCount',(select count(*) from papa_catalog_lyric_proposals p where p.variant_id=v.id and p.status='pending')) order by v.version_label,v.id) rows
  from papa_catalog_variants v left join counts c on c.variant_id=v.id left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id where v.family_id=f.id and v.active) g on true;
 return jsonb_build_object('rows',result,'total',n,'hasMore',page_offset+page_limit<n);
end $$;

-- Event-driven lyric suggestions, one row per variant/source. Never copy shared lyrics into host rows.
create function papa_catalog_track_custom() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and old.variant_id is distinct from new.variant_id then
  delete from papa_catalog_lyric_proposals where variant_id=old.variant_id and streamer_id=old.streamer_id and song_id=old.song_id;
 end if;
 if tg_op='UPDATE' and old.mode in ('copy','own') and trim(coalesce(old.body,''))<>'' and (new.mode='shared' or old.body is distinct from new.body) then
  insert into papa_catalog_custom_archives(streamer_id,song_id,body) values(old.streamer_id,old.song_id,old.body);
 end if;
 if new.mode in ('copy','own') and trim(coalesce(new.body,''))<>'' and new.variant_id is not null and
  not exists(select 1 from papa_catalog_lyric_revisions r where r.variant_id=new.variant_id and r.active and trim(r.body)<>'') then
  insert into papa_catalog_lyric_proposals(variant_id,streamer_id,song_id) values(new.variant_id,new.streamer_id,new.song_id)
   on conflict(variant_id,streamer_id,song_id) do update set updated_at=now(),
    status=case when tg_op='UPDATE' and old.body is distinct from new.body then 'pending' else papa_catalog_lyric_proposals.status end;
 else
  delete from papa_catalog_lyric_proposals where variant_id=new.variant_id and streamer_id=new.streamer_id and song_id=new.song_id;
 end if;
 return new;
end $$;
create trigger papa_catalog_track_custom after insert or update on papa_catalog_lyric_selections for each row execute function papa_catalog_track_custom();
-- Preserve legacy private notes in their existing private store, without changing the original JSON.
insert into papa_catalog_private_notes(streamer_id,song_id,body)
 select e.data->>'streamer_id',e.id,coalesce(nullif(e.data->>'privateNote',''),nullif(e.data->>'lyricNotes',''),e.data->>'privateNotes')
 from papa_v2_entities e where e.kind='songs' and e.data->>'streamer_id' is not null and
  coalesce(nullif(e.data->>'privateNote',''),nullif(e.data->>'lyricNotes',''),nullif(e.data->>'privateNotes','')) is not null
 on conflict(streamer_id,song_id) do nothing;
insert into papa_catalog_lyric_proposals(variant_id,streamer_id,song_id)
 select s.variant_id,s.streamer_id,s.song_id from papa_catalog_lyric_selections s where s.mode in ('copy','own') and trim(coalesce(s.body,''))<>'' and s.variant_id is not null
 and not exists(select 1 from papa_catalog_lyric_revisions r where r.variant_id=s.variant_id and r.active and trim(r.body)<>'') on conflict do nothing;
create function papa_catalog_lyric_sources(chosen_variant uuid,page_limit int default 3,page_offset int default 0) returns jsonb
 language sql stable security definer set search_path=public as $$
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)) from (select p.streamer_id as "streamerId",p.song_id as "songId",p.updated_at as "updatedAt"
  from papa_catalog_lyric_proposals p join papa_catalog_lyric_selections s on s.streamer_id=p.streamer_id and s.song_id=p.song_id and s.variant_id=p.variant_id
  where p.variant_id=chosen_variant and p.status='pending' and s.mode in ('own','copy') and trim(coalesce(s.body,''))<>'' order by p.updated_at desc,p.streamer_id limit least(greatest(page_limit,1),10) offset greatest(page_offset,0)) r),'[]'),
 'total',(select count(*) from papa_catalog_lyric_proposals p where p.variant_id=chosen_variant and p.status='pending'))
$$;
create function papa_catalog_adopt_lyric(chosen_variant uuid,room_id text,song_id text,actor_id text,skip boolean default false,expected_updated timestamptz default null)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare lyric text;
begin
 if coalesce(actor_id,'')='' then raise exception 'CATALOG_LYRIC_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 select s.body into lyric from papa_catalog_lyric_proposals p join papa_catalog_lyric_selections s on s.streamer_id=p.streamer_id and s.song_id=p.song_id and s.variant_id=p.variant_id
  where p.variant_id=chosen_variant and p.streamer_id=room_id and p.song_id=papa_catalog_adopt_lyric.song_id and p.status='pending'
  and s.mode in ('own','copy') and (expected_updated is null or p.updated_at=expected_updated) for update of p,s;
 if lyric is null then raise exception 'CATALOG_SELECTION_STALE';end if;
 if not skip then
  if exists(select 1 from papa_catalog_lyric_revisions r where r.variant_id=chosen_variant and r.active and trim(r.body)<>'') then raise exception 'CATALOG_SHARED_LYRIC_EXISTS';end if;
  perform papa_catalog_save_lyric(chosen_variant,lyric,actor_id,true);
  update papa_catalog_lyric_proposals set status='adopted' where variant_id=chosen_variant;
 else update papa_catalog_lyric_proposals p set status='skipped' where p.variant_id=chosen_variant and p.streamer_id=room_id and p.song_id=papa_catalog_adopt_lyric.song_id;end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function papa_catalog_variant_rooms(chosen_variant uuid,page_limit int default 50,page_offset int default 0) returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare result jsonb;n int;
begin
 if page_limit not between 1 and 50 or page_offset not between 0 and 10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 select count(*) into n from papa_catalog_song_links where variant_id=chosen_variant;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select sl.streamer_id as "streamerId",sl.song_id as "songId",e.data->>'title' title,e.data->>'artist' artist,
  c.id as "candidateId",c.source_hash as "sourceHash" from papa_catalog_song_links sl join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
  join papa_catalog_candidates c on c.streamer_id=sl.streamer_id and c.song_id=sl.song_id
  where sl.variant_id=chosen_variant order by sl.streamer_id,sl.song_id limit page_limit offset page_offset) r;
 return jsonb_build_object('items',result,'total',n,'hasMore',page_offset+page_limit<n);
end $$;

revoke all on function papa_catalog_group_candidate(),papa_catalog_review_rows(text),papa_catalog_review_page(text,text,text,int,int,text),papa_catalog_candidate_edit(uuid,text,jsonb,text),
 papa_catalog_review_selected(text,uuid[],jsonb,text,uuid,uuid,jsonb,uuid,text,jsonb),papa_catalog_families_page(text,int,int,boolean),papa_catalog_track_custom(),papa_catalog_lyric_sources(uuid,int,int),papa_catalog_adopt_lyric(uuid,text,text,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function papa_catalog_review_page(text,text,text,int,int,text),papa_catalog_candidate_edit(uuid,text,jsonb,text),papa_catalog_review_selected(text,uuid[],jsonb,text,uuid,uuid,jsonb,uuid,text,jsonb),
 papa_catalog_families_page(text,int,int,boolean),papa_catalog_lyric_sources(uuid,int,int),papa_catalog_adopt_lyric(uuid,text,text,text,boolean,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
