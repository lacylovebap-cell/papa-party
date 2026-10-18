begin;
-- The same validated shared title/artist used by the songbook, for selected IDs
-- only. No song, link, queue, accounting or historical Audit row is rewritten.
create function public.papa_catalog_request_metadata(requested_space text,requested_room text,selected_song_ids text[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if requested_space is null or requested_room is null or selected_song_ids is null
  or cardinality(selected_song_ids) not between 1 and 100
  or exists(select 1 from unnest(selected_song_ids) id where id is null or length(id) not between 1 and 200)
  or cardinality(selected_song_ids)<>(select count(distinct id) from unnest(selected_song_ids) id)
 then raise exception 'CATALOG_REQUEST_INPUT_INVALID';end if;
 if not exists(select 1 from public.papa_space_streamers r join public.papa_spaces s on s.id=r.space_id and s.status='active'
  where r.streamer_id=requested_room and r.space_id=requested_space) then raise exception 'CATALOG_REQUEST_SCOPE_INVALID';end if;
 select coalesce(jsonb_agg(jsonb_build_object('songId',e.id,'title',coalesce(v.title,e.data->>'title'),
  'artist',coalesce(v.artist,e.data->>'artist','')) order by e.id),'[]') into result
 from public.papa_v2_entities e
 left join public.papa_catalog_song_links l on l.streamer_id=requested_room and l.song_id=e.id
  and l.source_hash=public.papa_catalog_source_hash(e.data)
 left join public.papa_catalog_variants v on v.id=l.variant_id and v.active
  and exists(select 1 from public.papa_catalog_families f where f.id=v.family_id and f.active)
 where e.kind='songs' and e.space_id=requested_space and e.data->>'streamer_id'=requested_room and e.id=any(selected_song_ids);
 return jsonb_build_object('version',1,'scope',jsonb_build_object('spaceId',requested_space,'roomId',requested_room),
  'revision',(select revision from public.papa_v2_revision where id=1),'songs',result);
end $$;
revoke all on function public.papa_catalog_request_metadata(text,text,text[]) from public,anon,authenticated;
grant execute on function public.papa_catalog_request_metadata(text,text,text[]) to service_role;

-- New failed-request facts use the exact same identity as a successful request.
-- Preserve hourly deduplication and every previously recorded failure.
create or replace function public.papa_record_failed_request(room_id text,player_id text,song_id text,bucket bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare inserted_id bigint;s text;song record;
begin
 select space_id into s from public.papa_space_streamers where streamer_id=room_id;
 if s is null or not public.papa_achievement_player_valid(s,player_id,true) then raise exception 'FAILED_REQUEST_SCOPE_INVALID';end if;
 select item->>'title' title,item->>'artist' artist into song from jsonb_array_elements(
  public.papa_catalog_request_metadata(s,room_id,array[song_id])->'songs') item;
 if not found or bucket not between floor(extract(epoch from now())/3600)-1 and floor(extract(epoch from now())/3600)
 then raise exception 'FAILED_REQUEST_INVALID';end if;
 insert into public.papa_events(streamer_id,space_id,entity_kind,entity_id,action,actor_role,actor_player_id,effective_at,hour_bucket,after_data)
 values(room_id,s,'queue',song_id,'request_failed','player',player_id,now()::text,bucket,
  jsonb_build_object('songId',song_id,'title',song.title,'artist',song.artist,'reason','hourly_limit'))
 on conflict do nothing returning id into inserted_id;
 return inserted_id is not null;
end $$;
notify pgrst,'reload schema';
commit;
