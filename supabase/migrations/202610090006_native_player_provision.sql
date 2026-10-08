begin;

-- Provision only explicitly verified native business profiles. Accounts and
-- Memberships must already exist; the original room transaction still owns
-- all business changes, revision updates, profile audit and notifications.
create function papa_room_admin_commit_with_player_bindings(
 expected bigint,changes jsonb,removed jsonb,actor_context jsonb,notices jsonb,
 requested_room text,player_bindings jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare room_space text;actor_kind text;binding jsonb;subject uuid;membership uuid;
begin
 select space_id into room_space from papa_space_streamers where streamer_id=requested_room;
 if room_space is null or room_space='space-001' then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 actor_kind=papa_room_native_actor_guard(actor_context,requested_room,room_space);
 if actor_kind not in ('streamer_admin','super_admin') then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_typeof(removed) is distinct from 'array'
  or jsonb_typeof(notices) is distinct from 'array' or jsonb_typeof(player_bindings) is distinct from 'array'
  or jsonb_array_length(changes)>2000 or jsonb_array_length(removed)>2000
  or jsonb_array_length(notices)>1000 or jsonb_array_length(player_bindings)>2000
 then raise exception 'ROOM_WRITE_BATCH_INVALID';end if;

 -- Nothing can be provisioned against a stale snapshot. The delegated commit
 -- acquires this same lock and consumes the expected revision exactly once.
 perform 1 from papa_v2_revision where id=1 and revision=expected for update;
 if not found then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 for binding in select value from jsonb_array_elements(player_bindings) loop
  if jsonb_typeof(binding) is distinct from 'object'
   or not binding ?& array['player_id','account_id','membership_id']
   or binding-array['player_id','account_id','membership_id']<>'{}'::jsonb
   or jsonb_typeof(binding->'player_id') is distinct from 'string'
   or nullif(btrim(binding->>'player_id'),'') is null or length(binding->>'player_id')>200
   or jsonb_typeof(binding->'account_id') is distinct from 'string'
   or jsonb_typeof(binding->'membership_id') is distinct from 'string'
  then raise exception 'ROOM_PLAYER_BINDING_INVALID';end if;
  begin subject=(binding->>'account_id')::uuid;membership=(binding->>'membership_id')::uuid;
  exception when invalid_text_representation then raise exception 'ROOM_PLAYER_BINDING_INVALID';end;
 end loop;
 if exists(select 1 from jsonb_array_elements(player_bindings) b
   group by b->>'player_id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(player_bindings) b
   group by (b->>'account_id')::uuid having count(*)>1)
  or exists(select 1 from jsonb_array_elements(player_bindings) b
   group by (b->>'membership_id')::uuid having count(*)>1)
  or exists(select 1 from jsonb_array_elements(changes) c where c->>'kind'='players'
   group by c->>'id' having count(*)>1)
 then raise exception 'ROOM_PLAYER_BINDING_INVALID';end if;

 -- Retain identity/authority locks through the original commit, so a concurrent
 -- disable or Membership revocation cannot race a verified profile insert.
 perform 1 from papa_spaces where id=room_space for share;
 perform 1 from papa_space_streamers where streamer_id=requested_room for share;
 perform 1 from papa_accounts where id=(actor_context->>'account_id')::uuid
  or id in (select (b->>'account_id')::uuid from jsonb_array_elements(player_bindings) b)
  order by id for share;
 perform 1 from papa_space_memberships where id in
  (select (b->>'membership_id')::uuid from jsonb_array_elements(player_bindings) b)
  or actor_kind='streamer_admin' and account_id=(actor_context->>'account_id')::uuid
   and space_id=room_space and role='streamer_admin' and streamer_id=requested_room
  order by id for share;
 if actor_kind='super_admin' then
  perform 1 from papa_platform_roles where account_id=(actor_context->>'account_id')::uuid for share;
 end if;
 perform papa_room_native_actor_guard(actor_context,requested_room,room_space);
 if not exists(select 1 from papa_space_streamers where streamer_id=requested_room and space_id=room_space)
 then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;

 if exists(select 1 from jsonb_array_elements(player_bindings) b
  where not exists(select 1 from papa_space_memberships m join papa_accounts a on a.id=m.account_id
   where m.id=(b->>'membership_id')::uuid and m.account_id=(b->>'account_id')::uuid
    and m.space_id=room_space and m.role='player' and m.status='active' and a.disabled_at is null)
   or exists(select 1 from papa_space_player_profiles p where p.space_id=room_space
    and (p.player_id=b->>'player_id' or p.account_id=(b->>'account_id')::uuid))
   or not exists(select 1 from jsonb_array_elements(changes) c
    where c->>'kind'='players' and c->>'id'=b->>'player_id'))
  or exists(select 1 from jsonb_array_elements(changes) c where c->>'kind'='players' and (
   jsonb_typeof(c->'id') is distinct from 'string' or jsonb_typeof(c->'data') is distinct from 'object'
   or c->'data'->>'playerId' is distinct from c->>'id'
   or not papa_room_native_profile_data_safe(c->'data')
   or c->'data' ?| array['password','token','refreshToken','accessToken','currentPassword','secret',
    'account_id','accountId','membership_id','membershipId','space_id','spaceId']
   or not exists(select 1 from papa_space_player_profiles p
    where p.space_id=room_space and p.player_id=c->>'id')
    and not exists(select 1 from jsonb_array_elements(player_bindings) b where b->>'player_id'=c->>'id')))
 then raise exception 'ROOM_PLAYER_BINDING_INVALID';end if;

 -- The minimum identity-only seed satisfies the profile constraint. The native
 -- admin commit merges the matching players change and emits its normal audit.
 insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data)
 select room_space,b->>'player_id',(b->>'account_id')::uuid,(b->>'membership_id')::uuid,
  jsonb_build_object('playerId',b->>'player_id') from jsonb_array_elements(player_bindings) b;
 return papa_room_admin_commit(expected,changes,removed,actor_context,notices,requested_room);
end $$;

revoke all on function papa_room_admin_commit_with_player_bindings(bigint,jsonb,jsonb,jsonb,jsonb,text,jsonb)
 from public,anon,authenticated;
grant execute on function papa_room_admin_commit_with_player_bindings(bigint,jsonb,jsonb,jsonb,jsonb,text,jsonb)
 to service_role;
notify pgrst,'reload schema';
commit;
