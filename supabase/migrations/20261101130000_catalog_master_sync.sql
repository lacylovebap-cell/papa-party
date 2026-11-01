-- 10.31-CATALOG.2: editing a shared master (共同歌曲主資料) also updates every
-- linked streamer songbook, through the normal room commit (events, revision,
-- room scope checks). Only fields changed by that edit (title / artist) are
-- synced, so earlier approved spelling differences stay untouched.
-- Adds two functions only; no table, column, index or data change by itself.

create or replace function public.papa_catalog_sync_linked_songs(
 chosen_variant uuid, sync_fields text[], previous_title text, actor_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v papa_catalog_variants; link record; song jsonb; patch jsonb; next_title text; next_artist text;
 room_space text; synced int=0; conflicts int=0; failed int=0; family_updated boolean=false;
 rev bigint; actor jsonb; details jsonb='[]'::jsonb;
begin
 if chosen_variant is null or coalesce(actor_id,'')='' or sync_fields is null
  or exists(select 1 from unnest(sync_fields) f where f not in ('title','artist')) then
  raise exception 'CATALOG_SYNC_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 select * into v from papa_catalog_variants where id=chosen_variant;
 if not found then raise exception 'CATALOG_VARIANT_MISSING';end if;
 if cardinality(sync_fields)=0 then return jsonb_build_object('synced',0,'conflicts',0,'failed',0,'familyUpdated',false);end if;
 -- The work title follows when it still shows the previous master title or
 -- this is the family's only active version.
 if 'title'=any(sync_fields) then
  update papa_catalog_families f set title=v.title,updated_at=clock_timestamp()
   where f.id=v.family_id and f.title is distinct from v.title
    and (f.title=previous_title or (select count(*) from papa_catalog_variants x where x.family_id=f.id and x.active)<=1);
  family_updated=found;
 end if;
 for link in select l.streamer_id,l.song_id from papa_catalog_song_links l where l.variant_id=v.id order by l.streamer_id,l.song_id loop
  select data into song from papa_v2_entities where kind='songs' and id=link.song_id and data->>'streamer_id'=link.streamer_id;
  if song is null then continue;end if;
  next_title=case when 'title'=any(sync_fields) then v.title else song->>'title' end;
  next_artist=case when 'artist'=any(sync_fields) then coalesce(nullif(v.artist,''),'未分類') else song->>'artist' end;
  if next_title is not distinct from song->>'title' and next_artist is not distinct from song->>'artist' then continue;end if;
  -- Same rule as the songbook editor: one title+artist per room.
  if exists(select 1 from papa_v2_entities o where o.kind='songs' and o.id<>link.song_id
   and o.data->>'streamer_id'=link.streamer_id
   and papa_catalog_normalize(o.data->>'title')=papa_catalog_normalize(next_title)
   and papa_catalog_normalize(o.data->>'artist')=papa_catalog_normalize(next_artist)) then
   conflicts=conflicts+1;details=details||jsonb_build_object('streamerId',link.streamer_id,'songId',link.song_id,'result','conflict');continue;end if;
  select space_id into room_space from papa_space_streamers where streamer_id=link.streamer_id;
  patch=jsonb_build_object('songId',link.song_id,'streamer_id',link.streamer_id,'title',next_title,'artist',next_artist);
  actor=jsonb_build_object('role','super_admin','action','catalog_master_sync','streamer_id',link.streamer_id,
   'space_id',room_space,'catalog_actor',actor_id,'variant_id',v.id);
  begin
   select revision into rev from papa_v2_revision where id=1;
   perform papa_room_admin_commit(rev,jsonb_build_array(jsonb_build_object('kind','songs','id',link.song_id,'data',patch)),
    '[]'::jsonb,actor,'[]'::jsonb,link.streamer_id);
   -- The song index trigger re-queues a changed song; it is still the same
   -- approved link, now carrying the master text.
   update papa_catalog_candidates c set status='approved',reviewed_by=actor_id,reviewed_at=now(),updated_at=now()
    where c.streamer_id=link.streamer_id and c.song_id=link.song_id and c.status='pending'
     and exists(select 1 from papa_catalog_song_links l where l.streamer_id=c.streamer_id and l.song_id=c.song_id and l.variant_id=v.id);
   synced=synced+1;details=details||jsonb_build_object('streamerId',link.streamer_id,'songId',link.song_id,'result','synced');
  exception when others then
   failed=failed+1;details=details||jsonb_build_object('streamerId',link.streamer_id,'songId',link.song_id,'result','failed','error',left(sqlerrm,120));
  end;
 end loop;
 insert into papa_catalog_audit(actor_id,action,family_id,variant_id,details)
  values(actor_id,'master_sync',v.family_id,v.id,jsonb_build_object('fields',to_jsonb(sync_fields),'synced',synced,
   'conflicts',conflicts,'failed',failed,'familyUpdated',family_updated,'songs',details));
 return jsonb_build_object('synced',synced,'conflicts',conflicts,'failed',failed,'familyUpdated',family_updated);
end $$;

create or replace function public.papa_catalog_update_variant_synced(chosen_variant uuid, metadata jsonb,
 details jsonb, expected_version timestamptz, actor_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare before_row papa_catalog_variants; after_row papa_catalog_variants; result jsonb; fields text[]='{}';
begin
 select * into before_row from papa_catalog_variants where id=chosen_variant;
 if details is null then
  result=papa_catalog_governance('update_variant',array[chosen_variant],array[]::uuid[],null,metadata,
   jsonb_build_object(chosen_variant::text,expected_version),'{}'::jsonb,actor_id);
 else
  result=papa_catalog_update_variant_full(chosen_variant,metadata,details,expected_version,actor_id);
 end if;
 select * into after_row from papa_catalog_variants where id=chosen_variant;
 if after_row.title is distinct from before_row.title then fields=fields||'title'::text;end if;
 if after_row.artist is distinct from before_row.artist then fields=fields||'artist'::text;end if;
 return result||jsonb_build_object('sync',papa_catalog_sync_linked_songs(chosen_variant,fields,before_row.title,actor_id));
end $$;

revoke all on function public.papa_catalog_sync_linked_songs(uuid,text[],text,text) from public,anon,authenticated;
revoke all on function public.papa_catalog_update_variant_synced(uuid,jsonb,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.papa_catalog_sync_linked_songs(uuid,text[],text,text) to service_role;
grant execute on function public.papa_catalog_update_variant_synced(uuid,jsonb,jsonb,timestamptz,text) to service_role;
