-- Rollback for 10.29-SPACE.1 (batch 2: new Spaces open for operation).
-- Run only if batch 2 must be withdrawn, after redeploying the 10.29-PRICE.2 Edge.
-- 1) Lists, then suspends, every non-聲瑪 Space that is open (a status change, no data removed).
-- 2) Restores the five functions exactly as they are on production before batch 2
--    (definitions taken from main 8e36261; production differs only in line endings).
-- 3) Removes the five new player-login functions. The player-login table and the
--    papa_v2_sessions.space_id column are KEPT (nothing is deleted); without the
--    functions no one can use them, and 聲瑪 sessions never read them.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

select id,display_name,status from public.papa_spaces where id<>'space-001' and deleted_at is null and status='active';
update public.papa_spaces set status='suspended',management_revision=management_revision+1
 where id<>'space-001' and deleted_at is null and status='active';

CREATE OR REPLACE FUNCTION public.papa_verified_session_actor(session_hash text, requested_room text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sess public.papa_v2_sessions%rowtype; device public.papa_device_sessions%rowtype;
 scope_id text; actor_role text; requested_id text; requested_space text;
begin
 if session_hash !~ '^[a-f0-9]{64}$' then return null; end if;
 select * into sess from public.papa_v2_sessions
 where token_hash=session_hash and expires_at>now();
 if not found then return null; end if;
 if sess.player_id='__admin__' and coalesce(sess.role,'super_admin')='super_admin' then
  actor_role:='super_admin';
 elsif sess.role='streamer_admin' and sess.streamer_id is not null
  and sess.player_id='__streamer__:'||sess.streamer_id
  and exists(select 1 from public.papa_streamer_accounts
   where streamer_id=sess.streamer_id and enabled) then
  actor_role:='streamer_admin';
  select space_id into scope_id from public.papa_space_streamers
   where streamer_id=sess.streamer_id;
  if scope_id is null then return null; end if;
 elsif coalesce(sess.role,'player')='player' and sess.player_id not in ('__admin__','')
  and sess.player_id not like '__streamer__:%' then
  actor_role:='player';scope_id:='space-001';
 else return null; end if;
 if sess.device_session_id is not null then
  select * into device from public.papa_device_sessions
   where id=sess.device_session_id and account_id=sess.account_id
    and revoked_at is null and expires_at>now();
  if not found or (actor_role='super_admin' and device.role<>'president')
   or (actor_role='streamer_admin' and
    (device.role<>'streamer_admin' or device.streamer_id<>sess.streamer_id
     or device.space_id<>scope_id))
   or (actor_role='player' and device.role<>'player')
  then return null; end if;
  if actor_role='player' then scope_id:=device.space_id; end if;
 end if;
 if sess.account_id is null then
  if scope_id is not null and scope_id<>'space-001' then return null; end if;
 else
  if not exists(select 1 from public.papa_accounts
   where id=sess.account_id and disabled_at is null) then return null; end if;
  if actor_role='player' then
   if sess.player_id is distinct from papa_account_player_in_space(sess.account_id,scope_id)
   then return null; end if;
  elsif not exists(select 1 from public.papa_manager_account_links
   where account_id=sess.account_id and manager_key=
    (case when actor_role='super_admin' then 'president' else 'streamer:'||sess.streamer_id end))
  then return null; end if;
  if actor_role='super_admin' then
   if not exists(select 1 from public.papa_platform_roles
    where account_id=sess.account_id and role='president') then return null; end if;
  elsif not exists(select 1 from public.papa_space_memberships m
   join public.papa_spaces s on s.id=m.space_id
   where m.account_id=sess.account_id and m.space_id=scope_id
    and m.role=actor_role and m.status='active' and s.status='active'
    and (m.streamer_id is not distinct from
     (case when actor_role='streamer_admin' then sess.streamer_id else null end))) then
   return null;
  end if;
 end if;
 if nullif(requested_room,'') is not null then
  select room->>'id' into requested_id from public.papa_v2_entities e
  cross join lateral jsonb_array_elements(
   case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end
  ) room where e.kind='meta' and e.id='1'
   and (room->>'id'=requested_room or room->>'slug'=requested_room) limit 1;
  if requested_id is null then return null; end if;
  select space_id into requested_space from public.papa_space_streamers
   where streamer_id=requested_id;
  if requested_space is null or
   (actor_role<>'super_admin' and requested_space<>scope_id) or
   (actor_role='streamer_admin' and requested_id<>sess.streamer_id)
  then return null; end if;
 end if;
 return jsonb_build_object('role',actor_role,'accountId',sess.account_id,
  'spaceId',scope_id,'playerId',case when actor_role='player' then sess.player_id else null end,
  'loginId',case when actor_role='player' then sess.login_id else null end,
  'streamerId',sess.streamer_id,'deviceSessionId',sess.device_session_id);
end $function$;

CREATE OR REPLACE FUNCTION public.papa_manage_space(subject uuid, operation uuid, action_name text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.papa_management_streamer_login_status(subject uuid, requested_space text, requested_streamer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare room jsonb;account uuid;credential public.papa_streamer_accounts;membership text;
begin
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if not exists(select 1 from public.papa_space_streamers m join public.papa_spaces s on s.id=m.space_id
  where m.space_id=requested_space and m.streamer_id=requested_streamer and m.deleted_at is null and s.deleted_at is null)
 then raise exception 'STREAMER_SCOPE_INVALID';end if;
 room=public.papa_management_registry_room(requested_streamer);
 if room is null then raise exception 'STREAMER_SCOPE_INVALID';end if;
 select * into credential from public.papa_streamer_accounts where streamer_id=requested_streamer;
 select account_id into account from public.papa_manager_account_links where manager_key='streamer:'||requested_streamer;
 select status into membership from public.papa_space_memberships where account_id=account and space_id=requested_space
  and role='streamer_admin' and streamer_id=requested_streamer;
 return jsonb_build_object('spaceId',requested_space,'streamerId',requested_streamer,'slug',room->>'slug','name',room->>'display_name',
  'exists',credential.streamer_id is not null,'enabled',coalesce(credential.enabled,false),'accountId',account,
  'accountDisabled',exists(select 1 from public.papa_accounts where id=account and disabled_at is not null),'membershipStatus',membership,
  'operational',requested_space='space-001');
end;$function$;

CREATE OR REPLACE FUNCTION public.papa_management_space_readiness(subject uuid, requested_space text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare space_row public.papa_spaces;hosts jsonb;route_code text;missing_login jsonb;items jsonb;operational boolean;
begin
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 select * into space_row from public.papa_spaces where id=requested_space;
 if not found or space_row.deleted_at is not null then raise exception 'SPACE_NOT_FOUND';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.streamer_id,'name',room->>'display_name','slug',room->>'slug',
   'login',exists(select 1 from public.papa_streamer_accounts a where a.streamer_id=m.streamer_id and a.enabled),
   'account',exists(select 1 from public.papa_manager_account_links l where l.manager_key='streamer:'||m.streamer_id)) order by room->>'display_name'),'[]'::jsonb)
 into hosts from (select m.*,public.papa_management_registry_room(m.streamer_id) room from public.papa_space_streamers m
  where m.space_id=requested_space and m.deleted_at is null and m.archived_at is null) m where room is not null;
 select coalesce(jsonb_agg(h->'name'),'[]'::jsonb) into missing_login from jsonb_array_elements(hosts) h where not (h->>'login')::boolean;
 select code into route_code from public.papa_public_route_spaces where space_id=requested_space;
 operational=requested_space='space-001';
 items=jsonb_build_array(
  jsonb_build_object('code','streamer','done',jsonb_array_length(hosts)>0,'label','主播資料',
   'detail',case when jsonb_array_length(hosts)>0 then '已建立 '||jsonb_array_length(hosts)||' 位主播' else '尚未建立主播' end),
  jsonb_build_object('code','login','done',jsonb_array_length(hosts)>0 and jsonb_array_length(missing_login)=0,'label','登入帳號',
   'detail',case when jsonb_array_length(hosts)=0 then '建立主播後即可建立登入帳號' when jsonb_array_length(missing_login)=0 then '每位主播都已有可登入帳號'
    else '尚未建立登入：'||(select string_agg(x#>>'{}','、') from jsonb_array_elements(missing_login) x) end),
  jsonb_build_object('code','operations','done',operational,'label','營運功能（歌本、點歌、存歌、帳務）',
   'detail',case when operational then '已開放' else '新空間的營運功能屬第 2 批開放項目，完成驗收上線前暫不開放，避免與聲瑪資料混用' end),
  jsonb_build_object('code','route','done',route_code is not null,'label','專屬網址',
   'detail',case when route_code is not null then '已設定' else '尚未設定（選填，可在專屬網址設定）' end));
 return jsonb_build_object('spaceId',requested_space,'name',space_row.display_name,'status',space_row.status,'kind',coalesce(space_row.tenant_kind,case when space_row.id='space-001' then 'hall' end),
  'operational',operational,'hosts',hosts,'items',items,
  'provisioningPending',exists(select 1 from public.papa_management_audit a where a.space_id=requested_space and a.action='create'));
end;$function$;

CREATE OR REPLACE FUNCTION public.papa_space_center_directory(subject uuid, category text DEFAULT 'all'::text, search_text text DEFAULT ''::text, requested_page integer DEFAULT 1, requested_space text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not exists(select 1 from public.papa_accounts a join public.papa_platform_roles r on r.account_id=a.id where a.id=subject and a.disabled_at is null and r.role='president') then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if category is null or category not in ('all','hall','independent') or search_text is null or length(search_text)>100 or requested_page is null or requested_page<1 or requested_page>100000 or length(requested_space)>200 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 if requested_space is not null and not exists(select 1 from public.papa_spaces where id=requested_space and deleted_at is null) then raise exception 'SPACE_NOT_FOUND';end if;
 with registry as materialized (
  select r.value room from public.papa_v2_entities e cross join lateral jsonb_array_elements(case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) r(value) where e.kind='meta' and e.id='1'
 ), spaces as materialized (
  select s.*,coalesce(s.tenant_kind,case when s.id='space-001' and c.layout='flat' then 'hall' end) effective_kind,c.code,c.layout
  from public.papa_spaces s left join public.papa_public_route_spaces c on c.space_id=s.id where s.deleted_at is null
 ), hosts as materialized (
  select m.space_id,m.streamer_id,jsonb_build_object('id',m.streamer_id,'slug',r.room->>'slug','display_name',r.room->>'display_name','home_title',r.room->>'home_title','subtitle',r.room->>'subtitle','active',coalesce((r.room->>'active')::boolean,true)) descriptor,coalesce(r.room->>'display_name','未命名主播') name,r.room->>'slug' slug,
   coalesce((r.room->>'active')::boolean,true) active,m.archived_at,p.code public_code,
   case when c.code is not null and p.code is not null then public.papa_public_route_home(c.layout,c.code,p.code) end home_path,
   exists(select 1 from public.papa_streamer_accounts a where a.streamer_id=m.streamer_id and a.enabled) login_enabled,
   exists(select 1 from public.papa_streamer_accounts a where a.streamer_id=m.streamer_id) login_exists,
   exists(select 1 from public.papa_manager_account_links l where l.manager_key='streamer:'||m.streamer_id) account_ready
  from public.papa_space_streamers m join registry r on r.room->>'id'=m.streamer_id
  left join public.papa_public_route_spaces c on c.space_id=m.space_id
  left join public.papa_public_route_streamers p on p.space_id=m.space_id and p.streamer_id=m.streamer_id
  where m.deleted_at is null
 ), managers as materialized (
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
   'operational',s.id='space-001',
   'provisioningPending',exists(select 1 from public.papa_management_audit a where a.space_id=s.id and a.action='create'),
   'hostCount',(select count(*) from hosts h where h.space_id=s.id),
   'managerCount',(select count(*) from managers m where m.space_id=s.id),
   'managers',coalesce((select jsonb_agg(jsonb_build_object('accountId',m.account_id,'name',m.name) order by m.name,m.account_id)
    from (select * from managers where space_id=s.id order by name,account_id limit 6) m),'[]'::jsonb),
   'hosts',coalesce((select jsonb_agg(jsonb_build_object('id',h.streamer_id,'spaceId',h.space_id,'spaceName',s.display_name,'spaceKind',s.effective_kind,'name',h.name,'slug',h.slug,'active',h.active,'archivedAt',h.archived_at,'homePath',h.home_path,'loginEnabled',h.login_enabled,'loginExists',h.login_exists,'accountReady',h.account_ready,'operational',s.id='space-001','descriptor',h.descriptor) order by h.name,h.streamer_id) from (select * from hosts where space_id=s.id order by name,streamer_id limit 12) h),'[]'::jsonb)) row
  from spaces s where requested_space is null and (category='all' or s.effective_kind=category)
   and (strpos(lower(s.display_name),lower(search_text))>0 or strpos(lower(s.code),lower(search_text))>0
    or exists(select 1 from hosts h where h.space_id=s.id and (strpos(lower(h.name),lower(search_text))>0 or strpos(lower(h.public_code),lower(search_text))>0 or strpos(lower(h.slug),lower(search_text))>0)))
  union all
  select h.streamer_id,h.name,jsonb_build_object('id',h.streamer_id,'kind','streamer','spaceId',h.space_id,'spaceName',s.display_name,'spaceKind',s.effective_kind,'name',h.name,'slug',h.slug,'active',h.active,'archivedAt',h.archived_at,'homePath',h.home_path,'loginEnabled',h.login_enabled,'loginExists',h.login_exists,'accountReady',h.account_ready,'operational',s.id='space-001','descriptor',h.descriptor)
  from hosts h join spaces s on s.id=h.space_id where requested_space is not null and h.space_id=requested_space
   and (strpos(lower(h.name),lower(search_text))>0 or strpos(lower(h.public_code),lower(search_text))>0 or strpos(lower(h.slug),lower(search_text))>0)
 ), counted as (select count(*)::integer total from candidates),chosen as (select total,least(requested_page,greatest(1,(total+19)/20)) page from counted),
 paged as (select * from candidates order by name,key limit 20 offset ((select page from chosen)-1)*20)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row order by name,key) from paged),'[]'::jsonb),'total',total,'page',page,'pages',greatest(1,(total+19)/20),
  'summary',jsonb_build_object('halls',(select count(*) from spaces where effective_kind='hall'),'streamerSpaces',(select count(*) from hosts),'pendingSetup',(select count(*) from spaces s where s.status<>'active' or not exists(select 1 from hosts h where h.space_id=s.id))),
  'scope',requested_space,'registryRevision',(select revision from public.papa_v2_revision where id=1)) into result from chosen;
 return result;
end;$function$;

drop function if exists public.papa_space_player_logins(jsonb,text);
drop function if exists public.papa_space_player_login(text,text,text,text);
drop function if exists public.papa_space_player_access(jsonb,text,text,text,text,boolean,boolean,bigint);
drop function if exists public.papa_space_player_create(bigint,jsonb,jsonb,jsonb,jsonb,text,text,text,text);
drop function if exists public.papa_space_player_scope(jsonb,text);
notify pgrst,'reload schema';
commit;
