begin;
-- President-only Edge operations. Changes apply to common metadata and links;
-- existing room song JSON, historical IDs, private notes and lyric copies stay intact.
create function public.papa_catalog_governance(action text,variant_ids uuid[],
 candidate_ids uuid[] default '{}',target_family uuid default null,metadata jsonb default '{}',
 expected_versions jsonb default '{}',expected_sources jsonb default '{}',actor_id text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare source_variant papa_catalog_variants; selected_variant papa_catalog_variants;
 candidate papa_catalog_candidates; song_data jsonb; expected_at timestamptz;
 new_variant uuid; new_family uuid; changed_count int=0; checked_count int=0;
 title_value text; artist_value text; language_key text; language_value text;
 performer_key text; performer_value text; version_value text; active_value boolean;
 previous_metadata jsonb; next_metadata jsonb; previous_families jsonb;
begin
 if coalesce(action,'') not in ('merge_family','split_variant','update_variant') or
  coalesce(actor_id,'')='' or variant_ids is null or cardinality(variant_ids) not between 1 and 50 or
  array_position(variant_ids,null) is not null or
  (select count(distinct id) from unnest(variant_ids) id)<>cardinality(variant_ids) or
  metadata is null or jsonb_typeof(metadata)<>'object' or
  expected_versions is null or jsonb_typeof(expected_versions)<>'object' or
  expected_sources is null or jsonb_typeof(expected_sources)<>'object' or
  exists(select 1 from jsonb_object_keys(metadata) key where key not in
   ('title','artist','languageId','performerTypeId','versionLabel','active')) then
  raise exception 'CATALOG_GOVERNANCE_INVALID';
 end if;
 if action in ('split_variant','update_variant') and cardinality(variant_ids)<>1 then
  raise exception 'CATALOG_GOVERNANCE_INVALID';end if;
 if (metadata ? 'title' and (jsonb_typeof(metadata->'title')<>'string' or
    length(trim(metadata->>'title')) not between 1 and 300)) or
  (metadata ? 'artist' and (jsonb_typeof(metadata->'artist')<>'string' or length(metadata->>'artist')>300)) or
  (metadata ? 'versionLabel' and (jsonb_typeof(metadata->'versionLabel')<>'string' or length(metadata->>'versionLabel')>120)) or
  (metadata ? 'active' and jsonb_typeof(metadata->'active')<>'boolean') or
  (metadata ? 'languageId' and jsonb_typeof(metadata->'languageId') not in ('string','null')) or
  (metadata ? 'performerTypeId' and jsonb_typeof(metadata->'performerTypeId') not in ('string','null')) then
  raise exception 'CATALOG_METADATA_INVALID';end if;
 -- This lock precedes all entity/candidate/catalog locks, matching legacy commits.
 perform 1 from papa_v2_revision where id=1 for update;
 for selected_variant in select * from papa_catalog_variants where id=any(variant_ids) order by id for update loop
  checked_count=checked_count+1;
  begin
   expected_at=(expected_versions->>selected_variant.id::text)::timestamptz;
  exception when others then raise exception 'CATALOG_SELECTION_STALE';end;
  if expected_at is null or expected_at is distinct from selected_variant.updated_at then
   raise exception 'CATALOG_SELECTION_STALE';end if;
  source_variant=selected_variant;
 end loop;
 if checked_count<>cardinality(variant_ids) then raise exception 'CATALOG_VARIANT_MISSING';end if;
 if action='merge_family' then
  if target_family is null or not exists(select 1 from papa_catalog_families where id=target_family and active) then
   raise exception 'CATALOG_FAMILY_MISSING';end if;
  select jsonb_agg(jsonb_build_object('variantId',v.id,'familyId',v.family_id) order by v.id)
   into previous_families from papa_catalog_variants v where v.id=any(variant_ids);
  update papa_catalog_variants set family_id=target_family,updated_at=clock_timestamp()
   where id=any(variant_ids) and family_id<>target_family;
  get diagnostics changed_count=row_count;
  if changed_count>0 then
   insert into papa_catalog_audit(actor_id,action,family_id,details)
    values(actor_id,action,target_family,jsonb_build_object('previous',previous_families,'variantIds',to_jsonb(variant_ids)));
   update papa_v2_revision set revision=revision+1 where id=1;
  end if;
  return jsonb_build_object('ok',true,'count',changed_count,'familyId',target_family,
   'revision',(select revision from papa_v2_revision where id=1));
 end if;
 title_value=case when metadata ? 'title' then trim(metadata->>'title') else source_variant.title end;
 artist_value=case when metadata ? 'artist' then trim(metadata->>'artist') else source_variant.artist end;
 version_value=case when metadata ? 'versionLabel' then trim(metadata->>'versionLabel') else source_variant.version_label end;
 active_value=case when metadata ? 'active' then (metadata->>'active')::boolean else source_variant.active end;
 language_key=case when metadata ? 'languageId' then nullif(metadata->>'languageId','') else source_variant.language_id end;
 performer_key=case when metadata ? 'performerTypeId' then nullif(metadata->>'performerTypeId','') else source_variant.performer_type_id end;
 language_value=case when metadata ? 'languageId' then '' else source_variant.language_text end;
 performer_value=case when metadata ? 'performerTypeId' then '' else source_variant.performer_type_text end;
 if language_key is not null then
  select name into language_value from papa_catalog_languages where id=language_key
   and (active or language_key is not distinct from source_variant.language_id);
  if not found then raise exception 'CATALOG_TEMPLATE_MISSING';end if;
 end if;
 if performer_key is not null then
  select name into performer_value from papa_catalog_performer_types where id=performer_key
   and (active or performer_key is not distinct from source_variant.performer_type_id);
  if not found then raise exception 'CATALOG_TEMPLATE_MISSING';end if;
 end if;
 previous_metadata=jsonb_build_object('title',source_variant.title,'artist',source_variant.artist,
  'languageId',source_variant.language_id,'performerTypeId',source_variant.performer_type_id,
  'versionLabel',source_variant.version_label,'active',source_variant.active);
 next_metadata=jsonb_build_object('title',title_value,'artist',artist_value,'languageId',language_key,
  'performerTypeId',performer_key,'versionLabel',version_value,'active',active_value);
 if action='update_variant' then
  update papa_catalog_variants set title=title_value,artist=artist_value,language_id=language_key,
   language_text=language_value,performer_type_id=performer_key,performer_type_text=performer_value,
   version_label=version_value,active=active_value,updated_at=clock_timestamp()
   where id=source_variant.id;
  insert into papa_catalog_audit(actor_id,action,family_id,variant_id,details)
   values(actor_id,action,source_variant.family_id,source_variant.id,
    jsonb_build_object('before',previous_metadata,'after',next_metadata));
  new_variant=source_variant.id;new_family=source_variant.family_id;changed_count=1;
 else
  if candidate_ids is null or cardinality(candidate_ids) not between 1 and 50 or
   array_position(candidate_ids,null) is not null or
   (select count(distinct id) from unnest(candidate_ids) id)<>cardinality(candidate_ids) or
   not source_variant.active then raise exception 'CATALOG_SPLIT_INVALID';end if;
  new_family=coalesce(target_family,source_variant.family_id);
  if not exists(select 1 from papa_catalog_families where id=new_family and active) then
   raise exception 'CATALOG_FAMILY_MISSING';end if;
  -- A split moves only explicitly reviewed local links. Lock and validate all
  -- selections before creating the new version so one stale row aborts the batch.
  perform 1 from papa_v2_entities e join papa_catalog_candidates indexed on indexed.song_id=e.id
   where e.kind='songs' and indexed.id=any(candidate_ids) order by e.id for update of e;
  checked_count=0;
  for candidate in select * from papa_catalog_candidates where id=any(candidate_ids) order by id for update loop
   checked_count=checked_count+1;
   if candidate.status<>'approved' or
    (expected_sources->>candidate.id::text) is distinct from candidate.source_hash then
    raise exception 'CATALOG_SELECTION_STALE';end if;
   select data into song_data from papa_v2_entities where kind='songs' and id=candidate.song_id;
   if song_data is null or song_data->>'streamer_id'<>candidate.streamer_id or
    papa_catalog_source_hash(song_data)<>candidate.source_hash then raise exception 'CATALOG_SOURCE_STALE';end if;
   if not exists(select 1 from papa_catalog_song_links sl where sl.streamer_id=candidate.streamer_id
    and sl.song_id=candidate.song_id and sl.variant_id=source_variant.id) then
    raise exception 'CATALOG_SPLIT_LINK_MISMATCH';end if;
  end loop;
  if checked_count<>cardinality(candidate_ids) then raise exception 'CATALOG_CANDIDATE_MISSING';end if;
  insert into papa_catalog_variants(family_id,title,artist,language_id,language_text,
   performer_type_id,performer_type_text,version_label,active)
   values(new_family,title_value,artist_value,language_key,language_value,performer_key,performer_value,version_value,active_value)
   returning id into new_variant;
  -- Shared mode starts from the current shared lyric, never from another
  -- streamer's own/copy body. The original version's entire history is retained.
  insert into papa_catalog_lyric_revisions(variant_id,revision,body,active,actor_id)
   select new_variant,1,r.body,true,papa_catalog_governance.actor_id from papa_catalog_lyric_revisions r
   where r.variant_id=source_variant.id and r.active;
  update papa_catalog_song_links sl set variant_id=new_variant,linked_at=now()
   from papa_catalog_candidates c where c.id=any(candidate_ids)
    and sl.streamer_id=c.streamer_id and sl.song_id=c.song_id;
  update papa_catalog_lyric_selections ls set variant_id=new_variant,updated_at=now()
   from papa_catalog_candidates c where c.id=any(candidate_ids)
    and ls.streamer_id=c.streamer_id and ls.song_id=c.song_id;
  update papa_catalog_candidates set reviewed_by=actor_id,reviewed_at=now(),updated_at=now()
   where id=any(candidate_ids);
  changed_count=cardinality(candidate_ids);
  insert into papa_catalog_audit(actor_id,action,candidate_ids,family_id,variant_id,details)
   values(actor_id,action,candidate_ids,new_family,new_variant,
    jsonb_build_object('sourceVariantId',source_variant.id,'count',changed_count,'metadata',next_metadata));
 end if;
 update papa_v2_revision set revision=revision+1 where id=1;
 return jsonb_build_object('ok',true,'count',changed_count,'variantId',new_variant,'familyId',new_family,
  'revision',(select revision from papa_v2_revision where id=1));
end $$;
revoke all on function public.papa_catalog_governance(text,uuid[],uuid[],uuid,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.papa_catalog_governance(text,uuid[],uuid[],uuid,jsonb,jsonb,jsonb,text) to service_role;
commit;
