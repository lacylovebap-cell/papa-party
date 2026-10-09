begin;

-- Page the room's private new-song order before resolving lightweight shared
-- metadata. Shared masters and original/private song bodies are never copied.
create function public.papa_new_practice_page(
 requested_space text,requested_room text,management boolean default false,
 page_limit integer default 5,page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if management is null or page_limit is null or page_limit<1 or page_limit>50
  or page_offset is null or page_offset<0 or page_offset>10000000
 then raise exception 'NEW_PRACTICE_PAGE_INVALID';end if;
 if requested_space is null or requested_room is null or not exists(
  select 1 from papa_space_streamers scope join papa_spaces space on space.id=scope.space_id
  join papa_v2_entities meta on meta.kind='meta' and meta.id='1'
  cross join lateral jsonb_array_elements(coalesce(meta.data->'streamers','[]'::jsonb)) room
  where scope.space_id=requested_space and scope.streamer_id=requested_room
   and space.status='active' and room->>'id'=requested_room
   and (management or coalesce((room->>'active')::boolean,true)))
 then raise exception 'NEW_PRACTICE_SCOPE_INVALID';end if;
 with source as materialized (
  select song.id song_id,song.data,
   case when jsonb_typeof(song.data->'_order')='number' then
    case when (song.data->>'_order')::numeric between 0 and 8796093022207
     and trunc((song.data->>'_order')::numeric)=(song.data->>'_order')::numeric
     then (song.data->>'_order')::numeric end end source_order,
   case when jsonb_typeof(song.data->'sort_order')='number' then
    case when (song.data->>'sort_order')::numeric between -9007199254740991 and 9007199254740991
     and trunc((song.data->>'sort_order')::numeric)=(song.data->>'sort_order')::numeric
     then (song.data->>'sort_order')::numeric end end private_order
  from papa_v2_entities song where song.kind='songs' and song.space_id=requested_space
   and song.data->>'streamer_id'=requested_room
 ),canonical as (
  select song_id,data,source_order,private_order,
   row_number() over(order by coalesce(source_order,0),song_id)-1 source_position from source
 ),ranked as (
  select song_id,data,source_order,private_order,
   coalesce(private_order,source_order*1024,source_position*1024) effective_order from canonical
 ),visible as materialized (
  select song_id,data,source_order,private_order,effective_order from ranked
  where data->'new'='true'::jsonb and (management or not coalesce((data->>'hidden')::boolean,false))
 ),ordered as (
  select song_id,data,source_order,private_order,effective_order,
   lag(song_id) over(order by effective_order,coalesce(source_order,0),song_id) previous_song_id,
   lead(song_id) over(order by effective_order,coalesce(source_order,0),song_id) next_song_id
  from visible
 ),page as materialized (
  select song_id,data,source_order,private_order,effective_order,previous_song_id,next_song_id from ordered
  order by effective_order,coalesce(source_order,0),song_id limit page_limit offset page_offset
 ),projected as (
  select page.song_id,page.source_order,page.effective_order,
   coalesce((select jsonb_object_agg(field.key,field.value) from jsonb_each(page.data) field
    where field.key=any(array['id','songId','streamer_id','title','artist','cat','artistType','tags','new',
     'murmur','creditCost','shortMode','pairSongIds','hidden'])),'{}'::jsonb)
   ||jsonb_build_object('songId',page.song_id,'streamer_id',requested_room)
   ||jsonb_strip_nulls(jsonb_build_object('_order',page.source_order,'sort_order',page.effective_order,
    'title',variant.title,'artist',variant.artist,'cat',coalesce(language.name,variant.language_text),
    'artistType',coalesce(performer.name,variant.performer_type_text),'version',variant.version_label,
    'catalogVariantId',variant.id))
   ||jsonb_build_object(
    'hasLyrics',case when selection.mode in ('copy','own') then trim(coalesce(selection.body,''))<>''
     when variant.id is not null then trim(coalesce(lyrics.body,''))<>''
     else trim(coalesce(page.data->>'lyrics',''))<>'' end,
    'lyricsMode',coalesce(selection.mode,case when trim(coalesce(page.data->>'lyrics',''))<>'' then 'own' else 'shared' end),
    'hasSharedLyrics',trim(coalesce(lyrics.body,''))<>'',
    'hasCustomLyrics',case when selection.mode in ('copy','own') then trim(coalesce(selection.body,''))<>''
     when selection.mode is null then trim(coalesce(page.data->>'lyrics',''))<>'' else false end)
   ||case when management then jsonb_build_object('catalogStatus',case when variant.id is not null then 'linked'
     when candidate.status='pending' then 'pending' else 'unlinked' end,
    'previousSongId',page.previous_song_id,'nextSongId',page.next_song_id)
    ||jsonb_strip_nulls(jsonb_build_object('catalogFamilyId',variant.family_id)) else '{}'::jsonb end row_data
  from page
  left join papa_catalog_song_links link on link.streamer_id=requested_room and link.song_id=page.song_id
   and link.source_hash=papa_catalog_source_hash(page.data)
  left join papa_catalog_variants variant on variant.id=link.variant_id and variant.active
   and exists(select 1 from papa_catalog_families family where family.id=variant.family_id and family.active)
  left join papa_catalog_candidates candidate on candidate.streamer_id=requested_room and candidate.song_id=page.song_id
   and candidate.source_hash=papa_catalog_source_hash(page.data)
  left join papa_catalog_languages language on language.id=variant.language_id
  left join papa_catalog_performer_types performer on performer.id=variant.performer_type_id
  left join papa_catalog_lyric_selections selection on selection.streamer_id=requested_room and selection.song_id=page.song_id
  left join papa_catalog_lyric_revisions lyrics on lyrics.variant_id=variant.id and lyrics.active
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row_data order by effective_order,coalesce(source_order,0),song_id)
   from projected),'[]'::jsonb),'total',(select count(1) from visible),'pageLimit',page_limit,'pageOffset',page_offset,
  'hasMore',page_offset+page_limit<(select count(1) from visible)) into result;
 return result;
end $$;
revoke all on function public.papa_new_practice_page(text,text,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.papa_new_practice_page(text,text,boolean,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
