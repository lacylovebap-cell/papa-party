-- Integrated catalog additions; all existing song rows and links remain intact.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

alter table papa_catalog_variants
 add column if not exists version_kind text not null default 'original',
 add column if not exists performer_detail text not null default '',
 add column if not exists version_note text not null default '';

create table if not exists papa_catalog_issue_reports (
 id uuid primary key default gen_random_uuid(),
 family_id uuid references papa_catalog_families(id),
 variant_id uuid references papa_catalog_variants(id),
 reporter_streamer_id text not null,
 issue_type text not null check(issue_type in
  ('song_info','artist_name','performer_type','language','version_type','missing_version','version_relation','duplicate','other')),
 description text not null default '',
 suggestion text not null default '',
 status text not null default 'pending' check(status in ('pending','processing','fixed','declined')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists papa_catalog_issue_feed on papa_catalog_issue_reports(status,created_at desc,id);
create index if not exists papa_catalog_issue_reporter on papa_catalog_issue_reports(reporter_streamer_id,created_at desc,id);
alter table papa_catalog_issue_reports enable row level security;
revoke all on papa_catalog_issue_reports from public,anon,authenticated;
grant select,insert,update on papa_catalog_issue_reports to service_role;

-- A room song can change its shared relation without replacing the room song,
-- queue entries, play history, private notes, or custom lyrics.
create function papa_catalog_link_room_song(room_id text,song_id text,target_variant uuid,
 expected_source text,expected_variant uuid,actor_id text,require_same_family boolean default false)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare source_row jsonb;source_digest text;old_variant uuid;target_family uuid;old_family uuid;candidate_id uuid;
begin
 if coalesce(room_id,'')='' or coalesce(song_id,'')='' or coalesce(actor_id,'')='' or
  coalesce(expected_source,'')!~'^[a-f0-9]{32}$' then raise exception 'CATALOG_LINK_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 select e.data into source_row from papa_v2_entities e where e.kind='songs' and e.id=song_id
  and e.data->>'streamer_id'=room_id for update;
 if source_row is null then raise exception 'CATALOG_SONG_MISSING';end if;
 source_digest=papa_catalog_source_hash(source_row);
 if source_digest<>expected_source then raise exception 'CATALOG_SELECTION_STALE';end if;
 select v.family_id into target_family from papa_catalog_variants v
  join papa_catalog_families f on f.id=v.family_id and f.active
  where v.id=target_variant and v.active;
 if target_family is null then raise exception 'CATALOG_VARIANT_MISSING';end if;
 select sl.variant_id into old_variant from papa_catalog_song_links sl
  where sl.streamer_id=room_id and sl.song_id=papa_catalog_link_room_song.song_id for update;
 if old_variant is distinct from expected_variant then raise exception 'CATALOG_SELECTION_STALE';end if;
 if require_same_family and old_variant is not null then
  select family_id into old_family from papa_catalog_variants where id=old_variant;
  if old_family is distinct from target_family then raise exception 'CATALOG_FAMILY_MISMATCH';end if;
 end if;
 insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash)
  values(room_id,song_id,target_variant,source_digest)
  on conflict on constraint papa_catalog_song_links_pkey do update set variant_id=excluded.variant_id,
   source_hash=excluded.source_hash,linked_at=now();
 insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body)
  values(room_id,song_id,target_variant,
   case when trim(coalesce(source_row->>'lyrics',''))<>'' then 'own' else 'shared' end,
   case when trim(coalesce(source_row->>'lyrics',''))<>'' then source_row->>'lyrics' else null end)
  on conflict on constraint papa_catalog_lyric_selections_pkey do update set variant_id=excluded.variant_id;
 insert into papa_catalog_candidates(streamer_id,song_id,source_hash,title,artist,language_text,performer_type_text,
  version_label,title_key,artist_key,status,reviewed_by,reviewed_at)
  values(room_id,song_id,source_digest,coalesce(source_row->>'title',''),coalesce(source_row->>'artist',''),
   coalesce(source_row->>'cat',''),coalesce(source_row->>'artistType',''),coalesce(source_row->>'version',''),
   papa_catalog_normalize(source_row->>'title'),papa_catalog_normalize(source_row->>'artist'),
   'approved',actor_id,now())
  on conflict on constraint papa_catalog_candidates_streamer_id_song_id_key do update set status='approved',reviewed_by=actor_id,
   reviewed_at=now(),updated_at=now(),source_hash=source_digest
  returning id into candidate_id;
 insert into papa_catalog_audit(actor_id,action,candidate_ids,family_id,variant_id,details)
  values(actor_id,'relink_song',array[candidate_id],target_family,target_variant,
   jsonb_build_object('streamerId',room_id,'songId',song_id,'title',source_row->>'title',
    'artist',source_row->>'artist','fromVariant',old_variant,'toVariant',target_variant));
 return jsonb_build_object('ok',true,'familyId',target_family,'variantId',target_variant);
end $$;

create function papa_catalog_report_issue(room_id text,family_id uuid,variant_id uuid,issue_type text,
 description text,suggestion text) returns jsonb language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if coalesce(room_id,'')='' or coalesce(issue_type,'') not in
  ('song_info','artist_name','performer_type','language','version_type','missing_version','version_relation','duplicate','other')
  or length(coalesce(description,''))>3000 or length(coalesce(suggestion,''))>3000
  or family_id is null then raise exception 'CATALOG_ISSUE_INVALID';end if;
 if not exists(select 1 from papa_catalog_families f where f.id=papa_catalog_report_issue.family_id and f.active)
  or variant_id is not null and not exists(select 1 from papa_catalog_variants v
   where v.id=papa_catalog_report_issue.variant_id and v.family_id=papa_catalog_report_issue.family_id and v.active)
  then raise exception 'CATALOG_ISSUE_TARGET';end if;
 insert into papa_catalog_issue_reports(family_id,variant_id,reporter_streamer_id,issue_type,description,suggestion)
  values(family_id,variant_id,room_id,issue_type,coalesce(description,''),coalesce(suggestion,''))
  returning id into result;
 return jsonb_build_object('id',result,'status','pending');
end $$;

create function papa_catalog_issue_page(room_id text,report_status text,page_limit int,page_offset int)
 returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;
begin
 if page_limit not between 1 and 50 or page_offset not between 0 and 10000
  or coalesce(report_status,'') not in ('all','pending','processing','fixed','declined')
  then raise exception 'CATALOG_PAGE_LIMIT';end if;
 select count(*) into total_count from papa_catalog_issue_reports i
  where (room_id is null or i.reporter_streamer_id=room_id)
   and (report_status='all' or i.status=report_status);
 select coalesce(jsonb_agg(to_jsonb(r) order by r."createdAt" desc,r.id desc),'[]')
  into rows_json from (select i.id,i.family_id as "familyId",i.variant_id as "variantId",
   i.reporter_streamer_id as "streamerId",i.issue_type as "issueType",
   i.description,i.suggestion,i.status,i.created_at as "createdAt",
   f.title,v.title as "variantTitle",v.artist
   from papa_catalog_issue_reports i join papa_catalog_families f on f.id=i.family_id
   left join papa_catalog_variants v on v.id=i.variant_id
   where (room_id is null or i.reporter_streamer_id=room_id)
    and (report_status='all' or i.status=report_status)
   order by i.created_at desc,i.id desc limit page_limit offset page_offset) r;
 return jsonb_build_object('rows',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count);
end $$;

create function papa_catalog_issue_set_status(issue_id uuid,next_status text,actor_id text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare record_row papa_catalog_issue_reports%rowtype;
begin
 if coalesce(next_status,'') not in ('pending','processing','fixed','declined') or coalesce(actor_id,'')=''
  then raise exception 'CATALOG_ISSUE_INVALID';end if;
 update papa_catalog_issue_reports set status=next_status,updated_at=now() where id=issue_id
  returning * into record_row;
 if record_row.id is null then raise exception 'CATALOG_ISSUE_MISSING';end if;
 insert into papa_catalog_audit(actor_id,action,family_id,variant_id,details)
  values(actor_id,'issue_status',record_row.family_id,record_row.variant_id,
   jsonb_build_object('issueId',issue_id,'status',next_status,'streamerId',record_row.reporter_streamer_id));
 return jsonb_build_object('ok',true,'status',next_status);
end $$;

-- Family pagination and counts use the same valid link predicate as the
-- per-version room list. In particular, two songs from one room count once.
create function papa_catalog_families_page_v2(query_text text default '',lyrics_filter text default 'all',
 page_limit int default 20,page_offset int default 0) returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;
begin
 if page_limit not between 1 and 50 or page_offset not between 0 and 10000 or
  length(coalesce(query_text,''))>100 or coalesce(lyrics_filter,'') not in ('all','with','without','proposals')
  then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with matched as materialized (
  select f.id,f.title from papa_catalog_families f where f.active and exists(
   select 1 from papa_catalog_variants v where v.family_id=f.id and v.active
    and (query_text='' or position(lower(query_text) in lower(v.title||' '||v.artist||' '||v.version_label))>0)
    and (lyrics_filter='all' or lyrics_filter='proposals' and
     exists(select 1 from papa_catalog_lyric_proposals lp where lp.variant_id=v.id and lp.status='pending') or
     lyrics_filter in ('with','without') and
     exists(select 1 from papa_catalog_lyric_revisions lr where lr.variant_id=v.id and lr.active and trim(lr.body)<>'')=(lyrics_filter='with'))
  )
 ), paged as materialized (
  select id,title from matched order by title,id limit page_limit offset page_offset
 ), variants as materialized (
  select v.*,coalesce(l.name,v.language_text) language,coalesce(p.name,v.performer_type_text) performer_type,
   exists(select 1 from papa_catalog_lyric_revisions lr where lr.variant_id=v.id and lr.active and trim(lr.body)<>'') has_lyrics
  from papa_catalog_variants v join paged f on f.id=v.family_id
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id where v.active
 ), visible_variants as materialized (
  select * from variants v where lyrics_filter='all' or lyrics_filter='proposals' and
   exists(select 1 from papa_catalog_lyric_proposals lp where lp.variant_id=v.id and lp.status='pending') or
   lyrics_filter in ('with','without') and v.has_lyrics=(lyrics_filter='with')
 ), counts as materialized (
  select sl.variant_id,count(distinct sl.streamer_id)::int n
  from papa_catalog_song_links sl join visible_variants v on v.id=sl.variant_id
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
  group by sl.variant_id
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'variants',
   coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'variantId',v.id,'familyId',v.family_id,
    'title',v.title,'artist',v.artist,'versionLabel',v.version_label,'versionKind',v.version_kind,
    'performerDetail',v.performer_detail,'versionNote',v.version_note,'language',v.language,
    'languageId',v.language_id,'performerType',v.performer_type,'performerTypeId',v.performer_type_id,
    'updatedAt',v.updated_at,'variantUpdatedAt',v.updated_at,'streamerCount',coalesce(c.n,0),
    'hasSharedLyrics',v.has_lyrics,'lyricProposalCount',
     (select count(*) from papa_catalog_lyric_proposals lp where lp.variant_id=v.id and lp.status='pending')) order by v.version_label,v.id)
    from visible_variants v left join counts c on c.variant_id=v.id where v.family_id=f.id),'[]'::jsonb))
   order by f.title,f.id),'[]'::jsonb) from paged f)
 into total_count,rows_json;
 return jsonb_build_object('rows',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count);
end $$;

create function papa_catalog_variant_rooms_v2(chosen_variant uuid,page_limit int default 30,page_offset int default 0)
 returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;
begin
 if page_limit not between 1 and 50 or page_offset not between 0 and 10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with valid as materialized (
  select sl.streamer_id,sl.song_id,c.id candidate_id,c.source_hash,e.data->>'title' title,e.data->>'artist' artist
  from papa_catalog_song_links sl join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
  left join papa_catalog_candidates c on c.streamer_id=sl.streamer_id and c.song_id=sl.song_id
  where sl.variant_id=chosen_variant
 ), rooms as materialized (
  select distinct streamer_id from valid order by streamer_id limit page_limit offset page_offset
 )
 select (select count(distinct streamer_id) from valid),
  (select coalesce(jsonb_agg(jsonb_build_object('streamerId',r.streamer_id,
   'songs',coalesce((select jsonb_agg(jsonb_build_object('songId',v.song_id,'candidateId',v.candidate_id,
    'sourceHash',v.source_hash,'title',v.title,'artist',v.artist) order by v.song_id)
    from valid v where v.streamer_id=r.streamer_id),'[]'::jsonb)) order by r.streamer_id),'[]'::jsonb)
   from rooms r)
 into total_count,rows_json;
 return jsonb_build_object('items',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count);
end $$;

-- Public page contains only active, visible, valid linked room songs. It never
-- includes lyrics, private notes, candidate metadata, or old history.
create function papa_catalog_public_page(query_text text default '',page_limit int default 12,page_offset int default 0)
 returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;
begin
 if page_limit not between 1 and 20 or page_offset not between 0 and 10000 or
  length(coalesce(query_text,''))>100 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with rooms as materialized (
  select room->>'id' id,room->>'slug' slug,room->>'display_name' name
  from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  where m.kind='meta' and m.id='1' and coalesce((room->>'active')::boolean,true)
 ), visible as materialized (
  select v.id variant_id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,
   r.id streamer_id,r.slug,r.name,sl.song_id
  from papa_catalog_song_links sl join rooms r on r.id=sl.streamer_id
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
   and coalesce((e.data->>'hidden')::boolean,false)=false
  join papa_catalog_variants v on v.id=sl.variant_id and v.active
  join papa_catalog_families f on f.id=v.family_id and f.active
 ), matched as materialized (
  select distinct f.id,f.title from papa_catalog_families f join visible v on v.family_id=f.id
  where coalesce(query_text,'')='' or position(lower(query_text) in lower(v.title||' '||v.artist))>0
 ), paged as materialized (
  select * from matched order by title,id limit page_limit offset page_offset
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(jsonb_build_object('familyId',f.id,'title',f.title,
   'variants',coalesce((select jsonb_agg(jsonb_build_object('variantId',v.variant_id,
    'title',v.title,'artist',v.artist,'versionLabel',v.version_label,'versionKind',v.version_kind,
    'streamers',v.rooms) order by v.version_label,v.variant_id)
    from (select distinct vv.variant_id,vv.title,vv.artist,vv.version_label,vv.version_kind,
     (select coalesce(jsonb_agg(jsonb_build_object('streamerId',x.streamer_id,
      'name',x.name,'slug',x.slug,'songId',x.song_id) order by x.name,x.song_id),'[]'::jsonb)
      from (select distinct on (s.streamer_id) s.streamer_id,s.name,s.slug,s.song_id
       from visible s where s.variant_id=vv.variant_id order by s.streamer_id,s.song_id) x) rooms
     from visible vv where vv.family_id=f.id) v),'[]'::jsonb))
   order by f.title,f.id),'[]'::jsonb) from paged f)
 into total_count,rows_json;
 return jsonb_build_object('rows',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count);
end $$;

revoke all on function papa_catalog_link_room_song(text,text,uuid,text,uuid,text,boolean),
 papa_catalog_report_issue(text,uuid,uuid,text,text,text),
 papa_catalog_issue_page(text,text,int,int),papa_catalog_issue_set_status(uuid,text,text),
 papa_catalog_families_page_v2(text,text,int,int),papa_catalog_variant_rooms_v2(uuid,int,int),
 papa_catalog_public_page(text,int,int)
 from public,anon,authenticated;
grant execute on function papa_catalog_link_room_song(text,text,uuid,text,uuid,text,boolean),
 papa_catalog_report_issue(text,uuid,uuid,text,text,text),
 papa_catalog_issue_page(text,text,int,int),papa_catalog_issue_set_status(uuid,text,text),
 papa_catalog_families_page_v2(text,text,int,int),papa_catalog_variant_rooms_v2(uuid,int,int),
 papa_catalog_public_page(text,int,int)
 to service_role;
notify pgrst,'reload schema';
commit;
