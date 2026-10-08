begin;

-- New bounded read RPC; the original public-page signature remains available.
-- Classification is evaluated before family pagination, never in the browser.
create function papa_catalog_public_page_filtered(query_text text default '',
 language_filter text default '',performer_filter text default '',version_filter text default '',
 page_limit int default 12,page_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;options_json jsonb;
begin
 if page_limit not between 1 and 20 or page_offset not between 0 and 10000
  or greatest(length(coalesce(query_text,'')),length(coalesce(language_filter,'')),
   length(coalesce(performer_filter,'')),length(coalesce(version_filter,'')))>100
 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 with rooms as materialized (
  select room->>'id' id,room->>'slug' slug,room->>'display_name' name
  from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  where m.kind='meta' and m.id='1' and coalesce((room->>'active')::boolean,true)
 ), visible as materialized (
  select v.id variant_id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,
   coalesce(l.name,v.language_text,'') language,coalesce(p.name,v.performer_type_text,'') performer_type,
   r.id streamer_id,r.slug,r.name,sl.song_id
  from papa_catalog_song_links sl join rooms r on r.id=sl.streamer_id
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
   and coalesce((e.data->>'hidden')::boolean,false)=false
  join papa_catalog_variants v on v.id=sl.variant_id and v.active
  join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
 ), filtered as materialized (
  select v.variant_id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,v.language,v.performer_type,v.streamer_id,v.slug,v.name,v.song_id from visible v where
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
revoke all on function papa_catalog_public_page_filtered(text,text,text,text,int,int) from public,anon,authenticated;
grant execute on function papa_catalog_public_page_filtered(text,text,text,text,int,int) to service_role;
notify pgrst,'reload schema';
commit;
