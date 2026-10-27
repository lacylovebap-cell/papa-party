-- Read-only preflight for 20261028041500_management_accounts_and_deletion.sql.
-- Safe to run on production: SELECT only, no locks beyond ordinary reads.
-- Every *_ok column must be true before the migration is applied.
select
 to_regclass('public.papa_management_audit') is not null as audit_table_ok,
 to_regclass('public.papa_space_streamers') is not null as mapping_table_ok,
 to_regclass('public.papa_space_memberships') is not null as membership_table_ok,
 to_regclass('public.papa_manager_account_links') is not null as manager_links_ok,
 to_regclass('public.papa_streamer_accounts') is not null as streamer_logins_ok,
 to_regclass('public.papa_public_route_spaces') is not null as public_routes_ok,
 to_regprocedure('public.papa_release_b_commit(bigint,jsonb,jsonb,jsonb,jsonb)') is not null as business_commit_ok,
 to_regprocedure('public.papa_manage_streamer_login(text,text,boolean,text)') is not null as streamer_login_fn_ok,
 to_regprocedure('public.papa_manage_space(uuid,uuid,text,jsonb)') is not null as manage_space_ok,
 to_regprocedure('public.papa_space_center_directory(uuid,text,text,integer,text)') is not null as space_directory_ok,
 to_regprocedure('public.papa_public_route_home(text,text,text)') is not null as route_home_ok,
 exists(select 1 from pg_extension where extname='pgcrypto') as pgcrypto_ok,
 exists(select 1 from public.papa_platform_roles r join public.papa_manager_account_links l on l.account_id=r.account_id and l.manager_key='president'
  join public.papa_accounts a on a.id=r.account_id and a.disabled_at is null where r.role='president') as president_link_ok,
 not exists(select 1 from information_schema.columns where table_schema='public' and table_name='papa_spaces' and column_name='deleted_at') as not_yet_applied;

-- Current counts, to compare after the migration (expected: unchanged).
select (select count(*) from public.papa_spaces) spaces,(select count(*) from public.papa_space_streamers) mappings,
 (select count(*) from public.papa_streamer_accounts) streamer_logins,(select count(*) from public.papa_accounts) accounts,
 (select count(*) from public.papa_space_memberships) memberships,(select count(*) from public.papa_management_audit) management_audit,
 (select count(*) from public.papa_v2_entities) entities,(select revision from public.papa_v2_revision where id=1) registry_revision;

-- Why each Space is or is not operational (仙女 is expected: suspended, provisioning_pending=true, streamers=0).
select s.id,s.display_name,s.status,s.tenant_kind,
 exists(select 1 from public.papa_management_audit a where a.space_id=s.id and a.action='create') as provisioning_pending,
 (select count(*) from public.papa_space_streamers m where m.space_id=s.id) as streamers
from public.papa_spaces s order by s.created_at;
