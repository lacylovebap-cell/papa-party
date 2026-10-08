begin;

create index if not exists papa_catalog_variant_normalized_match on papa_catalog_variants
 (papa_catalog_normalize(title),papa_catalog_normalize(artist)) where active;

-- One server-side batch lookup for a preview. The client receives only small
-- candidate metadata; ambiguous results always require an explicit choice.
create function papa_catalog_import_matches(import_rows jsonb) returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if jsonb_typeof(import_rows)<>'array' or jsonb_array_length(import_rows)>100
  then raise exception 'CATALOG_IMPORT_LIMIT';end if;
 with input as materialized (
  select (r.value->>'line')::int line,r.value->>'title' title,
   r.value->>'artist' artist,r.value->>'cat' language
  from jsonb_array_elements(import_rows) r
 )
 select coalesce(jsonb_agg(jsonb_build_object('line',i.line,'total',
  (select count(*) from papa_catalog_variants v join papa_catalog_families f
   on f.id=v.family_id and f.active where v.active
   and papa_catalog_normalize(v.title)=papa_catalog_normalize(i.title)
   and papa_catalog_normalize(v.artist)=papa_catalog_normalize(i.artist)),
  'matches',coalesce((select jsonb_agg(to_jsonb(m) order by m."versionLabel",m."variantId")
   from (select v.id as "variantId",v.family_id as "familyId",v.title,v.artist,
    v.version_label as "versionLabel",coalesce(l.name,v.language_text) language,
    coalesce(p.name,v.performer_type_text) as "performerType"
    from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active
    left join papa_catalog_languages l on l.id=v.language_id
    left join papa_catalog_performer_types p on p.id=v.performer_type_id
    where v.active and papa_catalog_normalize(v.title)=papa_catalog_normalize(i.title)
     and papa_catalog_normalize(v.artist)=papa_catalog_normalize(i.artist)
    order by v.version_label,v.id limit 10) m),'[]'::jsonb)) order by i.line),'[]'::jsonb)
 into result from input i;
 return result;
end $$;

create function papa_catalog_import_link_batch(room_id text,selections jsonb,actor_id text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb;source_row jsonb;old_variant uuid;linked_count int=0;seen text[]='{}';
begin
 if coalesce(room_id,'')='' or coalesce(actor_id,'')='' or jsonb_typeof(selections)<>'array'
  or jsonb_array_length(selections)>100 then raise exception 'CATALOG_IMPORT_LIMIT';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 for item in select value from jsonb_array_elements(selections) loop
  if coalesce(item->>'songId','')='' or item->>'songId'=any(seen)
   then raise exception 'CATALOG_IMPORT_DUPLICATE';end if;
  seen=array_append(seen,item->>'songId');
  select e.data into source_row from papa_v2_entities e where e.kind='songs'
   and e.id=item->>'songId' and e.data->>'streamer_id'=room_id for update;
  if source_row is null or source_row->>'title' is distinct from item->>'title'
   or source_row->>'artist' is distinct from item->>'artist'
   then raise exception 'CATALOG_SELECTION_STALE';end if;
  select sl.variant_id into old_variant from papa_catalog_song_links sl
   where sl.streamer_id=room_id and sl.song_id=item->>'songId' for update;
  perform papa_catalog_link_room_song(room_id,item->>'songId',(item->>'variantId')::uuid,
   papa_catalog_source_hash(source_row),old_variant,actor_id,false);
  linked_count=linked_count+1;
 end loop;
 return jsonb_build_object('linked',linked_count);
end $$;

revoke all on function papa_catalog_import_matches(jsonb),
 papa_catalog_import_link_batch(text,jsonb,text) from public,anon,authenticated;
grant execute on function papa_catalog_import_matches(jsonb),
 papa_catalog_import_link_batch(text,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
