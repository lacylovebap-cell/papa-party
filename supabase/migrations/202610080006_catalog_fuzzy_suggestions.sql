begin;
set local search_path=public,extensions,pg_catalog;

create index if not exists papa_catalog_variant_title_fuzzy on papa_catalog_variants
 using gin ((papa_catalog_normalize(title)) gin_trgm_ops) where active;
create index if not exists papa_catalog_variant_artist_fuzzy on papa_catalog_variants
 using gin ((papa_catalog_normalize(artist)) gin_trgm_ops) where active;

create function papa_catalog_suggest_variants(chosen_candidate uuid,page_limit int default 8)
 returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare target papa_catalog_candidates%rowtype;result jsonb;
begin
 if page_limit not between 1 and 10 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 select * into target from papa_catalog_candidates where id=chosen_candidate;
 if target.id is null then raise exception 'CATALOG_CANDIDATE_MISSING';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.score desc,r."variantId"),'[]'::jsonb)
 into result from (
  select v.id as "variantId",v.family_id as "familyId",v.title,v.artist,
   v.version_label as "versionLabel",coalesce(l.name,v.language_text) language,
   coalesce(p.name,v.performer_type_text) as "performerType",
   round((similarity(papa_catalog_normalize(v.title),target.title_key)*0.65+
    similarity(papa_catalog_normalize(v.artist),target.artist_key)*0.25+
    case when papa_catalog_normalize(v.version_label)=papa_catalog_normalize(target.version_label)
     then 0.10 else 0 end)::numeric,3) score
  from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  where v.active and (papa_catalog_normalize(v.title)=target.title_key
   or papa_catalog_normalize(v.title) % target.title_key
   or (length(target.title_key)>=2 and position(target.title_key in papa_catalog_normalize(v.title))>0))
  order by score desc,v.id limit page_limit
 ) r;
 return result;
end $$;

revoke all on function papa_catalog_suggest_variants(uuid,int) from public,anon,authenticated;
grant execute on function papa_catalog_suggest_variants(uuid,int) to service_role;
notify pgrst,'reload schema';
commit;
