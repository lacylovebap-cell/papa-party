begin;

-- A bounded transaction wrapper for room-only queue/credit/wish operations.
-- Reuse the existing business commit, audit and notification stream. Song
-- bodies, global profiles and metadata are read-only on this lean path.
create function public.papa_room_operational_commit(
 expected bigint,changes jsonb,removed jsonb,actor_context jsonb,notices jsonb,requested_room text)
returns bigint language plpgsql security definer set search_path=public as $$
declare room_space text; actor_kind text;
begin
 select space_id into room_space from papa_space_streamers where streamer_id=requested_room;
 if room_space is null or room_space<>'space-001'
  or actor_context->>'streamer_id' is distinct from requested_room
  or nullif(actor_context->>'space_id','') is not null and actor_context->>'space_id'<>room_space
 then raise exception 'ROOM_OPERATION_SCOPE_INVALID';end if;
 actor_kind=actor_context->>'role';
 if actor_kind is null or actor_kind not in ('player','streamer_admin','super_admin')
  or actor_kind='streamer_admin' and actor_context->>'actor_streamer_id' is distinct from requested_room
 then raise exception 'ROOM_OPERATION_ACTOR_INVALID';end if;
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_typeof(removed) is distinct from 'array'
  or jsonb_typeof(notices) is distinct from 'array'
  or jsonb_array_length(changes)>1000 or jsonb_array_length(removed)>1000 or jsonb_array_length(notices)>1000
 then raise exception 'ROOM_OPERATION_BATCH_INVALID';end if;
 -- One set-based validation rejects wrong-room identifiers, even if the Edge
 -- accidentally forwarded a caller's stale/malicious record ID.
 if exists(
  select 1 from jsonb_array_elements(changes) c
  left join papa_v2_entities e on e.kind=c->>'kind' and e.id=c->>'id'
  where c->>'kind' not in ('queue','ledger','wishes') or c->>'kind' is null
   or nullif(c->>'id','') is null or jsonb_typeof(c->'data') is distinct from 'object'
   or c->'data'->>'streamer_id' is distinct from requested_room
   or c->'data'->>'id' is distinct from c->>'id'
   or e.id is not null and (e.space_id<>room_space or e.data->>'streamer_id' is distinct from requested_room)
 ) or exists(
  select 1 from jsonb_array_elements(removed) r
  left join papa_v2_entities e on e.kind=r->>'kind' and e.id=r->>'id'
  where r->>'kind' not in ('queue','ledger','wishes') or r->>'kind' is null
   or e.id is null or e.space_id<>room_space or e.data->>'streamer_id' is distinct from requested_room
 ) or exists(select 1 from jsonb_array_elements(notices) n where n->>'streamer_id' is distinct from requested_room)
 then raise exception 'ROOM_OPERATION_SCOPE_INVALID';end if;
 return papa_release_b_commit(expected,changes,removed,actor_context,notices);
end $$;
revoke all on function public.papa_room_operational_commit(bigint,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.papa_room_operational_commit(bigint,jsonb,jsonb,jsonb,jsonb,text) to service_role;
commit;
