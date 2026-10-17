begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

-- Registration contract only. No sender, enqueue, delivery trigger, cron,
-- notification copy, table rewrite or client table privileges are enabled.
do $$ begin
 if to_regclass('public.papa_device_push_registrations') is null
  or to_regprocedure('public.papa_device_space_scope_allowed(uuid,text,text,text)') is null
 then raise exception 'NATIVE_PUSH_PREREQUISITES_REQUIRED';end if;
end $$;

-- Edge must supply subject + session from its already verified device actor,
-- never copy either from arbitrary request fields. This internal helper is not
-- granted to service_role: the two SECURITY DEFINER entry points invoke it.
create function public.papa_require_native_push_actor(
 subject uuid,chosen_session uuid,chosen_transport text)
returns void language plpgsql security definer set search_path=public as $$
declare device public.papa_device_sessions%rowtype;platform_name text;
begin
 if subject is null or chosen_session is null or chosen_transport is null
  or chosen_transport not in ('fcm','desktop_os')
 then raise exception 'NATIVE_PUSH_ACTOR_INVALID';end if;
 -- Same session lock as refresh/revoke/switch. Do not lock the installation
 -- after this row: start/switch and refresh already own their lock order.
 select * into device from public.papa_device_sessions
 where id=chosen_session and account_id=subject for update;
 if not found or device.revoked_at is not null or device.expires_at<=clock_timestamp()
 then raise exception 'NATIVE_PUSH_SESSION_INACTIVE';end if;
 if public.papa_device_space_scope_allowed(
  device.account_id,device.role,device.space_id,device.streamer_id) is distinct from true
 then raise exception 'NATIVE_PUSH_SCOPE_INACTIVE';end if;
 select platform into platform_name from public.papa_installations
 where id=device.installation_id;
 if platform_name is null or not ((platform_name='android' and chosen_transport='fcm')
  or (platform_name='desktop' and chosen_transport='desktop_os'))
 then raise exception 'NATIVE_PUSH_PLATFORM_MISMATCH';end if;
end $$;

-- The old shared guard stamps transaction-start now(). Native registrations
-- need wall-clock metadata as well. PostgreSQL runs this trigger after the
-- existing papa_device_push_guard_trigger (name order); Web/APNS stay unchanged.
create function public.papa_native_push_clock() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.transport in ('fcm','desktop_os') then
  new.updated_at=clock_timestamp();
  if tg_op='INSERT' then new.created_at=new.updated_at;end if;
 end if;
 return new;
end $$;
create trigger papa_native_push_clock_trigger before insert or update
on public.papa_device_push_registrations for each row
execute function public.papa_native_push_clock();

create function public.papa_register_native_push(
 subject uuid,chosen_session uuid,chosen_transport text,chosen_destination text,
 chosen_permission text default 'granted')
returns jsonb language plpgsql security definer set search_path=public as $$
declare registration uuid;changed boolean;allowed boolean;
begin
 if chosen_destination is null or length(chosen_destination) not between 8 and 4096
  or chosen_destination<>btrim(chosen_destination)
  or chosen_destination ~ '[[:space:][:cntrl:]]'
  or chosen_permission is null
  or chosen_permission not in ('granted','prompt','denied','unsupported')
 then raise exception 'NATIVE_PUSH_REGISTRATION_INVALID';end if;
 perform public.papa_require_native_push_actor(subject,chosen_session,chosen_transport);
 allowed=chosen_permission='granted';
 insert into public.papa_device_push_registrations as current_binding(
  device_session_id,transport,destination,credentials,permission_state,enabled)
 values(chosen_session,chosen_transport,chosen_destination,'{}'::jsonb,chosen_permission,allowed)
 on conflict(device_session_id,transport) do update
 set destination=excluded.destination,credentials='{}'::jsonb,
  permission_state=excluded.permission_state,enabled=excluded.enabled
 where (current_binding.destination,current_binding.credentials,
  current_binding.permission_state,current_binding.enabled)
  is distinct from (excluded.destination,'{}'::jsonb,excluded.permission_state,excluded.enabled)
 returning id into registration;
 changed=found;
 if not changed then
  select id into registration from public.papa_device_push_registrations
  where device_session_id=chosen_session and transport=chosen_transport;
 end if;
 -- A slow trigger/lock must not extend a session beyond its actual expiry.
 -- Any failure rolls the registration/token/permission change back together.
 perform public.papa_require_native_push_actor(subject,chosen_session,chosen_transport);
 return jsonb_build_object('registrationId',registration,'permission',chosen_permission,
  'enabled',allowed,'changed',changed);
end $$;

create function public.papa_disable_native_push(
 subject uuid,chosen_session uuid,chosen_registration uuid,chosen_transport text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare registration public.papa_device_push_registrations%rowtype;changed boolean;
begin
 if chosen_registration is null then raise exception 'NATIVE_PUSH_BINDING_INVALID';end if;
 perform public.papa_require_native_push_actor(subject,chosen_session,chosen_transport);
 select * into registration from public.papa_device_push_registrations
 where id=chosen_registration and device_session_id=chosen_session
  and transport=chosen_transport for update;
 if not found then raise exception 'NATIVE_PUSH_BINDING_MISMATCH';end if;
 changed=registration.enabled;
 if changed then
  update public.papa_device_push_registrations set enabled=false
  where id=registration.id;
 end if;
 perform public.papa_require_native_push_actor(subject,chosen_session,chosen_transport);
 return jsonb_build_object('registrationId',registration.id,
  'permission',registration.permission_state,'enabled',false,'changed',changed);
end $$;

-- No destination/token, credentials, account, refresh/access hash or other
-- installation is ever returned. Existing RLS and table grants stay intact.
revoke all on function public.papa_require_native_push_actor(uuid,uuid,text),
 public.papa_native_push_clock(),
 public.papa_register_native_push(uuid,uuid,text,text,text),
 public.papa_disable_native_push(uuid,uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.papa_register_native_push(uuid,uuid,text,text,text),
 public.papa_disable_native_push(uuid,uuid,uuid,text) to service_role;

commit;
