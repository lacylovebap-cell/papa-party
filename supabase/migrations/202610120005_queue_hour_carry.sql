begin;
-- New completed live requests can explicitly consume the hour they carried into.
-- No historical requests, ledger rows, event payloads or identities are rewritten.
create function public.papa_queue_uses_quota(record_data jsonb)
returns boolean language sql immutable set search_path=public as $$
 select coalesce(record_data->>'kind'='saved' or
  record_data->>'kind'='live' and record_data->>'status'='completed'
   and record_data->'quota_carried'='true'::jsonb,false);
$$;
revoke all on function public.papa_queue_uses_quota(jsonb) from public,anon,authenticated,service_role;

-- Preserve the installed function bodies and privileges, changing only the
-- eligibility predicate. Fail closed if the expected released definition drifted.
do $patch$
declare signature text;definition text;patched text;
begin
 foreach signature in array array[
  'public.papa_extra_quota_snapshot_metadata(jsonb,text,text,text)',
  'public.papa_player_streamer_summary(text,jsonb,integer,integer)'] loop
  definition=pg_get_functiondef(signature::regprocedure);
  patched=replace(definition,'queue.data->>''kind''=''saved''','public.papa_queue_uses_quota(queue.data)');
  patched=replace(patched,'data->>''kind''=''saved''','public.papa_queue_uses_quota(data)');
  if patched=definition then raise exception 'CARRY_READ_DEFINITION_CHANGED: %',signature;end if;
  execute patched;
 end loop;
end $patch$;
commit;

