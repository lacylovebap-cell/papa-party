-- Explicit user confirmation: 風間駿 / 孫燕姿 / 聽見 is a typo for 遇見.
-- One stable song ID only; no historical queues, notifications or Audit rewrites.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
select revision from public.papa_v2_revision where id=1 for update;
do $$
declare song_key constant text='e0f30150-321e-4aca-8797-38abf93f7661';
 room_key constant text='53d61a59-0eb3-4f05-9fff-c3d1cd034e4d';
 old_hash constant text='2e31b33d844f88238d42ea36f76bc674';
 original jsonb;corrected jsonb;candidate record;link record;before_others text;after_others text;tip bigint;
begin
 select data into original from public.papa_v2_entities where kind='songs' and id=song_key and space_id='space-001' and data->>'streamer_id'=room_key for update;
 if original is null or md5(jsonb_set(original,'{title}','"聽見"')::text)<>old_hash or original->>'title' not in ('聽見','遇見') then raise exception 'CONFIRMED_SONG_CHANGED';end if;
 select l.* into link from public.papa_catalog_song_links l join public.papa_catalog_variants v on v.id=l.variant_id and v.active
  join public.papa_catalog_families f on f.id=v.family_id and f.active where l.streamer_id=room_key and l.song_id=song_key
  and l.source_hash=public.papa_catalog_source_hash(original) and v.id='d1f09fcb-b1bf-4555-be74-63dc8c6d041e' and v.title='遇見' and v.artist='孫燕姿' for update of l;
 if link.song_id is null then raise exception 'CONFIRMED_CATALOG_LINK_CHANGED';end if;
 if original->>'title'='遇見' then return;end if;
 select * into candidate from public.papa_catalog_candidates where streamer_id=room_key and song_id=song_key for update;
 if candidate.status is distinct from 'approved' or candidate.source_hash is distinct from link.source_hash then raise exception 'CONFIRMED_CANDIDATE_CHANGED';end if;
 select md5(coalesce(string_agg(md5(to_jsonb(e)::text),'|' order by kind,id),'')) into before_others from public.papa_v2_entities e where not(kind='songs' and id=song_key);
 select coalesce(max(id),0) into tip from public.papa_events;
 perform set_config('papa.actor_context',jsonb_build_object('role','system','action','song_title_correction','space_id','space-001','streamer_id',room_key,'reason','使用者確認原歌名誤植：聽見 → 遇見')::text,true);
 corrected=jsonb_set(original,'{title}','"遇見"');
 update public.papa_v2_entities set data=corrected where kind='songs' and id=song_key;
 update public.papa_catalog_song_links set source_hash=public.papa_catalog_source_hash(corrected) where streamer_id=room_key and song_id=song_key;
 -- The same approved variant remains linked. The indexing trigger refreshes
 -- candidate metadata; retain its existing review rather than reopening it.
 update public.papa_catalog_candidates set status=candidate.status,reviewed_by=candidate.reviewed_by,reviewed_at=candidate.reviewed_at
  where streamer_id=room_key and song_id=song_key and source_hash=public.papa_catalog_source_hash(corrected) and title='遇見';
 if not found then raise exception 'CONFIRMED_CANDIDATE_REFRESH_FAILED';end if;
 update public.papa_v2_revision set revision=revision+1 where id=1;
 select md5(coalesce(string_agg(md5(to_jsonb(e)::text),'|' order by kind,id),'')) into after_others from public.papa_v2_entities e where not(kind='songs' and id=song_key);
 if before_others is distinct from after_others or exists(select 1 from public.papa_v2_entities where kind='songs' and id=song_key and data is distinct from corrected)
  or (select count(*) from public.papa_events where id>tip)<>1
  or not exists(select 1 from public.papa_events where id>tip and entity_kind='songs' and entity_id=song_key and action='song_title_correction' and before_data->>'title'='聽見' and after_data->>'title'='遇見')
 then raise exception 'CONFIRMED_SONG_INTEGRITY_FAILED';end if;
end $$;
select jsonb_build_object('songId',e.id,'title',e.data->>'title','songIdUnchanged',e.data->>'songId'=e.id,
 'linkValid',l.source_hash=public.papa_catalog_source_hash(e.data),'variantId',l.variant_id,
 'revision',(select revision from public.papa_v2_revision where id=1)) result
from public.papa_v2_entities e join public.papa_catalog_song_links l on l.song_id=e.id and l.streamer_id=e.data->>'streamer_id'
where e.kind='songs' and e.id='e0f30150-321e-4aca-8797-38abf93f7661';
commit;
