-- Local verification only; production application requires approval.
-- Replaces two functions only: no table rewrite, account mutation or tenant activation.
begin;
set local lock_timeout='3s';
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
  kind=payload->>'kind';target_account=nullif(payload->>'ownerAccountId','')::uuid;
  if kind not in ('hall','independent') or kind is null or length(trim(coalesce(payload->>'name','')))=0 or length(payload->>'name')>100 or (target_account is not null and not exists(select 1 from public.papa_accounts where id=target_account and disabled_at is null)) then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  target_space='space-'||gen_random_uuid()::text;
  -- New tenants remain suspended until their business and public-route capabilities are provisioned.
  insert into public.papa_spaces(id,slug,display_name,status,tenant_kind,owner_account_id) values(target_space,target_space,trim(payload->>'name'),'suspended',kind,target_account) returning to_jsonb(papa_spaces.*) into after_value;
  if target_account is not null then
  insert into public.papa_space_memberships(account_id,space_id,role,permissions,permissions_explicit) values(target_account,target_space,'space_admin',array['songs','queue','players','announcements','streamers','reports','administrators'],true);
  end if;
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
   (select r->>'display_name' from public.papa_v2_entities e cross join lateral jsonb_array_elements(coalesce(e.data->'streamers','[]'::jsonb)) r where e.kind='meta' and e.id='1' and r->>'id'=m.streamer_id limit 1) as streamer_name,
   coalesce(nullif(p.data->>'name',''),case when l.manager_key='president' then '平台總裁' when l.manager_key like 'streamer:%' then (
    select r->>'display_name' from public.papa_v2_entities e cross join lateral jsonb_array_elements(
     case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) r
     where e.kind='meta' and e.id='1' and r->>'id'=substr(l.manager_key,10) limit 1) end,l.manager_key,m.account_id::text) as name
   from public.papa_space_memberships m left join public.papa_manager_account_links l on l.account_id=m.account_id
   left join public.papa_account_legacy_players b on b.account_id=m.account_id left join public.papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
   where can_manage and m.space_id=requested_space and m.role in ('space_admin','streamer_admin')
    and (requested_streamer is null or m.streamer_id is null or m.streamer_id=requested_streamer)
 ), filtered as materialized (select * from members where strpos(lower(name),lower(search_text))>0 or strpos(lower(account_id::text),lower(search_text))>0),
 accounts as (select account_id,min(name) name from filtered group by account_id),
 counted as (select count(*)::integer n from accounts),chosen as (select n,least(requested_page,greatest(1,(n+19)/20)) p from counted),
 account_page as (select account_id from accounts order by name,account_id limit 20 offset ((select p from chosen)-1)*20),
 paged as (select f.* from filtered f join account_page a using(account_id))
 select (select n from chosen),(select p from chosen),coalesce(jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'role',role,'streamerId',streamer_id,
  'streamerName',streamer_name,'status',status,'permissions',permissions,'permissionsExplicit',permissions_explicit,'managerKey',manager_key,'name',name,
  'effectivePermissions',case when permissions_explicit then permissions when role='streamer_admin' and manager_key='streamer:'||streamer_id
   then array['songs','queue','players','announcements','reports'] else '{}'::text[] end) order by name,id),'[]'::jsonb) into total_rows,page_number,members from paged;
 return jsonb_build_object('space',jsonb_build_object('id',space_row.id,'name',space_row.display_name,'status',space_row.status,'kind',space_row.tenant_kind,
  'ownerAccountId',space_row.owner_account_id,'revision',space_row.management_revision,'provisioningPending',exists(select 1 from public.papa_management_audit a where a.space_id=requested_space and a.action='create')),
  'streamer',case when room is not null then jsonb_build_object('descriptor',room,'settings',coalesce(room_settings,'{}'::jsonb),'archivedAt',archive_time) end,
  'membershipPageUnit','account','memberships',members,'total',total_rows,'page',page_number,'pages',greatest(1,(total_rows+19)/20),'canManageMemberships',can_manage,'registryRevision',registry_revision);
end;$$;
revoke all on function public.papa_management_detail(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.papa_management_detail(uuid,text,text,text,integer) to service_role;


commit;
