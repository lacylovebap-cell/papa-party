-- LOCAL PROPOSAL ONLY. Not covered by the earlier additive-management approval.
-- Do not apply or call against production until the specific deletion scope is approved.
-- This deliberately fails closed on unreviewed relations and global player JSON.
-- No cascade, account deletion, Audit deletion, alias deletion or historical export.
begin;
create or replace function public.papa_test_streamer_delete_review(subject uuid,requested_space text,requested_streamer text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare room jsonb; meta jsonb; mapping public.papa_space_streamers; space_revision bigint; registry_revision bigint;
 dependencies jsonb='[]';blockers jsonb='[]';unreviewed jsonb='[]';r record;n bigint;column_name text;fingerprint text;
 known_test boolean;payload jsonb;
 safe_tables text[]=array['papa_spaces','papa_space_streamers','papa_accounts','papa_account_legacy_players',
  'papa_platform_roles','papa_manager_account_links','papa_v2_entities','papa_v2_revision','papa_management_audit'];
begin
 if subject is null or not exists(select 1 from public.papa_accounts where id=subject and disabled_at is null)
  or not exists(select 1 from public.papa_platform_roles where account_id=subject and role='president')
  or not exists(select 1 from public.papa_manager_account_links where account_id=subject and manager_key='president')
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if requested_space is null or requested_streamer is null or length(requested_space)>200 or length(requested_streamer)>200
 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 select * into mapping from public.papa_space_streamers where space_id=requested_space and streamer_id=requested_streamer;
 if not found then raise exception 'STREAMER_SCOPE_INVALID';end if;
 select management_revision into space_revision from public.papa_spaces where id=requested_space;
 select revision into registry_revision from public.papa_v2_revision where id=1;
 select data into meta from public.papa_v2_entities where kind='meta' and id='1';
 if (select count(*) from jsonb_array_elements(coalesce(meta->'streamers','[]')) x where x->>'id'=requested_streamer)<>1
 then raise exception 'STREAMER_DESCRIPTOR_INVALID';end if;
 select x into room from jsonb_array_elements(meta->'streamers') x where x->>'id'=requested_streamer;
 -- Stable, explicitly reviewed candidate IDs; a name containing 'test' grants nothing.
 known_test=requested_space='space-001' and requested_streamer=any(array[
  '17a9d873-e04c-4a6c-a453-cddb5b1caf65','ad54f563-6ce1-4b6d-984d-62e3f10089d1',
  'e25270a5-c9a4-4c10-acb0-dd00e728eb14','3bbcffdb-683c-42e3-8bc4-8fd1f539bf89',
  'd7468fa2-4f17-41f8-a087-76a3d1d76e6f','407ddd3b-ec07-484b-b628-286bf5103779']);
 if not known_test then blockers=blockers||jsonb_build_array('NOT_APPROVED_TEST_CANDIDATE');end if;
 if coalesce(room->'active','true') is distinct from 'false'::jsonb then blockers=blockers||jsonb_build_array('DISABLE_BEFORE_DELETE');end if;
 if mapping.archived_at is null then blockers=blockers||jsonb_build_array('ARCHIVE_BEFORE_DELETE');end if;
 -- Only canonical indexed room rows. Capped counts do not download business bodies.
 for r in select kind from unnest(array['songs','queue','ledger','crowns','cards','wishes']) kind loop
  select count(*) into n from(select 1 from public.papa_v2_entities where kind=r.kind and space_id=requested_space
   and data->>'streamer_id'=requested_streamer limit 1001) hits;
  dependencies=dependencies||jsonb_build_array(jsonb_build_object('relation','papa_v2_entities','kind',r.kind,'count',least(n,1000),'capped',n>1000));
  if n>0 then blockers=blockers||jsonb_build_array('BUSINESS_DATA:'||r.kind);end if;
 end loop;
 -- A global player's JSON may hold old per-streamer credits/favorites. Do not
 -- scan/export it, and never infer absence from the six operational kinds.
 if exists(select 1 from public.papa_v2_entities where kind='players' limit 1)
 then unreviewed=unreviewed||jsonb_build_array('GLOBAL_PLAYER_JSON_REFERENCES');end if;
 if exists(select 1 from public.papa_v2_entities where kind='meta' and id<>'1' limit 1)
 then unreviewed=unreviewed||jsonb_build_array('NONCANONICAL_METADATA_REFERENCES');end if;
 -- Table inventory makes future/unknown relations a blocker. Only recognized
 -- direct room-key relations are queried; historical JSON is never searched.
 for r in select c.relname,c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
  where ns.nspname='public' and c.relkind in ('r','p') and c.relname like 'papa\_%' escape '\' order by c.relname loop
  if r.relname=any(safe_tables) then continue;end if;
  column_name=null;
  if r.relname=any(array['papa_space_memberships','papa_events','papa_streamer_accounts','papa_streamer_login_attempts',
   'papa_song_favorites','papa_chat_messages','papa_chat_reads','papa_notifications','papa_notice_preferences','papa_push_subscriptions',
   'papa_public_route_streamers','papa_public_route_aliases','papa_public_route_audit','papa_player_extra_quotas',
   'papa_achievement_visibility','papa_achievement_awards','papa_achievement_draws','papa_achievement_request_draws',
   'papa_achievement_public_choices','papa_badge_show_settlements','papa_device_sessions','papa_player_activity',
   'papa_operation_receipts','papa_room_sync_revisions','papa_catalog_song_links','papa_catalog_candidates',
   'papa_catalog_lyric_selections','papa_catalog_private_notes','papa_catalog_language_filters','papa_catalog_language_filter_items',
   'papa_catalog_issue_reports']) then column_name='streamer_id';end if;
  if column_name is null or not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=r.oid
   and a.attname=column_name and not a.attisdropped and a.atttypid='text'::pg_catalog.regtype)
  then unreviewed=unreviewed||jsonb_build_array('RELATION:'||r.relname);continue;end if;
  execute format('select count(*) from(select 1 from public.%I where %I=$1 limit 1001) hits',r.relname,column_name) into n using requested_streamer;
  dependencies=dependencies||jsonb_build_array(jsonb_build_object('relation',r.relname,'count',least(n,1000),'capped',n>1000));
  if n>0 then blockers=blockers||jsonb_build_array('DEPENDENCY:'||r.relname);end if;
 end loop;
 -- Even a zero matching count does not establish absence of indirect FK, actor,
 -- target, JSON, backup, payment or storage references. Present those explicitly.
 for r in select distinct c.relname from pg_catalog.pg_constraint fk join pg_catalog.pg_class c on c.oid=fk.conrelid
  join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
  where fk.contype='f' and fk.confrelid='public.papa_space_streamers'::pg_catalog.regclass
   and ns.nspname<>'public' loop
  unreviewed=unreviewed||jsonb_build_array('EXTERNAL_FOREIGN_KEY:'||r.relname);
 end loop;
 if jsonb_array_length(unreviewed)>0 then blockers=blockers||jsonb_build_array('DEPENDENCY_REVIEW_INCOMPLETE');end if;
 fingerprint=md5(coalesce((select string_agg(c.relname||':'||a.attname||':'||a.atttypid::text,',' order by c.relname,a.attnum)
  from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where ns.nspname='public' and c.relkind in('r','p') and c.relname like 'papa\_%' escape '\'),''));
 payload=jsonb_build_object('spaceId',requested_space,'streamerId',requested_streamer,'name',room->>'display_name',
  'spaceRevision',space_revision,'registryRevision',registry_revision,'schemaFingerprint',fingerprint,
  'archivedAt',mapping.archived_at,'knownTestCandidate',known_test,'dependencies',dependencies,'blockers',blockers,'unreviewed',unreviewed,
  'safeToDelete',jsonb_array_length(blockers)=0,'requiresExplicitApproval',true,'permanentDeleteAuthorized',false,
  'before',jsonb_build_object('registryEntries',1,'spaceMappings',1),
  'after',jsonb_build_object('registryEntries',0,'spaceMappings',0),
  'preserved',jsonb_build_array('all player Accounts','all unrelated streamers','all business rows','all original Audit','all URL aliases'));
 return payload||jsonb_build_object('confirmationToken',md5(payload::text));
end $$;
revoke all on function public.papa_test_streamer_delete_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.papa_test_streamer_delete_review(uuid,text,text) to service_role;

-- Isolated-only prototype. It is intentionally NOT deployable as a production
-- deletion function: production execution always raises DELETE_PROTOTYPE_ONLY.
-- The final production migration must integrate confirmed indirect-reference
-- review and lock-order/concurrency validation before removing this guard.
create or replace function public.papa_test_streamer_delete_empty_prototype(subject uuid,operation uuid,
 requested_space text,requested_streamer text,confirmation_token text,confirmed_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare review jsonb;prior public.papa_management_audit;payload jsonb;meta jsonb;result jsonb;
begin
 if current_setting('papa.isolated_delete_fixture',true) is distinct from 'true' then raise exception 'DELETE_PROTOTYPE_ONLY';end if;
 if operation is null then raise exception 'DELETE_OPERATION_INVALID';end if;
 perform 1 from public.papa_accounts where id=subject and disabled_at is null for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_platform_roles where account_id=subject and role='president' for share;
 if not found or not exists(select 1 from public.papa_manager_account_links where account_id=subject and manager_key='president')
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(operation::text,0));
 payload=jsonb_build_object('spaceId',requested_space,'streamerId',requested_streamer,'confirmationToken',confirmation_token,'confirmedName',confirmed_name);
 select * into prior from public.papa_management_audit where operation_id=operation;
 if found then
  if prior.actor_account_id<>subject or prior.action<>'delete_empty_test_streamer' or prior.request_data is distinct from payload then raise exception 'OPERATION_CONFLICT';end if;
  return prior.after_data;
 end if;
 perform 1 from public.papa_v2_revision where id=1 for update;
 perform 1 from public.papa_spaces where id=requested_space for update;
 perform 1 from public.papa_space_streamers where space_id=requested_space and streamer_id=requested_streamer for update;
 lock table public.papa_v2_entities in share row exclusive mode;
 review=public.papa_test_streamer_delete_review(subject,requested_space,requested_streamer);
 if review->>'confirmationToken' is distinct from confirmation_token then raise exception 'DELETE_PREVIEW_STALE';end if;
 if review->>'name' is distinct from confirmed_name then raise exception 'DELETE_NAME_MISMATCH';end if;
 if review->'safeToDelete' is distinct from 'true'::jsonb then raise exception 'DELETE_DEPENDENCIES_PRESENT';end if;
 select data into meta from public.papa_v2_entities where kind='meta' and id='1' for update;
 meta=jsonb_set(meta,'{streamers}',coalesce((select jsonb_agg(x order by ord) from jsonb_array_elements(meta->'streamers')
  with ordinality r(x,ord) where x->>'id'<>requested_streamer),'[]'));
 meta=jsonb_set(meta,'{streamerSettings}',coalesce(meta->'streamerSettings','{}')-requested_streamer);
 update public.papa_v2_entities set data=meta where kind='meta' and id='1';
 delete from public.papa_space_streamers where space_id=requested_space and streamer_id=requested_streamer;
 update public.papa_spaces set management_revision=management_revision+1 where id=requested_space;
 update public.papa_v2_revision set revision=revision+1 where id=1;
 result=jsonb_build_object('deleted',true,'spaceId',requested_space,'streamerId',requested_streamer,'isolatedPrototype',true);
 insert into public.papa_management_audit(operation_id,actor_account_id,space_id,action,request_data,before_data,after_data)
 values(operation,subject,requested_space,'delete_empty_test_streamer',payload,review,result);
 return result;
end $$;
revoke all on function public.papa_test_streamer_delete_empty_prototype(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
-- No service_role EXECUTE grant for the prototype, even in a mistakenly applied proposal.
commit;
