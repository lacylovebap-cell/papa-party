begin;

-- Add bounded administrative reads; previous RPC signatures remain available.
create function papa_catalog_families_page_v3(query_text text default '',lyrics_filter text default 'all',
 page_limit int default 20,page_offset int default 0,language_filter text default '',
 version_filter text default '',viewer_room text default null) returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;options_json jsonb;
begin
 if page_limit not between 1 and 50 or page_offset not between 0 and 10000
  or greatest(length(coalesce(query_text,'')),length(coalesce(language_filter,'')),length(coalesce(version_filter,'')))>100
  or coalesce(lyrics_filter,'') not in ('all','with','without','proposals')
 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with base as materialized (
  select v.id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,v.performer_detail,v.version_note,
   v.language_id,v.performer_type_id,v.updated_at,coalesce(l.name,v.language_text,'') language,
   coalesce(p.name,v.performer_type_text,'') performer_type,
   exists(select 1 from papa_catalog_lyric_revisions lr where lr.variant_id=v.id and lr.active and trim(lr.body)<>'') has_lyrics,
   (select count(*) from papa_catalog_lyric_proposals lp where lp.variant_id=v.id and lp.status='pending') proposal_count
  from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id where v.active
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
 ), rooms as materialized (
  select r->>'id' id from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) r
  where m.kind='meta' and m.id='1' and coalesce((r->>'active')::boolean,true)
 ), members as materialized (
  select sl.variant_id,count(distinct sl.streamer_id)::int n,
   bool_or(sl.streamer_id=viewer_room) already_added
  from papa_catalog_song_links sl join matching v on v.id=sl.variant_id join paged f on f.id=v.family_id
  join rooms r on r.id=sl.streamer_id join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
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

create function papa_catalog_variant_rooms_v3(chosen_variant uuid,page_limit int default 30,page_offset int default 0)
 returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;
begin
 if page_limit not between 1 and 50 or page_offset not between 0 and 10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with names as materialized (
  select r->>'id' id,coalesce(nullif(r->>'display_name',''),'未命名主播') name
  from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) r
  where m.kind='meta' and m.id='1' and coalesce((r->>'active')::boolean,true)
 ), valid as materialized (
  select sl.streamer_id,n.name,sl.song_id,c.id candidate_id,c.source_hash,e.data->>'title' title,e.data->>'artist' artist
  from papa_catalog_song_links sl join names n on n.id=sl.streamer_id
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
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

revoke all on function papa_catalog_families_page_v3(text,text,int,int,text,text,text),
 papa_catalog_variant_rooms_v3(uuid,int,int) from public,anon,authenticated;
grant execute on function papa_catalog_families_page_v3(text,text,int,int,text,text,text),
 papa_catalog_variant_rooms_v3(uuid,int,int) to service_role;
create or replace function papa_catalog_song_metadata(room_id text) returns jsonb
 language sql stable security definer set search_path=public as $$
 with linked_families as materialized (
  select distinct v.family_id from papa_catalog_song_links sl join papa_catalog_variants v on v.id=sl.variant_id and v.active where sl.streamer_id=room_id
 ), names as materialized (
  select r->>'id' id from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) r where m.kind='meta' and m.id='1' and coalesce((r->>'active')::boolean,true)
 ), family_counts as materialized (
  select v.family_id,count(distinct sl.streamer_id) filter(where sl.streamer_id<>room_id)::int n
  from papa_catalog_song_links sl join papa_catalog_variants v on v.id=sl.variant_id and v.active
  join linked_families own on own.family_id=v.family_id join papa_catalog_families f on f.id=v.family_id and f.active
  join names r on r.id=sl.streamer_id join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
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
   then 'own' else 'shared' end))) order by e.id),'[]')
 from papa_v2_entities e
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

notify pgrst,'reload schema';
commit;

