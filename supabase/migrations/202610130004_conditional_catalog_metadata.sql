begin;

-- Only reduce transfer of an existing projection. Compute its exact signature
-- and rows in the same read snapshot; diagnostic revision heads are not used.
-- No cache of accounting, authorization, songs or player/queue state.
create function public.papa_catalog_song_metadata_conditional(room_id text, known_signature text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare chosen_space text; rows jsonb; signature text;
begin
 select scope.space_id into chosen_space from public.papa_space_streamers scope
 join public.papa_spaces space on space.id=scope.space_id and space.status='active'
 where scope.streamer_id=room_id;
 if chosen_space is null then raise exception 'CATALOG_METADATA_SCOPE_INVALID'; end if;
 rows=public.papa_catalog_song_metadata_in_space(room_id);
 signature=encode(sha256(convert_to(jsonb_build_object('version',1,'spaceId',chosen_space,
  'roomId',room_id,'rows',rows)::text,'UTF8')),'hex');
 if known_signature=signature then
  return jsonb_build_object('spaceId',chosen_space,'roomId',room_id,'signature',signature,'unchanged',true);
 end if;
 return jsonb_build_object('spaceId',chosen_space,'roomId',room_id,'signature',signature,'unchanged',false,'rows',rows);
end $$;
revoke all on function public.papa_catalog_song_metadata_conditional(text,text) from public,anon,authenticated;
grant execute on function public.papa_catalog_song_metadata_conditional(text,text) to service_role;

-- Existing metadata RPC and all business functions, tables and permissions stay intact.
notify pgrst,'reload schema';
commit;
