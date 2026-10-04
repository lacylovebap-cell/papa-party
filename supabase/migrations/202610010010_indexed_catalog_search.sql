begin;

-- Index the authoritative sources, without duplicating complete lyric bodies in
-- a search table or rewriting original songs. Supabase supports pg_trgm.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
set local search_path=public,extensions,pg_catalog;

-- LIKE must keep POSITION's literal treatment of %, _ and backslashes.
create function public.papa_catalog_search_pattern(value text) returns text
language sql immutable strict set search_path=public as $$
 select '%'||replace(replace(replace(value,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%'
$$;

-- Only searchable public fields and legacy lyrics belong in this index. In
-- particular, privateNotes and the separate private-note table are excluded.
create function public.papa_song_search_source(song jsonb) returns text
language sql immutable strict set search_path=public as $$
 select lower(coalesce(song->>'title','')||' '||coalesce(song->>'artist','')||' '||
  coalesce(song->>'cat','')||' '||coalesce(song->>'artistType','')||' '||
  coalesce(song->>'murmur','')||' '||coalesce(song->>'tags','')||' '||coalesce(song->>'lyrics',''))
$$;

-- A token without three consecutive letters/digits has no useful substring
-- trigram. Keep the exact fallback for one/two-character CJK and punctuation.
create function public.papa_catalog_search_anchor(value text) returns text
language sql immutable strict set search_path=public as $$
 select word from regexp_split_to_table(value,'[[:space:]　]+') word
 where word~'[[:alnum:]]{3}' order by length(word) desc,word limit 1
$$;

create index if not exists papa_song_search_source_trgm
 on public.papa_v2_entities using gin (public.papa_song_search_source(data) gin_trgm_ops)
 where kind='songs';
create index if not exists papa_catalog_variant_search_trgm
 on public.papa_catalog_variants using gin
 ((lower(title||' '||artist||' '||version_label||' '||language_text||' '||performer_type_text)) gin_trgm_ops)
 where active;
create index if not exists papa_catalog_language_search_trgm
 on public.papa_catalog_languages using gin ((lower(name)) gin_trgm_ops);
create index if not exists papa_catalog_performer_search_trgm
 on public.papa_catalog_performer_types using gin ((lower(name)) gin_trgm_ops);
create index if not exists papa_catalog_own_lyric_search_trgm
 on public.papa_catalog_lyric_selections using gin ((lower(body)) gin_trgm_ops)
 where mode in ('copy','own');
create index if not exists papa_catalog_shared_lyric_search_trgm
 on public.papa_catalog_lyric_revisions using gin ((lower(body)) gin_trgm_ops) where active;

-- An indexed token supplies candidates only. Rechecking the complete phrase
-- preserves catalog substring matches across field boundaries and template
-- names, even when a template name differs from the variant's stored text.
create or replace function public.papa_catalog_search(query_text text default '',page_limit int default 30,
 page_offset int default 0,room_id text default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare q text=lower(trim(coalesce(query_text,''))); anchor text; pattern text;
 phrase_pattern text; n int; rows_json jsonb;
begin
 if page_limit is null or page_offset is null or page_limit<1 or page_limit>50 or
  page_offset<0 or page_offset>10000 or length(q)>120 then
  raise exception 'CATALOG_PAGE_LIMIT';end if;
 anchor=papa_catalog_search_anchor(q);
 pattern=papa_catalog_search_pattern(anchor);
 phrase_pattern=papa_catalog_search_pattern(q);
 with candidate_ids as materialized (
  select v.id from papa_catalog_variants v where anchor is null and v.active
  union
  select v.id from papa_catalog_variants v where anchor is not null and v.active and
   lower(v.title||' '||v.artist||' '||v.version_label||' '||v.language_text||' '||v.performer_type_text)
    like pattern escape E'\\'
  union
  select v.id from papa_catalog_languages l join papa_catalog_variants v on v.language_id=l.id
   where anchor is not null and v.active and lower(l.name) like pattern escape E'\\'
  union
  select v.id from papa_catalog_performer_types p join papa_catalog_variants v on v.performer_type_id=p.id
   where anchor is not null and v.active and lower(p.name) like pattern escape E'\\'
 ), matched as materialized (
  select v.id,v.title,v.artist from candidate_ids c
  join papa_catalog_variants v on v.id=c.id and v.active
  join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  where q='' or lower(concat_ws(' ',v.title,v.artist,v.version_label,
   coalesce(l.name,v.language_text),coalesce(p.name,v.performer_type_text))) like phrase_pattern escape E'\\'
 ), current_page as materialized (
  select id,title,artist from matched order by title,artist,id limit page_limit offset page_offset
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.title,page_rows.artist,page_rows.id),'[]'::jsonb)
   from (
    select v.id,v.family_id as "familyId",v.title,v.artist,v.language_id as "languageId",v.updated_at as "updatedAt",
     coalesce(l.name,v.language_text) as language,v.performer_type_id as "performerTypeId",
     coalesce(p.name,v.performer_type_text) as "performerType",v.version_label as "versionLabel",
     case when room_id is null then false else exists(select 1 from papa_catalog_song_links sl
      where sl.streamer_id=room_id and sl.variant_id=v.id) end as "alreadyAdded"
    from current_page page join papa_catalog_variants v on v.id=page.id
    left join papa_catalog_languages l on l.id=v.language_id
    left join papa_catalog_performer_types p on p.id=v.performer_type_id
   ) page_rows)
 into n,rows_json;
 return jsonb_build_object('rows',rows_json,'total',n,'hasMore',page_offset+page_limit<n);
end $$;

-- Each seed predicate exactly matches its GIN index expression. The union is a
-- superset: effective metadata/lyrics and source hashes are checked afterwards.
-- Shared lyrics fan out via existing links rather than being copied per room.
create or replace function public.papa_song_search_room(room_id text,query_text text default '',tags text[] default '{}',
 page_limit int default 30,page_offset int default 0,language_name text default null) returns jsonb
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
  where (coalesce(language_name,'')='' or coalesce(l.name,v.language_text,e.data->>'cat','')=language_name)
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

revoke all on function public.papa_catalog_search_pattern(text),public.papa_song_search_source(jsonb),
 public.papa_catalog_search_anchor(text),public.papa_catalog_search(text,int,int,text),
 public.papa_song_search_room(text,text,text[],int,int,text) from public,anon,authenticated;
grant execute on function public.papa_catalog_search_pattern(text),public.papa_song_search_source(jsonb),
 public.papa_catalog_search_anchor(text),public.papa_catalog_search(text,int,int,text),
 public.papa_song_search_room(text,text,text[],int,int,text) to service_role;

commit;
