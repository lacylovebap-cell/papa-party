begin;

-- The ordinary room snapshot already projects shared metadata once per room.
-- Add only small status fields; source hashes stay manager-only and on demand.
create or replace function papa_catalog_song_metadata(room_id text) returns jsonb
 language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('songId',e.id,
  'title',v.title,'artist',v.artist,'cat',coalesce(l.name,v.language_text),
  'artistType',coalesce(p.name,v.performer_type_text),'version',v.version_label,
  'catalogVariantId',v.id,'catalogFamilyId',v.family_id,
  'catalogStatus',case when v.id is not null then 'linked'
   when c.status='pending' then 'pending' else 'unlinked' end,
  'hasLyrics',case when ls.mode in ('copy','own') then trim(coalesce(ls.body,''))<>''
   when v.id is not null then trim(coalesce(lr.body,''))<>''
   else trim(coalesce(e.data->>'lyrics',''))<>'' end,
  'lyricsMode',coalesce(ls.mode,case when trim(coalesce(e.data->>'lyrics',''))<>''
   then 'own' else 'shared' end))) order by e.id),'[]')
 from papa_v2_entities e
 left join papa_catalog_song_links sl on sl.streamer_id=room_id and sl.song_id=e.id
  and sl.source_hash=papa_catalog_source_hash(e.data)
 left join papa_catalog_variants v on v.id=sl.variant_id and v.active
  and exists(select 1 from papa_catalog_families f where f.id=v.family_id and f.active)
 left join papa_catalog_candidates c on c.streamer_id=room_id and c.song_id=e.id
  and c.source_hash=papa_catalog_source_hash(e.data)
 left join papa_catalog_languages l on l.id=v.language_id
 left join papa_catalog_performer_types p on p.id=v.performer_type_id
 left join papa_catalog_lyric_selections ls on ls.streamer_id=room_id and ls.song_id=e.id
 left join papa_catalog_lyric_revisions lr on lr.variant_id=v.id and lr.active
 where e.kind='songs' and e.data->>'streamer_id'=room_id
$$;

create function papa_catalog_link_info(room_id text,song_id text) returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 select jsonb_build_object('songId',e.id,'sourceHash',papa_catalog_source_hash(e.data),
  'variantId',v.id,'familyId',v.family_id,'title',v.title,'artist',v.artist,
  'versionLabel',v.version_label,
  'status',case when v.id is not null then 'linked'
   when c.status='pending' then 'pending' else 'unlinked' end)
 into result from papa_v2_entities e
 left join papa_catalog_song_links sl on sl.streamer_id=room_id and sl.song_id=e.id
  and sl.source_hash=papa_catalog_source_hash(e.data)
 left join papa_catalog_variants v on v.id=sl.variant_id and v.active
  and exists(select 1 from papa_catalog_families f where f.id=v.family_id and f.active)
 left join papa_catalog_candidates c on c.streamer_id=room_id and c.song_id=e.id
  and c.source_hash=papa_catalog_source_hash(e.data)
 where e.kind='songs' and e.id=papa_catalog_link_info.song_id and e.data->>'streamer_id'=room_id;
 if result is null then raise exception 'CATALOG_SONG_MISSING';end if;
 return result;
end $$;

create function papa_catalog_family_singers(chosen_family uuid) returns jsonb
 language sql stable security definer set search_path=public as $$
 with room_names as materialized (
  select room->>'id' id,room->>'display_name' name
  from papa_v2_entities m cross join lateral
   jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  where m.kind='meta' and m.id='1'
 )
 select coalesce(jsonb_agg(jsonb_build_object('variantId',v.id,'versionLabel',v.version_label,
  'artist',v.artist,'rooms',coalesce((select jsonb_agg(jsonb_build_object('streamerId',r.id,
   'name',coalesce(r.name,r.id)) order by coalesce(r.name,r.id))
   from room_names r where exists(select 1 from papa_catalog_song_links sl
    join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
     and e.data->>'streamer_id'=sl.streamer_id
     and papa_catalog_source_hash(e.data)=sl.source_hash
    where sl.variant_id=v.id and sl.streamer_id=r.id)),'[]'::jsonb))
  order by v.version_label,v.id),'[]'::jsonb)
 from papa_catalog_variants v where v.family_id=chosen_family and v.active
$$;

revoke all on function papa_catalog_link_info(text,text),papa_catalog_family_singers(uuid)
 from public,anon,authenticated;
grant execute on function papa_catalog_link_info(text,text),papa_catalog_family_singers(uuid)
 to service_role;
notify pgrst,'reload schema';
commit;
