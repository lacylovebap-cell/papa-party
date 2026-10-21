-- Approved and applied on 2026-10-21: display metadata only; UUIDs preserved.
-- Numbers never re-use a deleted account's number and never change on sorting.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.papa_accounts add column if not exists display_number bigint generated always as identity;
revoke all on sequence public.papa_accounts_display_number_seq from public,anon,authenticated;
create unique index if not exists papa_accounts_display_number_key on public.papa_accounts(display_number);
-- Read only on demand by the authenticated platform-president Edge handler.
create or replace function public.papa_management_account_numbers(subject uuid,requested_accounts uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.papa_accounts a join public.papa_platform_roles r on r.account_id=a.id and r.role='president'
  join public.papa_manager_account_links l on l.account_id=a.id and l.manager_key='president' where a.id=subject and a.disabled_at is null)
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if requested_accounts is null or cardinality(requested_accounts)>20 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 return (select coalesce(jsonb_object_agg(a.id::text,lpad(a.display_number::text,greatest(3,length(a.display_number::text)),'0')),'{}'::jsonb)
  from public.papa_accounts a where a.id=any(requested_accounts));
end;$$;
revoke all on function public.papa_management_account_numbers(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.papa_management_account_numbers(uuid,uuid[]) to service_role;
commit;
