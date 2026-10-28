-- Pricing spec batch 2: one hall pricing record per 廳／獨立主播 Space.
-- Additive only. The record lives in the existing papa_space_policies table
-- (policy_key 'pricing'); the daily rollover stays in papa_spaces
-- (accounting_rollover_hour, already used by accounting and badges).
-- Two new service-only functions; no existing table, row or function changes.
-- Until a Space has a record, its streamers keep their own legacy price fields,
-- so applying this migration alone changes no price anywhere.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

do $$ begin
 if to_regclass('public.papa_space_policies') is null or to_regclass('public.papa_management_audit') is null
  or to_regprocedure('public.papa_management_is_president(uuid)') is null
 then raise exception 'SPACE_PRICING_PREREQUISITE_MISSING';end if;
end $$;

-- Read for the management editor: the Space, its rollover hour and its pricing
-- record (null when none yet). President only.
create or replace function public.papa_management_space_pricing(subject uuid,requested_space text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare space_row public.papa_spaces;policy public.papa_space_policies;
begin
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if requested_space is null or length(requested_space)>200 then raise exception 'MANAGEMENT_QUERY_INVALID';end if;
 select * into space_row from public.papa_spaces where id=requested_space;
 if not found or space_row.deleted_at is not null then raise exception 'SPACE_NOT_FOUND';end if;
 select * into policy from public.papa_space_policies where space_id=requested_space and policy_key='pricing';
 return jsonb_build_object('spaceId',space_row.id,'name',space_row.display_name,
  'kind',coalesce(space_row.tenant_kind,case when space_row.id='space-001' then 'hall' end),'status',space_row.status,
  'rolloverHour',space_row.accounting_rollover_hour,
  'pricing',case when policy.space_id is null or policy.value='{}'::jsonb then null else policy.value end,
  'revision',coalesce(policy.revision,0));
end;$$;

-- Save: the Edge validated the form with the shared pricing engine; this
-- function re-checks its shape, the president, the Space and the revision the
-- editor opened, then writes the record and the rollover hour atomically and
-- keeps an immutable Audit row. A retried operation returns the first result.
create or replace function public.papa_management_space_pricing_save(subject uuid,operation uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.papa_management_audit;target_space text;expected bigint;rollover smallint;pricing jsonb;
 space_row public.papa_spaces;policy public.papa_space_policies;current_revision bigint;next_revision bigint;before_value jsonb;result jsonb;
begin
 if operation is null or jsonb_typeof(payload) is distinct from 'object' then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 perform 1 from public.papa_accounts where id=subject and disabled_at is null for share;
 if not public.papa_management_is_president(subject) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('spaceId','expectedRevision','rolloverHour','pricing'))
  or jsonb_typeof(payload->'spaceId') is distinct from 'string' or length(payload->>'spaceId')>200
  or jsonb_typeof(payload->'expectedRevision') is distinct from 'number' or (payload->>'expectedRevision')!~'^[0-9]{1,15}$'
  or jsonb_typeof(payload->'rolloverHour') is distinct from 'number' or (payload->>'rolloverHour')!~'^[0-9]{1,2}$'
  or (payload->>'rolloverHour')::int not between 0 and 23
  or jsonb_typeof(payload->'pricing') is distinct from 'object' or octet_length((payload->'pricing')::text)>32768
  or payload->'pricing'->'v' is distinct from '1'::jsonb
  or payload->'pricing'->>'mode' is null or payload->'pricing'->>'mode' not in ('double','single','none')
  or jsonb_typeof(payload->'pricing'->'names') is distinct from 'object' or jsonb_typeof(payload->'pricing'->'perUnit') is distinct from 'object'
  or jsonb_typeof(payload->'pricing'->'plans') is distinct from 'array' or jsonb_array_length(payload->'pricing'->'plans')>20
  or jsonb_typeof(payload->'pricing'->'tiers') is distinct from 'array' or jsonb_array_length(payload->'pricing'->'tiers')>10
 then raise exception 'MANAGEMENT_PAYLOAD_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(operation::text,0));
 select * into prior from public.papa_management_audit where operation_id=operation;
 if found then
  if prior.actor_account_id<>subject or prior.action<>'space_pricing' or prior.request_data<>payload then raise exception 'OPERATION_CONFLICT';end if;
  return prior.after_data;
 end if;
 target_space=payload->>'spaceId';expected=(payload->>'expectedRevision')::bigint;rollover=(payload->>'rolloverHour')::smallint;pricing=payload->'pricing';
 select * into space_row from public.papa_spaces where id=target_space and deleted_at is null for update;
 if not found then raise exception 'SPACE_NOT_FOUND';end if;
 select * into policy from public.papa_space_policies where space_id=target_space and policy_key='pricing' for update;
 current_revision=coalesce(policy.revision,0);
 if current_revision<>expected then raise exception 'MANAGEMENT_VERSION_CONFLICT';end if;
 before_value=jsonb_build_object('revision',current_revision,'rolloverHour',space_row.accounting_rollover_hour,
  'pricing',case when policy.space_id is null then null else policy.value end);
 if policy.space_id is null then
  insert into public.papa_space_policies(space_id,policy_key,value,revision,updated_at) values(target_space,'pricing',pricing,1,now());
  next_revision=1;
 else
  update public.papa_space_policies set value=pricing,revision=revision+1,updated_at=now()
  where space_id=target_space and policy_key='pricing' returning revision into next_revision;
 end if;
 if space_row.accounting_rollover_hour is distinct from rollover then
  update public.papa_spaces set accounting_rollover_hour=rollover where id=target_space;
 end if;
 result=jsonb_build_object('saved',true,'spaceId',target_space,'revision',next_revision,'rolloverHour',rollover);
 insert into public.papa_management_audit(operation_id,actor_account_id,space_id,action,request_data,before_data,after_data)
 values(operation,subject,target_space,'space_pricing',payload,before_value,result);
 return result;
end;$$;

revoke all on function public.papa_management_space_pricing(uuid,text),public.papa_management_space_pricing_save(uuid,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.papa_management_space_pricing(uuid,text),public.papa_management_space_pricing_save(uuid,uuid,jsonb)
 to service_role;
notify pgrst,'reload schema';
commit;
