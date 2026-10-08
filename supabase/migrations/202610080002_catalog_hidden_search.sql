begin;
create or replace function public.papa_song_search_room_v2(room_id text,query_text text default '',tags text[] default '{}',
 page_limit int default 30,page_offset int default 0,language_name text default null,include_hidden boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare words text[]; anchor text; pattern text; n int; ids jsonb;
begin
 if coalesce(room_id,'')='' or length(coalesce(query_text,''))>120 or page_limit is null or
  page_offset is null or page_limit<1 or page_limit>50 or page_offset<0 or page_offset>10000 or
  coalesce(array_length(tags,1),0)>30 or length(coalesce(language_name,''))>120 then
  raise exception 'CATALOG_SEARCH_LIMIT';end if;
 if not exists(select 1 from papa_v2_entities m cross join lateral
  jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  where m.kind='meta' and m.id='1' and room->>'id'=room_id
   and coalesce((room->>'active')::boolean,true)) then raise exception 'CATALOG_ROOM_MISSING';end if;
 words=regexp_split_to_array(lower(trim(coalesce(query_text,''))),'[[:space:]　]+');
 anchor=papa_catalog_search_anchor(lower(trim(coalesce(query_text,''))));
 pattern=papa_catalog_search_pattern(anchor);
 with source_hits as materialized (
  -- Keep the selective lyric predicate ahead of room filtering. Otherwise a
  -- room-expression estimate can choose to read every legacy lyric in a room.
  select e.id,e.data->>'streamer_id' as streamer_id from papa_v2_entities e
   where anchor is not null and e.kind='songs'
    and papa_song_search_source(e.data) like pattern escape E'\\'
 ), candidate_ids as materialized (
  select e.id from papa_v2_entities e
   where anchor is null and e.kind='songs' and e.data->>'streamer_id'=room_id
  union
  select id from source_hits where streamer_id=room_id
  union
  select sl.song_id from papa_catalog_variants v join papa_catalog_song_links sl on sl.variant_id=v.id
   where anchor is not null and v.active and sl.streamer_id=room_id and
    lower(v.title||' '||v.artist||' '||v.version_label||' '||v.language_text||' '||v.performer_type_text)
     like pattern escape E'\\'
  union
  select sl.song_id from papa_catalog_languages l join papa_catalog_variants v on v.language_id=l.id and v.active
   join papa_catalog_song_links sl on sl.variant_id=v.id
   where anchor is not null and sl.streamer_id=room_id and lower(l.name) like pattern escape E'\\'
  union
  select sl.song_id from papa_catalog_performer_types p join papa_catalog_variants v on v.performer_type_id=p.id and v.active
   join papa_catalog_song_links sl on sl.variant_id=v.id
   where anchor is not null and sl.streamer_id=room_id and lower(p.name) like pattern escape E'\\'
  union
  select ls.song_id from papa_catalog_lyric_selections ls
   where anchor is not null and ls.streamer_id=room_id and ls.mode in ('copy','own')
    and lower(ls.body) like pattern escape E'\\'
  union
  select sl.song_id from papa_catalog_lyric_revisions lr join papa_catalog_song_links sl on sl.variant_id=lr.variant_id
   where anchor is not null and lr.active and sl.streamer_id=room_id and lower(lr.body) like pattern escape E'\\'
 ), matched as materialized (
  select e.id,case when e.data->>'_order'~'^[0-9]{1,9}$' then (e.data->>'_order')::int else 0 end as song_order
  from candidate_ids c join papa_v2_entities e on e.kind='songs' and e.id=c.id and e.data->>'streamer_id'=room_id
  left join papa_catalog_song_links sl on sl.streamer_id=room_id and sl.song_id=e.id
  left join papa_catalog_variants v on v.id=sl.variant_id and v.active
   and sl.source_hash=papa_catalog_source_hash(e.data)
   and exists(select 1 from papa_catalog_families f where f.id=v.family_id and f.active)
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  left join papa_catalog_lyric_selections ls on ls.streamer_id=room_id and ls.song_id=e.id
  left join papa_catalog_lyric_revisions lr on lr.variant_id=v.id and lr.active
  where (include_hidden or coalesce((e.data->>'hidden')::boolean,false)=false) and (coalesce(language_name,'')='' or coalesce(l.name,v.language_text,e.data->>'cat','')=language_name)
   and (coalesce(array_length(tags,1),0)=0 or exists(select 1
    from jsonb_array_elements_text(coalesce(e.data->'tags','[]'::jsonb)) song_tag where song_tag=any(tags)))
   and not exists(select 1 from unnest(words) word where word<>'' and
    lower(concat_ws(' ',coalesce(v.title,e.data->>'title'),coalesce(v.artist,e.data->>'artist'),
     coalesce(l.name,v.language_text,e.data->>'cat'),coalesce(p.name,v.performer_type_text,e.data->>'artistType'),e.data->>'murmur',e.data->>'tags',
     coalesce(case when ls.mode in ('copy','own') then ls.body
      when v.id is not null then lr.body end,e.data->>'lyrics','')))
      not like papa_catalog_search_pattern(word) escape E'\\')
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(page_rows.id order by page_rows.song_order,page_rows.id),'[]'::jsonb)
   from (select id,song_order from matched order by song_order,id limit page_limit offset page_offset) page_rows)
 into n,ids;
 return jsonb_build_object('songIds',ids,'total',n,'hasMore',page_offset+page_limit<n);
end $$;
revoke all on function public.papa_song_search_room_v2(text,text,text[],int,int,text,boolean) from public,anon,authenticated;
grant execute on function public.papa_song_search_room_v2(text,text,text[],int,int,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
