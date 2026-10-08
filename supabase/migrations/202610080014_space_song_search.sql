begin;

-- Cross-room public song search uses a bounded Space read, never a snapshot.
-- Resolve linked metadata against the global master without exposing lyrics.
create function papa_song_search_in_space(query_text text default '',requested_space text default 'space-001',page_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;words text[];
begin
 if requested_space is null or not exists(select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
 if page_limit is null or page_limit not between 1 and 100 or length(coalesce(query_text,''))>100
 then raise exception 'CATALOG_SEARCH_LIMIT';end if;
 words=regexp_split_to_array(lower(replace(trim(coalesce(query_text,'')),'國語','華語')),'[[:space:]　]+');
 with rooms as materialized (
  select r->>'id' id,r->>'display_name' name,r->>'slug' slug,scope.space_id
  from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) r
  join papa_space_streamers scope on scope.streamer_id=r->>'id' and scope.space_id=requested_space
  where m.kind='meta' and m.id='1' and coalesce((r->>'active')::boolean,true)
 ), visible as materialized (
  select e.id song_id,coalesce(v.title,e.data->>'title','') title,coalesce(v.artist,e.data->>'artist','') artist,
   r.name streamer,r.slug,lower(replace(concat_ws(' ',coalesce(v.title,e.data->>'title'),
    coalesce(v.artist,e.data->>'artist'),coalesce(l.name,v.language_text,e.data->>'cat'),
    coalesce(p.name,v.performer_type_text,e.data->>'artistType'),coalesce(v.version_label,e.data->>'version'),
    e.data->>'murmur',e.data->>'tags'),'國語','華語')) searchable
  from papa_v2_entities e join rooms r on r.id=e.data->>'streamer_id' and r.space_id=e.space_id
  left join papa_catalog_song_links sl on sl.streamer_id=r.id and sl.song_id=e.id
   and sl.source_hash=papa_catalog_source_hash(e.data)
  left join papa_catalog_variants v on v.id=sl.variant_id and v.active
   and exists(select 1 from papa_catalog_families f where f.id=v.family_id and f.active)
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  where e.kind='songs' and not coalesce((e.data->>'hidden')::boolean,false)
 ), paged as materialized (
  select song_id,title,artist,streamer,slug from visible v where not exists(
   select 1 from unnest(words) word where word<>'' and position(word in v.searchable)=0)
  order by title,artist,slug,song_id limit page_limit
 )
 select coalesce(jsonb_agg(jsonb_build_object('songId',song_id,'title',title,'artist',artist,
  'streamer',streamer,'slug',slug) order by title,artist,slug,song_id),'[]'::jsonb)
 into rows_json from paged;
 return rows_json;
end $$;
revoke all on function papa_song_search_in_space(text,text,int) from public,anon,authenticated;
grant execute on function papa_song_search_in_space(text,text,int) to service_role;
notify pgrst,'reload schema';
commit;
