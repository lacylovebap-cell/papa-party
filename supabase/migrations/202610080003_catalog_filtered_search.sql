begin;
create or replace function public.papa_catalog_search_filtered(query_text text default '',page_limit int default 30,
 page_offset int default 0,room_id text default null,language_filter text default null,performer_filter text default null,search_mode text default 'metadata') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare q text=lower(trim(coalesce(query_text,''))); anchor text; pattern text;
 phrase_pattern text; n int; rows_json jsonb;
begin
 if page_limit is null or page_offset is null or page_limit<1 or page_limit>50 or
  page_offset<0 or page_offset>10000 or length(q)>120 or coalesce(search_mode,'') not in ('metadata','lyrics') then
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
  union
  select v.id from papa_catalog_lyric_revisions lr join papa_catalog_variants v on v.id=lr.variant_id
   where search_mode='lyrics' and anchor is not null and lr.active and v.active
    and lower(lr.body) like pattern escape E'\\'
 ), matched as materialized (
  select v.id,v.title,v.artist from candidate_ids c
  join papa_catalog_variants v on v.id=c.id and v.active
  join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  where (coalesce(language_filter,'')='' or coalesce(l.name,v.language_text)=language_filter)
   and (coalesce(performer_filter,'')='' or coalesce(p.name,v.performer_type_text)=performer_filter)
   and ((search_mode='lyrics' and exists(select 1 from papa_catalog_lyric_revisions lr
      where lr.variant_id=v.id and lr.active and lower(lr.body) like phrase_pattern escape E'\\'))
    or (search_mode='metadata' and (q='' or lower(concat_ws(' ',v.title,v.artist,v.version_label,
     coalesce(l.name,v.language_text),coalesce(p.name,v.performer_type_text))) like phrase_pattern escape E'\\')))
 ), current_page as materialized (
  select id,title,artist from matched order by title,artist,id limit page_limit offset page_offset
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.title,page_rows.artist,page_rows.id),'[]'::jsonb)
   from (
    select v.id,v.family_id as "familyId",v.title,v.artist,v.language_id as "languageId",v.updated_at as "updatedAt",
     coalesce(l.name,v.language_text) as language,v.performer_type_id as "performerTypeId",
     coalesce(p.name,v.performer_type_text) as "performerType",v.version_label as "versionLabel",
     v.version_kind as "versionKind",v.performer_detail as "performerDetail",v.version_note as "versionNote",
     case when room_id is null then false else exists(select 1 from papa_catalog_song_links sl
      where sl.streamer_id=room_id and sl.variant_id=v.id) end as "alreadyAdded"
    from current_page page join papa_catalog_variants v on v.id=page.id
    left join papa_catalog_languages l on l.id=v.language_id
    left join papa_catalog_performer_types p on p.id=v.performer_type_id
   ) page_rows)
 into n,rows_json;
 return jsonb_build_object('rows',rows_json,'total',n,'hasMore',page_offset+page_limit<n);
end $$;
revoke all on function public.papa_catalog_search_filtered(text,int,int,text,text,text,text) from public,anon,authenticated;
grant execute on function public.papa_catalog_search_filtered(text,int,int,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
