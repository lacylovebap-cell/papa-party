begin;

-- Shared master stays global; only singer relationships/counts are Space-bound.
-- No relation copies, lyric downloads, fan-out writes, or additional polling.
create or replace function public.papa_streamer_directory()
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(room||jsonb_build_object('spaceId',scope.space_id) order by ordinal),'[]'::jsonb)
 from papa_v2_entities e cross join lateral
 jsonb_array_elements(coalesce(e.data->'streamers','[]'::jsonb)) with ordinality entry(room,ordinal)
 join papa_space_streamers scope on scope.streamer_id=room->>'id'
 join papa_spaces space on space.id=scope.space_id and space.status='active'
 where e.kind='meta' and e.id='1';
$$;

create function papa_catalog_public_page_in_space(query_text text default '',page_limit int default 12,page_offset int default 0,requested_space text default 'space-001')
 returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;
begin
 if requested_space is null or requested_space is not null and not exists(
  select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
 if page_limit not between 1 and 20 or page_offset not between 0 and 10000 or
  length(coalesce(query_text,''))>100 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with rooms as materialized (
  select room->>'id' id,room->>'slug' slug,room->>'display_name' name
  from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id'
  where m.kind='meta' and m.id='1' and scope.space_id=requested_space
   and coalesce((room->>'active')::boolean,true)
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

create function papa_catalog_variant_rooms_v2_in_space(chosen_variant uuid,page_limit int default 30,page_offset int default 0,requested_space text default 'space-001')
 returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;
begin
 if requested_space is not null and not exists(
  select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
 if page_limit not between 1 and 50 or page_offset not between 0 and 10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with valid as materialized (
  select sl.streamer_id,sl.song_id,c.id candidate_id,c.source_hash,e.data->>'title' title,e.data->>'artist' artist
  from papa_catalog_song_links sl join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
  join papa_space_streamers scope on scope.streamer_id=sl.streamer_id
   and (requested_space is null or scope.space_id=requested_space) and e.space_id=scope.space_id
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

create function papa_catalog_families_page_v2_in_space(query_text text default '',lyrics_filter text default 'all',
 page_limit int default 20,page_offset int default 0,requested_space text default 'space-001') returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;
begin
 if requested_space is not null and not exists(
  select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
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
  join papa_space_streamers scope on scope.streamer_id=sl.streamer_id
   and (requested_space is null or scope.space_id=requested_space) and e.space_id=scope.space_id
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

create function papa_catalog_family_singers_in_space(chosen_family uuid,requested_space text) returns jsonb
 language sql stable security definer set search_path=public as $$
 with room_names as materialized (
  select room->>'id' id,room->>'display_name' name
  from papa_v2_entities m cross join lateral
   jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id'
  join papa_spaces space on space.id=scope.space_id and space.status='active'
  where m.kind='meta' and m.id='1' and scope.space_id=requested_space
 )
 select coalesce(jsonb_agg(jsonb_build_object('variantId',v.id,'versionLabel',v.version_label,
  'artist',v.artist,'rooms',coalesce((select jsonb_agg(jsonb_build_object('streamerId',r.id,
   'name',coalesce(r.name,r.id)) order by coalesce(r.name,r.id))
   from room_names r where exists(select 1 from papa_catalog_song_links sl
    join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
     and e.data->>'streamer_id'=sl.streamer_id
     and papa_catalog_source_hash(e.data)=sl.source_hash
    where sl.variant_id=v.id and sl.streamer_id=r.id)),'[]'::jsonb))
  order by v.version_label,v.id),'[]'::jsonb)
 from papa_catalog_variants v where v.family_id=chosen_family and v.active
$$;

-- Legacy signatures now delegate to Space 001, never the whole platform.
create or replace function papa_catalog_public_page(query_text text default '',page_limit int default 12,page_offset int default 0)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_catalog_public_page_in_space(query_text,page_limit,page_offset,'space-001');
$$;
create or replace function papa_catalog_variant_rooms_v2(chosen_variant uuid,page_limit int default 30,page_offset int default 0)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_catalog_variant_rooms_v2_in_space(chosen_variant,page_limit,page_offset,'space-001');
$$;
create or replace function papa_catalog_families_page_v2(query_text text default '',lyrics_filter text default 'all',page_limit int default 20,page_offset int default 0)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_catalog_families_page_v2_in_space(query_text,lyrics_filter,page_limit,page_offset,'space-001');
$$;
create or replace function papa_catalog_family_singers(chosen_family uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_catalog_family_singers_in_space(chosen_family,'space-001');
$$;

revoke all on function papa_catalog_public_page_in_space(text,int,int,text),papa_catalog_variant_rooms_v2_in_space(uuid,int,int,text),papa_catalog_families_page_v2_in_space(text,text,int,int,text),papa_catalog_family_singers_in_space(uuid,text) from public,anon,authenticated;
grant execute on function papa_catalog_public_page_in_space(text,int,int,text),papa_catalog_variant_rooms_v2_in_space(uuid,int,int,text),papa_catalog_families_page_v2_in_space(text,text,int,int,text),papa_catalog_family_singers_in_space(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
