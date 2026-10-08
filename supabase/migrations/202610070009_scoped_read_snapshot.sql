begin;

-- Additive read path. Mutation, login and backup still use the complete
-- snapshot; an ordinary room view transfers only that room's business rows.
create index papa_entity_room_read on public.papa_v2_entities
 (space_id,kind,(data->>'streamer_id'),id)
 where kind in ('songs','ledger','queue','crowns','cards','wishes');

create function public.papa_v2_scoped_read_snapshot(requested_room text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room_id text; room_space text; result jsonb;
begin
 select room->>'id' into room_id from public.papa_v2_entities e
 cross join lateral jsonb_array_elements(
  case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers'
   else '[]'::jsonb end) room
 where e.kind='meta' and e.id='1'
  and (room->>'id'=requested_room or room->>'slug'=requested_room)
 limit 1;
 select space_id into room_space from public.papa_space_streamers
 where streamer_id=room_id;
 if room_id is null or room_space is null
 then raise exception 'UNKNOWN_STREAMER_SPACE'; end if;
 select jsonb_build_object('revision',(select revision from public.papa_v2_revision where id=1),
  'rows',coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'id',e.id,'data',
   case when e.kind='songs' then e.data-array[
    'lyrics','lyricNotes','privateNote','privateNotes','lyricHistory','lyricsHistory']
   else e.data end)),'[]'::jsonb))
 into result from public.papa_v2_entities e
 where e.kind in ('meta','settings','players')
  or (e.space_id=room_space and e.kind in
   ('songs','ledger','queue','crowns','cards','wishes')
   and e.data->>'streamer_id'=room_id);
 return result;
end $$;
revoke all on function public.papa_v2_scoped_read_snapshot(text)
 from public,anon,authenticated;
grant execute on function public.papa_v2_scoped_read_snapshot(text)
 to service_role;

commit;
