begin read only;
set local statement_timeout='8s';
-- REVIEW ONLY. No export of row bodies, writes, deletes or table maintenance.
-- Frozen historical window plus ID bounds prevents newly backdated events
-- from silently expanding a previously reviewed batch.
with historical_window as materialized (
 select e.id,e.streamer_id,e.entity_kind,e.entity_id,e.action,e.actor_role,e.actor_player_id,e.created_at,e.effective_at,e.before_data,e.after_data,e.hour_bucket,e.actor_account_id,e.actor_streamer_id,e.actor_display_name_snapshot,e.target_player_id,e.target_player_name_snapshot,e.space_id from public.papa_events e
 where e.id between 279016 and 325138
  and e.created_at>='2026-10-09 11:00:00+00'::timestamptz
  and e.created_at<'2026-10-09 15:00:00+00'::timestamptz
  and e.entity_kind='songs' and (e.space_id='space-001' or e.space_id is null)
), candidates as materialized (
 select e.id,e.streamer_id,e.entity_kind,e.entity_id,e.action,e.actor_role,e.actor_player_id,e.created_at,e.effective_at,e.before_data,e.after_data,e.hour_bucket,e.actor_account_id,e.actor_streamer_id,e.actor_display_name_snapshot,e.target_player_id,e.target_player_name_snapshot,e.space_id from historical_window e
 where jsonb_typeof(e.before_data)='object' and jsonb_typeof(e.after_data)='object'
  and exists(select 1 from public.papa_space_streamers r
   where r.streamer_id=e.streamer_id and r.space_id='space-001')
  and e.before_data->>'songId'=e.entity_id and e.after_data->>'songId'=e.entity_id
  and e.before_data->>'streamer_id'=e.streamer_id and e.after_data->>'streamer_id'=e.streamer_id
  and jsonb_typeof(e.before_data->'_order')='number' and jsonb_typeof(e.after_data->'_order')='number'
  and e.before_data->'_order' is distinct from e.after_data->'_order'
  and not e.before_data ? 'songSnapshot'
  and e.after_data->'songSnapshot'=jsonb_build_object('title',e.before_data->'title','artist',e.before_data->'artist')
  and e.before_data-'_order'=e.after_data-array['_order','songSnapshot']
), scopes as (
 select space_id recorded_space_id,streamer_id,case when space_id is null then 'legacy_scope_unconfirmed' else 'explicit_space' end scope_evidence,count(*) rows,min(id) first_id,max(id) last_id,
  sum(coalesce(pg_column_size(before_data),0)+coalesce(pg_column_size(after_data),0)) payload_bytes,
  encode(sha256(convert_to(string_agg(id::text,',' order by id),'UTF8')),'hex') ids_sha256
 from candidates group by space_id,streamer_id
)
select jsonb_build_object('review_version',1,'window_start_taipei','2026-10-09 19:00:00',
 'window_end_taipei_exclusive','2026-10-09 23:00:00','window_first_id',279016,'window_last_id',325138,
 'candidate_rows',(select count(*) from candidates),
 'eligible_rows',(select count(*) from candidates where space_id='space-001'),
 'legacy_scope_review_rows',(select count(*) from candidates where space_id is null),
 'rejected_song_rows',(select count(*) from historical_window)-(select count(*) from candidates),
 'payload_bytes',(select sum(coalesce(pg_column_size(before_data),0)+coalesce(pg_column_size(after_data),0)) from candidates),
 'export_json_text_bytes',(select sum(octet_length(to_jsonb(c)::text)+1) from candidates c),
 'scopes',(select jsonb_agg(to_jsonb(s) order by streamer_id) from scopes s),
 'excluded_kinds',jsonb_build_array('ledger','queue','players','meta','cards','crowns','wishes','shared_catalog'),
 'data_changed',false,'exported',false) review;
commit;
