-- REVIEW ONLY: explicit production approval required. Function definition only, no row restore.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
CREATE OR REPLACE FUNCTION public.papa_v2_commit(expected bigint, changes jsonb, removed jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare current_version bigint; r jsonb;
begin
 select revision into current_version from papa_v2_revision where id=1 for update;
 if current_version <> expected then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 for r in select value from jsonb_array_elements(changes) loop
  insert into papa_v2_entities(kind,id,data) values(r->>'kind',r->>'id',r->'data') on conflict(kind,id) do update set data=excluded.data;
 end loop;
 for r in select value from jsonb_array_elements(removed) loop
  delete from papa_v2_entities where kind=r->>'kind' and id=r->>'id';
 end loop;
 update papa_v2_revision set revision=current_version+1 where id=1;
 return current_version+1;
end $function$
;
revoke all on function public.papa_v2_commit(bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.papa_v2_commit(bigint,jsonb,jsonb) to service_role;
commit;
