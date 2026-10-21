-- Pending approval: additive tenant metadata and management audit. Never run automatically.
begin;
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
revoke all on public.papa_management_audit from public,anon,authenticated;
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
commit;
