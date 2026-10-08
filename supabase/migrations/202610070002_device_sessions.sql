begin;

-- Phase 1: durable session storage. The existing papa_v2_sessions access
-- tokens remain valid; no client switches to this registry in this migration.
create table public.papa_installations (
 id uuid primary key,
 platform text not null check(platform in ('web','android','desktop','ios')),
 app_version text not null default '',
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now()
);
create table public.papa_device_sessions (
 id uuid primary key default gen_random_uuid(),
 installation_id uuid not null references public.papa_installations(id),
 account_id uuid not null references public.papa_accounts(id),
 session_kind text not null check(session_kind in ('player','manager')),
 role text not null check(role in ('player','streamer_admin','space_admin','president')),
 space_id text references public.papa_spaces(id),
 streamer_id text,
 login_id text not null default '',
 refresh_hash text not null unique check(refresh_hash ~ '^[a-f0-9]{64}$'),
 rotation bigint not null default 0 check(rotation>=0),
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 check((session_kind='player')=(role='player')),
 check((role='president' and space_id is null and streamer_id is null)
  or (role in ('player','space_admin') and space_id is not null and streamer_id is null)
  or (role='streamer_admin' and space_id is not null and streamer_id is not null)),
 foreign key(streamer_id,space_id) references public.papa_space_streamers(streamer_id,space_id)
);
create unique index papa_device_one_active_kind
on public.papa_device_sessions(installation_id,session_kind)
where revoked_at is null;
create index papa_device_account_active
on public.papa_device_sessions(account_id,last_seen_at desc)
where revoked_at is null;
alter table public.papa_v2_sessions
 add column device_session_id uuid references public.papa_device_sessions(id);
create index papa_access_device_session on public.papa_v2_sessions(device_session_id)
 where device_session_id is not null;

-- A service-issued device session must match a real active membership. This
-- protects against accidental acceptance of a caller-supplied Space/role.
create function public.papa_device_membership_guard() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_op='UPDATE' then
  if (new.installation_id,new.account_id,new.session_kind,new.role,new.space_id,new.streamer_id,new.login_id)
   is distinct from (old.installation_id,old.account_id,old.session_kind,old.role,old.space_id,old.streamer_id,old.login_id)
  then raise exception 'SESSION_SCOPE_IMMUTABLE'; end if;
  if old.revoked_at is not null and new.revoked_at is null
  then raise exception 'SESSION_REVOKED'; end if;
  -- Explicit logout must remain possible after membership/account suspension.
  if new.revoked_at is not null then return new; end if;
 end if;
 if not exists(select 1 from papa_accounts a where a.id=new.account_id and a.disabled_at is null)
 then raise exception 'ACCOUNT_DISABLED'; end if;
 if new.role='president' then
  if not exists(select 1 from papa_platform_roles p where p.account_id=new.account_id and p.role='president')
  then raise exception 'MEMBERSHIP_REQUIRED'; end if;
 elsif not exists(
  select 1 from papa_space_memberships m join papa_spaces s on s.id=m.space_id
  where m.account_id=new.account_id and m.space_id=new.space_id
    and m.role=new.role and m.status='active' and s.status='active'
    and (m.streamer_id is not distinct from new.streamer_id)
 ) then raise exception 'MEMBERSHIP_REQUIRED';
 end if;
 return new;
end $$;
create trigger papa_device_membership_guard_trigger
before insert or update on public.papa_device_sessions
for each row execute function public.papa_device_membership_guard();

-- Edge generates both random tokens. PostgreSQL stores only SHA-256 hashes.
-- Rotation is atomic: a consumed refresh token can never succeed twice.
create function public.papa_rotate_device_session(session_id uuid,old_hash text,new_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_value papa_device_sessions%rowtype;
begin
 if new_hash !~ '^[a-f0-9]{64}$' or old_hash !~ '^[a-f0-9]{64}$' or new_hash=old_hash
 then raise exception 'INVALID_REFRESH_HASH'; end if;
 select * into row_value from papa_device_sessions where id=session_id for update;
 if not found or row_value.revoked_at is not null or row_value.expires_at<=now()
  or row_value.refresh_hash<>old_hash then return null; end if;
 update papa_device_sessions set refresh_hash=new_hash,rotation=rotation+1,
  last_seen_at=now(),expires_at=now()+interval '90 days'
 where id=session_id
 returning * into row_value;
 update papa_installations set last_seen_at=now()
 where id=row_value.installation_id;
 return jsonb_build_object('sessionId',row_value.id,'accountId',row_value.account_id,
  'kind',row_value.session_kind,'role',row_value.role,'spaceId',row_value.space_id,
  'streamerId',row_value.streamer_id,'loginId',row_value.login_id,'rotation',row_value.rotation,
  'expiresAt',row_value.expires_at);
end $$;
create function public.papa_revoke_device_session(subject uuid,session_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare changed uuid;
begin
 update papa_device_sessions set revoked_at=now()
 where id=session_id and account_id=subject and revoked_at is null
 returning id into changed;
 return changed is not null;
end $$;

alter table public.papa_installations enable row level security;
alter table public.papa_device_sessions enable row level security;
revoke all on public.papa_installations,public.papa_device_sessions from public,anon,authenticated;
grant all on public.papa_installations,public.papa_device_sessions to service_role;
revoke all on function public.papa_rotate_device_session(uuid,text,text),
 public.papa_revoke_device_session(uuid,uuid),public.papa_device_membership_guard()
 from public,anon,authenticated;
grant execute on function public.papa_rotate_device_session(uuid,text,text),
 public.papa_revoke_device_session(uuid,uuid) to service_role;

commit;
