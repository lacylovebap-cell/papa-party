begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- ops/platform-management-proposed.sql
-- Pending approval: additive tenant metadata and management audit. Never run automatically.

alter table public.papa_spaces add column if not exists tenant_kind text check (tenant_kind in ('hall','independent'));
alter table public.papa_spaces add column if not exists owner_account_id uuid references public.papa_accounts(id);
alter table public.papa_spaces add column if not exists management_revision bigint not null default 0;
alter table public.papa_space_memberships add column if not exists permissions text[] not null default '{}';
-- Existing manager scopes retain their legacy meaning until explicitly edited.
alter table public.papa_space_memberships add column if not exists permissions_explicit boolean not null default false;
alter table public.papa_space_streamers add column if not exists archived_at timestamptz;
create table if not exists public.papa_management_audit(
 operation_id uuid primary key,actor_account_id uuid not null references public.papa_accounts(id),
 space_id text not null references public.papa_spaces(id),action text not null,
 request_data jsonb not null,before_data jsonb,after_data jsonb not null,created_at timestamptz not null default now()
);
alter table public.papa_management_audit enable row level security;
revoke all on public.papa_management_audit from public,anon,authenticated,service_role;
create index if not exists papa_management_audit_space_created on public.papa_management_audit(space_id,created_at);

-- All callers receive their Account ID from the verified server session. This
-- helper does not trust a client role or infer a tenant from a display name.
create or replace function public.papa_management_access(subject uuid,requested_space text,requested_streamer text,required_permission text)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if required_permission is null or required_permission not in ('songs','queue','players','announcements','streamers','reports','administrators')
  or not exists(select 1 from public.papa_accounts where id=subject and disabled_at is null)
 then return false;end if;
 if not exists(select 1 from public.papa_spaces where id=requested_space) then return false;end if;
 if requested_streamer is not null and not exists(select 1 from public.papa_space_streamers where space_id=requested_space and streamer_id=requested_streamer)
 then return false;end if;
 if exists(select 1 from public.papa_platform_roles where account_id=subject and role='president') then return true;end if;
 if not exists(select 1 from public.papa_spaces where id=requested_space and status='active') then return false;end if;
 if exists(select 1 from public.papa_spaces where id=requested_space and owner_account_id=subject) then return true;end if;
 return exists(select 1 from public.papa_space_memberships m where m.account_id=subject and m.space_id=requested_space and m.status='active'
  and required_permission=any(m.permissions) and (m.role='space_admin' or m.role='streamer_admin' and requested_streamer=m.streamer_id));
end;$$;
revoke all on function public.papa_management_access(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.papa_management_access(uuid,text,text,text) to service_role;

-- One scoped permission check for the authenticated Edge request. Legacy
-- streamer credentials retain only their original own-room capabilities; a new
-- space_admin role is never inferred from an old empty permissions array.
create or replace function public.papa_management_room_permission(subject uuid,requested_streamer text,permission_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare target_space text;
begin
 if permission_name is null or permission_name not in ('songs','queue','players','announcements','streamers','reports','administrators','all')
  or requested_streamer is null or length(requested_streamer)>200 or not exists(select 1 from public.papa_accounts where id=subject and disabled_at is null)
 then return false;end if;
 select space_id into target_space from public.papa_space_streamers where streamer_id=requested_streamer;
 if target_space is null then return false;end if;
 if exists(select 1 from public.papa_platform_roles where account_id=subject and role='president') then return true;end if;
 if not exists(select 1 from public.papa_spaces where id=target_space and status='active') then return false;end if;
 if exists(select 1 from public.papa_spaces where id=target_space and owner_account_id=subject) then return true;end if;
 return exists(select 1 from public.papa_space_memberships m where m.account_id=subject and m.space_id=target_space and m.status='active'
  and (m.role='space_admin' or m.role='streamer_admin' and m.streamer_id=requested_streamer) and (
   m.permissions_explicit and (permission_name=any(m.permissions) or permission_name='all' and array['songs','queue','players','announcements','reports'] <@ m.permissions)
   or not m.permissions_explicit and m.role='streamer_admin' and permission_name in ('songs','queue','players','announcements','reports','all')
    and exists(select 1 from public.papa_manager_account_links l where l.account_id=subject and l.manager_key='streamer:'||requested_streamer)
    and exists(select 1 from public.papa_streamer_accounts a where a.streamer_id=requested_streamer and a.enabled)
  ));
end;$$;
revoke all on function public.papa_management_room_permission(uuid,text,text) from public,anon,authenticated;
grant execute on function public.papa_management_room_permission(uuid,text,text) to service_role;

create or replace function public.papa_management_audit_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'MANAGEMENT_AUDIT_IMMUTABLE';end;$$;
revoke all on function public.papa_management_audit_immutable() from public,anon,authenticated,service_role;
drop trigger if exists papa_management_audit_immutable on public.papa_management_audit;
create trigger papa_management_audit_immutable before update or delete on public.papa_management_audit
 for each row execute function public.papa_management_audit_immutable();

-- A stale registry writer must not reactivate an archived streamer. Locking
-- referenced mappings also serializes a concurrent archive against activation.
create or replace function public.papa_management_archived_streamer_guard() returns trigger
language plpgsql set search_path='' as $$
declare mapping record;
begin
 for mapping in select m.streamer_id,m.archived_at from public.papa_space_streamers m where exists(
  select 1 from jsonb_array_elements(case when jsonb_typeof(new.data->'streamers')='array' then new.data->'streamers' else '[]'::jsonb end) room
  where room->>'id'=m.streamer_id) order by m.streamer_id for share
 loop
  if mapping.archived_at is not null and exists(select 1 from jsonb_array_elements(new.data->'streamers') room
   where room->>'id'=mapping.streamer_id and coalesce(room->>'active','true')<>'false')
  then raise exception 'STREAMER_ARCHIVED';end if;
 end loop;
 return new;
end;$$;
revoke all on function public.papa_management_archived_streamer_guard() from public,anon,authenticated,service_role;
drop trigger if exists papa_management_archived_streamer_guard on public.papa_v2_entities;
create trigger papa_management_archived_streamer_guard before update of data on public.papa_v2_entities
 for each row when (new.kind='meta' and new.id='1') execute function public.papa_management_archived_streamer_guard();

create or replace function public.papa_manage_space(subject uuid,operation uuid,action_name text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare president boolean; permitted boolean; current_space public.papa_spaces; prior public.papa_management_audit;
 target_space text; target_account uuid; member_id uuid; desired_permissions text[]; granted_permissions text[];
 before_value jsonb; after_value jsonb; desired_status text; kind text; desired_role text; target_streamer text;
 current_mapping public.papa_space_streamers; current_room jsonb;
begin
 if operation is null or jsonb_typeof(payload) is distinct from 'object' then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_accounts where id=subject and disabled_at is null for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 -- Serialize a request key and actor authority for replay and revocation consistency.
 perform pg_advisory_xact_lock(hashtextextended(operation::text,0));
 perform 1 from public.papa_platform_roles where account_id=subject and role='president' for share;
 president=found;
 target_space=payload->>'spaceId';
 if action_name='create' then
  if not president then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 else
  select * into current_space from public.papa_spaces where id=target_space for update;
  if not found then raise exception 'SPACE_NOT_FOUND';end if;
  permitted=president or (current_space.status='active' and current_space.owner_account_id=subject);
  if action_name in ('membership','archive_streamer','restore_streamer') and not permitted then
   select m.permissions into granted_permissions from public.papa_space_memberships m where m.space_id=target_space and m.account_id=subject and m.role='space_admin' and m.status='active' for update;
   permitted=current_space.status='active' and (case when action_name='membership' then 'administrators' else 'streamers' end)=any(coalesce(granted_permissions,'{}'));
  end if;
  if not coalesce(permitted,false) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 end if;
 select * into prior from public.papa_management_audit where operation_id=operation;
 if found then
  if prior.actor_account_id<>subject or prior.action<>action_name or prior.request_data<>payload then raise exception 'OPERATION_CONFLICT';end if;
  return prior.after_data;
 end if;
 if action_name='create' then
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('name','kind','ownerAccountId')) then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  kind=payload->>'kind';target_account=(payload->>'ownerAccountId')::uuid;
  if kind not in ('hall','independent') or kind is null or length(trim(coalesce(payload->>'name','')))=0 or length(payload->>'name')>100 or not exists(select 1 from public.papa_accounts where id=target_account and disabled_at is null) then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  target_space='space-'||gen_random_uuid()::text;
  -- New tenants remain suspended until their business and public-route capabilities are provisioned.
  insert into public.papa_spaces(id,slug,display_name,status,tenant_kind,owner_account_id) values(target_space,target_space,trim(payload->>'name'),'suspended',kind,target_account) returning to_jsonb(papa_spaces.*) into after_value;
  insert into public.papa_space_memberships(account_id,space_id,role,permissions,permissions_explicit) values(target_account,target_space,'space_admin',array['songs','queue','players','announcements','streamers','reports','administrators'],true);
 elsif action_name='edit' then
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('spaceId','revision','name')) then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  if current_space.management_revision is distinct from (payload->>'revision')::bigint then raise exception 'MANAGEMENT_VERSION_CONFLICT';end if;
  if length(trim(coalesce(payload->>'name','')))=0 or length(payload->>'name')>100 then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  before_value=to_jsonb(current_space);
  update public.papa_spaces set display_name=trim(payload->>'name'),management_revision=management_revision+1 where id=target_space returning to_jsonb(papa_spaces.*) into after_value;
 elsif action_name in ('suspend','restore') then
  if not president then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('spaceId','revision')) then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  if current_space.management_revision is distinct from (payload->>'revision')::bigint then raise exception 'MANAGEMENT_VERSION_CONFLICT';end if;
  -- New tenants are not silently activated before their scoped business and
  -- login flows have been provisioned. An approved provisioning release must
  -- add that capability; this management proposal cannot bypass it.
  if action_name='restore' and exists(select 1 from public.papa_management_audit where space_id=target_space and action='create')
  then raise exception 'SPACE_PROVISIONING_REQUIRED';end if;
  desired_status=case when action_name='restore' then 'active' else 'suspended' end;
  before_value=to_jsonb(current_space);
  if current_space.status is distinct from desired_status then
   update public.papa_spaces set status=desired_status,management_revision=management_revision+1 where id=target_space returning to_jsonb(papa_spaces.*) into after_value;
  else after_value=before_value;end if;
 elsif action_name in ('archive_streamer','restore_streamer') then
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('spaceId','revision','streamerId')) then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  if current_space.management_revision is distinct from (payload->>'revision')::bigint then raise exception 'MANAGEMENT_VERSION_CONFLICT';end if;
  target_streamer=payload->>'streamerId';
  select * into current_mapping from public.papa_space_streamers where streamer_id=target_streamer and space_id=target_space for update;
  if not found then raise exception 'STREAMER_SCOPE_INVALID';end if;
  select room into current_room from public.papa_v2_entities e cross join lateral jsonb_array_elements(
   case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) room
   where e.kind='meta' and e.id='1' and room->>'id'=target_streamer;
  if current_room is null then raise exception 'STREAMER_METADATA_INVALID';end if;
  if action_name='archive_streamer' and coalesce(current_room->>'active','true')<>'false'
  then raise exception 'STREAMER_DISABLE_BEFORE_ARCHIVE';end if;
  before_value=to_jsonb(current_mapping);
  if action_name='archive_streamer' and current_mapping.archived_at is null then
   update public.papa_space_streamers set archived_at=now() where streamer_id=target_streamer returning to_jsonb(papa_space_streamers.*) into after_value;
  elsif action_name='restore_streamer' and current_mapping.archived_at is not null then
   update public.papa_space_streamers set archived_at=null where streamer_id=target_streamer returning to_jsonb(papa_space_streamers.*) into after_value;
  else after_value=before_value;end if;
  if after_value is distinct from before_value then update public.papa_spaces set management_revision=management_revision+1 where id=target_space;end if;
 elsif action_name='membership' then
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('spaceId','revision','accountId','permissions','status','role','streamerId')) then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  if current_space.management_revision is distinct from (payload->>'revision')::bigint then raise exception 'MANAGEMENT_VERSION_CONFLICT';end if;
  target_account=(payload->>'accountId')::uuid;desired_status=payload->>'status';desired_role=coalesce(payload->>'role','space_admin');target_streamer=nullif(payload->>'streamerId','');
  if desired_role not in ('space_admin','streamer_admin') or (desired_role='streamer_admin')<>(target_streamer is not null)
  then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  if target_streamer is not null and not exists(select 1 from public.papa_space_streamers where space_id=target_space and streamer_id=target_streamer)
  then raise exception 'STREAMER_SCOPE_INVALID';end if;
  if target_account=current_space.owner_account_id and desired_role='space_admin' then raise exception 'OWNER_TRANSFER_REQUIRED';end if;
  if desired_status is null or desired_status not in ('active','suspended') or jsonb_typeof(payload->'permissions') is distinct from 'array' or not exists(select 1 from public.papa_accounts where id=target_account and disabled_at is null) then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  select coalesce(array_agg(distinct value),'{}') into desired_permissions from jsonb_array_elements_text(payload->'permissions');
  if not desired_permissions <@ array['songs','queue','players','announcements','streamers','reports','administrators']
   or desired_role='streamer_admin' and desired_permissions && array['streamers','administrators'] then raise exception 'PERMISSION_INVALID';end if;
  if not president and current_space.owner_account_id is distinct from subject and (target_account=subject or not desired_permissions <@ coalesce(granted_permissions,'{}')) then raise exception 'PERMISSION_ESCALATION';end if;
  select to_jsonb(m) into before_value from public.papa_space_memberships m where m.account_id=target_account and m.space_id=target_space and m.role=desired_role and m.streamer_id is not distinct from target_streamer;
  if not president and current_space.owner_account_id is distinct from subject and before_value is not null and not array(select jsonb_array_elements_text(before_value->'permissions')) <@ coalesce(granted_permissions,'{}') then raise exception 'PERMISSION_ESCALATION';end if;
  if target_streamer is null then
   insert into public.papa_space_memberships(account_id,space_id,role,status,permissions,permissions_explicit) values(target_account,target_space,desired_role,desired_status,desired_permissions,true)
   on conflict(account_id,space_id,role) where streamer_id is null do update set status=excluded.status,permissions=excluded.permissions,permissions_explicit=true returning to_jsonb(papa_space_memberships.*) into after_value;
  else
   insert into public.papa_space_memberships(account_id,space_id,role,streamer_id,status,permissions,permissions_explicit) values(target_account,target_space,desired_role,target_streamer,desired_status,desired_permissions,true)
   on conflict(account_id,space_id,role,streamer_id) where streamer_id is not null do update set status=excluded.status,permissions=excluded.permissions,permissions_explicit=true returning to_jsonb(papa_space_memberships.*) into after_value;
  end if;
  update public.papa_spaces set management_revision=management_revision+1 where id=target_space;
 else raise exception 'MANAGEMENT_ACTION_INVALID';
 end if;
 insert into public.papa_management_audit(operation_id,actor_account_id,space_id,action,request_data,before_data,after_data) values(operation,subject,target_space,action_name,payload,before_value,after_value);
 return after_value;
end;
$$;
revoke all on function public.papa_manage_space(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.papa_manage_space(uuid,uuid,text,jsonb) to service_role;

-- ops/platform-management-directory-proposed.sql
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
    and m.status='active' and (case when section_name='accounts' then 'administrators'=any(m.permissions)
     when section_name='halls' then m.permissions && array['streamers','administrators'] else 'streamers'=any(m.permissions) end)))
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

-- ops/platform-management-session-proposed.sql
-- Read-only login bridge: authorization metadata only. The verified business
-- session retains its player/streamer/president role, device and account.
create or replace function public.papa_management_session(subject uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare president boolean:=false; rooms boolean:=false; accounts boolean:=false; reports boolean:=false; sections jsonb:='[]'::jsonb;
begin
 if exists(select 1 from public.papa_accounts where id=subject and disabled_at is null) then
  select exists(select 1 from public.papa_platform_roles where account_id=subject and role='president') into president;
  select president or exists(select 1 from public.papa_spaces s where s.status='active' and
    (s.owner_account_id=subject or exists(select 1 from public.papa_space_memberships m
      where m.space_id=s.id and m.account_id=subject and m.role='space_admin' and m.status='active' and 'streamers'=any(m.permissions)))),
   president or exists(select 1 from public.papa_spaces s where s.status='active' and
    (s.owner_account_id=subject or exists(select 1 from public.papa_space_memberships m
      where m.space_id=s.id and m.account_id=subject and m.role='space_admin' and m.status='active' and 'administrators'=any(m.permissions)))),
   president or exists(select 1 from public.papa_spaces s where s.status='active' and
    (s.owner_account_id=subject or exists(select 1 from public.papa_space_memberships m
      where m.space_id=s.id and m.account_id=subject and m.role='space_admin' and m.status='active' and 'reports'=any(m.permissions))))
   into rooms,accounts,reports;
 end if;
 if rooms or accounts or reports then sections:=jsonb_build_array('overview');end if;
 if rooms or accounts then sections:=sections||jsonb_build_array('halls');end if;
 if rooms then sections:=sections||jsonb_build_array('streamers');end if;
 if accounts then sections:=sections||jsonb_build_array('accounts');end if;
 if rooms then sections:=sections||jsonb_build_array('cleanup');end if;
 return jsonb_build_object('version',1,'allowed',rooms or accounts or reports,'president',president,
  'permissions',jsonb_build_object('streamers',rooms,'administrators',accounts,'reports',reports),'sections',sections);
end;$$;
revoke all on function public.papa_management_session(uuid) from public,anon,authenticated;
grant execute on function public.papa_management_session(uuid) to service_role;

-- ops/platform-management-commit-proposed.sql
-- Approved management integration; apply only after the deployment validation gate.
-- Keeps business calculation, receipts, ledger and Audit in their existing RPCs.

-- Hold the same authority rows until the delegated operation commits. In
-- particular Space FOR SHARE serializes against papa_manage_space's status,
-- membership and archive changes (which take Space FOR UPDATE first).
create or replace function public.papa_management_lock_room(actor_context jsonb,permission_name text)
returns void language plpgsql security definer set search_path='' as $$
declare subject uuid;room text;target_space text;
begin
 if jsonb_typeof(actor_context) is distinct from 'object' or actor_context->>'role' is distinct from 'streamer_admin'
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 begin subject=(actor_context->>'account_id')::uuid;
 exception when invalid_text_representation then raise exception 'MANAGEMENT_ACCESS_DENIED';end;
 room=actor_context->>'actor_streamer_id';target_space=actor_context->>'space_id';
 if subject is null or nullif(room,'') is null or nullif(target_space,'') is null
  or actor_context->>'streamer_id' is not null and actor_context->>'streamer_id' is distinct from room
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_accounts where id=subject and disabled_at is null for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_spaces where id=target_space and status='active' for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_space_streamers where streamer_id=room and space_id=target_space and archived_at is null for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_space_memberships where account_id=subject and space_id=target_space order by id for share;
 perform 1 from public.papa_manager_account_links where account_id=subject for share;
 perform 1 from public.papa_streamer_accounts where streamer_id=room for share;
 if not coalesce(public.papa_management_room_permission(subject,room,permission_name),false)
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
end;$$;
revoke all on function public.papa_management_lock_room(jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.papa_management_business_commit(commit_name text,arguments jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; subject uuid; room text; target_space text; permission_name text; action_name text; result jsonb;
begin
 if commit_name is null or commit_name not in ('papa_release_b_commit','papa_room_operational_commit','papa_room_admin_commit','papa_room_operational_commit_receipted','papa_room_admin_commit_with_player_bindings')
  or jsonb_typeof(arguments) is distinct from 'object' then raise exception 'MANAGEMENT_COMMIT_INVALID';end if;
 ctx=arguments->'actor_context';
 if ctx->>'role' is distinct from 'streamer_admin' then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 subject=(ctx->>'account_id')::uuid;room=ctx->>'streamer_id';target_space=ctx->>'space_id';
 if subject is null or room is null or target_space is null or ctx->>'actor_streamer_id' is distinct from room
  or commit_name<>'papa_release_b_commit' and arguments->>'requested_room' is distinct from room
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 action_name=split_part(coalesce(ctx->>'action',''),':',1);
 permission_name=case
  when action_name in ('song','songsBulk','restoreSongEdits','lyrics','newPracticeSet','newPracticeOrder','songOrder','wishAdmin') then 'songs'
  when action_name in ('queue','onBehalf','streamerDraw','queueOrder') then 'queue'
  when action_name in ('player','ledger','allocate','extraQuota','crown','card','playerProvision') then 'players'
  else 'all' end;
 perform public.papa_management_lock_room(ctx,permission_name);
 -- Names are strictly allowlisted above; all data remains bound parameters.
 if commit_name='papa_release_b_commit' then
  execute 'select to_jsonb(public.papa_release_b_commit(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices''))' into result using arguments;
 elsif commit_name='papa_room_operational_commit_receipted' then
  execute 'select public.papa_room_operational_commit_receipted(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices'',$1->>''requested_room'',($1->>''operation_id'')::uuid,$1->>''actor_key'',$1->>''request_hash'')' into result using arguments;
 elsif commit_name='papa_room_admin_commit_with_player_bindings' then
  execute 'select to_jsonb(public.papa_room_admin_commit_with_player_bindings(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices'',$1->>''requested_room'',$1->''player_bindings''))' into result using arguments;
 else
  execute format('select to_jsonb(public.%I(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices'',$1->>''requested_room''))',commit_name) into result using arguments;
 end if;
 return result;
end;$$;
revoke all on function public.papa_management_business_commit(text,jsonb) from public,anon,authenticated;
grant execute on function public.papa_management_business_commit(text,jsonb) to service_role;

-- Existing badge/catalog/quota mutations bypass the snapshot commits above.
-- Dispatch only these established RPCs, with their current named signatures;
-- adding a future endpoint never implicitly grants delegated write access.
create or replace function public.papa_management_guarded_rpc(rpc_name text,arguments jsonb,actor_context jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare permission_name text;room text;target_space text;signature record;argument record;
 candidates integer=0;sql_arguments text='';expression text;result jsonb;catalog_actor jsonb;
begin
 permission_name=case
  when rpc_name in ('papa_catalog_import_link_batch','papa_catalog_link_room_song','papa_catalog_report_issue',
   'papa_catalog_language_filter_save','papa_catalog_lyric_choice','papa_catalog_batch_add') then 'songs'
  when rpc_name in ('papa_achievement_visibility_set','papa_achievement_manual_grant',
   'papa_achievement_manual_grant_batch','papa_achievement_revoke','papa_manage_player_extra_quota') then 'players'
  when rpc_name='papa_public_route_save' then 'all'
  else null end;
 if permission_name is null or jsonb_typeof(arguments) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(arguments))>50
 then raise exception 'MANAGEMENT_RPC_INVALID';end if;
 perform public.papa_management_lock_room(actor_context,permission_name);
 room=actor_context->>'actor_streamer_id';target_space=actor_context->>'space_id';
 -- Do not let canonical authority for one room accompany another room's args.
 if arguments?'requested_room' and arguments->>'requested_room' is distinct from room
  or arguments?'room_id' and arguments->>'room_id' is distinct from room
  or arguments?'requested_space' and arguments->>'requested_space' is distinct from target_space
  or arguments?'actor_context' and arguments->'actor_context' is distinct from actor_context
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if arguments?'actor_id' then
  if left(arguments->>'actor_id',9) is distinct from 'verified:' then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
  begin catalog_actor=substring(arguments->>'actor_id' from 10)::jsonb;
  exception when invalid_text_representation then raise exception 'MANAGEMENT_ACCESS_DENIED';end;
  if catalog_actor is distinct from actor_context then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 end if;
 -- Match a single overload by its supplied names and required parameters.
 -- Names/types originate only from pg_catalog; values remain bound JSON.
 for signature in select p.* from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=rpc_name and p.prokind='f' and p.provariadic=0 and not p.proretset
  and not exists(select 1 from jsonb_object_keys(arguments) key where not key=any(p.proargnames[1:p.pronargs]))
  and not exists(select 1 from generate_series(1,p.pronargs-p.pronargdefaults) i where not arguments?p.proargnames[i])
 loop
  candidates=candidates+1;
  if candidates>1 then raise exception 'MANAGEMENT_RPC_SIGNATURE_INVALID';end if;
  for argument in select p.proargnames[i] name,p.proargtypes[i-1] type_oid,t.typcategory
   from pg_catalog.pg_proc p cross join lateral generate_series(1,p.pronargs) i
   join pg_catalog.pg_type t on t.oid=p.proargtypes[i-1]
   where p.oid=signature.oid and arguments?p.proargnames[i] order by i
  loop
   if sql_arguments<>'' then sql_arguments=sql_arguments||',';end if;
   if argument.type_oid in ('jsonb'::regtype,'json'::regtype) then
    expression=format('($1->%L)::%s',argument.name,pg_catalog.format_type(argument.type_oid,null));
   elsif argument.typcategory='A' then
    if arguments->argument.name<>'null'::jsonb and jsonb_typeof(arguments->argument.name)<>'array'
    then raise exception 'MANAGEMENT_RPC_ARGUMENT_INVALID';end if;
    expression=format('case when $1->%L=''null''::jsonb then null else array(select jsonb_array_elements_text($1->%L))::%s end',argument.name,argument.name,pg_catalog.format_type(argument.type_oid,null));
   else expression=format('($1->>%L)::%s',argument.name,pg_catalog.format_type(argument.type_oid,null));end if;
   sql_arguments=sql_arguments||format('%I := %s',argument.name,expression);
  end loop;
 end loop;
 if candidates<>1 then raise exception 'MANAGEMENT_RPC_SIGNATURE_INVALID';end if;
 execute format('select to_jsonb(public.%I(%s))',rpc_name,sql_arguments) into result using arguments;
 return result;
end;$$;
revoke all on function public.papa_management_guarded_rpc(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.papa_management_guarded_rpc(text,jsonb,jsonb) to service_role;

commit;
