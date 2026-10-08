begin;

-- Shared masters remain global. Public facets and room relationships use only
-- the requested active Space; an explicit null is reserved for global review.
create function papa_catalog_public_page_filtered_in_space(query_text text default '',
 language_filter text default '',performer_filter text default '',version_filter text default '',
 page_limit int default 12,page_offset int default 0,requested_space text default 'space-001')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;options_json jsonb;
begin
 if requested_space is null or not exists(
  select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
 if page_limit is null or page_offset is null or page_limit not between 1 and 20 or page_offset not between 0 and 10000
  or greatest(length(coalesce(query_text,'')),length(coalesce(language_filter,'')),
   length(coalesce(performer_filter,'')),length(coalesce(version_filter,'')))>100
 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with rooms as materialized (
  select room->>'id' id,room->>'slug' slug,room->>'display_name' name,scope.space_id
  from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id' and scope.space_id=requested_space
  where m.kind='meta' and m.id='1' and coalesce((room->>'active')::boolean,true)
 ), visible as materialized (
  select v.id variant_id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,
   coalesce(l.name,v.language_text,'') language,coalesce(p.name,v.performer_type_text,'') performer_type,
   r.id streamer_id,r.slug,r.name,sl.song_id
  from papa_catalog_song_links sl join rooms r on r.id=sl.streamer_id
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id and e.space_id=r.space_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
   and coalesce((e.data->>'hidden')::boolean,false)=false
  join papa_catalog_variants v on v.id=sl.variant_id and v.active
  join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
 ), filtered as materialized (
  select v.variant_id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,v.language,
   v.performer_type,v.streamer_id,v.slug,v.name,v.song_id from visible v where
   (coalesce(language_filter,'')='' or v.language=language_filter)
   and (coalesce(performer_filter,'')='' or v.performer_type=performer_filter)
   and (coalesce(version_filter,'')='' or v.version_kind=version_filter)
   and (coalesce(query_text,'')='' or position(lower(query_text) in lower(v.title||' '||v.artist))>0)
 ), matched as materialized (
  select distinct f.id,f.title from papa_catalog_families f join filtered v on v.family_id=f.id
 ), paged as materialized (
  select id,title from matched order by title,id limit page_limit offset page_offset
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(jsonb_build_object('familyId',f.id,'title',f.title,
   'variants',coalesce((select jsonb_agg(jsonb_build_object('variantId',v.variant_id,
    'title',v.title,'artist',v.artist,'versionLabel',v.version_label,'versionKind',v.version_kind,
    'language',v.language,'performerType',v.performer_type,'streamers',v.rooms) order by v.version_label,v.variant_id)
    from (select distinct vv.variant_id,vv.title,vv.artist,vv.version_label,vv.version_kind,vv.language,vv.performer_type,
     (select coalesce(jsonb_agg(jsonb_build_object('streamerId',x.streamer_id,'name',x.name,'slug',x.slug,'songId',x.song_id)
       order by x.name,x.song_id),'[]'::jsonb)
      from (select distinct on (s.streamer_id) s.streamer_id,s.name,s.slug,s.song_id
       from filtered s where s.variant_id=vv.variant_id order by s.streamer_id,s.song_id) x) rooms
     from filtered vv where vv.family_id=f.id) v),'[]'::jsonb)) order by f.title,f.id),'[]'::jsonb) from paged f),
  jsonb_build_object(
   'languages',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct language x from visible where language<>'') a),
   'performerTypes',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct performer_type x from visible where performer_type<>'') a),
   'versionKinds',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct version_kind x from visible where version_kind<>'') a))
 into total_count,rows_json,options_json;
 return jsonb_build_object('rows',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count,'filters',options_json);
end $$;

create function papa_catalog_variant_rooms_v3_in_space(chosen_variant uuid,page_limit int default 30,
 page_offset int default 0,requested_space text default 'space-001')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;
begin
 if requested_space is not null and not exists(
  select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
 if page_limit is null or page_offset is null or page_limit not between 1 and 50 or page_offset not between 0 and 10000
 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with names as materialized (
  select r->>'id' id,coalesce(nullif(r->>'display_name',''),'未命名主播') name,scope.space_id
  from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) r
  join papa_space_streamers scope on scope.streamer_id=r->>'id'
   and (requested_space is null or scope.space_id=requested_space)
  join papa_spaces space on space.id=scope.space_id and space.status='active'
  where m.kind='meta' and m.id='1' and coalesce((r->>'active')::boolean,true)
 ), valid as materialized (
  select sl.streamer_id,n.name,sl.song_id,c.id candidate_id,c.source_hash,e.data->>'title' title,e.data->>'artist' artist
  from papa_catalog_song_links sl join names n on n.id=sl.streamer_id
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id and e.space_id=n.space_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
  left join papa_catalog_candidates c on c.streamer_id=sl.streamer_id and c.song_id=sl.song_id
  where sl.variant_id=chosen_variant
 ), rooms as materialized (
  select distinct streamer_id,name from valid order by name,streamer_id limit page_limit offset page_offset
 )
 select (select count(distinct streamer_id) from valid),
  (select coalesce(jsonb_agg(jsonb_build_object('streamerId',r.streamer_id,'streamerName',r.name,
   'songs',coalesce((select jsonb_agg(jsonb_build_object('songId',v.song_id,'candidateId',v.candidate_id,
    'sourceHash',v.source_hash,'title',v.title,'artist',v.artist) order by v.song_id)
    from valid v where v.streamer_id=r.streamer_id),'[]'::jsonb)) order by r.name,r.streamer_id),'[]'::jsonb) from rooms r)
 into total_count,rows_json;
 return jsonb_build_object('items',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count);
end $$;

create function papa_catalog_families_page_v3_in_space(query_text text default '',lyrics_filter text default 'all',
 page_limit int default 20,page_offset int default 0,language_filter text default '',
 version_filter text default '',viewer_room text default null,requested_space text default 'space-001')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;options_json jsonb;
begin
 if requested_space is not null and not exists(
  select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
 if page_limit is null or page_offset is null or page_limit not between 1 and 50 or page_offset not between 0 and 10000
  or greatest(length(coalesce(query_text,'')),length(coalesce(language_filter,'')),length(coalesce(version_filter,'')))>100
  or coalesce(lyrics_filter,'') not in ('all','with','without','proposals')
 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with rooms as materialized (
  select r->>'id' id,scope.space_id from papa_v2_entities m
  cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) r
  join papa_space_streamers scope on scope.streamer_id=r->>'id'
   and (requested_space is null or scope.space_id=requested_space)
  join papa_spaces space on space.id=scope.space_id and space.status='active'
  where m.kind='meta' and m.id='1' and coalesce((r->>'active')::boolean,true)
 ), proposal_counts as materialized (
  select lp.variant_id,count(*)::int n from papa_catalog_lyric_proposals lp
  join rooms r on r.id=lp.streamer_id
  join papa_catalog_lyric_selections ls on ls.streamer_id=lp.streamer_id and ls.song_id=lp.song_id
   and ls.variant_id=lp.variant_id and ls.mode in ('copy','own') and trim(coalesce(ls.body,''))<>''
  join papa_catalog_song_links sl on sl.streamer_id=lp.streamer_id and sl.song_id=lp.song_id and sl.variant_id=lp.variant_id
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id and e.space_id=r.space_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
  where lp.status='pending' group by lp.variant_id
 ), base as materialized (
  select v.id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,v.performer_detail,v.version_note,
   v.language_id,v.performer_type_id,v.updated_at,coalesce(l.name,v.language_text,'') language,
   coalesce(p.name,v.performer_type_text,'') performer_type,
   exists(select 1 from papa_catalog_lyric_revisions lr where lr.variant_id=v.id and lr.active and trim(lr.body)<>'') has_lyrics,
   coalesce(pc.n,0) proposal_count
  from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  left join proposal_counts pc on pc.variant_id=v.id where v.active
 ), matching as materialized (
  select b.id,b.family_id,b.title,b.artist,b.version_label,b.version_kind,b.performer_detail,b.version_note,
   b.language_id,b.performer_type_id,b.updated_at,b.language,b.performer_type,b.has_lyrics,b.proposal_count
  from base b where (coalesce(query_text,'')='' or position(lower(query_text) in lower(b.title||' '||b.artist||' '||b.version_label))>0)
   and (coalesce(language_filter,'')='' or b.language=language_filter)
   and (coalesce(version_filter,'')='' or b.version_kind=version_filter)
   and (lyrics_filter='all' or lyrics_filter='proposals' and b.proposal_count>0 or
    lyrics_filter in ('with','without') and b.has_lyrics=(lyrics_filter='with'))
 ), families as materialized (
  select distinct f.id,f.title from papa_catalog_families f join matching v on v.family_id=f.id
 ), paged as materialized (
  select id,title from families order by title,id limit page_limit offset page_offset
 ), members as materialized (
  select sl.variant_id,count(distinct sl.streamer_id)::int n,bool_or(sl.streamer_id=viewer_room) already_added
  from papa_catalog_song_links sl join matching v on v.id=sl.variant_id join paged f on f.id=v.family_id
  join rooms r on r.id=sl.streamer_id join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id and e.space_id=r.space_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
  group by sl.variant_id
 )
 select (select count(*) from families),
  (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'variants',
   coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'variantId',v.id,'familyId',v.family_id,
    'title',v.title,'artist',v.artist,'versionLabel',v.version_label,'versionKind',v.version_kind,
    'performerDetail',v.performer_detail,'versionNote',v.version_note,'language',v.language,
    'languageId',v.language_id,'performerType',v.performer_type,'performerTypeId',v.performer_type_id,
    'updatedAt',v.updated_at,'variantUpdatedAt',v.updated_at,'streamerCount',coalesce(c.n,0),
    'alreadyAdded',coalesce(c.already_added,false),'hasSharedLyrics',v.has_lyrics,'lyricProposalCount',v.proposal_count)
    order by v.version_label,v.id) from matching v left join members c on c.variant_id=v.id where v.family_id=f.id),'[]'::jsonb))
   order by f.title,f.id),'[]'::jsonb) from paged f),
  jsonb_build_object('languages',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from
    (select distinct language x from base where language<>'') l),
   'versionKinds',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from
    (select distinct version_kind x from base where version_kind<>'') k))
 into total_count,rows_json,options_json;
 return jsonb_build_object('rows',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count,'filters',options_json);
end $$;

-- Aggregate once per linked family in the room's own Space. Song metadata keeps
-- its light projection; only boolean lyric availability crosses this boundary.
create function papa_catalog_song_metadata_in_space(room_id text) returns jsonb
language sql stable security definer set search_path=public as $$
 with own_space as materialized (
  select scope.space_id from papa_space_streamers scope
  join papa_spaces space on space.id=scope.space_id and space.status='active'
  where scope.streamer_id=room_id
 ), linked_families as materialized (
  select distinct v.family_id from papa_catalog_song_links sl
  join papa_catalog_variants v on v.id=sl.variant_id and v.active
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
  join own_space own on own.space_id=e.space_id where sl.streamer_id=room_id
 ), rooms as materialized (
  select r->>'id' id,scope.space_id from papa_v2_entities m
  cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) r
  join papa_space_streamers scope on scope.streamer_id=r->>'id'
  join own_space own on own.space_id=scope.space_id
  where m.kind='meta' and m.id='1' and coalesce((r->>'active')::boolean,true)
 ), family_counts as materialized (
  select v.family_id,count(distinct sl.streamer_id) filter(where sl.streamer_id<>room_id)::int n
  from papa_catalog_song_links sl join papa_catalog_variants v on v.id=sl.variant_id and v.active
  join linked_families own on own.family_id=v.family_id join papa_catalog_families f on f.id=v.family_id and f.active
  join rooms r on r.id=sl.streamer_id join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id and e.space_id=r.space_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
  group by v.family_id
 )
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('songId',e.id,
  'title',v.title,'artist',v.artist,'cat',coalesce(l.name,v.language_text),
  'artistType',coalesce(p.name,v.performer_type_text),'version',v.version_label,
  'catalogVariantId',v.id,'catalogFamilyId',v.family_id,
  'otherStreamerCount',coalesce(fc.n,0),'catalogStatus',case when v.id is not null then 'linked'
   when c.status='pending' then 'pending' else 'unlinked' end,
  'hasLyrics',case when ls.mode in ('copy','own') then trim(coalesce(ls.body,''))<>''
   when v.id is not null then trim(coalesce(lr.body,''))<>''
   else trim(coalesce(e.data->>'lyrics',''))<>'' end,
  'lyricsMode',coalesce(ls.mode,case when trim(coalesce(e.data->>'lyrics',''))<>''
   then 'own' else 'shared' end))) order by e.id),'[]'::jsonb)
 from papa_v2_entities e join own_space own on own.space_id=e.space_id
 left join papa_catalog_song_links sl on sl.streamer_id=room_id and sl.song_id=e.id
  and sl.source_hash=papa_catalog_source_hash(e.data)
 left join papa_catalog_variants v on v.id=sl.variant_id and v.active
  and exists(select 1 from papa_catalog_families f where f.id=v.family_id and f.active)
 left join family_counts fc on fc.family_id=v.family_id
 left join papa_catalog_candidates c on c.streamer_id=room_id and c.song_id=e.id
  and c.source_hash=papa_catalog_source_hash(e.data)
 left join papa_catalog_languages l on l.id=v.language_id
 left join papa_catalog_performer_types p on p.id=v.performer_type_id
 left join papa_catalog_lyric_selections ls on ls.streamer_id=room_id and ls.song_id=e.id
 left join papa_catalog_lyric_revisions lr on lr.variant_id=v.id and lr.active
 where e.kind='songs' and e.data->>'streamer_id'=room_id
$$;

-- Install compatibility wrappers after UI2 creates the production signatures.
-- The wrappers keep older callers in Space 001 on a fresh chronological apply.
create or replace function papa_catalog_public_page_in_space(query_text text default '',page_limit int default 12,
 page_offset int default 0,requested_space text default 'space-001')
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_catalog_public_page_filtered_in_space(query_text,'','','',page_limit,page_offset,requested_space);
$$;
create or replace function papa_catalog_variant_rooms_v2_in_space(chosen_variant uuid,page_limit int default 30,
 page_offset int default 0,requested_space text default 'space-001')
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_catalog_variant_rooms_v3_in_space(chosen_variant,page_limit,page_offset,requested_space);
$$;
create or replace function papa_catalog_families_page_v2_in_space(query_text text default '',lyrics_filter text default 'all',
 page_limit int default 20,page_offset int default 0,requested_space text default 'space-001')
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_catalog_families_page_v3_in_space(query_text,lyrics_filter,page_limit,page_offset,'','',null,requested_space);
$$;

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

revoke all on function papa_catalog_public_page_filtered_in_space(text,text,text,text,int,int,text),
 papa_catalog_variant_rooms_v3_in_space(uuid,int,int,text),
 papa_catalog_families_page_v3_in_space(text,text,int,int,text,text,text,text),
 papa_catalog_song_metadata_in_space(text) from public,anon,authenticated;
grant execute on function papa_catalog_public_page_filtered_in_space(text,text,text,text,int,int,text),
 papa_catalog_variant_rooms_v3_in_space(uuid,int,int,text),
 papa_catalog_families_page_v3_in_space(text,text,int,int,text,text,text,text),
 papa_catalog_song_metadata_in_space(text) to service_role;
revoke all on function papa_catalog_public_page(text,int,int),papa_catalog_variant_rooms_v2(uuid,int,int),
 papa_catalog_families_page_v2(text,text,int,int),papa_catalog_family_singers(uuid),
 papa_catalog_public_page_in_space(text,int,int,text),papa_catalog_variant_rooms_v2_in_space(uuid,int,int,text),
 papa_catalog_families_page_v2_in_space(text,text,int,int,text) from public,anon,authenticated;
grant execute on function papa_catalog_public_page(text,int,int),papa_catalog_variant_rooms_v2(uuid,int,int),
 papa_catalog_families_page_v2(text,text,int,int),papa_catalog_family_singers(uuid),
 papa_catalog_public_page_in_space(text,int,int,text),papa_catalog_variant_rooms_v2_in_space(uuid,int,int,text),
 papa_catalog_families_page_v2_in_space(text,text,int,int,text) to service_role;
notify pgrst,'reload schema';
commit;
