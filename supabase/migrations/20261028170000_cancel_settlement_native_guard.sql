-- 10.28-CANCEL.1: every cancellation now stores a read-only `cancel_settlement`
-- snapshot on the queue row (what was released, from which source, once).
-- The native-room player guard only lets a player's own cancel touch a fixed
-- list of queue fields, so add that one field to both copies of the list.
-- Nothing else in the function changes; the replacement is verified against the
-- exact production definition before it runs, and aborts on any mismatch.
do $migration$
declare
 fn oid;
 old_def text;
 new_def text;
 old_list constant text := $$'allocationReturnedCredits','updated_at','effective_at','created_at']$$;
 new_list constant text := $$'allocationReturnedCredits','cancel_settlement','updated_at','effective_at','created_at']$$;
begin
 select p.oid into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='papa_room_native_commit_platform_ids_original';
 old_def := pg_get_functiondef(fn);
 if position('cancel_settlement' in old_def)>0 then
  raise notice 'cancel_settlement already allowed; nothing to do';
  return;
 end if;
 if md5(old_def) <> 'c74531c7b4d56585aae4335bc6ebd434' then
  raise exception 'papa_room_native_commit_platform_ids_original differs from the reviewed definition';
 end if;
 if (length(old_def)-length(replace(old_def,old_list,'')))/length(old_list) <> 2 then
  raise exception 'expected exactly two cancel field lists';
 end if;
 new_def := replace(old_def,old_list,new_list);
 execute new_def;
end
$migration$;
