-- Optional bounded, count-only investigation. READ ONLY: no functions, temp
-- tables, maintenance, mutations, player names, message bodies or Audit text.
-- This intentionally does NOT authorize deletion, even if all counts are zero.
-- Count values 1001 mean "at least 1001". Do not run on every UI render.
with candidates(id) as(values
 ('17a9d873-e04c-4a6c-a453-cddb5b1caf65'),('ad54f563-6ce1-4b6d-984d-62e3f10089d1'),
 ('e25270a5-c9a4-4c10-acb0-dd00e728eb14'),('3bbcffdb-683c-42e3-8bc4-8fd1f539bf89'),
 ('d7468fa2-4f17-41f8-a087-76a3d1d76e6f'),('407ddd3b-ec07-484b-b628-286bf5103779')),
 rooms as(select x from public.papa_v2_entities e cross join lateral jsonb_array_elements(e.data->'streamers') x
  where e.kind='meta' and e.id='1')
select m.space_id,c.id streamer_id,r.x->>'display_name' name,r.x->'active' active,m.archived_at,
 jsonb_build_object(
  'songs',(select count(*) from(select 1 from public.papa_v2_entities e where e.kind='songs' and e.space_id=m.space_id and e.data->>'streamer_id'=c.id limit 1001) hits),
  'queue',(select count(*) from(select 1 from public.papa_v2_entities e where e.kind='queue' and e.space_id=m.space_id and e.data->>'streamer_id'=c.id limit 1001) hits),
  'ledger',(select count(*) from(select 1 from public.papa_v2_entities e where e.kind='ledger' and e.space_id=m.space_id and e.data->>'streamer_id'=c.id limit 1001) hits),
  'crowns',(select count(*) from(select 1 from public.papa_v2_entities e where e.kind='crowns' and e.space_id=m.space_id and e.data->>'streamer_id'=c.id limit 1001) hits),
  'cards',(select count(*) from(select 1 from public.papa_v2_entities e where e.kind='cards' and e.space_id=m.space_id and e.data->>'streamer_id'=c.id limit 1001) hits),
  'wishes',(select count(*) from(select 1 from public.papa_v2_entities e where e.kind='wishes' and e.space_id=m.space_id and e.data->>'streamer_id'=c.id limit 1001) hits),
  'memberships',(select count(*) from(select 1 from public.papa_space_memberships e where e.streamer_id=c.id limit 1001) hits),
  'credentials',(select count(*) from public.papa_streamer_accounts e where e.streamer_id=c.id),
  'catalogLinks',(select count(*) from(select 1 from public.papa_catalog_song_links e where e.streamer_id=c.id limit 1001) hits),
  'favorites',(select count(*) from(select 1 from public.papa_song_favorites e where e.streamer_id=c.id limit 1001) hits),
  'awards',(select count(*) from(select 1 from public.papa_achievement_awards e where e.streamer_id=c.id limit 1001) hits),
  'chat',(select count(*) from(select 1 from public.papa_chat_messages e where e.streamer_id=c.id limit 1001) hits),
  'boardDirect',(select count(*) from(select 1 from public.papa_board_posts e where e.streamer_id=c.id limit 1001) hits),
  'notifications',(select count(*) from(select 1 from public.papa_notifications e where e.streamer_id=c.id limit 1001) hits),
  'auditDirect',(select count(*) from(select 1 from public.papa_events e where e.streamer_id=c.id limit 1001) hits),
  'routeAliases',(select count(*) from(select 1 from public.papa_public_route_aliases e where e.streamer_id=c.id limit 1001) hits)
 ) known_counts,
 false safe_to_delete,
 array['global player JSON','Audit actor references','board origin/targets/history','shared catalog audit/evidence',
  'payments and refunds','historical snapshots/backups','Storage paths','device and push links','other schema or indirect relations'] unreviewed
from candidates c left join public.papa_space_streamers m on m.streamer_id=c.id
left join rooms r on r.x->>'id'=c.id order by c.id;
