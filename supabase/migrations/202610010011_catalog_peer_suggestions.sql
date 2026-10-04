begin;

-- Initial review must also work before the president has approved any common
-- variants. Probe a single normalized title group, in ID order, rather than
-- comparing every song pair. Status is part of the partial-index predicate.
create index if not exists papa_catalog_candidate_title_peers
 on public.papa_catalog_candidates(title_key,id)
 where status in ('pending','approved');

create or replace function public.papa_catalog_review_list(status text default 'pending',page_limit int default 30,
 page_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare n int; rows_json jsonb;
begin
 if coalesce(status,'') not in ('pending','approved','rejected','removed','history') or
  page_limit is null or page_offset is null or page_limit<1 or page_limit>50 or
  page_offset<0 or page_offset>10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 if status='history' then
  select count(*) into n from papa_catalog_audit;
  select coalesce(jsonb_agg(to_jsonb(page_rows)),'[]'::jsonb) into rows_json from (
   select id,actor_id as "actorId",action,candidate_ids as "candidateIds",family_id as "familyId",
    variant_id as "variantId",details,created_at as "createdAt"
   from papa_catalog_audit order by created_at desc,id desc limit page_limit offset page_offset
  ) page_rows;
 else
  select count(*) into n from papa_catalog_candidates c where c.status=papa_catalog_review_list.status;
  with current_page as materialized (
   select c.id,c.streamer_id as "streamerId",c.song_id as "songId",c.title,c.artist,
    c.language_text as language,c.performer_type_text as "performerType",c.version_label as "versionLabel",
    c.title_key,c.artist_key,c.status,c.source_hash as "sourceHash",c.source_revision as "sourceRevision",
    c.created_at as "createdAt",c.updated_at as "updatedAt",sl.variant_id as "variantId",v.updated_at as "variantUpdatedAt",
    e.id is not null as source_valid
   from papa_catalog_candidates c left join papa_catalog_song_links sl
    on sl.streamer_id=c.streamer_id and sl.song_id=c.song_id
   left join papa_catalog_variants v on v.id=sl.variant_id
   left join papa_v2_entities e on e.kind='songs' and e.id=c.song_id
    and e.data->>'streamer_id'=c.streamer_id and papa_catalog_source_hash(e.data)=c.source_hash
   where c.status=papa_catalog_review_list.status order by c.updated_at desc,c.id desc
   limit page_limit offset page_offset
  )
  select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows."updatedAt" desc,page_rows.id desc),'[]'::jsonb)
  into rows_json from (
   select p.id,p."streamerId",p."songId",p.title,p.artist,p.language,p."performerType",p."versionLabel",
    p.status,p."sourceHash",p."sourceRevision",p."createdAt",p."updatedAt",p."variantId",p."variantUpdatedAt",
    coalesce(s.items,'[]'::jsonb) as "suggestedVariants",coalesce(peers.items,'[]'::jsonb) as "suggestedCandidates"
   from current_page p
   left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('id',match.id,'title',match.title,'artist',match.artist,
      'versionLabel',match.version_label) order by match.id),'[]'::jsonb) as items
    from (
     select v.id,v.title,v.artist,v.version_label
     from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active
     where p.status='pending' and p.title_key<>'' and p.artist_key<>'' and v.active
      and public.papa_catalog_normalize(v.title)=p.title_key
      and public.papa_catalog_normalize(v.artist)=p.artist_key
     order by v.id limit 3
    ) match
   ) s on true
   -- Only the materialized page (at most 50 rows) performs peer probes. Both
   -- sides must still describe live source songs; removed, rejected, deleted,
   -- moved-room, and stale-index rows cannot become suggestions.
   left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('id',peer.id,'streamerId',peer.streamer_id,
      'songId',peer.song_id,'title',peer.title,'artist',peer.artist,'language',peer.language_text,
      'performerType',peer.performer_type_text,'versionLabel',peer.version_label,'matchType',
      case when p.artist_key='' or peer.artist_key='' or p.artist_key<>peer.artist_key then 'same_title'
       when (p.language<>'' and peer.language_text<>'' and
        papa_catalog_normalize(case when p.language in ('華語','中文') then '國語' else p.language end)<>
        papa_catalog_normalize(case when peer.language_text in ('華語','中文') then '國語' else peer.language_text end))
        or papa_catalog_normalize(p."versionLabel")<>papa_catalog_normalize(peer.version_label)
        then 'possible_version' else 'possible_same' end) order by peer.id),'[]'::jsonb) as items
    from (
     select c.id,c.streamer_id,c.song_id,c.title,c.artist,c.artist_key,c.language_text,
      c.performer_type_text,c.version_label
     from papa_catalog_candidates c join papa_v2_entities e on e.kind='songs' and e.id=c.song_id
      and e.data->>'streamer_id'=c.streamer_id and papa_catalog_source_hash(e.data)=c.source_hash
     where p.status='pending' and p.source_valid and p.title_key<>''
      and c.title_key=p.title_key and c.id<>p.id and c.status in ('pending','approved')
     order by c.id limit 3
    ) peer
   ) peers on true
  ) page_rows;
 end if;
 return jsonb_build_object('rows',rows_json,'total',n,'hasMore',page_offset+page_limit<n);
end $$;

-- Peer results are hints for manual review. They contain only the candidate
-- metadata allowlist and never write an approval, link, lyric, or source song.
revoke all on function public.papa_catalog_review_list(text,int,int) from public,anon,authenticated;
grant execute on function public.papa_catalog_review_list(text,int,int) to service_role;
commit;
