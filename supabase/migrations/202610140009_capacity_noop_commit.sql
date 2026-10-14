-- Authorized for WEB.5 deployment on 2026-10-14. No existing rows rewritten.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
create or replace function public.papa_v2_commit(expected bigint,changes jsonb,removed jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare current_version bigint; r jsonb;
begin
 select revision into current_version from papa_v2_revision where id=1 for update;
 if current_version <> expected then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 for r in select value from jsonb_array_elements(changes) loop
  insert into papa_v2_entities(kind,id,data) values(r->>'kind',r->>'id',r->'data')
  on conflict(kind,id) do update set data=excluded.data
   where papa_v2_entities.data is distinct from excluded.data;
 end loop;
 for r in select value from jsonb_array_elements(removed) loop
  delete from papa_v2_entities where kind=r->>'kind' and id=r->>'id';
 end loop;
 -- Keep the existing concurrency token and enclosing notices/receipts contract.
 update papa_v2_revision set revision=current_version+1 where id=1;
 return current_version+1;
end $$;
revoke all on function public.papa_v2_commit(bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.papa_v2_commit(bigint,jsonb,jsonb) to service_role;
commit;
