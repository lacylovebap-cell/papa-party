begin;

-- Push registrations belong to a durable device session, not a short-lived
-- access token. The legacy Web Push table remains untouched until Web swaps
-- transport and confirms notification de-duplication.
create table public.papa_device_push_registrations (
 id uuid primary key default gen_random_uuid(),
 device_session_id uuid not null references public.papa_device_sessions(id) on delete cascade,
 transport text not null check(transport in ('web_push','fcm','desktop_os','apns')),
 destination text not null check(length(destination) between 8 and 4096),
 credentials jsonb not null default '{}'::jsonb,
 permission_state text not null default 'granted'
  check(permission_state in ('granted','prompt','denied','unsupported')),
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(device_session_id,transport)
);
create index papa_device_push_destination
 on public.papa_device_push_registrations(transport,destination)
 where enabled;

create function public.papa_device_push_guard() returns trigger
language plpgsql set search_path=public as $$
declare s public.papa_device_sessions%rowtype; platform_name text;
begin
 if tg_op='UPDATE' and
  (new.device_session_id,new.transport) is distinct from
  (old.device_session_id,old.transport)
 then raise exception 'PUSH_BINDING_IMMUTABLE'; end if;
 if tg_op='UPDATE' and old.enabled and not new.enabled then
  new.updated_at=now();return new;
 end if;
 select * into s from public.papa_device_sessions
 where id=new.device_session_id;
 if not found or s.revoked_at is not null or s.expires_at<=now()
 then raise exception 'DEVICE_SESSION_INACTIVE'; end if;
 select platform into platform_name from public.papa_installations
 where id=s.installation_id;
 if not exists(select 1 from public.papa_accounts a
  where a.id=s.account_id and a.disabled_at is null)
 then raise exception 'ACCOUNT_DISABLED'; end if;
 if s.role='president' then
  if not exists(select 1 from public.papa_platform_roles p
   where p.account_id=s.account_id and p.role='president')
  then raise exception 'MEMBERSHIP_REQUIRED'; end if;
 elsif not exists(select 1 from public.papa_space_memberships m
  join public.papa_spaces space on space.id=m.space_id
  where m.account_id=s.account_id and m.space_id=s.space_id
   and m.role=s.role and m.streamer_id is not distinct from s.streamer_id
   and m.status='active' and space.status='active')
 then raise exception 'MEMBERSHIP_REQUIRED'; end if;
 if not ((platform_name='web' and new.transport='web_push')
  or (platform_name='android' and new.transport='fcm')
  or (platform_name='desktop' and new.transport in ('desktop_os','web_push'))
  or (platform_name='ios' and new.transport='apns'))
 then raise exception 'PUSH_PLATFORM_MISMATCH'; end if;
 if new.transport='web_push' and
  (new.destination !~ '^https://' or
   coalesce(new.credentials->>'p256dh','')='' or
   coalesce(new.credentials->>'auth','')='')
 then raise exception 'PUSH_CREDENTIALS_INVALID'; end if;
 new.updated_at=now();
 return new;
end $$;
create trigger papa_device_push_guard_trigger
before insert or update on public.papa_device_push_registrations
for each row execute function public.papa_device_push_guard();

-- One canonical notification can have one tracked delivery per registered
-- device. The delivery row contains IDs only, never duplicate body/lyrics.
create table public.papa_device_notification_deliveries (
 id bigint generated always as identity primary key,
 notification_id uuid not null references public.papa_notifications(id) on delete cascade,
 registration_id uuid not null references public.papa_device_push_registrations(id) on delete cascade,
 status text not null default 'pending'
  check(status in ('pending','sending','sent','skipped','failed')),
 attempts int not null default 0 check(attempts>=0),
 available_at timestamptz not null default now(),
 lease uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(notification_id,registration_id)
);
create index papa_device_delivery_claim
 on public.papa_device_notification_deliveries(available_at,id)
 where status='pending';

-- Set-based, idempotent enqueue. It is not hooked to the old notification
-- trigger yet; Phase 2 will switch delivery after the new adapters are ready.
create function public.papa_enqueue_device_deliveries(chosen_notification uuid)
returns int language plpgsql security definer set search_path=public as $$
declare inserted_count int;
begin
 insert into public.papa_device_notification_deliveries(notification_id,registration_id)
 select n.id,r.id from public.papa_notifications n
 join public.papa_device_push_registrations r on r.enabled
  and r.permission_state='granted'
 join public.papa_device_sessions d on d.id=r.device_session_id
  and d.revoked_at is null and d.expires_at>now()
 join public.papa_accounts a on a.id=d.account_id and a.disabled_at is null
 left join public.papa_space_streamers map on map.streamer_id=n.streamer_id
 left join public.papa_account_legacy_players player
  on player.account_id=d.account_id
 where n.id=chosen_notification and n.read_at is null
  and (
   (n.recipient='__super__' and d.role='president'
    and exists(select 1 from public.papa_platform_roles p
     where p.account_id=d.account_id and p.role='president'))
   or (n.recipient='__admin__' and d.role='streamer_admin'
    and d.streamer_id=n.streamer_id and d.space_id=map.space_id
    and exists(select 1 from public.papa_space_memberships m
     join public.papa_spaces s on s.id=m.space_id and s.status='active'
     where m.account_id=d.account_id and m.space_id=d.space_id
      and m.role='streamer_admin' and m.streamer_id=d.streamer_id and m.status='active'))
   or (d.role='player' and n.recipient=player.legacy_player_id
    and d.space_id=map.space_id
    and exists(select 1 from public.papa_space_memberships m
     join public.papa_spaces s on s.id=m.space_id and s.status='active'
     where m.account_id=d.account_id and m.space_id=d.space_id
      and m.role='player' and m.status='active'))
  )
 on conflict(notification_id,registration_id) do nothing;
 get diagnostics inserted_count=row_count;
 return inserted_count;
end $$;

alter table public.papa_device_push_registrations enable row level security;
alter table public.papa_device_notification_deliveries enable row level security;
revoke all on public.papa_device_push_registrations,
 public.papa_device_notification_deliveries from public,anon,authenticated;
grant all on public.papa_device_push_registrations,
 public.papa_device_notification_deliveries to service_role;
grant usage,select on sequence public.papa_device_notification_deliveries_id_seq
 to service_role;
revoke all on function public.papa_device_push_guard(),
 public.papa_enqueue_device_deliveries(uuid) from public,anon,authenticated;
grant execute on function public.papa_enqueue_device_deliveries(uuid) to service_role;

commit;
