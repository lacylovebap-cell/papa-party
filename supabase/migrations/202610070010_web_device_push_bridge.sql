begin;

-- Keep one existing Web Push job stream. Old subscriptions stay unchanged;
-- newly remembered devices are authorized by their durable session instead
-- of a short-lived access hash. No second enqueue/notification is introduced.
alter table public.papa_push_subscriptions
 add column device_session_id uuid references public.papa_device_sessions(id);
create index papa_web_push_device_session on public.papa_push_subscriptions(device_session_id)
 where device_session_id is not null;

create function public.papa_device_push_recipient(chosen_device uuid,chosen_room text,chosen_recipient text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from papa_device_sessions d
  join papa_accounts a on a.id=d.account_id and a.disabled_at is null
  left join papa_account_legacy_players p on p.account_id=d.account_id
  left join papa_space_streamers map on map.streamer_id=chosen_room
  where d.id=chosen_device and d.revoked_at is null and d.expires_at>now() and (
   (chosen_recipient='__super__' and d.role='president' and exists(
    select 1 from papa_platform_roles r where r.account_id=d.account_id and r.role='president'))
   or (d.space_id=map.space_id and exists(
    select 1 from papa_space_memberships m join papa_spaces s on s.id=m.space_id and s.status='active'
    where m.account_id=d.account_id and m.space_id=d.space_id and m.role=d.role
     and m.streamer_id is not distinct from d.streamer_id and m.status='active'
   ) and (
    (d.role='player' and chosen_recipient=p.legacy_player_id)
    or (d.role='streamer_admin' and d.streamer_id=chosen_room and chosen_recipient='__admin__'
     and exists(select 1 from papa_streamer_accounts s where s.streamer_id=d.streamer_id and s.enabled))
   ))
  )
 );
$$;

create function public.papa_web_push_device_guard() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.device_session_id is not null and not papa_device_push_recipient(new.device_session_id,new.streamer_id,new.recipient)
 then raise exception 'PUSH_DEVICE_RECIPIENT_MISMATCH';end if;
 return new;
end $$;
create trigger papa_web_push_device_guard_trigger
before insert or update on public.papa_push_subscriptions for each row
execute function public.papa_web_push_device_guard();

-- Logout/password revocation removes only that device's delivery route. Jobs
-- already queued cascade through the existing FK; notification history stays.
create function public.papa_revoke_web_device_push() returns trigger
language plpgsql set search_path=public as $$
begin
 if old.revoked_at is null and new.revoked_at is not null then
  delete from papa_push_subscriptions where device_session_id=new.id;
 end if;
 return new;
end $$;
create trigger papa_revoke_web_device_push_trigger
after update of revoked_at on public.papa_device_sessions for each row
execute function public.papa_revoke_web_device_push();

revoke all on function public.papa_device_push_recipient(uuid,text,text),
 public.papa_web_push_device_guard(),public.papa_revoke_web_device_push()
 from public,anon,authenticated;
grant execute on function public.papa_device_push_recipient(uuid,text,text) to service_role;
commit;
