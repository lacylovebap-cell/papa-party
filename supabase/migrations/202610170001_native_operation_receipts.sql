begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

-- Extend the original delivery receipt wrapper; no new receipt/ledger store,
-- business backfill, identity inference, or change to the global write CAS.
create or replace function public.papa_room_operational_commit_receipted(
 expected bigint,changes jsonb,removed jsonb,actor_context jsonb,notices jsonb,requested_room text,
 operation_id uuid,actor_key text,request_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare room_space text;receipt public.papa_operation_receipts;committed_revision bigint;actor_kind text;
 native_actor_key text;
begin
 select r.space_id into room_space from public.papa_space_streamers r
 join public.papa_spaces s on s.id=r.space_id and s.status='active' where r.streamer_id=requested_room;
 actor_kind=actor_context->>'role';
 if room_space is null
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
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(room_space,requested_room,actor_key,operation_id)::text,0));
 if room_space<>'space-001' then
  -- This check also runs for duplicate deliveries. A historical receipt does
  -- not authorize a suspended Account/Membership or a different native player.
  actor_kind=public.papa_room_native_actor_guard(actor_context,requested_room,room_space);
  -- Match operationProof's JSON.stringify([Account,role,player,managedRoom]).
  -- array_to_json preserves compact JSON; jsonb::text would insert whitespace.
  native_actor_key=encode(sha256(convert_to(array_to_json(array[
   actor_context->>'account_id',actor_kind,
   case when actor_kind='player' then actor_context->>'player_id' else null end,
   case when actor_kind='streamer_admin' then actor_context->>'actor_streamer_id' else null end
  ]::text[])::text,'UTF8')),'hex');
  if native_actor_key is distinct from actor_key then raise exception 'ROOM_OPERATION_ACTOR_INVALID';end if;
 end if;
 select * into receipt from public.papa_operation_receipts r
 where r.space_id=room_space and r.streamer_id=requested_room
  and r.actor_key=papa_room_operational_commit_receipted.actor_key
  and r.operation_id=papa_room_operational_commit_receipted.operation_id;
 if found then
  if receipt.request_hash is distinct from request_hash then raise exception 'OPERATION_RECEIPT_REUSED';end if;
  return jsonb_build_object('revision',receipt.revision,'duplicate',true);
 end if;
 -- Existing dispatcher chooses the legacy or native guarded transaction.
 -- Entity/Audit/notice failures and the receipt insert share one transaction.
 committed_revision=public.papa_room_operational_commit(expected,changes,removed,actor_context,notices,requested_room);
 insert into public.papa_operation_receipts values(room_space,requested_room,actor_key,operation_id,request_hash,committed_revision,clock_timestamp());
 return jsonb_build_object('revision',committed_revision,'duplicate',false);
end $$;

-- Native recovery/early-return reads must authorize the current actor in the
-- same database call. Keep the existing four-argument legacy lookup intact.
create function public.papa_native_operation_receipt(
 requested_room text,requested_space text,requested_actor text,requested_operation uuid,actor_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor_kind text;native_actor_key text;
begin
 if requested_space is null or requested_space='space-001'
  or requested_actor is null or requested_actor !~ '^[a-f0-9]{64}$'
  or requested_operation is null or not exists(select 1 from public.papa_space_streamers r
   join public.papa_spaces s on s.id=r.space_id and s.status='active'
   where r.streamer_id=requested_room and r.space_id=requested_space)
 then raise exception 'OPERATION_RECEIPT_SCOPE_INVALID';end if;
 -- Both a hit and a miss require a currently permitted native identity.
 actor_kind=public.papa_room_native_actor_guard(actor_context,requested_room,requested_space);
 native_actor_key=encode(sha256(convert_to(array_to_json(array[
  actor_context->>'account_id',actor_kind,
  case when actor_kind='player' then actor_context->>'player_id' else null end,
  case when actor_kind='streamer_admin' then actor_context->>'actor_streamer_id' else null end
 ]::text[])::text,'UTF8')),'hex');
 if native_actor_key is distinct from requested_actor then raise exception 'ROOM_OPERATION_ACTOR_INVALID';end if;
 return public.papa_operation_receipt(requested_room,requested_space,requested_actor,requested_operation);
end $$;

revoke all on function public.papa_room_operational_commit_receipted(bigint,jsonb,jsonb,jsonb,jsonb,text,uuid,text,text),
 public.papa_native_operation_receipt(text,text,text,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.papa_room_operational_commit_receipted(bigint,jsonb,jsonb,jsonb,jsonb,text,uuid,text,text),
 public.papa_native_operation_receipt(text,text,text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
