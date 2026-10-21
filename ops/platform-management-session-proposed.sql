-- Read-only login bridge: authorization metadata only. The verified business
-- session retains its player/streamer/president role, device and account.
create or replace function public.papa_management_session(subject uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare president boolean:=false; rooms boolean:=false; accounts boolean:=false; reports boolean:=false; sections jsonb:='[]'::jsonb;
begin
 if exists(select 1 from public.papa_accounts where id=subject and disabled_at is null) then
  select exists(select 1 from public.papa_platform_roles where account_id=subject and role='president') into president;
  select president or exists(select 1 from public.papa_spaces s where s.status='active' and
    (s.owner_account_id=subject or exists(select 1 from public.papa_space_memberships m
      where m.space_id=s.id and m.account_id=subject and m.role='space_admin' and m.status='active' and 'streamers'=any(m.permissions)))),
   president or exists(select 1 from public.papa_spaces s where s.status='active' and
    (s.owner_account_id=subject or exists(select 1 from public.papa_space_memberships m
      where m.space_id=s.id and m.account_id=subject and m.role='space_admin' and m.status='active' and 'administrators'=any(m.permissions)))),
   president or exists(select 1 from public.papa_spaces s where s.status='active' and
    (s.owner_account_id=subject or exists(select 1 from public.papa_space_memberships m
      where m.space_id=s.id and m.account_id=subject and m.role='space_admin' and m.status='active' and 'reports'=any(m.permissions))))
   into rooms,accounts,reports;
 end if;
 if rooms or accounts or reports then sections:=jsonb_build_array('overview');end if;
 if rooms or accounts then sections:=sections||jsonb_build_array('halls');end if;
 if rooms then sections:=sections||jsonb_build_array('streamers');end if;
 if accounts then sections:=sections||jsonb_build_array('accounts');end if;
 if rooms then sections:=sections||jsonb_build_array('cleanup');end if;
 return jsonb_build_object('version',1,'allowed',rooms or accounts or reports,'president',president,
  'permissions',jsonb_build_object('streamers',rooms,'administrators',accounts,'reports',reports),'sections',sections);
end;$$;
revoke all on function public.papa_management_session(uuid) from public,anon,authenticated;
grant execute on function public.papa_management_session(uuid) to service_role;
