begin;
-- The Edge validates public room visibility or the manager's own room before
-- calling these service-only RPCs. No lyrics or private song fields are returned.
create function public.papa_catalog_language_filter(room_id text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected_mode text; selected_ids jsonb; language_rows jsonb;
begin
 if coalesce(room_id,'')='' or not exists(select 1 from papa_v2_entities m
  cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  where m.kind='meta' and m.id='1' and room->>'id'=room_id) then
  raise exception 'CATALOG_ROOM_MISSING';end if;
 select mode into selected_mode from papa_catalog_language_filters where streamer_id=room_id;
 selected_mode=coalesce(selected_mode,'auto');
 select coalesce(jsonb_agg(language_id order by language_id),'[]'::jsonb) into selected_ids
  from papa_catalog_language_filter_items where streamer_id=room_id;
 if selected_mode='custom' then
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'active',l.active,'sortOrder',l.sort_order)
   order by l.sort_order,l.name,l.id),'[]'::jsonb) into language_rows
   from papa_catalog_language_filter_items item join papa_catalog_languages l on l.id=item.language_id
   where item.streamer_id=room_id;
 else
  with existing as (
   select case when v.id is not null then v.language_id else null end as template_id,
    trim(case when v.id is not null then coalesce(lang.name,v.language_text) else coalesce(e.data->>'cat','') end) as name
   from papa_v2_entities e
   left join papa_catalog_song_links sl on sl.streamer_id=room_id and sl.song_id=e.id
    and sl.source_hash=papa_catalog_source_hash(e.data)
   left join papa_catalog_variants v on v.id=sl.variant_id and v.active
    and exists(select 1 from papa_catalog_families f where f.id=v.family_id and f.active)
   left join papa_catalog_languages lang on lang.id=v.language_id
   where e.kind='songs' and e.data->>'streamer_id'=room_id
  ), resolved as (
   select distinct on (e.name) coalesce(e.template_id,l.id) as id,e.name,
    coalesce(l.active,true) as active,coalesce(l.sort_order,100000) as sort_order
   from existing e left join papa_catalog_languages l on l.id=e.template_id or
    (e.template_id is null and l.name=e.name)
   where e.name<>'' order by e.name,e.template_id nulls last
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'active',r.active,'sortOrder',r.sort_order)
   order by r.sort_order,r.name),'[]'::jsonb) into language_rows from resolved r;
 end if;
 return jsonb_build_object('mode',selected_mode,'languageIds',selected_ids,'languages',language_rows);
end $$;

create function public.papa_catalog_language_filter_save(room_id text,mode text,
 language_ids text[] default '{}',actor_id text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare previous_mode text; previous_ids text[]; selected_ids text[]; current_revision bigint;
begin
 if coalesce(room_id,'')='' or coalesce(actor_id,'')='' or coalesce(mode,'') not in ('auto','custom') or
  language_ids is null or cardinality(language_ids)>100 or array_position(language_ids,null) is not null or
  (select count(distinct id) from unnest(language_ids) id)<>cardinality(language_ids) then
  raise exception 'CATALOG_LANGUAGE_FILTER_INVALID';end if;
 if not exists(select 1 from papa_v2_entities m
  cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  where m.kind='meta' and m.id='1' and room->>'id'=room_id) then
  raise exception 'CATALOG_ROOM_MISSING';end if;
 select revision into current_revision from papa_v2_revision where id=1 for update;
 select f.mode into previous_mode from papa_catalog_language_filters f where f.streamer_id=room_id;
 previous_mode=coalesce(previous_mode,'auto');
 select coalesce(array_agg(language_id order by language_id),'{}'::text[]) into previous_ids
  from papa_catalog_language_filter_items where streamer_id=room_id;
 select case when mode='auto' then '{}'::text[] else
  coalesce(array_agg(id order by id),'{}'::text[]) end into selected_ids from unnest(language_ids) id;
 if exists(select 1 from unnest(selected_ids) chosen where not exists(
  select 1 from papa_catalog_languages l where l.id=chosen and (l.active or chosen=any(previous_ids)))) then
  raise exception 'CATALOG_TEMPLATE_MISSING';end if;
 if previous_mode=mode and previous_ids=selected_ids then
  return papa_catalog_language_filter(room_id)||jsonb_build_object('changed',false,'revision',current_revision);
 end if;
 insert into papa_catalog_language_filters(streamer_id,mode,updated_at)
  values(room_id,mode,clock_timestamp()) on conflict(streamer_id) do update
   set mode=excluded.mode,updated_at=excluded.updated_at;
 delete from papa_catalog_language_filter_items where streamer_id=room_id;
 insert into papa_catalog_language_filter_items(streamer_id,language_id)
  select room_id,id from unnest(selected_ids) id;
 insert into papa_catalog_audit(actor_id,action,details)
  values(actor_id,'language_filter',jsonb_build_object('streamerId',room_id,
   'before',jsonb_build_object('mode',previous_mode,'languageIds',to_jsonb(previous_ids)),
   'after',jsonb_build_object('mode',mode,'languageIds',to_jsonb(selected_ids))));
 update papa_v2_revision set revision=revision+1 where id=1 returning revision into current_revision;
 return papa_catalog_language_filter(room_id)||jsonb_build_object('changed',true,'revision',current_revision);
end $$;

-- Language filtering happens before pagination; applying it in the browser
-- after receiving one page would silently omit matching results on later pages.
drop function public.papa_song_search_room(text,text,text[],int,int);
create function public.papa_song_search_room(room_id text,query_text text default '',tags text[] default '{}',
 page_limit int default 30,page_offset int default 0,language_name text default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare words text[]; n int; ids jsonb;
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
 with matched as materialized (
  select e.id,case when e.data->>'_order'~'^[0-9]{1,9}$' then (e.data->>'_order')::int else 0 end as song_order
  from papa_v2_entities e
  left join papa_catalog_song_links sl on sl.streamer_id=room_id and sl.song_id=e.id
  left join papa_catalog_variants v on v.id=sl.variant_id and v.active
   and sl.source_hash=papa_catalog_source_hash(e.data)
   and exists(select 1 from papa_catalog_families f where f.id=v.family_id and f.active)
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  left join papa_catalog_lyric_selections ls on ls.streamer_id=room_id and ls.song_id=e.id
  left join papa_catalog_lyric_revisions lr on lr.variant_id=v.id and lr.active
  where e.kind='songs' and e.data->>'streamer_id'=room_id
   and (coalesce(language_name,'')='' or coalesce(l.name,v.language_text,e.data->>'cat','')=language_name)
   and (coalesce(array_length(tags,1),0)=0 or exists(select 1
    from jsonb_array_elements_text(coalesce(e.data->'tags','[]'::jsonb)) song_tag where song_tag=any(tags)))
   and not exists(select 1 from unnest(words) word where word<>'' and
    position(word in lower(concat_ws(' ',coalesce(v.title,e.data->>'title'),coalesce(v.artist,e.data->>'artist'),
     coalesce(l.name,v.language_text,e.data->>'cat'),coalesce(p.name,v.performer_type_text,e.data->>'artistType'),e.data->>'murmur',e.data->>'tags',
     coalesce(case when ls.mode in ('copy','own') then ls.body
      when v.id is not null then lr.body end,e.data->>'lyrics',''))))=0)
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(page_rows.id order by page_rows.song_order,page_rows.id),'[]'::jsonb)
   from (select id,song_order from matched order by song_order,id limit page_limit offset page_offset) page_rows)
 into n,ids;
 return jsonb_build_object('songIds',ids,'total',n,'hasMore',page_offset+page_limit<n);
end $$;
revoke all on function public.papa_catalog_language_filter(text),
 public.papa_catalog_language_filter_save(text,text,text[],text),
 public.papa_song_search_room(text,text,text[],int,int,text) from public,anon,authenticated;
grant execute on function public.papa_catalog_language_filter(text),
 public.papa_catalog_language_filter_save(text,text,text[],text),
 public.papa_song_search_room(text,text,text[],int,int,text) to service_role;
commit;
