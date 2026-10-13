begin;

-- Delivery receipts only: no balances, entity snapshots or replacement ledger.
-- Each receipt commits/rolls back with the existing authoritative transaction.
create table public.papa_operation_receipts (
 space_id text not null,
 streamer_id text not null,
 actor_key text not null check(actor_key ~ '^[a-f0-9]{64}$'),
 operation_id uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 revision bigint not null check(revision>=0),
 created_at timestamptz not null default clock_timestamp(),
 primary key(space_id,streamer_id,actor_key,operation_id)
);
alter table public.papa_operation_receipts enable row level security;
revoke all on public.papa_operation_receipts from public,anon,authenticated,service_role;

create function public.papa_operation_receipt(requested_room text,requested_space text,
 requested_actor text,requested_operation uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare receipt public.papa_operation_receipts;
begin
 if requested_actor is null or requested_actor !~ '^[a-f0-9]{64}$'
  or requested_operation is null or not exists(select 1 from public.papa_space_streamers r
  join public.papa_spaces s on s.id=r.space_id and s.status='active'
  where r.streamer_id=requested_room and r.space_id=requested_space)
 then raise exception 'OPERATION_RECEIPT_SCOPE_INVALID';end if;
 select * into receipt from public.papa_operation_receipts r
 where r.space_id=requested_space and r.streamer_id=requested_room
  and r.actor_key=requested_actor and r.operation_id=requested_operation;
 if not found then return jsonb_build_object('committed',false);end if;
 return jsonb_build_object('committed',true,'revision',receipt.revision,'requestHash',receipt.request_hash);
end $$;

create function public.papa_room_operational_commit_receipted(
 expected bigint,changes jsonb,removed jsonb,actor_context jsonb,notices jsonb,requested_room text,
 operation_id uuid,actor_key text,request_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare room_space text;receipt public.papa_operation_receipts;committed_revision bigint;actor_kind text;
begin
 select r.space_id into room_space from public.papa_space_streamers r
 join public.papa_spaces s on s.id=r.space_id and s.status='active' where r.streamer_id=requested_room;
 actor_kind=actor_context->>'role';
 if room_space is null or room_space<>'space-001'
  or actor_context->>'space_id' is distinct from room_space
  or actor_context->>'streamer_id' is distinct from requested_room
 then raise exception 'ROOM_OPERATION_SCOPE_INVALID';end if;
 if actor_kind is null or actor_kind not in ('player','streamer_admin','super_admin')
  or actor_kind='streamer_admin' and actor_context->>'actor_streamer_id' is distinct from requested_room
 then raise exception 'ROOM_OPERATION_ACTOR_INVALID';end if;
 if operation_id is null or actor_key is null or actor_key !~ '^[a-f0-9]{64}$'
  or request_hash is null or request_hash !~ '^[a-f0-9]{64}$'
 then raise exception 'OPERATION_RECEIPT_INPUT_INVALID';end if;
 -- Same-key requests serialize before the existing global CAS transaction.
 -- Hash collisions only serialize unrelated keys; the exact PK still isolates them.
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(room_space,requested_room,actor_key,operation_id)::text,0));
 select * into receipt from public.papa_operation_receipts r
 where r.space_id=room_space and r.streamer_id=requested_room
  and r.actor_key=papa_room_operational_commit_receipted.actor_key
  and r.operation_id=papa_room_operational_commit_receipted.operation_id;
 if found then
  if receipt.request_hash is distinct from request_hash then raise exception 'OPERATION_RECEIPT_REUSED';end if;
  return jsonb_build_object('revision',receipt.revision,'duplicate',true);
 end if;
 committed_revision=public.papa_room_operational_commit(expected,changes,removed,actor_context,notices,requested_room);
 insert into public.papa_operation_receipts values(room_space,requested_room,actor_key,operation_id,request_hash,committed_revision,clock_timestamp());
 return jsonb_build_object('revision',committed_revision,'duplicate',false);
end $$;

revoke all on function public.papa_operation_receipt(text,text,text,uuid),
 public.papa_room_operational_commit_receipted(bigint,jsonb,jsonb,jsonb,jsonb,text,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.papa_operation_receipt(text,text,text,uuid),
 public.papa_room_operational_commit_receipted(bigint,jsonb,jsonb,jsonb,jsonb,text,uuid,text,text) to service_role;
-- No business-data backfill or change to existing commit/audit/ledger guards.
notify pgrst,'reload schema';
commit;
