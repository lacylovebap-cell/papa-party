begin;
-- Search visible approved metadata and approved lyric bodies on the server.
-- The existing response allowlist is unchanged: no lyric body, snippets, hit flags or private notes.
create or replace function public.papa_catalog_families_page_v4_in_space(query_text text default '',lyrics_filter text default 'all',
 page_limit int default 20,page_offset int default 0,language_filter text default '',
 version_filter text default '',viewer_room text default null,requested_space text default 'space-001',
 membership_filter text default 'all',sort_order text default 'default',version_label_filter text default '')
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
 if sort_order is null or sort_order not in ('default','newest','oldest') or length(coalesce(version_label_filter,''))>120
 then raise exception 'CATALOG_SEARCH_FILTER_INVALID';end if;
 perform papa_list_catalog_scope(requested_space,viewer_room,membership_filter);
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
 ), members_all as materialized (select variant_id,streamer_count,already_added from papa_list_catalog_members(viewer_room,requested_space)),base as materialized (
  select v.id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,v.performer_detail,v.version_note,
   v.language_id,v.performer_type_id,v.updated_at,v.created_at sort_date,coalesce(l.name,v.language_text,'') language,
   coalesce(p.name,v.performer_type_text,'') performer_type,
   exists(select 1 from papa_catalog_lyric_revisions lr where lr.variant_id=v.id and lr.active and trim(lr.body)<>'') has_lyrics,
   coalesce(pc.n,0) proposal_count,coalesce(member.streamer_count,0) n,coalesce(member.already_added,false) already_added
  from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  left join proposal_counts pc on pc.variant_id=v.id
  left join members_all member on member.variant_id=v.id where v.active
 ), matching as materialized (
  select b.id,b.family_id,b.title,b.artist,b.version_label,b.version_kind,b.performer_detail,b.version_note,
   b.language_id,b.performer_type_id,b.updated_at,b.sort_date,b.language,b.performer_type,b.has_lyrics,b.proposal_count,b.n,b.already_added
  from base b where (coalesce(trim(query_text),'')='' or not exists(
    select 1 from regexp_split_to_table(lower(trim(query_text)), E'\\s+') term(word)
    where term.word<>'' and position(term.word in lower(concat_ws(' ',b.title,b.artist,b.version_label,
     b.version_kind,b.language,b.performer_type,b.performer_detail,b.version_note)))=0
     and not exists(select 1 from papa_catalog_lyric_revisions lr
      where lr.variant_id=b.id and lr.active
       and lower(lr.body) like papa_catalog_search_pattern(term.word) escape E'\\')))
   and (coalesce(language_filter,'')='' or b.language=language_filter)
   and (coalesce(version_filter,'')='' or b.version_kind=version_filter)
   and (coalesce(version_label_filter,'')='' or b.version_label=version_label_filter)
   and (membership_filter='all' or b.already_added=(membership_filter='added'))
   and (lyrics_filter='all' or lyrics_filter='proposals' and b.proposal_count>0 or
    lyrics_filter in ('with','without') and b.has_lyrics=(lyrics_filter='with'))
 ), families as materialized (
  select distinct f.id,f.title,f.created_at sort_date from papa_catalog_families f join matching v on v.family_id=f.id
 ), paged as materialized (
  select id,title,sort_date,row_number() over(order by case when sort_order='default' then title end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id) page_order from families
  order by case when sort_order='default' then title end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id limit page_limit offset page_offset
 )
 select (select count(*) from families),
  (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'variants',
   coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'variantId',v.id,'familyId',v.family_id,
    'title',v.title,'artist',v.artist,'versionLabel',v.version_label,'versionKind',v.version_kind,
    'performerDetail',v.performer_detail,'versionNote',v.version_note,'language',v.language,
    'languageId',v.language_id,'performerType',v.performer_type,'performerTypeId',v.performer_type_id,
    'updatedAt',v.updated_at,'variantUpdatedAt',v.updated_at,'createdAt',v.sort_date,'streamerCount',v.n,
    'alreadyAdded',v.already_added,'hasSharedLyrics',v.has_lyrics,'lyricProposalCount',v.proposal_count)
    order by case when sort_order='default' then v.version_label end,case when sort_order='newest' then v.sort_date end desc nulls last,case when sort_order='oldest' then v.sort_date end asc nulls last,v.id) from matching v where v.family_id=f.id),'[]'::jsonb))
   order by f.page_order),'[]'::jsonb) from paged f),
  jsonb_build_object('languages',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from
    (select distinct language x from base where language<>'') l),
   'versionKinds',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from
    (select distinct version_kind x from base where version_kind<>'') k),
   'versionLabels',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from
    (select distinct version_label x from base where version_label<>'') k))
 into total_count,rows_json,options_json;
 return jsonb_build_object('rows',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count,'filters',options_json);
end $$;
revoke all on function public.papa_catalog_families_page_v4_in_space(text,text,integer,integer,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.papa_catalog_families_page_v4_in_space(text,text,integer,integer,text,text,text,text,text,text,text) to service_role;
commit;
