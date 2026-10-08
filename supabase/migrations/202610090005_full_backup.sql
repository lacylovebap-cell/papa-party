begin;

-- Explicit, rare president export. Normal room reads never call this RPC.
-- Preserve the established private business backup (including legacy player
-- passwords); live access/refresh credentials and Push routing are excluded.
create function papa_president_full_backup(subject uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare snapshot jsonb;tables jsonb='{}';counts jsonb='{}';rows_json jsonb;table_name text;
 recovery_tables text[]=array[
  'papa_spaces','papa_space_streamers','papa_space_hostnames',
  'papa_accounts','papa_account_legacy_players','papa_manager_account_links',
  'papa_space_memberships','papa_platform_roles','papa_space_player_profiles',
  'papa_feature_registry','papa_space_entitlements','papa_account_entitlements','papa_space_policies',
  'papa_player_extra_quotas',
  'papa_catalog_languages','papa_catalog_performer_types','papa_catalog_families',
  'papa_catalog_variants','papa_catalog_song_links','papa_catalog_candidates',
  'papa_catalog_negative_decisions','papa_catalog_lyric_revisions','papa_catalog_lyric_selections',
  'papa_catalog_private_notes','papa_catalog_custom_archives','papa_catalog_lyric_proposals',
  'papa_catalog_language_filters','papa_catalog_language_filter_items',
  'papa_catalog_audit','papa_catalog_issue_reports',
  'papa_chat_messages','papa_chat_reads','papa_board_posts','papa_board_blocks','papa_board_history',
  'papa_events','papa_notifications'];
begin
 if subject is null or not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  or not exists(select 1 from papa_platform_roles where account_id=subject and role='president')
  or not exists(select 1 from papa_manager_account_links where account_id=subject and manager_key='president')
 then raise exception 'BACKUP_ACTOR_INVALID';end if;
 snapshot=papa_v2_snapshot();
 -- A fixed allowlist, not caller-supplied table names. One transactionally
 -- consistent database statement exports all necessary columns of these
 -- non-session tables, never a per-player/song request or fan-out write.
 foreach table_name in array recovery_tables loop
  if to_regclass('public.'||table_name) is null then raise exception 'BACKUP_SCHEMA_INCOMPLETE';end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(record)),''[]''::jsonb) from public.%I record',table_name) into rows_json;
  tables=jsonb_set(tables,array[table_name],rows_json);
  counts=jsonb_set(counts,array[table_name],to_jsonb(jsonb_array_length(rows_json)));
 end loop;
 -- Keep delivery preferences, never the capability channel/topic. Restoring
 -- preferences must generate new channels after creating fresh sessions.
 select coalesce(jsonb_agg(jsonb_build_object('streamer_id',streamer_id,'recipient',recipient,'preferences',preferences)),'[]'::jsonb)
 into rows_json from papa_notice_preferences;
 tables=jsonb_set(tables,'{papa_notice_preferences}',rows_json);
 counts=jsonb_set(counts,'{papa_notice_preferences}',to_jsonb(jsonb_array_length(rows_json)));
 return snapshot||jsonb_build_object('architecture',jsonb_build_object(
  'formatVersion',1,'exportedAt',now(),'tables',tables,'counts',counts,
  'manifest',jsonb_build_object(
   'entitySource','papa_v2_snapshot','tableOrder',to_jsonb(recovery_tables||'papa_notice_preferences'::text),
   'privateBusinessData',true,
   'excluded',jsonb_build_array('device/access/refresh sessions and token hashes',
    'manager password hashes and external authentication credentials',
    'Push subscriptions, endpoints, keys, jobs and device deliveries',
    'installation preferences and notification capability channels',
    'notice configuration secrets and historical release-backup archives',
    'external binary media (business rows retain their URLs)'),
   'restoreRequirements',jsonb_build_array(
    'Explicit privileged restoration with foreign-key ordering; this export does not execute a restore.',
    'Restore original business IDs, Account/Membership bindings and catalog IDs; never match players by name.',
    'Reset identity sequences after restoring explicit audit/history IDs.',
    'Reconfigure manager authentication and create fresh device sessions/Push subscriptions.',
    'Revalidate custom hostnames and media availability before activating restored routes.'))));
end $$;
revoke all on function papa_president_full_backup(uuid) from public,anon,authenticated;
grant execute on function papa_president_full_backup(uuid) to service_role;
notify pgrst,'reload schema';
commit;
