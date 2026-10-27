-- Rollback for 20261028041500_management_accounts_and_deletion.sql.
-- Run only if the release must be withdrawn. It removes the new functions,
-- guards and grants and restores the 2026-10-26 space directory text.
-- It deliberately KEEPS papa_management_deletions and the deleted_at columns:
-- they are the history of any deletion already performed. No business, player,
-- Audit or credential row is changed by this rollback.
-- Note: after rollback the restored directory no longer hides deleted
-- tombstones; a deleted Space would reappear as a suspended Space.
begin;
set local lock_timeout='3s';
drop trigger if exists papa_entity_tombstone_guard on public.papa_v2_entities;
drop trigger if exists papa_space_tombstone_guard on public.papa_spaces;
drop trigger if exists papa_space_streamer_tombstone_guard on public.papa_space_streamers;
drop trigger if exists papa_space_membership_tombstone_guard on public.papa_space_memberships;
drop function if exists public.papa_management_provision_streamer(uuid,uuid,jsonb,text,text);
drop function if exists public.papa_management_streamer_login(uuid,uuid,jsonb,text,text);
drop function if exists public.papa_management_streamer_login_status(uuid,text,text);
drop function if exists public.papa_management_account_list(uuid,text,integer);
drop function if exists public.papa_management_delete(uuid,uuid,jsonb);
drop function if exists public.papa_management_remove_streamer(uuid,text,text);
drop function if exists public.papa_management_delete_review(uuid,text,text);
drop function if exists public.papa_management_space_readiness(uuid,text);
drop function if exists public.papa_management_relation_count(text,text,text,text);
drop function if exists public.papa_management_registry_write(uuid,text,jsonb,jsonb,bigint);
drop function if exists public.papa_management_streamer_account(text,text,boolean);
drop function if exists public.papa_management_login_reason(jsonb);
drop function if exists public.papa_management_registry_room(text);
drop function if exists public.papa_management_is_president(uuid);
drop function if exists public.papa_entity_tombstone_guard();
drop function if exists public.papa_space_tombstone_guard();
create or replace function public.papa_space_center_directory(subject uuid,category text default 'all',search_text text default '',requested_page integer default 1,requested_space text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.papa_accounts a join public.papa_platform_roles r on r.account_id=a.id where a.id=subject and a.disabled_at is null and r.role='president') then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if category is null or category not in ('all','hall','independent') or search_text is null or length(search_text)>100 or requested_page is null or requested_page<1 or requested_page>100000 or length(requested_space)>200 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 if requested_space is not null and not exists(select 1 from public.papa_spaces where id=requested_space) then raise exception 'SPACE_NOT_FOUND';end if;
 with registry as materialized (
  select r.value room from public.papa_v2_entities e cross join lateral jsonb_array_elements(case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) r(value) where e.kind='meta' and e.id='1'
 ), spaces as materialized (
  select s.*,coalesce(s.tenant_kind,case when s.id='space-001' and c.layout='flat' then 'hall' end) effective_kind,c.code,c.layout
  from public.papa_spaces s left join public.papa_public_route_spaces c on c.space_id=s.id
 ), hosts as materialized (
  select m.space_id,m.streamer_id,jsonb_build_object('id',m.streamer_id,'slug',r.room->>'slug','display_name',r.room->>'display_name','home_title',r.room->>'home_title','subtitle',r.room->>'subtitle','active',coalesce((r.room->>'active')::boolean,true)) descriptor,coalesce(r.room->>'display_name','未命名主播') name,r.room->>'slug' slug,
   coalesce((r.room->>'active')::boolean,true) active,m.archived_at,p.code public_code,
   case when c.code is not null and p.code is not null then public.papa_public_route_home(c.layout,c.code,p.code) end home_path,
   exists(select 1 from public.papa_streamer_accounts a where a.streamer_id=m.streamer_id and a.enabled) login_enabled
  from public.papa_space_streamers m join registry r on r.room->>'id'=m.streamer_id
  left join public.papa_public_route_spaces c on c.space_id=m.space_id
  left join public.papa_public_route_streamers p on p.space_id=m.space_id and p.streamer_id=m.streamer_id
 ), managers as materialized (
  -- One Account may hold several roles. Expose only its display name, never
  -- credentials or the player's full profile, and count it once per Space.
  select distinct m.space_id,m.account_id,
   coalesce(nullif(p.data->>'name',''),case when l.manager_key='president' then '平台總裁'
    when l.manager_key like 'streamer:%' then (select nullif(r.room->>'display_name','') from registry r where r.room->>'id'=substr(l.manager_key,10) limit 1) end,'未命名管理帳號') name
  from public.papa_space_memberships m join public.papa_accounts a on a.id=m.account_id and a.disabled_at is null
  left join public.papa_manager_account_links l on l.account_id=m.account_id
  left join public.papa_account_legacy_players b on b.account_id=m.account_id
  left join public.papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
  where m.role in ('space_admin','streamer_admin') and m.status='active'
 ), candidates as (
  select s.id key,s.display_name name,jsonb_build_object('id',s.id,'name',s.display_name,'kind',s.effective_kind,'status',s.status,'revision',s.management_revision,
   'classificationSource',case when s.tenant_kind is null then 'legacy_route' else 'explicit' end,
   'homePath',case when s.layout in ('flat','hall') then '/'||s.code end,
   'hostCount',(select count(*) from hosts h where h.space_id=s.id),
   'managerCount',(select count(*) from managers m where m.space_id=s.id),
   'managers',coalesce((select jsonb_agg(jsonb_build_object('accountId',m.account_id,'name',m.name) order by m.name,m.account_id)
    from (select * from managers where space_id=s.id order by name,account_id limit 6) m),'[]'::jsonb),
   'hosts',coalesce((select jsonb_agg(jsonb_build_object('id',h.streamer_id,'spaceId',h.space_id,'spaceName',s.display_name,'name',h.name,'slug',h.slug,'active',h.active,'archivedAt',h.archived_at,'homePath',h.home_path,'loginEnabled',h.login_enabled,'descriptor',h.descriptor) order by h.name,h.streamer_id) from (select * from hosts where space_id=s.id order by name,streamer_id limit 12) h),'[]'::jsonb)) row
  from spaces s where requested_space is null and (category='all' or s.effective_kind=category)
   and (strpos(lower(s.display_name),lower(search_text))>0 or strpos(lower(s.code),lower(search_text))>0
    or exists(select 1 from hosts h where h.space_id=s.id and (strpos(lower(h.name),lower(search_text))>0 or strpos(lower(h.public_code),lower(search_text))>0 or strpos(lower(h.slug),lower(search_text))>0)))
  union all
  select h.streamer_id,h.name,jsonb_build_object('id',h.streamer_id,'kind','streamer','spaceId',h.space_id,'spaceName',s.display_name,'name',h.name,'slug',h.slug,'active',h.active,'archivedAt',h.archived_at,'homePath',h.home_path,'loginEnabled',h.login_enabled,'descriptor',h.descriptor)
  from hosts h join spaces s on s.id=h.space_id where requested_space is not null and h.space_id=requested_space
   and (strpos(lower(h.name),lower(search_text))>0 or strpos(lower(h.public_code),lower(search_text))>0 or strpos(lower(h.slug),lower(search_text))>0)
 ), counted as (select count(*)::integer total from candidates),chosen as (select total,least(requested_page,greatest(1,(total+19)/20)) page from counted),
 paged as (select * from candidates order by name,key limit 20 offset ((select page from chosen)-1)*20)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row order by name,key) from paged),'[]'::jsonb),'total',total,'page',page,'pages',greatest(1,(total+19)/20),
  'summary',jsonb_build_object('halls',(select count(*) from spaces where effective_kind='hall'),'streamerSpaces',(select count(*) from hosts),'pendingSetup',(select count(*) from spaces s where s.status<>'active' or not exists(select 1 from hosts h where h.space_id=s.id))),
  'scope',requested_space,'registryRevision',(select revision from public.papa_v2_revision where id=1)) into result from chosen;
 return result;
end;$$;
revoke all on function public.papa_space_center_directory(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.papa_space_center_directory(uuid,text,text,integer,text) to service_role;
revoke all on function public.papa_space_center_directory(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.papa_space_center_directory(uuid,text,text,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
