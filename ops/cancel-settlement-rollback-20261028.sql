-- Rollback for 20261028170000_cancel_settlement_native_guard.sql.
-- Removes `cancel_settlement` from the native player cancel field lists again.
-- Only needed if the Edge goes back to 10.28-ADMIN.4; existing queue rows that
-- already carry cancel_settlement stay as they are (display-only field).
do $rollback$
declare
 fn oid;
 cur text;
 with_field constant text := $$'allocationReturnedCredits','cancel_settlement','updated_at','effective_at','created_at']$$;
 without_field constant text := $$'allocationReturnedCredits','updated_at','effective_at','created_at']$$;
begin
 select p.oid into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='papa_room_native_commit_platform_ids_original';
 cur := pg_get_functiondef(fn);
 if (length(cur)-length(replace(cur,with_field,'')))/length(with_field) <> 2 then
  raise exception 'expected exactly two cancel field lists containing cancel_settlement';
 end if;
 execute replace(cur,with_field,without_field);
 if md5(pg_get_functiondef(fn)) <> 'c74531c7b4d56585aae4335bc6ebd434' then
  raise exception 'rollback did not restore the reviewed definition';
 end if;
end
$rollback$;
