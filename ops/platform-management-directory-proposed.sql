-- Local companion read model. Requires platform-management-proposed.sql and the
-- existing Account links/registry tables. No operational history is downloaded.
create or replace function public.papa_management_directory(subject uuid,section_name text,search_text text default '',requested_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows_json jsonb; total_rows integer; page_number integer; president boolean; registry_revision bigint;
begin
 if not exists(select 1 from public.papa_accounts where id=subject and disabled_at is null) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 select exists(select 1 from public.papa_platform_roles where account_id=subject and role='president') into president;
 if not president and not exists(select 1 from public.papa_spaces s where s.status='active' and
  (s.owner_account_id=subject or exists(select 1 from public.papa_space_memberships m where m.space_id=s.id and m.account_id=subject
   and m.role='space_admin' and m.status='active' and m.permissions && array['streamers','reports','administrators'])))
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if section_name is null or section_name not in ('overview','halls','streamers','accounts','cleanup') or search_text is null or length(search_text)>100 or requested_page is null or requested_page<1 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 select revision into registry_revision from public.papa_v2_revision where id=1;
 if section_name='overview' then
  with visible as materialized (select s.* from public.papa_spaces s where president or s.status='active' and
   (s.owner_account_id=subject or exists(select 1 from public.papa_space_memberships m where m.space_id=s.id and m.account_id=subject and m.role='space_admin'
    and m.status='active' and m.permissions && array['streamers','reports','administrators'])))
  select jsonb_build_object('spaces',(select count(*) from visible),'halls',(select count(*) from visible where tenant_kind='hall'),
   'independent',(select count(*) from visible where tenant_kind='independent'),'unclassified',(select count(*) from visible where tenant_kind is null),
   'streamers',(select count(*) from public.papa_space_streamers m join visible s on s.id=m.space_id),
   'managers',(select count(*) from (select m.account_id from public.papa_space_memberships m join visible s on s.id=m.space_id join public.papa_accounts a on a.id=m.account_id
    where m.role in ('space_admin','streamer_admin') and m.status='active' and a.disabled_at is null
    union select p.account_id from public.papa_platform_roles p join public.papa_accounts a on a.id=p.account_id where president and p.role='president' and a.disabled_at is null) enabled_managers),
   'pendingProvisioning',(select count(*) from visible s where exists(select 1 from public.papa_management_audit a where a.space_id=s.id and a.action='create')),
   'archivedStreamers',(select count(*) from public.papa_space_streamers m join visible s on s.id=m.space_id where m.archived_at is not null)) into rows_json;
  return jsonb_build_object('rows','[]'::jsonb,'total',0,'page',1,'pages',1,'summary',rows_json,'registryRevision',registry_revision);
 end if;
 with visible as materialized (
  select s.* from public.papa_spaces s where president or s.status='active' and
   (s.owner_account_id=subject or exists(select 1 from public.papa_space_memberships m where m.space_id=s.id and m.account_id=subject and m.role='space_admin'
    and m.status='active' and (case when section_name='accounts' then 'administrators' else 'streamers' end)=any(m.permissions)))
 ), rooms as materialized (
  select r.value as descriptor from public.papa_v2_entities e cross join lateral jsonb_array_elements(
   case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) r(value) where e.kind='meta' and e.id='1'
 ), candidates as materialized (
  select s.id as key,s.display_name as name,jsonb_build_object('id',s.id,'name',s.display_name,'status',s.status,'kind',s.tenant_kind,
   'ownerAccountId',s.owner_account_id,'revision',s.management_revision,'provisioningPending',exists(select 1 from public.papa_management_audit a where a.space_id=s.id and a.action='create')) as row
   from visible s where section_name='halls'
  union all
  select m.streamer_id,r.descriptor->>'display_name',jsonb_build_object('id',m.streamer_id,'name',r.descriptor->>'display_name','slug',r.descriptor->>'slug',
   'active',coalesce(r.descriptor->'active','true'::jsonb),'spaceId',m.space_id,'spaceName',s.display_name,'archivedAt',m.archived_at,'revision',s.management_revision,
   'descriptor',r.descriptor||jsonb_build_object('spaceId',m.space_id))
   from public.papa_space_streamers m join visible s on s.id=m.space_id join rooms r on r.descriptor->>'id'=m.streamer_id
   where ((section_name='streamers' and m.archived_at is null) or (section_name='cleanup' and (m.archived_at is not null or r.descriptor->>'active'='false')))
  union all
  select a.id::text,coalesce(nullif(p.data->>'name',''),case when l.manager_key='president' then '平台總裁' when l.manager_key like 'streamer:%'
    then (select descriptor->>'display_name' from rooms where descriptor->>'id'=substr(l.manager_key,10) limit 1) end,l.manager_key,a.id::text),
   jsonb_build_object('id',a.id,'name',coalesce(nullif(p.data->>'name',''),case when l.manager_key='president' then '平台總裁' when l.manager_key like 'streamer:%'
    then (select descriptor->>'display_name' from rooms where descriptor->>'id'=substr(l.manager_key,10) limit 1) end,l.manager_key,a.id::text),'disabledAt',a.disabled_at,'managerKey',l.manager_key)
   from public.papa_accounts a left join public.papa_manager_account_links l on l.account_id=a.id
   left join public.papa_account_legacy_players b on b.account_id=a.id left join public.papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
   where section_name='accounts' and ((president and exists(select 1 from public.papa_platform_roles where account_id=a.id and role='president'))
    or exists(select 1 from public.papa_space_memberships m join visible s on s.id=m.space_id where m.account_id=a.id and m.role in ('space_admin','streamer_admin')))
 ), filtered as materialized (select * from candidates where strpos(lower(coalesce(name,'')),lower(search_text))>0 or strpos(lower(key),lower(search_text))>0),
 counted as (select count(*)::integer n from filtered), chosen as (select least(requested_page,greatest(1,(n+19)/20)) p,n from counted),
 paged as (select f.* from filtered f order by name,key limit 20 offset ((select p from chosen)-1)*20)
 select (select n from chosen),(select p from chosen),coalesce(jsonb_agg(row order by name,key),'[]'::jsonb) into total_rows,page_number,rows_json from paged;
 return jsonb_build_object('rows',rows_json,'total',total_rows,'page',page_number,'pages',greatest(1,(total_rows+19)/20),'registryRevision',registry_revision);
end;$$;
revoke all on function public.papa_management_directory(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.papa_management_directory(uuid,text,text,integer) to service_role;

create or replace function public.papa_management_detail(subject uuid,requested_space text,requested_streamer text default null,search_text text default '',requested_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare space_row public.papa_spaces; room jsonb; room_settings jsonb; archive_time timestamptz; members jsonb; total_rows integer; page_number integer; can_manage boolean; registry_revision bigint;
begin
 if requested_space is null or length(requested_space)>200 or length(coalesce(requested_streamer,''))>200 or search_text is null or length(search_text)>100 or requested_page is null or requested_page<1 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 can_manage=public.papa_management_access(subject,requested_space,null,'administrators');
 if not can_manage and not public.papa_management_access(subject,requested_space,requested_streamer,'streamers')
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 select * into space_row from public.papa_spaces where id=requested_space;
 if not found then raise exception 'SPACE_NOT_FOUND';end if;
 select revision into registry_revision from public.papa_v2_revision where id=1;
 if requested_streamer is not null then
  select r.value||jsonb_build_object('spaceId',m.space_id),e.data->'streamerSettings'->m.streamer_id,m.archived_at into room,room_settings,archive_time
   from public.papa_space_streamers m join public.papa_v2_entities e on e.kind='meta' and e.id='1'
   cross join lateral jsonb_array_elements(case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) r(value)
   where m.space_id=requested_space and m.streamer_id=requested_streamer and r.value->>'id'=m.streamer_id;
  if room is null then raise exception 'STREAMER_SCOPE_INVALID';end if;
 end if;
 with members as materialized (
  select m.id,m.account_id,m.role,m.streamer_id,m.status,m.permissions,m.permissions_explicit,l.manager_key,
   coalesce(nullif(p.data->>'name',''),case when l.manager_key='president' then '平台總裁' when l.manager_key like 'streamer:%' then (
    select r->>'display_name' from public.papa_v2_entities e cross join lateral jsonb_array_elements(
     case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) r
     where e.kind='meta' and e.id='1' and r->>'id'=substr(l.manager_key,10) limit 1) end,l.manager_key,m.account_id::text) as name
   from public.papa_space_memberships m left join public.papa_manager_account_links l on l.account_id=m.account_id
   left join public.papa_account_legacy_players b on b.account_id=m.account_id left join public.papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
   where can_manage and m.space_id=requested_space and m.role in ('space_admin','streamer_admin')
    and (requested_streamer is null or m.streamer_id is null or m.streamer_id=requested_streamer)
 ), filtered as materialized (select * from members where strpos(lower(name),lower(search_text))>0 or strpos(lower(account_id::text),lower(search_text))>0),
 counted as (select count(*)::integer n from filtered),chosen as (select n,least(requested_page,greatest(1,(n+19)/20)) p from counted),
 paged as (select * from filtered order by name,id limit 20 offset ((select p from chosen)-1)*20)
 select (select n from chosen),(select p from chosen),coalesce(jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'role',role,'streamerId',streamer_id,
  'status',status,'permissions',permissions,'permissionsExplicit',permissions_explicit,'managerKey',manager_key,'name',name,
  'effectivePermissions',case when permissions_explicit then permissions when role='streamer_admin' and manager_key='streamer:'||streamer_id
   then array['songs','queue','players','announcements','reports'] else '{}'::text[] end) order by name,id),'[]'::jsonb) into total_rows,page_number,members from paged;
 return jsonb_build_object('space',jsonb_build_object('id',space_row.id,'name',space_row.display_name,'status',space_row.status,'kind',space_row.tenant_kind,
  'ownerAccountId',space_row.owner_account_id,'revision',space_row.management_revision,'provisioningPending',exists(select 1 from public.papa_management_audit a where a.space_id=requested_space and a.action='create')),
  'streamer',case when room is not null then jsonb_build_object('descriptor',room,'settings',coalesce(room_settings,'{}'::jsonb),'archivedAt',archive_time) end,
  'memberships',members,'total',total_rows,'page',page_number,'pages',greatest(1,(total_rows+19)/20),'canManageMemberships',can_manage,'registryRevision',registry_revision);
end;$$;
revoke all on function public.papa_management_detail(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.papa_management_detail(uuid,text,text,text,integer) to service_role;

-- This is a bounded-count review, not a delete authorization. A known zero is
-- never advertised as proof that indirect/global/retained references are absent.
create or replace function public.papa_management_dependencies(subject uuid,requested_space text,requested_streamer text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare entity_counts jsonb; memberships bigint; audit_present boolean; route_alias_count bigint; current_room jsonb;
begin
 if requested_space is null or requested_streamer is null or length(requested_space)>200 or length(requested_streamer)>200
 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 if not public.papa_management_access(subject,requested_space,requested_streamer,'streamers') then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 select room into current_room from public.papa_v2_entities e cross join lateral jsonb_array_elements(
  case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) room
  where e.kind='meta' and e.id='1' and room->>'id'=requested_streamer;
 if current_room is null then raise exception 'STREAMER_SCOPE_INVALID';end if;
 select jsonb_object_agg(kind,n) into entity_counts from (select kinds.kind,count(e.id) n from unnest(array['songs','queue','ledger','crowns','cards','wishes']) kinds(kind)
  left join public.papa_v2_entities e on e.kind=kinds.kind and e.space_id=requested_space and e.data->>'streamer_id'=requested_streamer group by kinds.kind) counted;
 select count(*) into memberships from public.papa_space_memberships where space_id=requested_space and streamer_id=requested_streamer;
 if to_regclass('public.papa_events') is not null then execute 'select exists(select 1 from public.papa_events where streamer_id=$1 limit 1)' into audit_present using requested_streamer;end if;
 if to_regclass('public.papa_public_route_aliases') is not null then execute 'select count(*) from public.papa_public_route_aliases where space_id=$1 and streamer_id=$2' into route_alias_count using requested_space,requested_streamer;end if;
 return jsonb_build_object('spaceId',requested_space,'streamerId',requested_streamer,'name',current_room->>'display_name','entityCounts',entity_counts,
  'memberships',memberships,'auditPresent',audit_present,'routeAliases',route_alias_count,'safeToDelete',false,'permanentDeleteAuthorized',false,
  'unchecked',jsonb_build_array('shared catalog and version links','global player and favorite JSON references','medal grants and evidence','messages and notification receipts',
    'payments and settlement links','device sessions and push subscriptions','release backups and historical JSON references','indirect or unknown future relations'));
end;$$;
revoke all on function public.papa_management_dependencies(uuid,text,text) from public,anon,authenticated;
grant execute on function public.papa_management_dependencies(uuid,text,text) to service_role;
