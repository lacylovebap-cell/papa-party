begin;

-- Homepage theme system. Additive only: no existing table, row or function is
-- changed. Streamer themes live inside the existing per-streamer settings JSON
-- (published `theme`, unpublished `themeDraft`); hall themes reuse the existing
-- papa_space_policies table (`hall_theme`, `hall_theme_draft`). Theme files are
-- content-addressed objects in the existing papa-photos bucket.

-- One row per streamer_id, set by hand by the platform president. No prices.
create table public.papa_streamer_plans (
 streamer_id text primary key check(streamer_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 plan text not null check(plan in ('lifetime_free_full','founding','founding_lifetime','basic_plus_single','general_full','free_songbook')),
 status text not null default 'active' check(status in ('active','suspended')),
 valid_until timestamptz,
 features text[] not null default '{}'
  check(features <@ array['theme_streamer_basic','theme_streamer_images','theme_streamer_publish']::text[]),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.papa_accounts(id)
);
-- Small, rare management log: who changed a plan or published a hall theme.
-- Slider/colour edits are never logged; theme contents are not copied here.
create table public.papa_theme_audit (
 id bigint generated always as identity primary key,
 at timestamptz not null default now(),
 actor_account uuid,
 target_kind text not null check(target_kind in ('streamer_plan','hall_theme')),
 target_id text not null,
 action text not null check(action in ('plan_save','hall_draft','hall_publish','hall_reset'))
);
alter table public.papa_streamer_plans enable row level security;
alter table public.papa_theme_audit enable row level security;
revoke all on public.papa_streamer_plans,public.papa_theme_audit from public,anon,authenticated;
grant select,insert,update on public.papa_streamer_plans to service_role;
grant select,insert on public.papa_theme_audit to service_role;

insert into public.papa_feature_registry(feature_key,target_kind,description) values
 ('theme_hall_basic','space','廳首頁基本主題'),
 ('theme_hall_images','space','廳首頁圖片編輯'),
 ('theme_hall_publish','space','廳首頁草稿與發布')
on conflict (feature_key) do nothing;

create function public.papa_theme_hall_save(requested_space text,save_mode text,theme_value jsonb,actor_account uuid default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare next_revision bigint;
begin
 if save_mode not in ('draft','publish') or theme_value is null or jsonb_typeof(theme_value)<>'object'
  or octet_length(theme_value::text)>8192 then raise exception 'THEME_INPUT_INVALID'; end if;
 if not exists(select 1 from papa_spaces where id=requested_space) then raise exception 'THEME_SPACE_INVALID'; end if;
 insert into papa_space_policies(space_id,policy_key,value)
 values(requested_space,case when save_mode='publish' then 'hall_theme' else 'hall_theme_draft' end,theme_value)
 on conflict(space_id,policy_key) do update set value=excluded.value,revision=papa_space_policies.revision+1,updated_at=now()
 returning revision into next_revision;
 if save_mode='publish' then
  update papa_space_policies set value='{}'::jsonb,revision=revision+1,updated_at=now()
  where space_id=requested_space and policy_key='hall_theme_draft' and value<>'{}'::jsonb;
  insert into papa_theme_audit(actor_account,target_kind,target_id,action)
  values(actor_account,'hall_theme',requested_space,case when theme_value='{}'::jsonb then 'hall_reset' else 'hall_publish' end);
 end if;
 return next_revision;
end $$;

create function public.papa_theme_plan_save(requested_room text,requested_plan text,requested_status text,requested_valid_until timestamptz,
 requested_features text[],actor_account uuid,hall_space text default null,hall_features text[] default '{}')
returns void language plpgsql security definer set search_path=public as $$
begin
 if actor_account is null or not exists(select 1 from papa_platform_roles where account_id=actor_account and role='president')
 then raise exception 'THEME_PLAN_ACTOR_INVALID'; end if;
 insert into papa_streamer_plans(streamer_id,plan,status,valid_until,features,updated_at,updated_by)
 values(requested_room,requested_plan,requested_status,requested_valid_until,coalesce(requested_features,'{}'),now(),actor_account)
 on conflict(streamer_id) do update set plan=excluded.plan,status=excluded.status,valid_until=excluded.valid_until,
  features=excluded.features,updated_at=now(),updated_by=excluded.updated_by;
 if hall_space is not null then
  if not exists(select 1 from papa_spaces where id=hall_space) then raise exception 'THEME_SPACE_INVALID'; end if;
  if not coalesce(hall_features,'{}') <@ array['theme_hall_basic','theme_hall_images','theme_hall_publish']::text[] then raise exception 'THEME_FEATURE_INVALID'; end if;
  insert into papa_space_entitlements(space_id,feature_key,enabled)
  select hall_space,f,f=any(coalesce(hall_features,'{}')) from unnest(array['theme_hall_basic','theme_hall_images','theme_hall_publish']) f
  on conflict(space_id,feature_key) do update set enabled=excluded.enabled,updated_at=now();
 end if;
 insert into papa_theme_audit(actor_account,target_kind,target_id,action) values(actor_account,'streamer_plan',requested_room,'plan_save');
end $$;

-- Before cleanup deletes a theme file, confirm no streamer settings (published,
-- draft, or a copied streamer) and no hall policy anywhere still mentions it.
-- Returns only the hashes that are still in use; reads nothing else out.
create function public.papa_theme_assets_in_use(asset_hashes text[])
returns text[] language sql stable security definer set search_path=public as $$
 select coalesce(array_agg(h),'{}'::text[]) from unnest(asset_hashes) h
 where h ~ '^[a-f0-9]{64}$' and (
  exists(select 1 from papa_v2_entities e where e.kind in ('meta','settings') and strpos(e.data::text,h)>0)
  or exists(select 1 from papa_space_policies p where strpos(p.value::text,h)>0))
$$;

revoke all on function public.papa_theme_hall_save(text,text,jsonb,uuid),
 public.papa_theme_plan_save(text,text,text,timestamptz,text[],uuid,text,text[]),
 public.papa_theme_assets_in_use(text[]) from public,anon,authenticated;
grant execute on function public.papa_theme_hall_save(text,text,jsonb,uuid),
 public.papa_theme_plan_save(text,text,text,timestamptz,text[],uuid,text,text[]),
 public.papa_theme_assets_in_use(text[]) to service_role;

commit;
