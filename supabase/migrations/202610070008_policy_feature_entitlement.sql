begin;

-- Phase 1 contract only. Existing features are not gated by these tables.
-- A future Web/native adapter may read a small scoped policy snapshot.
create table public.papa_feature_registry (
 feature_key text primary key check(feature_key ~ '^[a-z][a-z0-9_]{1,63}$'),
 target_kind text not null check(target_kind in ('space','account')),
 description text not null default '',
 created_at timestamptz not null default now()
);
create table public.papa_space_entitlements (
 space_id text not null references public.papa_spaces(id),
 feature_key text not null references public.papa_feature_registry(feature_key),
 enabled boolean not null,
 config jsonb not null default '{}'::jsonb
  check(jsonb_typeof(config)='object'),
 updated_at timestamptz not null default now(),
 primary key(space_id,feature_key)
);
create table public.papa_account_entitlements (
 account_id uuid not null references public.papa_accounts(id),
 feature_key text not null references public.papa_feature_registry(feature_key),
 enabled boolean not null,
 config jsonb not null default '{}'::jsonb
  check(jsonb_typeof(config)='object'),
 updated_at timestamptz not null default now(),
 primary key(account_id,feature_key)
);
create table public.papa_space_policies (
 space_id text not null references public.papa_spaces(id),
 policy_key text not null check(policy_key ~ '^[a-z][a-z0-9_]{1,63}$'),
 value jsonb not null check(jsonb_typeof(value)='object'),
 revision bigint not null default 1 check(revision>0),
 updated_at timestamptz not null default now(),
 primary key(space_id,policy_key)
);

create function public.papa_entitlement_target_guard() returns trigger
language plpgsql set search_path=public as $$
declare actual_kind text;
begin
 select target_kind into actual_kind from public.papa_feature_registry
 where feature_key=new.feature_key;
 if actual_kind is distinct from
  (case when tg_table_name='papa_space_entitlements' then 'space' else 'account' end)
 then raise exception 'FEATURE_TARGET_MISMATCH'; end if;
 return new;
end $$;
create trigger papa_space_entitlement_target_trigger
before insert or update on public.papa_space_entitlements
for each row execute function public.papa_entitlement_target_guard();
create trigger papa_account_entitlement_target_trigger
before insert or update on public.papa_account_entitlements
for each row execute function public.papa_entitlement_target_guard();
create function public.papa_feature_target_immutable() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.target_kind is distinct from old.target_kind
 then raise exception 'FEATURE_TARGET_IMMUTABLE'; end if;
 return new;
end $$;
create trigger papa_feature_target_immutable_trigger
before update on public.papa_feature_registry
for each row execute function public.papa_feature_target_immutable();

-- The service receives an Account only from a verified session. It may
-- resolve another Space for a president, or an active membership holder.
-- No account identifiers or policies from other Spaces are returned.
create function public.papa_policy_feature_snapshot(subject uuid,chosen_space text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare features jsonb; account_features jsonb; policies jsonb;
begin
 if subject is null or chosen_space is null or
  not exists(select 1 from public.papa_accounts a
   where a.id=subject and a.disabled_at is null) or
  not exists(select 1 from public.papa_spaces s
   where s.id=chosen_space and s.status='active') then return null; end if;
 if not exists(select 1 from public.papa_platform_roles
  where account_id=subject and role='president') and
  not exists(select 1 from public.papa_space_memberships
   where account_id=subject and space_id=chosen_space and status='active')
 then return null; end if;
 select coalesce(jsonb_object_agg(e.feature_key,jsonb_build_object(
  'enabled',e.enabled,'config',e.config)),'{}'::jsonb)
 into features from public.papa_space_entitlements e
 where e.space_id=chosen_space;
 select coalesce(jsonb_object_agg(e.feature_key,jsonb_build_object(
  'enabled',e.enabled,'config',e.config)),'{}'::jsonb)
 into account_features from public.papa_account_entitlements e
 where e.account_id=subject;
 select coalesce(jsonb_object_agg(p.policy_key,jsonb_build_object(
  'value',p.value,'revision',p.revision)),'{}'::jsonb)
 into policies from public.papa_space_policies p
 where p.space_id=chosen_space;
 return jsonb_build_object('spaceId',chosen_space,'features',features,
  'accountFeatures',account_features,'policies',policies);
end $$;

alter table public.papa_feature_registry enable row level security;
alter table public.papa_space_entitlements enable row level security;
alter table public.papa_account_entitlements enable row level security;
alter table public.papa_space_policies enable row level security;
revoke all on public.papa_feature_registry,public.papa_space_entitlements,
 public.papa_account_entitlements,public.papa_space_policies
 from public,anon,authenticated;
grant all on public.papa_feature_registry,public.papa_space_entitlements,
 public.papa_account_entitlements,public.papa_space_policies to service_role;
revoke all on function public.papa_policy_feature_snapshot(uuid,text),
 public.papa_entitlement_target_guard(),public.papa_feature_target_immutable()
 from public,anon,authenticated;
grant execute on function public.papa_policy_feature_snapshot(uuid,text)
 to service_role;

commit;
