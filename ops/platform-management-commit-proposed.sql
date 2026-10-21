-- Approved management integration; apply only after the deployment validation gate.
-- Keeps business calculation, receipts, ledger and Audit in their existing RPCs.
begin;
create or replace function public.papa_management_business_commit(commit_name text,arguments jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; subject uuid; room text; target_space text; permission_name text; action_name text; result jsonb;
begin
 if commit_name is null or commit_name not in ('papa_release_b_commit','papa_room_operational_commit','papa_room_admin_commit','papa_room_operational_commit_receipted','papa_room_admin_commit_with_player_bindings')
  or jsonb_typeof(arguments) is distinct from 'object' then raise exception 'MANAGEMENT_COMMIT_INVALID';end if;
 ctx=arguments->'actor_context';
 if ctx->>'role' is distinct from 'streamer_admin' then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 subject=(ctx->>'account_id')::uuid;room=ctx->>'streamer_id';target_space=ctx->>'space_id';
 if subject is null or room is null or target_space is null or ctx->>'actor_streamer_id' is distinct from room
  or commit_name<>'papa_release_b_commit' and arguments->>'requested_room' is distinct from room
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 -- Same order as management writes: Account -> Space -> mapping/memberships.
 -- FOR SHARE conflicts with permission/status updates, including non-key updates.
 perform 1 from public.papa_accounts where id=subject and disabled_at is null for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_spaces where id=target_space and status='active' for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_space_streamers where streamer_id=room and space_id=target_space for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_space_memberships where account_id=subject and space_id=target_space order by id for share;
 perform 1 from public.papa_manager_account_links where account_id=subject for share;
 perform 1 from public.papa_streamer_accounts where streamer_id=room for share;
 action_name=split_part(coalesce(ctx->>'action',''),':',1);
 permission_name=case
  when action_name in ('song','songsBulk','restoreSongEdits','lyrics','newPracticeSet','newPracticeOrder','songOrder','wishAdmin') then 'songs'
  when action_name in ('queue','onBehalf','streamerDraw','queueOrder') then 'queue'
  when action_name in ('player','ledger','allocate','extraQuota','crown','card','playerProvision') then 'players'
  else 'all' end;
 if not public.papa_management_room_permission(subject,room,permission_name) then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 -- Names are strictly allowlisted above; all data remains bound parameters.
 if commit_name='papa_release_b_commit' then
  execute 'select to_jsonb(public.papa_release_b_commit(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices''))' into result using arguments;
 elsif commit_name='papa_room_operational_commit_receipted' then
  execute 'select public.papa_room_operational_commit_receipted(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices'',$1->>''requested_room'',($1->>''operation_id'')::uuid,$1->>''actor_key'',$1->>''request_hash'')' into result using arguments;
 elsif commit_name='papa_room_admin_commit_with_player_bindings' then
  execute 'select to_jsonb(public.papa_room_admin_commit_with_player_bindings(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices'',$1->>''requested_room'',$1->''player_bindings''))' into result using arguments;
 else
  execute format('select to_jsonb(public.%I(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices'',$1->>''requested_room''))',commit_name) into result using arguments;
 end if;
 return result;
end;$$;
revoke all on function public.papa_management_business_commit(text,jsonb) from public,anon,authenticated;
grant execute on function public.papa_management_business_commit(text,jsonb) to service_role;
commit;
