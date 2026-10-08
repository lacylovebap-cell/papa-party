begin;
set local search_path=public,extensions,pg_catalog;

-- One review transaction creates the family and variants, then applies the
-- president's explicit metadata for each selected version. Room songs remain
-- untouched; only their shared variant relation is established.
create function papa_catalog_review_versions(candidate_ids uuid[],expected_sources jsonb,
 actor_id text,common_metadata jsonb,variant_metadata jsonb,target_family uuid default null)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; entry record; chosen jsonb; linked_variant uuid; language_key text;
 performer_key text; labels jsonb='{}'::jsonb;
begin
 if candidate_ids is null or cardinality(candidate_ids) not between 2 and 50 or
  variant_metadata is null or jsonb_typeof(variant_metadata)<>'object' or
  common_metadata is null or jsonb_typeof(common_metadata)<>'object' or
  exists(select 1 from jsonb_object_keys(variant_metadata) id where not id=any(candidate_ids::text[]))
 then raise exception 'CATALOG_REVIEW_INVALID';end if;
 for entry in select key,value from jsonb_each(variant_metadata) loop
  chosen=entry.value;
  if jsonb_typeof(chosen)<>'object' or
   exists(select 1 from jsonb_object_keys(chosen) k where k not in
    ('artist','language','performerType','versionLabel','versionKind','performerDetail','versionNote')) or
   (chosen ? 'artist' and (jsonb_typeof(chosen->'artist')<>'string' or length(chosen->>'artist')>300)) or
   (chosen ? 'language' and (jsonb_typeof(chosen->'language')<>'string' or length(chosen->>'language')>100)) or
   (chosen ? 'performerType' and (jsonb_typeof(chosen->'performerType')<>'string' or length(chosen->>'performerType')>100)) or
   (chosen ? 'versionLabel' and (jsonb_typeof(chosen->'versionLabel')<>'string' or length(trim(chosen->>'versionLabel')) not between 1 and 120)) or
   (chosen ? 'versionKind' and (jsonb_typeof(chosen->'versionKind')<>'string' or length(chosen->>'versionKind')>80)) or
   (chosen ? 'performerDetail' and (jsonb_typeof(chosen->'performerDetail')<>'string' or length(chosen->>'performerDetail')>300)) or
   (chosen ? 'versionNote' and (jsonb_typeof(chosen->'versionNote')<>'string' or length(chosen->>'versionNote')>500))
  then raise exception 'CATALOG_REVIEW_INVALID';end if;
  if chosen ? 'versionLabel' then labels=labels||jsonb_build_object(entry.key,chosen->>'versionLabel');end if;
 end loop;
 result=papa_catalog_review_selected('different_versions',candidate_ids,expected_sources,
  actor_id,target_family,null,common_metadata,null,null,labels);
 for entry in select c.id,c.streamer_id,c.song_id,variant_metadata->c.id::text chosen
  from papa_catalog_candidates c where c.id=any(candidate_ids) order by c.id loop
  chosen=coalesce(entry.chosen,'{}'::jsonb);
  select variant_id into linked_variant from papa_catalog_song_links
   where streamer_id=entry.streamer_id and song_id=entry.song_id;
  if linked_variant is null then raise exception 'CATALOG_SELECTION_STALE';end if;
  language_key=null;performer_key=null;
  if chosen ? 'language' then
   select id into language_key from papa_catalog_languages
    where name=chosen->>'language' and active order by sort_order,id limit 1;
  end if;
  if chosen ? 'performerType' then
   select id into performer_key from papa_catalog_performer_types
    where name=chosen->>'performerType' and active order by sort_order,id limit 1;
  end if;
  update papa_catalog_variants set
   artist=case when chosen ? 'artist' then trim(chosen->>'artist') else artist end,
   language_id=case when chosen ? 'language' then language_key else language_id end,
   language_text=case when chosen ? 'language' then trim(chosen->>'language') else language_text end,
   performer_type_id=case when chosen ? 'performerType' then performer_key else performer_type_id end,
   performer_type_text=case when chosen ? 'performerType' then trim(chosen->>'performerType') else performer_type_text end,
   version_kind=case when chosen ? 'versionKind' then trim(chosen->>'versionKind') else version_kind end,
   performer_detail=case when chosen ? 'performerDetail' then trim(chosen->>'performerDetail') else performer_detail end,
   version_note=case when chosen ? 'versionNote' then trim(chosen->>'versionNote') else version_note end,
   updated_at=clock_timestamp()
   where id=linked_variant;
 end loop;
 insert into papa_catalog_audit(actor_id,action,family_id,details)
  values(actor_id,'review_versions_detail',(result->>'familyId')::uuid,
   jsonb_build_object('candidateIds',to_jsonb(candidate_ids),'versionCount',cardinality(candidate_ids)));
 return result;
end $$;

revoke all on function papa_catalog_review_versions(uuid[],jsonb,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function papa_catalog_review_versions(uuid[],jsonb,text,jsonb,jsonb,uuid) to service_role;
create function papa_catalog_review_same_full(candidate_ids uuid[],expected_sources jsonb,
 actor_id text,common_metadata jsonb,variant_details jsonb,lyrics_source uuid default null,
 shared_body text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;version_stamp timestamptz;
begin
 result=papa_catalog_review_selected('confirm_same',candidate_ids,expected_sources,actor_id,
  null,null,common_metadata,lyrics_source,shared_body,'{}'::jsonb);
 select updated_at into version_stamp from papa_catalog_variants where id=(result->>'variantId')::uuid;
 perform papa_catalog_update_variant_full((result->>'variantId')::uuid,'{}'::jsonb,
  variant_details,version_stamp,actor_id);
 return result||jsonb_build_object('revision',(select revision from papa_v2_revision where id=1));
end $$;
revoke all on function papa_catalog_review_same_full(uuid[],jsonb,text,jsonb,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function papa_catalog_review_same_full(uuid[],jsonb,text,jsonb,jsonb,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
