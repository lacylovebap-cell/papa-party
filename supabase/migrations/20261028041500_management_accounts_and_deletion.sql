-- Batch 1: platform management accounts, provisioning and safe deletion.
-- Additive only: two nullable tombstone columns, one archive table, guard
-- triggers and new service-only functions. Existing functions are reused, not
-- rewritten, except papa_space_center_directory which now hides deleted rows.
-- No player, song, queue, ledger, badge, notification or Audit row is rewritten.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

do $$ begin
 if to_regclass('public.papa_management_audit') is null or to_regclass('public.papa_space_streamers') is null
  or to_regclass('public.papa_space_memberships') is null or to_regclass('public.papa_manager_account_links') is null
  or to_regclass('public.papa_streamer_accounts') is null or to_regclass('public.papa_public_route_spaces') is null
  or to_regprocedure('public.papa_release_b_commit(bigint,jsonb,jsonb,jsonb,jsonb)') is null
  or to_regprocedure('public.papa_manage_streamer_login(text,text,boolean,text)') is null
  or to_regprocedure('public.papa_manage_space(uuid,uuid,text,jsonb)') is null
 then raise exception 'MANAGEMENT_PREREQUISITE_MISSING';end if;
end $$;

-- Tombstones: Audit, event and URL history keep foreign keys to these rows and
-- are immutable, so a deleted Space/streamer keeps a reserved, unusable row.
alter table public.papa_spaces add column if not exists deleted_at timestamptz;
alter table public.papa_space_streamers add column if not exists deleted_at timestamptz;

create table if not exists public.papa_management_deletions(
 operation_id uuid primary key,
 actor_account_id uuid not null references public.papa_accounts(id),
 target_kind text not null check(target_kind in ('streamer','space')),
 space_id text not null,
 streamer_id text,
 target_name text not null,
 request_data jsonb not null,
 removed jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists papa_management_deletions_space on public.papa_management_deletions(space_id,created_at);
alter table public.papa_management_deletions enable row level security;
revoke all on public.papa_management_deletions from public,anon,authenticated,service_role;

create or replace function public.papa_management_deletions_immutable() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'MANAGEMENT_DELETION_IMMUTABLE';end;$$;
drop trigger if exists papa_management_deletions_immutable on public.papa_management_deletions;
create trigger papa_management_deletions_immutable before update or delete on public.papa_management_deletions
 for each row execute function public.papa_management_deletions_immutable();

-- A deleted Space or streamer can never be revived, renamed or receive new
-- members/streamers through any existing path.
create or replace function public.papa_space_tombstone_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_name='papa_spaces' then
  if old.deleted_at is not null then raise exception 'SPACE_DELETED';end if;
  return new;
 end if;
 if tg_table_name='papa_space_streamers' and tg_op='UPDATE' then
  if old.deleted_at is not null then raise exception 'STREAMER_DELETED';end if;
 end if;
 if exists(select 1 from public.papa_spaces where id=new.space_id and deleted_at is not null) then raise exception 'SPACE_DELETED';end if;
 if tg_table_name='papa_space_memberships' and new.streamer_id is not null
  and exists(select 1 from public.papa_space_streamers where streamer_id=new.streamer_id and deleted_at is not null)
 then raise exception 'STREAMER_DELETED';end if;
 return new;
end;$$;
drop trigger if exists papa_space_tombstone_guard on public.papa_spaces;
create trigger papa_space_tombstone_guard before update on public.papa_spaces
 for each row execute function public.papa_space_tombstone_guard();
drop trigger if exists papa_space_streamer_tombstone_guard on public.papa_space_streamers;
create trigger papa_space_streamer_tombstone_guard before insert or update on public.papa_space_streamers
 for each row execute function public.papa_space_tombstone_guard();
drop trigger if exists papa_space_membership_tombstone_guard on public.papa_space_memberships;
create trigger papa_space_membership_tombstone_guard before insert or update on public.papa_space_memberships
 for each row execute function public.papa_space_tombstone_guard();

-- A deleted streamer's reserved ID can never receive new business rows, even
-- from a stale client that still holds the old room ID.
create or replace function public.papa_entity_tombstone_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.papa_space_streamers where streamer_id=new.data->>'streamer_id' and deleted_at is not null)
 then raise exception 'STREAMER_DELETED';end if;
 return new;
end;$$;
drop trigger if exists papa_entity_tombstone_guard on public.papa_v2_entities;
create trigger papa_entity_tombstone_guard before insert on public.papa_v2_entities
 for each row when (new.kind in ('songs','ledger','queue','crowns','cards','wishes'))
 execute function public.papa_entity_tombstone_guard();

-- Same president proof as the registry functions: verified Account, platform
-- role and the president credential link. Never a client-supplied role.
create or replace function public.papa_management_is_president(subject uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select subject is not null
  and exists(select 1 from public.papa_accounts where id=subject and disabled_at is null)
  and exists(select 1 from public.papa_platform_roles where account_id=subject and role='president')
  and exists(select 1 from public.papa_manager_account_links where account_id=subject and manager_key='president');
$$;

create or replace function public.papa_management_registry_room(room_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select room from public.papa_v2_entities e cross join lateral jsonb_array_elements(
  case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) room
 where e.kind='meta' and e.id='1' and room->>'id'=room_id limit 1;
$$;

-- Internal registry writer. It mirrors papa_streamer_registry_commit's
-- validation and still commits through papa_release_b_commit (events/audit),
-- but also accepts a suspended (not yet operational) Space for the president.
create or replace function public.papa_management_registry_write(subject uuid,requested_space text,replacement_room jsonb,
 room_settings jsonb,expected bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_revision bigint;room_id text;room_slug text;mapped public.papa_space_streamers;space_row public.papa_spaces;
 old_meta jsonb;old_room jsonb;prepared_room jsonb;prepared_meta jsonb;public_patch jsonb;stamp text;next_revision bigint;
 public_fields text[]=array['id','slug','display_name','home_title','subtitle','description','avatar_url','banner_url','active','created_at','updated_at'];
begin
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 select * into space_row from public.papa_spaces where id=requested_space for update;
 if not found or space_row.deleted_at is not null then raise exception 'SPACE_NOT_FOUND';end if;
 if jsonb_typeof(replacement_room) is distinct from 'object' then raise exception 'STREAMER_REGISTRY_DESCRIPTOR_INVALID';end if;
 room_id=replacement_room->>'id';room_slug=replacement_room->>'slug';
 if jsonb_typeof(replacement_room->'id') is distinct from 'string' or nullif(btrim(room_id),'') is null or length(room_id)>200
  or jsonb_typeof(replacement_room->'slug') is distinct from 'string' or room_slug !~ '^[a-z0-9][a-z0-9-]{0,39}$'
  or jsonb_typeof(replacement_room->'display_name') is distinct from 'string'
  or nullif(btrim(replacement_room->>'display_name'),'') is null or length(replacement_room->>'display_name')>100
  or replacement_room ? 'active' and jsonb_typeof(replacement_room->'active') is distinct from 'boolean'
  or exists(select 1 from jsonb_each(replacement_room) field where field.key<>all(public_fields))
  or exists(select 1 from jsonb_each(replacement_room) field
   where field.key<>'active' and jsonb_typeof(field.value) is distinct from 'string')
 then raise exception 'STREAMER_REGISTRY_DESCRIPTOR_INVALID';end if;
 select revision into current_revision from public.papa_v2_revision where id=1 for update;
 if expected is not null and expected<>current_revision then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 select data into old_meta from public.papa_v2_entities where kind='meta' and id='1' for update;
 if jsonb_typeof(old_meta->'streamers') is distinct from 'array' or jsonb_typeof(old_meta->'streamerSettings') is distinct from 'object'
 then raise exception 'STREAMER_REGISTRY_METADATA_INVALID';end if;
 if (select count(*) from jsonb_array_elements(old_meta->'streamers') room where room->>'id'=room_id)>1
  or exists(select 1 from jsonb_array_elements(old_meta->'streamers') room where room->>'id' is distinct from room_id and room->>'slug'=room_slug)
 then raise exception 'STREAMER_REGISTRY_DUPLICATE';end if;
 select room into old_room from jsonb_array_elements(old_meta->'streamers') room where room->>'id'=room_id;
 select * into mapped from public.papa_space_streamers where streamer_id=room_id for update;
 if found and (mapped.space_id<>requested_space or mapped.deleted_at is not null) or old_room is not null and not found
 then raise exception 'STREAMER_REGISTRY_SCOPE_INVALID';end if;
 -- An independent Space is one streamer's own Space.
 if old_room is null and space_row.tenant_kind='independent' and exists(select 1 from public.papa_space_streamers m
   where m.space_id=requested_space and m.deleted_at is null and public.papa_management_registry_room(m.streamer_id) is not null)
 then raise exception 'INDEPENDENT_SINGLE_STREAMER';end if;
 select coalesce(jsonb_object_agg(field.key,field.value),'{}'::jsonb) into public_patch from jsonb_each(replacement_room) field;
 stamp=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 prepared_room=coalesce(old_room,'{}'::jsonb)||public_patch||jsonb_build_object(
  'created_at',coalesce(old_room->>'created_at',public_patch->>'created_at',stamp),'updated_at',stamp,
  'active',coalesce(public_patch->'active',old_room->'active','true'::jsonb));
 prepared_meta=jsonb_set(old_meta,'{streamers}',case when old_room is null then old_meta->'streamers'||jsonb_build_array(prepared_room)
  else (select jsonb_agg(case when room->>'id'=room_id then prepared_room else room end order by ordinal)
   from jsonb_array_elements(old_meta->'streamers') with ordinality rooms(room,ordinal)) end);
 if old_room is null then
  if jsonb_typeof(room_settings) is distinct from 'object' then raise exception 'STREAMER_REGISTRY_SETTINGS_INVALID';end if;
  if old_meta->'streamerSettings' ? room_id then raise exception 'STREAMER_REGISTRY_METADATA_INVALID';end if;
  prepared_meta=jsonb_set(prepared_meta,'{streamerSettings}',old_meta->'streamerSettings'||jsonb_build_object(room_id,room_settings));
  insert into public.papa_space_streamers(streamer_id,space_id) values(room_id,requested_space) on conflict(streamer_id) do nothing;
  if not exists(select 1 from public.papa_space_streamers where streamer_id=room_id and space_id=requested_space and deleted_at is null)
  then raise exception 'STREAMER_REGISTRY_SCOPE_INVALID';end if;
 end if;
 next_revision=public.papa_release_b_commit(current_revision,jsonb_build_array(jsonb_build_object('kind','meta','id','1','data',prepared_meta)),'[]'::jsonb,
  jsonb_build_object('role','super_admin','account_id',subject::text,'space_id',requested_space,'streamer_id',room_id,'action','streamer'),'[]'::jsonb);
 return jsonb_build_object('revision',next_revision,'room',prepared_room,'created',old_room is null);
end;$$;

-- Internal: the streamer credential's canonical Account, created at provisioning
-- time instead of on first login, plus its active streamer_admin membership.
create or replace function public.papa_management_streamer_account(requested_space text,room_id text,activate boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare account uuid;
begin
 perform pg_advisory_xact_lock(hashtext('papa-account:streamer:'||room_id));
 select account_id into account from public.papa_manager_account_links where manager_key='streamer:'||room_id;
 if account is null then
  insert into public.papa_accounts default values returning id into account;
  insert into public.papa_manager_account_links(manager_key,account_id) values('streamer:'||room_id,account);
 elsif activate then
  update public.papa_accounts set disabled_at=null where id=account and disabled_at is not null;
 end if;
 insert into public.papa_space_memberships(account_id,space_id,role,streamer_id,status)
 values(account,requested_space,'streamer_admin',room_id,'active')
 on conflict(account_id,space_id,role,streamer_id) where streamer_id is not null
 do update set status=case when activate then 'active' else public.papa_space_memberships.status end;
 return account;
end;$$;

create or replace function public.papa_management_login_reason(result jsonb) returns text
language sql immutable set search_path='' as $$
 select case result->>'reason' when 'weak_password' then 'STREAMER_LOGIN_WEAK_PASSWORD'
  when 'same_as_president' then 'STREAMER_LOGIN_SAME_AS_PRESIDENT' when 'password_required' then 'STREAMER_LOGIN_PASSWORD_REQUIRED'
  else 'STREAMER_LOGIN_FAILED' end;
$$;

create or replace function public.papa_management_provision_streamer(subject uuid,operation uuid,payload jsonb,password text,auth_user text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.papa_management_audit;request jsonb;mode text;target_space text;created_space jsonb;written jsonb;room_id text;
 account uuid;login jsonb;login_enabled boolean;result jsonb;before_room jsonb;
begin
 if operation is null or jsonb_typeof(payload) is distinct from 'object' then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 perform 1 from public.papa_accounts where id=subject and disabled_at is null for share;
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(operation::text,0));
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('mode','spaceId','spaceName','room','settings','expectedRevision','loginEnabled'))
 then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 mode=payload->>'mode';
 if mode is null or mode not in ('independent','streamer') or payload ? 'loginEnabled' and jsonb_typeof(payload->'loginEnabled')<>'boolean'
  or payload ? 'expectedRevision' and jsonb_typeof(payload->'expectedRevision')<>'number'
  or password is not null and (length(password)<4 or octet_length(password)>72)
  or password is not null and not (payload ? 'loginEnabled')
 then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 login_enabled=(payload->>'loginEnabled')::boolean;
 -- The password itself is never stored in the Audit request.
 request=payload||jsonb_build_object('passwordProvided',password is not null);
 select * into prior from public.papa_management_audit where operation_id=operation;
 if found then
  if prior.actor_account_id<>subject or prior.action<>'provision_streamer' or prior.request_data<>request then raise exception 'OPERATION_CONFLICT';end if;
  return prior.after_data;
 end if;
 if mode='independent' then
  if length(btrim(coalesce(payload->>'spaceName','')))=0 or length(payload->>'spaceName')>100 or payload ? 'spaceId'
   or payload->'room' ? 'id' and exists(select 1 from public.papa_space_streamers where streamer_id=payload->'room'->>'id')
  then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
  created_space=public.papa_manage_space(subject,md5(operation::text||':space')::uuid,'create',
   jsonb_build_object('name',btrim(payload->>'spaceName'),'kind','independent'));
  target_space=created_space->>'id';
 else
  target_space=payload->>'spaceId';
  if target_space is null or length(target_space)>200 then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 end if;
 before_room=public.papa_management_registry_room(payload->'room'->>'id');
 written=public.papa_management_registry_write(subject,target_space,payload->'room',payload->'settings',(payload->>'expectedRevision')::bigint);
 room_id=written->'room'->>'id';
 if password is not null or login_enabled is not null then
  if password is null and not exists(select 1 from public.papa_streamer_accounts where streamer_id=room_id) then
   if login_enabled then raise exception 'STREAMER_LOGIN_PASSWORD_REQUIRED';end if;
  else
   login=public.papa_manage_streamer_login(room_id,password,login_enabled,auth_user);
   if coalesce((login->>'ok')::boolean,false) is not true then raise exception '%',public.papa_management_login_reason(login);end if;
  end if;
  if password is not null or login_enabled then account=public.papa_management_streamer_account(target_space,room_id,login_enabled);end if;
 end if;
 if account is null then select account_id into account from public.papa_manager_account_links where manager_key='streamer:'||room_id;end if;
 update public.papa_spaces set management_revision=management_revision+1 where id=target_space;
 result=jsonb_build_object('spaceId',target_space,'streamerId',room_id,'slug',written->'room'->>'slug','name',written->'room'->>'display_name',
  'created',(written->>'created')::boolean,'spaceCreated',mode='independent','registryRevision',(written->>'revision')::bigint,
  'accountId',account,'loginExists',exists(select 1 from public.papa_streamer_accounts where streamer_id=room_id),
  'loginEnabled',exists(select 1 from public.papa_streamer_accounts where streamer_id=room_id and enabled));
 insert into public.papa_management_audit(operation_id,actor_account_id,space_id,action,request_data,before_data,after_data)
 values(operation,subject,target_space,'provision_streamer',request,before_room,result);
 return result;
end;$$;

create or replace function public.papa_management_streamer_login(subject uuid,operation uuid,payload jsonb,password text,auth_user text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.papa_management_audit;request jsonb;target_space text;room_id text;mapping public.papa_space_streamers;room jsonb;
 login jsonb;account uuid;wanted boolean;result jsonb;before_value jsonb;
begin
 if operation is null or jsonb_typeof(payload) is distinct from 'object' then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 perform 1 from public.papa_accounts where id=subject and disabled_at is null for share;
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(operation::text,0));
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('spaceId','streamerId','enabled'))
  or jsonb_typeof(payload->'enabled') is distinct from 'boolean'
  or password is not null and (length(password)<4 or octet_length(password)>72)
 then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 target_space=payload->>'spaceId';room_id=payload->>'streamerId';wanted=(payload->>'enabled')::boolean;
 request=payload||jsonb_build_object('passwordProvided',password is not null);
 select * into prior from public.papa_management_audit where operation_id=operation;
 if found then
  if prior.actor_account_id<>subject or prior.action<>'streamer_login' or prior.request_data<>request then raise exception 'OPERATION_CONFLICT';end if;
  return prior.after_data;
 end if;
 perform 1 from public.papa_spaces where id=target_space and deleted_at is null for update;
 if not found then raise exception 'SPACE_NOT_FOUND';end if;
 select * into mapping from public.papa_space_streamers where streamer_id=room_id and space_id=target_space for update;
 room=public.papa_management_registry_room(room_id);
 if mapping.streamer_id is null or mapping.deleted_at is not null or room is null then raise exception 'STREAMER_SCOPE_INVALID';end if;
 if mapping.archived_at is not null and wanted then raise exception 'STREAMER_ARCHIVED';end if;
 before_value=jsonb_build_object('exists',exists(select 1 from public.papa_streamer_accounts where streamer_id=room_id),
  'enabled',exists(select 1 from public.papa_streamer_accounts where streamer_id=room_id and enabled));
 login=public.papa_manage_streamer_login(room_id,password,wanted,auth_user);
 if coalesce((login->>'ok')::boolean,false) is not true then raise exception '%',public.papa_management_login_reason(login);end if;
 if wanted or password is not null then account=public.papa_management_streamer_account(target_space,room_id,wanted);
 else select account_id into account from public.papa_manager_account_links where manager_key='streamer:'||room_id;end if;
 update public.papa_spaces set management_revision=management_revision+1 where id=target_space;
 result=jsonb_build_object('spaceId',target_space,'streamerId',room_id,'slug',room->>'slug','name',room->>'display_name','accountId',account,
  'loginExists',true,'loginEnabled',wanted,'passwordChanged',password is not null);
 insert into public.papa_management_audit(operation_id,actor_account_id,space_id,action,request_data,before_data,after_data)
 values(operation,subject,target_space,'streamer_login',request,before_value,result);
 return result;
end;$$;

create or replace function public.papa_management_streamer_login_status(subject uuid,requested_space text,requested_streamer text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
end;$$;

-- Every Account that can hold management authority, across all Spaces.
create or replace function public.papa_management_account_list(subject uuid,search_text text default '',requested_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if search_text is null or length(search_text)>100 or requested_page is null or requested_page<1 or requested_page>100000
 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 with registry as materialized (
  select r.value room from public.papa_v2_entities e cross join lateral jsonb_array_elements(
   case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end) r(value) where e.kind='meta' and e.id='1'
 ), candidates as materialized (
  select a.id,a.disabled_at from public.papa_accounts a where
   exists(select 1 from public.papa_platform_roles p where p.account_id=a.id and p.role='president')
   or exists(select 1 from public.papa_manager_account_links l where l.account_id=a.id)
   or exists(select 1 from public.papa_space_memberships m join public.papa_spaces s on s.id=m.space_id
    where m.account_id=a.id and m.role in ('space_admin','streamer_admin') and s.deleted_at is null)
   or exists(select 1 from public.papa_spaces s where s.owner_account_id=a.id and s.deleted_at is null)
 ), described as materialized (
  select c.id,c.disabled_at,l.manager_key,
   case when l.manager_key like 'streamer:%' then (select r.room->>'slug' from registry r where r.room->>'id'=substr(l.manager_key,10) limit 1) end login_code,
   coalesce(nullif(p.data->>'name',''),case when l.manager_key='president' then '平台總裁'
    when l.manager_key like 'streamer:%' then (select nullif(r.room->>'display_name','') from registry r where r.room->>'id'=substr(l.manager_key,10) limit 1) end,
    '未命名管理帳號') name,
   case when exists(select 1 from public.papa_platform_roles x where x.account_id=c.id and x.role='president') then 'president'
    when l.manager_key like 'streamer:%' then 'streamer' when b.legacy_player_id is not null then 'player' else 'account' end kind,
   (select coalesce(jsonb_agg(jsonb_build_object('spaceId',m.space_id,'spaceName',s.display_name,'spaceKind',coalesce(s.tenant_kind,case when s.id='space-001' then 'hall' end),
     'role',m.role,'streamerId',m.streamer_id,'streamerName',(select r.room->>'display_name' from registry r where r.room->>'id'=m.streamer_id limit 1),
     'status',m.status,'owner',false) order by s.display_name,m.role,m.streamer_id),'[]'::jsonb)
    from public.papa_space_memberships m join public.papa_spaces s on s.id=m.space_id
    where m.account_id=c.id and m.role in ('space_admin','streamer_admin') and s.deleted_at is null) roles,
   (select coalesce(jsonb_agg(jsonb_build_object('spaceId',s.id,'spaceName',s.display_name) order by s.display_name),'[]'::jsonb)
    from public.papa_spaces s where s.owner_account_id=c.id and s.deleted_at is null) owned
  from candidates c left join public.papa_manager_account_links l on l.account_id=c.id
  left join public.papa_account_legacy_players b on b.account_id=c.id left join public.papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
 ), filtered as materialized (
  select * from described d where search_text=''
   or strpos(lower(d.name),lower(search_text))>0 or strpos(lower(coalesce(d.login_code,'')),lower(search_text))>0
   or exists(select 1 from jsonb_array_elements(d.roles) r where strpos(lower(coalesce(r->>'spaceName','')),lower(search_text))>0
    or strpos(lower(coalesce(r->>'streamerName','')),lower(search_text))>0)
 ), counted as (select count(*)::integer total from filtered), chosen as (select total,least(requested_page,greatest(1,(total+19)/20)) page from counted),
 paged as (select * from filtered order by kind<>'president',name,id limit 20 offset ((select page from chosen)-1)*20)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'managerKey',manager_key,'loginCode',login_code,
   'disabledAt',disabled_at,'roles',case when jsonb_array_length(roles)>12 then (select jsonb_agg(x) from (select x from jsonb_array_elements(roles) x limit 12) y) else roles end,
   'roleCount',jsonb_array_length(roles),'owned',owned) order by kind<>'president',name,id) from paged),'[]'::jsonb),
  'total',total,'page',page,'pages',greatest(1,(total+19)/20)) into result from chosen;
 return result;
end;$$;

-- Bounded count helper for optional relations. A missing table counts as 0 only
-- when the caller explicitly knows it is optional; values are never returned.
create or replace function public.papa_management_relation_count(relation text,column_name text,value text,extra text default null)
returns bigint language plpgsql stable security definer set search_path='' as $$
declare n bigint;
begin
 if to_regclass('public.'||relation) is null then return 0;end if;
 if not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=('public.'||relation)::regclass and a.attname=column_name and not a.attisdropped)
 then return 0;end if;
 execute format('select count(*) from (select 1 from public.%I where %I=$1 %s limit 1001) hits',relation,column_name,coalesce(extra,'')) into n using value;
 return n;
end;$$;

create or replace function public.papa_management_delete_review(subject uuid,requested_space text,requested_streamer text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare space_row public.papa_spaces;mapping public.papa_space_streamers;room jsonb;blockers jsonb='[]';removes jsonb='[]';keeps jsonb='[]';
 affected jsonb='[]';n bigint;item record;r record;target_name text;target_kind text;host record;host_review jsonb;also_removes jsonb;
 registry_revision bigint;payload jsonb;known text[];
 business text[][]=array[
  array['papa_achievement_awards','勳章取得紀錄'],array['papa_achievement_draws','勳章抽選紀錄'],array['papa_achievement_request_draws','點歌抽選紀錄'],
  array['papa_achievement_public_choices','玩家勳章公開設定'],array['papa_badge_show_settlements','場次勳章結算'],array['papa_board_posts','留言板內容'],
  array['papa_chat_messages','私訊內容'],array['papa_chat_reads','私訊已讀紀錄'],array['papa_song_favorites','玩家收藏'],array['papa_player_extra_quotas','玩家專屬提歌權'],
  array['papa_catalog_song_links','共同曲庫關聯'],array['papa_catalog_candidates','共同曲庫待審資料'],array['papa_catalog_custom_archives','自訂曲庫封存'],
  array['papa_catalog_lyric_proposals','歌詞修訂提案'],array['papa_catalog_lyric_selections','歌詞版本選擇'],array['papa_catalog_private_notes','歌曲私人備註']];
 setup text[][]=array[
  array['papa_streamer_accounts','主播登入密碼'],array['papa_streamer_login_attempts','登入嘗試紀錄'],array['papa_v2_sessions','目前登入狀態'],
  array['papa_push_subscriptions','推播訂閱'],array['papa_notice_preferences','通知偏好'],array['papa_room_sync_revisions','同步計數'],
  array['papa_operation_receipts','操作回執'],array['papa_catalog_language_filter_items','歌本語言篩選項目'],array['papa_catalog_language_filters','歌本語言篩選'],
  array['papa_achievement_visibility','勳章顯示設定'],array['papa_player_activity','活動監看紀錄']];
 history text[][]=array[array['papa_events','操作歷史'],array['papa_public_route_aliases','舊網址與 QR 紀錄'],array['papa_public_route_audit','網址變更紀錄']];
begin
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if requested_space is null or length(requested_space)>200 or length(coalesce(requested_streamer,''))>200 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 select * into space_row from public.papa_spaces where id=requested_space;
 if not found or space_row.deleted_at is not null then raise exception 'SPACE_NOT_FOUND';end if;
 select revision into registry_revision from public.papa_v2_revision where id=1;
 if requested_streamer is not null then
  target_kind='streamer';
  select * into mapping from public.papa_space_streamers where space_id=requested_space and streamer_id=requested_streamer;
  room=public.papa_management_registry_room(requested_streamer);
  if mapping.streamer_id is null or mapping.deleted_at is not null or room is null then raise exception 'STREAMER_SCOPE_INVALID';end if;
  target_name=room->>'display_name';
  if requested_streamer='papa' then blockers=blockers||jsonb_build_array(jsonb_build_object('code','PROTECTED','label','此為平台原始主播，不能刪除','count',1));end if;
  for item in select k from unnest(array['songs','queue','ledger','crowns','cards','wishes']) k loop
   select count(*) into n from (select 1 from public.papa_v2_entities where kind=item.k and space_id=requested_space and data->>'streamer_id'=requested_streamer limit 1001) hits;
   if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','BUSINESS:'||item.k,'count',least(n,1000),'capped',n>1000,
    'label',case item.k when 'songs' then '歌本歌曲' when 'queue' then '待播／演唱紀錄' when 'ledger' then '存歌／帳務' when 'crowns' then '冠歌'
     when 'cards' then '卡片' else '許願池' end));end if;
  end loop;
  for i in 1..array_length(business,1) loop
   n=public.papa_management_relation_count(business[i][1],'streamer_id',requested_streamer);
   if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','DATA:'||business[i][1],'label',business[i][2],'count',least(n,1000),'capped',n>1000));end if;
  end loop;
  n=public.papa_management_relation_count('papa_notifications','streamer_id',requested_streamer,'and recipient not in (''__admin__'',''__super__'')');
  if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','DATA:player_notifications','label','玩家通知紀錄','count',least(n,1000),'capped',n>1000));end if;
  select count(*) into n from (select 1 from public.papa_v2_entities where kind='players' and strpos(data::text,'"'||requested_streamer||'"')>0 limit 1001) hits;
  if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','DATA:player_json','label','玩家資料內仍有此主播紀錄','count',least(n,1000),'capped',n>1000));end if;
  n=public.papa_management_relation_count('papa_device_sessions','streamer_id',requested_streamer)+public.papa_management_relation_count('papa_device_space_preferences','home_streamer_id',requested_streamer)
   +public.papa_management_relation_count('papa_device_space_preferences','last_streamer_id',requested_streamer);
  if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','DEVICE','label','App 裝置登入或預設首頁（請該裝置登出或改預設首頁）','count',least(n,1000),'capped',n>1000));end if;
  -- Removed configuration and login data (archived in the deletion record).
  removes=removes||jsonb_build_array(jsonb_build_object('code','DESCRIPTOR','label','主播資料與首頁設定','count',1));
  select count(*) into n from public.papa_space_memberships where space_id=requested_space and streamer_id=requested_streamer;
  if n>0 then removes=removes||jsonb_build_array(jsonb_build_object('code','MEMBERSHIPS','label','此主播的管理授權','count',n));end if;
  for i in 1..array_length(setup,1) loop
   n=public.papa_management_relation_count(setup[i][1],'streamer_id',requested_streamer);
   if n>0 then removes=removes||jsonb_build_array(jsonb_build_object('code','SETUP:'||setup[i][1],'label',setup[i][2],'count',least(n,1000),'capped',n>1000));end if;
  end loop;
  n=public.papa_management_relation_count('papa_notifications','streamer_id',requested_streamer,'and recipient in (''__admin__'',''__super__'')');
  if n>0 then removes=removes||jsonb_build_array(jsonb_build_object('code','SETUP:admin_notifications','label','管理通知','count',least(n,1000),'capped',n>1000));end if;
  if exists(select 1 from public.papa_manager_account_links where manager_key='streamer:'||requested_streamer) then
   removes=removes||jsonb_build_array(jsonb_build_object('code','ACCOUNT_LINK','label','主播登入帳號（若沒有其他身分將一併停用）','count',1));end if;
  for i in 1..array_length(history,1) loop
   n=public.papa_management_relation_count(history[i][1],'streamer_id',requested_streamer);
   if n>0 then keeps=keeps||jsonb_build_array(jsonb_build_object('code','HISTORY:'||history[i][1],'label',history[i][2],'count',least(n,1000),'capped',n>1000));end if;
  end loop;
  known=array['papa_v2_entities','papa_space_streamers','papa_space_memberships','papa_notifications','papa_device_sessions','papa_device_space_preferences',
   'papa_public_route_streamers']||(select array_agg(business[i][1]) from generate_subscripts(business,1) i)
   ||(select array_agg(setup[i][1]) from generate_subscripts(setup,1) i)||(select array_agg(history[i][1]) from generate_subscripts(history,1) i);
  for r in select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
   join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attname='streamer_id' and not a.attisdropped
   where ns.nspname='public' and c.relkind in ('r','p') and c.relname like 'papa\_%' escape '\' and c.relname<>all(known) order by c.relname loop
   n=public.papa_management_relation_count(r.relname,'streamer_id',requested_streamer);
   if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','UNKNOWN:'||r.relname,'label','其他資料（'||r.relname||'）','count',least(n,1000),'capped',n>1000));end if;
  end loop;
 else
  target_kind='space';target_name=space_row.display_name;
  if requested_space='space-001' then blockers=blockers||jsonb_build_array(jsonb_build_object('code','PROTECTED','label','聲瑪為平台原始廳，不能刪除','count',1));end if;
  for host in select m.streamer_id,public.papa_management_registry_room(m.streamer_id) room from public.papa_space_streamers m
   where m.space_id=requested_space and m.deleted_at is null order by m.streamer_id loop
   affected=affected||jsonb_build_array(jsonb_build_object('id',host.streamer_id,'name',coalesce(host.room->>'display_name','未命名主播')));
  end loop;
  if space_row.tenant_kind='independent' and jsonb_array_length(affected)=1 then
   host_review=public.papa_management_delete_review(subject,requested_space,affected->0->>'id');
   also_removes=jsonb_build_object('id',affected->0->>'id','name',affected->0->>'name');
   blockers=blockers||coalesce((select jsonb_agg(x||jsonb_build_object('label','主播「'||(affected->0->>'name')||'」：'||(x->>'label'))) from jsonb_array_elements(host_review->'blockers') x),'[]'::jsonb);
   removes=removes||host_review->'removes';keeps=keeps||host_review->'keeps';
  elsif jsonb_array_length(affected)>0 then
   blockers=blockers||jsonb_build_array(jsonb_build_object('code','HAS_STREAMERS','count',jsonb_array_length(affected),
    'label','此空間仍有主播，不會自動連帶刪除；請先逐一刪除或移出：'||(select string_agg(x->>'name','、') from jsonb_array_elements(affected) x)));
  end if;
  select count(*) into n from (select 1 from public.papa_v2_entities where space_id=requested_space limit 1001) hits;
  if n>0 and also_removes is null then blockers=blockers||jsonb_build_array(jsonb_build_object('code','BUSINESS','label','空間業務資料','count',least(n,1000),'capped',n>1000));end if;
  n=public.papa_management_relation_count('papa_device_space_preferences','home_space_id',requested_space)
   +public.papa_management_relation_count('papa_device_space_preferences','last_space_id',requested_space);
  if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','DEVICE','label','App 裝置以此空間為預設首頁（請該裝置改預設首頁）','count',least(n,1000),'capped',n>1000));end if;
  select count(*) into n from public.papa_space_memberships where space_id=requested_space and role='player';
  if n>0 then blockers=blockers||jsonb_build_array(jsonb_build_object('code','PLAYERS','label','空間玩家身分','count',n));end if;
  for r in select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
   join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attname='space_id' and not a.attisdropped
   where ns.nspname='public' and c.relkind in ('r','p') and c.relname like 'papa\_%' escape '\'
    and c.relname<>all(array['papa_v2_entities','papa_space_streamers','papa_space_memberships','papa_management_audit','papa_management_deletions','papa_events',
     'papa_public_route_spaces','papa_public_route_streamers','papa_public_route_aliases','papa_public_route_audit','papa_space_hostnames','papa_space_entitlements',
     'papa_space_policies','papa_notifications','papa_notice_center_preferences','papa_notice_page_snapshots','papa_room_sync_revisions','papa_operation_receipts',
     'papa_player_activity','papa_catalog_language_filters','papa_catalog_language_filter_items','papa_achievement_visibility'])
   order by c.relname loop
   n=public.papa_management_relation_count(r.relname,'space_id',requested_space);
   if n>0 and not (also_removes is not null and public.papa_management_relation_count(r.relname,'streamer_id',also_removes->>'id')=n) then
    blockers=blockers||jsonb_build_array(jsonb_build_object('code','DATA:'||r.relname,'label','空間其他資料（'||r.relname||'）','count',least(n,1000),'capped',n>1000));end if;
  end loop;
  removes=removes||jsonb_build_array(jsonb_build_object('code','SPACE','label','空間資料（從清單、登入及網址移除）','count',1));
  select count(*) into n from public.papa_space_memberships where space_id=requested_space and role='space_admin';
  if n>0 then removes=removes||jsonb_build_array(jsonb_build_object('code','SPACE_MEMBERSHIPS','label','廳管理員授權','count',n));end if;
  select count(*) into n from public.papa_management_audit where space_id=requested_space;
  if n>0 then keeps=keeps||jsonb_build_array(jsonb_build_object('code','HISTORY:papa_management_audit','label','管理操作紀錄','count',n));end if;
 end if;
 payload=jsonb_build_object('target',jsonb_build_object('kind',target_kind,'spaceId',requested_space,'streamerId',requested_streamer,'name',target_name,
   'spaceName',space_row.display_name,'spaceKind',coalesce(space_row.tenant_kind,case when space_row.id='space-001' then 'hall' end)),
  'blockers',blockers,'removes',removes,'keeps',keeps,'affectedStreamers',case when also_removes is null then affected else '[]'::jsonb end,
  'alsoRemovesStreamer',also_removes,'safeToDelete',jsonb_array_length(blockers)=0,
  'spaceRevision',space_row.management_revision,'registryRevision',registry_revision);
 return payload||jsonb_build_object('confirmationToken',md5(payload::text));
end;$$;

-- Internal: removes one streamer after a fresh review inside the caller's
-- transaction. Business rows are never touched (review requires none).
create or replace function public.papa_management_remove_streamer(subject uuid,requested_space text,room_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare room jsonb;meta jsonb;settings jsonb;current_revision bigint;next_revision bigint;removed jsonb;account uuid;memberships jsonb;
 counts jsonb='{}';i int;n bigint;
 tables text[]=array['papa_streamer_login_attempts','papa_v2_sessions','papa_push_subscriptions','papa_notice_preferences','papa_room_sync_revisions',
  'papa_operation_receipts','papa_catalog_language_filter_items','papa_catalog_language_filters','papa_achievement_visibility','papa_player_activity'];
begin
 select revision into current_revision from public.papa_v2_revision where id=1 for update;
 select data into meta from public.papa_v2_entities where kind='meta' and id='1' for update;
 select x into room from jsonb_array_elements(meta->'streamers') x where x->>'id'=room_id;
 if room is null then raise exception 'STREAMER_SCOPE_INVALID';end if;
 settings=meta->'streamerSettings'->room_id;
 select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) into memberships from public.papa_space_memberships m where m.space_id=requested_space and m.streamer_id=room_id;
 delete from public.papa_space_memberships where space_id=requested_space and streamer_id=room_id;
 counts=counts||jsonb_build_object('credential',(select jsonb_build_object('exists',true,'enabled',enabled,'updatedAt',updated_at) from public.papa_streamer_accounts where streamer_id=room_id));
 delete from public.papa_streamer_accounts where streamer_id=room_id;
 delete from public.papa_manager_attempts where bucket in ('streamer:'||room_id,'change:streamer:'||room_id);
 for i in 1..array_length(tables,1) loop
  if to_regclass('public.'||tables[i]) is not null then
   execute format('with gone as (delete from public.%I where streamer_id=$1 returning 1) select count(*) from gone',tables[i]) into n using room_id;
   if n>0 then counts=counts||jsonb_build_object(tables[i],n);end if;
  end if;
 end loop;
 with gone as (delete from public.papa_notifications where streamer_id=room_id and recipient in ('__admin__','__super__') returning 1) select count(*) into n from gone;
 if n>0 then counts=counts||jsonb_build_object('admin_notifications',n);end if;
 select account_id into account from public.papa_manager_account_links where manager_key='streamer:'||room_id;
 if account is not null then
  delete from public.papa_manager_account_links where manager_key='streamer:'||room_id;
  if not exists(select 1 from public.papa_manager_account_links where account_id=account)
   and not exists(select 1 from public.papa_platform_roles where account_id=account)
   and not exists(select 1 from public.papa_account_legacy_players where account_id=account)
   and not exists(select 1 from public.papa_space_memberships where account_id=account and status='active')
   and not exists(select 1 from public.papa_spaces where owner_account_id=account and deleted_at is null)
  then update public.papa_accounts set disabled_at=coalesce(disabled_at,now()) where id=account;counts=counts||jsonb_build_object('accountDisabled',account);
  else counts=counts||jsonb_build_object('accountKept',account);end if;
 end if;
 meta=jsonb_set(meta,'{streamers}',coalesce((select jsonb_agg(x order by ord) from jsonb_array_elements(meta->'streamers') with ordinality r(x,ord)
  where x->>'id'<>room_id),'[]'::jsonb));
 meta=jsonb_set(meta,'{streamerSettings}',coalesce(meta->'streamerSettings','{}'::jsonb)-room_id);
 next_revision=public.papa_release_b_commit(current_revision,jsonb_build_array(jsonb_build_object('kind','meta','id','1','data',meta)),'[]'::jsonb,
  jsonb_build_object('role','super_admin','account_id',subject::text,'space_id',requested_space,'streamer_id',room_id,'action','delete_streamer'),'[]'::jsonb);
 update public.papa_space_streamers set deleted_at=now(),archived_at=coalesce(archived_at,now()) where streamer_id=room_id and space_id=requested_space;
 removed=jsonb_build_object('descriptor',room,'settings',settings,'memberships',memberships,'removedCounts',counts,'registryRevision',next_revision);
 return removed;
end;$$;

create or replace function public.papa_management_delete(subject uuid,operation uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.papa_management_deletions;review jsonb;target_space text;room_id text;removed jsonb;result jsonb;space_memberships jsonb;
 target_name text;target_kind text;hostnames bigint;
begin
 if operation is null or jsonb_typeof(payload) is distinct from 'object' then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 perform 1 from public.papa_accounts where id=subject and disabled_at is null for share;
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('spaceId','streamerId','confirmationToken','confirmedName'))
  or jsonb_typeof(payload->'spaceId') is distinct from 'string' or payload ? 'streamerId' and jsonb_typeof(payload->'streamerId')<>'string'
  or jsonb_typeof(payload->'confirmationToken') is distinct from 'string' or jsonb_typeof(payload->'confirmedName') is distinct from 'string'
 then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(operation::text,0));
 select * into prior from public.papa_management_deletions where operation_id=operation;
 if found then
  if prior.actor_account_id<>subject or prior.request_data<>payload then raise exception 'OPERATION_CONFLICT';end if;
  return prior.removed->'result';
 end if;
 target_space=payload->>'spaceId';room_id=payload->>'streamerId';
 -- Lock order: registry revision, Space, mapping(s); then re-review in the same transaction.
 perform 1 from public.papa_v2_revision where id=1 for update;
 perform 1 from public.papa_spaces where id=target_space and deleted_at is null for update;
 if not found then raise exception 'SPACE_NOT_FOUND';end if;
 perform 1 from public.papa_space_streamers where space_id=target_space and deleted_at is null order by streamer_id for update;
 review=public.papa_management_delete_review(subject,target_space,room_id);
 if review->>'confirmationToken' is distinct from payload->>'confirmationToken' then raise exception 'DELETE_PREVIEW_STALE';end if;
 if btrim(review->'target'->>'name') is distinct from btrim(payload->>'confirmedName') then raise exception 'DELETE_NAME_MISMATCH';end if;
 if review->'safeToDelete' is distinct from 'true'::jsonb then raise exception 'DELETE_DEPENDENCIES_PRESENT';end if;
 target_name=review->'target'->>'name';target_kind=review->'target'->>'kind';
 if target_kind='streamer' then
  removed=jsonb_build_object('streamer',public.papa_management_remove_streamer(subject,target_space,room_id));
  update public.papa_spaces set management_revision=management_revision+1 where id=target_space;
  result=jsonb_build_object('deleted',true,'kind','streamer','spaceId',target_space,'streamerId',room_id,'name',target_name);
  insert into public.papa_management_audit(operation_id,actor_account_id,space_id,action,request_data,before_data,after_data)
  values(operation,subject,target_space,'delete_streamer',payload,review-'confirmationToken',result);
 else
  if review->'alsoRemovesStreamer' is not null and jsonb_typeof(review->'alsoRemovesStreamer')='object' then
   removed=jsonb_build_object('streamer',public.papa_management_remove_streamer(subject,target_space,review->'alsoRemovesStreamer'->>'id'));
  else removed='{}'::jsonb;end if;
  select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) into space_memberships from public.papa_space_memberships m where m.space_id=target_space and m.role='space_admin';
  delete from public.papa_space_memberships where space_id=target_space and role='space_admin';
  hostnames=0;
  if to_regclass('public.papa_space_hostnames') is not null then
   execute 'with gone as (delete from public.papa_space_hostnames where space_id=$1 returning 1) select count(*) from gone' into hostnames using target_space;
  end if;
  result=jsonb_build_object('deleted',true,'kind','space','spaceId',target_space,'name',target_name,
   'streamerId',review->'alsoRemovesStreamer'->>'id');
  insert into public.papa_management_audit(operation_id,actor_account_id,space_id,action,request_data,before_data,after_data)
  values(operation,subject,target_space,'delete_space',payload,review-'confirmationToken',result);
  removed=removed||jsonb_build_object('space',(select to_jsonb(s) from public.papa_spaces s where s.id=target_space),'spaceMemberships',space_memberships,'hostnames',hostnames);
  update public.papa_spaces set status='suspended',deleted_at=now(),management_revision=management_revision+1 where id=target_space;
 end if;
 insert into public.papa_management_deletions(operation_id,actor_account_id,target_kind,space_id,streamer_id,target_name,request_data,removed)
 values(operation,subject,target_kind,target_space,coalesce(room_id,review->'alsoRemovesStreamer'->>'id'),target_name,payload,
  removed||jsonb_build_object('review',review-'confirmationToken','result',result));
 return result;
end;$$;

-- What still separates a Space from normal operation, in plain terms.
create or replace function public.papa_management_space_readiness(subject uuid,requested_space text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
end;$$;

-- Same contract as 20261025213142, now excluding deleted tombstones and
-- exposing per-host login and Account readiness for the card actions.
create or replace function public.papa_space_center_directory(subject uuid,category text default 'all',search_text text default '',requested_page integer default 1,requested_space text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
end;$$;

revoke all on function public.papa_management_is_president(uuid),public.papa_management_registry_room(text),
 public.papa_management_registry_write(uuid,text,jsonb,jsonb,bigint),public.papa_management_streamer_account(text,text,boolean),
 public.papa_management_login_reason(jsonb),public.papa_management_relation_count(text,text,text,text),
 public.papa_management_remove_streamer(uuid,text,text),public.papa_space_tombstone_guard(),public.papa_management_deletions_immutable(),
 public.papa_entity_tombstone_guard()
 from public,anon,authenticated,service_role;
revoke all on function public.papa_management_provision_streamer(uuid,uuid,jsonb,text,text),public.papa_management_streamer_login(uuid,uuid,jsonb,text,text),
 public.papa_management_streamer_login_status(uuid,text,text),public.papa_management_account_list(uuid,text,integer),
 public.papa_management_delete_review(uuid,text,text),public.papa_management_delete(uuid,uuid,jsonb),public.papa_management_space_readiness(uuid,text),
 public.papa_space_center_directory(uuid,text,text,integer,text)
 from public,anon,authenticated;
grant execute on function public.papa_management_provision_streamer(uuid,uuid,jsonb,text,text),public.papa_management_streamer_login(uuid,uuid,jsonb,text,text),
 public.papa_management_streamer_login_status(uuid,text,text),public.papa_management_account_list(uuid,text,integer),
 public.papa_management_delete_review(uuid,text,text),public.papa_management_delete(uuid,uuid,jsonb),public.papa_management_space_readiness(uuid,text),
 public.papa_space_center_directory(uuid,text,text,integer,text)
 to service_role;
notify pgrst,'reload schema';
commit;
