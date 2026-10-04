begin;
-- Room lyric reads use the same valid-link definition as the metadata projection
-- and lyric search. A locally edited song needs review before inheriting common
-- lyrics again; the streamer's own/copy body and private notes remain available.
create or replace function public.papa_catalog_get_lyrics(variant_id uuid default null,room_id text default null,
 song_id text default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare vid uuid=variant_id; selection papa_catalog_lyric_selections; own_note text='';
 source_song jsonb; lyric_body text; rev int; selected_mode text;
begin
 if coalesce(room_id,'')<>'' and coalesce(song_id,'')<>'' then
  select data into source_song from papa_v2_entities where kind='songs' and id=song_id
   and data->>'streamer_id'=room_id;
  if source_song is null then raise exception 'CATALOG_SONG_MISSING';end if;
  select sl.variant_id into vid from papa_catalog_song_links sl
   join papa_catalog_variants v on v.id=sl.variant_id and v.active
   join papa_catalog_families f on f.id=v.family_id and f.active
   where sl.streamer_id=room_id and sl.song_id=papa_catalog_get_lyrics.song_id
    and sl.source_hash=papa_catalog_source_hash(source_song);
  select * into selection from papa_catalog_lyric_selections s
   where s.streamer_id=room_id and s.song_id=papa_catalog_get_lyrics.song_id;
  select n.body into own_note from papa_catalog_private_notes n
   where n.streamer_id=room_id and n.song_id=papa_catalog_get_lyrics.song_id;
  if selection.mode in ('copy','own') then
   return jsonb_build_object('body',selection.body,'revision',null,'mode',selection.mode,
    'privateNote',coalesce(own_note,''),'variantId',vid);
  end if;
  if vid is null then
   return jsonb_build_object('body',coalesce(source_song->>'lyrics',''),'revision',null,
    'mode','own','privateNote',coalesce(own_note,''),'variantId',null);
  end if;
  selected_mode='shared';
 elsif vid is null then
  raise exception 'CATALOG_LYRIC_INVALID';
 end if;
 select r.body,r.revision into lyric_body,rev from papa_catalog_lyric_revisions r
  where r.variant_id=vid and r.active;
 return jsonb_build_object('body',coalesce(lyric_body,''),'revision',rev,
  'mode',coalesce(selected_mode,'shared'),'privateNote',coalesce(own_note,''),'variantId',vid);
end $$;
revoke all on function public.papa_catalog_get_lyrics(uuid,text,text) from public,anon,authenticated;
grant execute on function public.papa_catalog_get_lyrics(uuid,text,text) to service_role;
commit;
