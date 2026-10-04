begin;

-- Match the conservative spelling folds used by the local candidate helper.
-- This is intentionally not an automatic Simplified/Traditional conversion.
create or replace function public.papa_catalog_normalize(value text) returns text
language sql immutable strict set search_path=public as $$
 select lower(regexp_replace(
  replace(replace(normalize(value,NFKC),'臺','台'),'裏','裡'),
  '[[:punct:][:space:]　，。！？、・·]+','','g'))
$$;

-- Candidate keys created before this spelling fold must use the same rule.
update public.papa_catalog_candidates c
set title_key=public.papa_catalog_normalize(c.title),
    artist_key=public.papa_catalog_normalize(c.artist)
where c.title_key is distinct from public.papa_catalog_normalize(c.title)
   or c.artist_key is distinct from public.papa_catalog_normalize(c.artist);

-- A per-candidate lookup starts from an exact title + artist key. The active
-- variant rows are unique already, so suggestions do not repeat when several
-- streamer songs link to one variant.
create index if not exists papa_catalog_variants_exact_suggestion
 on public.papa_catalog_variants
 ((public.papa_catalog_normalize(title)),(public.papa_catalog_normalize(artist)),id)
 where active;

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
  -- MATERIALIZED makes the lateral work run for the current page (at most 50),
  -- not for the entire pending queue. Every variant probe has an exact indexed
  -- title/artist predicate and a limit of three; uncertain matches stay manual.
  with current_page as materialized (
   select c.id,c.streamer_id as "streamerId",c.song_id as "songId",c.title,c.artist,
    c.language_text as language,c.performer_type_text as "performerType",c.version_label as "versionLabel",
    c.title_key,c.artist_key,c.status,c.source_hash as "sourceHash",c.source_revision as "sourceRevision",
    c.created_at as "createdAt",c.updated_at as "updatedAt",sl.variant_id as "variantId",v.updated_at as "variantUpdatedAt"
   from papa_catalog_candidates c left join papa_catalog_song_links sl
    on sl.streamer_id=c.streamer_id and sl.song_id=c.song_id
   left join papa_catalog_variants v on v.id=sl.variant_id
   where c.status=papa_catalog_review_list.status order by c.updated_at desc,c.id desc
   limit page_limit offset page_offset
  )
  select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows."updatedAt" desc,page_rows.id desc),'[]'::jsonb)
  into rows_json from (
   select p.id,p."streamerId",p."songId",p.title,p.artist,p.language,p."performerType",p."versionLabel",
    p.status,p."sourceHash",p."sourceRevision",p."createdAt",p."updatedAt",p."variantId",p."variantUpdatedAt",
    coalesce(s.items,'[]'::jsonb) as "suggestedVariants"
   from current_page p
   left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('id',match.id,'title',match.title,'artist',match.artist,
      'versionLabel',match.version_label) order by match.id),'[]'::jsonb) as items
    from (
     select v.id,v.title,v.artist,v.version_label
     from papa_catalog_variants v
     join papa_catalog_families f on f.id=v.family_id and f.active
     where p.status='pending' and p.title_key<>'' and p.artist_key<>'' and v.active
      and public.papa_catalog_normalize(v.title)=p.title_key
      and public.papa_catalog_normalize(v.artist)=p.artist_key
     order by v.id limit 3
    ) match
   ) s on true
  ) page_rows;
 end if;
 return jsonb_build_object('rows',rows_json,'total',n,'hasMore',page_offset+page_limit<n);
end $$;

-- Replacing a security-definer function retains its service-only access.
revoke all on function public.papa_catalog_review_list(text,int,int) from public,anon,authenticated;
grant execute on function public.papa_catalog_review_list(text,int,int) to service_role;

commit;
