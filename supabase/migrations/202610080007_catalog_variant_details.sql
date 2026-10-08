begin;
set local search_path=public,extensions,pg_catalog;

-- Keep the existing governance lock, stale-version check and shared-field update.
-- The extra fields belong to the shared variant, never to each streamer song.
create function papa_catalog_update_variant_full(chosen_variant uuid,metadata jsonb,
 details jsonb,expected_version timestamptz,actor_id text) returns jsonb
 language plpgsql security definer set search_path=public as $$
declare result jsonb; before_row papa_catalog_variants%rowtype; after_row papa_catalog_variants%rowtype;
begin
 if chosen_variant is null or coalesce(actor_id,'')='' or details is null or
  jsonb_typeof(details)<>'object' or
  exists(select 1 from jsonb_object_keys(details) k where k not in
   ('versionKind','performerDetail','versionNote')) or
  (details ? 'versionKind' and (jsonb_typeof(details->'versionKind')<>'string' or length(details->>'versionKind')>80)) or
  (details ? 'performerDetail' and (jsonb_typeof(details->'performerDetail')<>'string' or length(details->>'performerDetail')>300)) or
  (details ? 'versionNote' and (jsonb_typeof(details->'versionNote')<>'string' or length(details->>'versionNote')>500))
 then raise exception 'CATALOG_METADATA_INVALID';end if;
 select * into before_row from papa_catalog_variants where id=chosen_variant;
 result=papa_catalog_governance('update_variant',array[chosen_variant],array[]::uuid[],null,
  metadata,jsonb_build_object(chosen_variant::text,expected_version), '{}'::jsonb,actor_id);
 update papa_catalog_variants set
  version_kind=case when details ? 'versionKind' then trim(details->>'versionKind') else version_kind end,
  performer_detail=case when details ? 'performerDetail' then trim(details->>'performerDetail') else performer_detail end,
  version_note=case when details ? 'versionNote' then trim(details->>'versionNote') else version_note end,
  updated_at=clock_timestamp()
 where id=chosen_variant returning * into after_row;
 if details<>'{}'::jsonb then
  insert into papa_catalog_audit(actor_id,action,family_id,variant_id,details)
   values(actor_id,'update_variant_details',after_row.family_id,chosen_variant,
    jsonb_build_object('before',jsonb_build_object('versionKind',before_row.version_kind,
     'performerDetail',before_row.performer_detail,'versionNote',before_row.version_note),
     'after',details));
 end if;
 return result;
end $$;

revoke all on function papa_catalog_update_variant_full(uuid,jsonb,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function papa_catalog_update_variant_full(uuid,jsonb,jsonb,timestamptz,text) to service_role;
create function papa_catalog_variant_info(chosen_variant uuid) returns jsonb
 language sql stable security definer set search_path=public as $$
 select jsonb_build_object('variantId',v.id,'familyId',v.family_id,'title',v.title,'artist',v.artist,
  'versionLabel',v.version_label,'versionKind',v.version_kind,'performerDetail',v.performer_detail,
  'versionNote',v.version_note,'languageId',v.language_id,'language',coalesce(l.name,v.language_text),
  'performerTypeId',v.performer_type_id,'performerType',coalesce(p.name,v.performer_type_text),
  'updatedAt',v.updated_at,'active',v.active)
 from papa_catalog_variants v left join papa_catalog_languages l on l.id=v.language_id
 left join papa_catalog_performer_types p on p.id=v.performer_type_id where v.id=chosen_variant;
$$;
revoke all on function papa_catalog_variant_info(uuid) from public,anon,authenticated;
grant execute on function papa_catalog_variant_info(uuid) to service_role;
notify pgrst,'reload schema';
commit;
