begin;
-- Ordinary read has no use for lyric bodies. Strip them before Database -> Edge
-- transfer, while mutations and explicit backups keep the original snapshot RPC.
create or replace function public.papa_v2_read_snapshot() returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('revision',(select revision from papa_v2_revision where id=1),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',id,'data',
    case when kind='songs' then data-array['lyrics','lyricNotes','privateNote','privateNotes','lyricHistory','lyricsHistory'] else data end))
   from papa_v2_entities),'[]'::jsonb));
$$;
revoke all on function public.papa_v2_read_snapshot() from public,anon,authenticated;
grant execute on function public.papa_v2_read_snapshot() to service_role;
commit;
