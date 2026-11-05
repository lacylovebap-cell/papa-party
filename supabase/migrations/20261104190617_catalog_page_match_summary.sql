begin;
create function public.papa_catalog_page_exact_target(candidate_id uuid)
returns uuid language sql stable security invoker set search_path=public as $$
 select v.id
 from papa_catalog_candidates c
 cross join lateral (select papa_catalog_suggest_variants(c.id,2) as matches) m
 join papa_catalog_variants v on v.id=(m.matches->0->>'variantId')::uuid
 where c.id=candidate_id and c.status='pending' and c.preferred_family is null
 and coalesce(c.edited_metadata,'{}'::jsonb)='{}'::jsonb
 and not exists(select 1 from papa_catalog_song_links l where l.streamer_id=c.streamer_id and l.song_id=c.song_id)
 and jsonb_array_length(m.matches)=1
 and c.title_key=papa_catalog_normalize(v.title) and c.title_key<>''
 and c.artist_key=papa_catalog_normalize(v.artist) and c.artist_key<>''
 and nullif(trim(c.version_label),'') is not null
 and papa_catalog_normalize(c.version_label)=papa_catalog_normalize(v.version_label)
 and nullif(trim(c.language_text),'') is not null and c.language_text=m.matches->0->>'language'
 and nullif(trim(c.performer_type_text),'') is not null and c.performer_type_text=m.matches->0->>'performerType'
$$;
revoke all on function public.papa_catalog_page_exact_target(uuid) from public,anon,authenticated;
grant execute on function public.papa_catalog_page_exact_target(uuid) to service_role;

create function public.papa_catalog_review_page_matches(
 section text, query_text text, language_name text, page_limit int,
 page_offset int, chosen_group text
) returns jsonb language sql stable security invoker set search_path=public as $$
 with page as materialized (
  select papa_catalog_review_page(section,query_text,language_name,page_limit,page_offset,chosen_group) as result
 ), decorated as (
  select entry.ordinality, entry.value || case
   when section='duplicates' and chosen_group is null then
    jsonb_build_object('matches',papa_catalog_suggest_variants((entry.value->'rows'->0->>'id')::uuid,3),'rows',
     (select jsonb_agg(source.value || jsonb_build_object(
       'defaultTarget',papa_catalog_page_exact_target((source.value->>'id')::uuid),
       'previousVariant', (select jsonb_build_object('variantId',v.id,'title',v.title,'artist',v.artist,'versionLabel',v.version_label)
         from papa_catalog_song_links l join papa_catalog_variants v on v.id=l.variant_id
         where l.streamer_id=source.value->>'streamerId' and l.song_id=source.value->>'songId')
     ) order by source.ordinality) from jsonb_array_elements(entry.value->'rows') with ordinality source))
   else '{}'::jsonb end as item
  from page cross join lateral jsonb_array_elements(page.result->'rows') with ordinality as entry
 )
 select result || jsonb_build_object('rows',
  coalesce((select jsonb_agg(item order by ordinality) from decorated),'[]'::jsonb))
 from page
$$;
revoke all on function public.papa_catalog_review_page_matches(text,text,text,int,int,text) from public,anon,authenticated;
grant execute on function public.papa_catalog_review_page_matches(text,text,text,int,int,text) to service_role;
create function public.papa_catalog_review_page_submit(
 decision text, candidate_ids uuid[], expected_sources jsonb, expected_updates jsonb, actor_id text, target_variant uuid, options jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 if decision not in ('link_variant','independent','confirm_same','different_versions','create_variant') or cardinality(candidate_ids) not between 1 and 50 then
  raise exception 'CATALOG_REVIEW_INVALID';
 end if;
 perform 1 from papa_v2_revision where id=1 for update;
 perform 1 from papa_v2_entities e join papa_catalog_candidates c on c.song_id=e.id where e.kind='songs' and c.id=any(candidate_ids) order by e.id for update of e;
 perform 1 from papa_catalog_candidates where id=any(candidate_ids) order by id for update;
 if (select count(*) from papa_catalog_candidates c where c.id=any(candidate_ids)
  and c.status='pending' and c.updated_at=(expected_updates->>c.id::text)::timestamptz
  and (coalesce(options->>'automatic','false')<>'true' or (decision='link_variant' and papa_catalog_page_exact_target(c.id)=target_variant))
 )<>cardinality(candidate_ids) then raise exception 'CATALOG_SELECTION_STALE'; end if;
 if decision='confirm_same' and options ? 'variantDetails' then
  return papa_catalog_review_same_full(candidate_ids,expected_sources,actor_id,coalesce(options->'commonMetadata','{}'),options->'variantDetails',(options->>'lyricsSource')::uuid,options->>'sharedBody');
 end if;
 if decision='different_versions' then
  return papa_catalog_review_versions(candidate_ids,expected_sources,actor_id,coalesce(options->'commonMetadata','{}'),options->'variantMetadata',(options->>'familyId')::uuid);
 end if;
 return papa_catalog_review_selected(decision,candidate_ids,expected_sources,actor_id,
  target_family=>(options->>'familyId')::uuid,target_variant=>target_variant,
  common_metadata=>coalesce(options->'commonMetadata','{}') ||
   case when options ? 'variantLabel' then jsonb_build_object('versionLabel',options->>'variantLabel') else '{}'::jsonb end);

end $$;
revoke all on function public.papa_catalog_review_page_submit(text,uuid[],jsonb,jsonb,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.papa_catalog_review_page_submit(text,uuid[],jsonb,jsonb,text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
