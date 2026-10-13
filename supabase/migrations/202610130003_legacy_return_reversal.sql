begin;
-- No data backfill or privilege changes. Extend the existing deferred guard
-- solely for an Audit-proven legacy orphan return; ordinary protections stay.
create or replace function papa_accounting_link_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare source jsonb;used numeric;debit_count integer;queue_row jsonb;
begin
 -- A deferred trigger checks the final row, not an intermediate image.

 select data into new.data from papa_v2_entities where kind=new.kind and id=new.id;
 if new.kind='queue' and nullif(new.data->>'performance_duplicate_of','') is not null then
  select data into queue_row from papa_v2_entities where kind='queue' and id=new.data->>'performance_duplicate_of' and space_id=new.space_id;
  if new.data->>'status' is distinct from 'completed' or queue_row is null or queue_row->>'status' is distinct from 'completed'
   or new.id=new.data->>'performance_duplicate_of' or queue_row->>'performance_duplicate_of' is not null or exists(select 1 from papa_v2_entities q where q.kind='queue' and q.space_id=new.space_id and q.data->>'performance_duplicate_of'=new.id)
   or queue_row->>'playerId' is distinct from new.data->>'playerId' or queue_row->>'streamer_id' is distinct from new.data->>'streamer_id'
   or queue_row->>'songId' is distinct from new.data->>'songId' then raise exception 'ACCOUNTING_DUPLICATE_LINK_INVALID';end if;
 end if;

 if new.kind='queue' and new.data->>'allocation_model'='reservation-v1' then
  select data into source from papa_v2_entities where kind='ledger' and id=new.data->>'source_transaction_id'
   and space_id=new.space_id for update;
  if source is null or source->>'streamer_id' is distinct from new.data->>'streamer_id'
   or source->>'playerId' is distinct from new.data->>'playerId' or source->>'accounting_kind' is distinct from 'receipt'
   or source ? 'queueId' or nullif(source->>'voided_at','') is not null and not (new.data->>'status' in ('cancelled','stored') and new.data->>'receipt_voided_at'=source->>'voided_at')
  then raise exception 'ACCOUNTING_SOURCE_INVALID';end if;
  select coalesce(sum((data->>'creditCost')::numeric),0) into used from papa_v2_entities where kind='queue'
   and space_id=new.space_id and data->>'streamer_id'=new.data->>'streamer_id'
   and data->>'source_transaction_id'=new.data->>'source_transaction_id' and data->>'status' in ('pending','waiting','completed');
  if used>(source->>'amount')::numeric then raise exception 'ACCOUNTING_SOURCE_OVERALLOCATED';end if;
  select count(*) into debit_count from papa_v2_entities where kind='ledger' and space_id=new.space_id
   and data->>'streamer_id'=new.data->>'streamer_id' and data->>'queueId'=new.id and (data->>'amount')::numeric<0;
  if (new.data->>'status'='completed' and debit_count<>1) or (new.data->>'status'<>'completed' and debit_count<>0)
  then raise exception 'ACCOUNTING_SETTLEMENT_INVALID';end if;
 end if;
 if new.kind='ledger' and new.data->>'accounting_kind'='consumption' then
  select data into queue_row from papa_v2_entities where kind='queue' and id=new.data->>'queueId' and space_id=new.space_id;
  if queue_row is null or queue_row->>'status' is distinct from 'completed'
   or queue_row->>'playerId' is distinct from new.data->>'playerId'
   or queue_row->>'streamer_id' is distinct from new.data->>'streamer_id'
   or (queue_row->>'creditCost')::numeric<>-(new.data->>'amount')::numeric
   or new.data->>'settlement_id' is distinct from new.id
   or queue_row->>'settlement_id' is distinct from new.id
   or queue_row->>'source_transaction_id' is distinct from new.data->>'source_transaction_id'
   or queue_row->>'allocation_id' is distinct from new.data->>'allocation_id'
   or new.data->>'performance_id' is distinct from new.data->>'queueId'
   or queue_row->>'performance_id' is distinct from new.data->>'queueId'
  then raise exception 'ACCOUNTING_SETTLEMENT_INVALID';end if;
  select count(*) into debit_count from papa_v2_entities where kind='ledger' and space_id=new.space_id
   and data->>'queueId'=new.data->>'queueId' and data->>'accounting_kind'='consumption';
  if debit_count<>1 then raise exception 'ACCOUNTING_DUPLICATE_SETTLEMENT';end if;
 end if;
 if new.kind='ledger' and nullif(new.data->>'voided_at','') is not null then
  select count(*) into debit_count from papa_v2_entities where kind='ledger' and space_id=new.space_id and data->>'reversal_of'=new.id
   and (data->>'amount')::numeric=-(new.data->>'amount')::numeric;
  if debit_count<>1 or new.data->>'queueId' is null and new.data->>'allocation_id' is not null and exists(select 1 from papa_v2_entities l where l.kind='ledger' and l.space_id=new.space_id and l.data->>'allocation_id'=new.data->>'allocation_id' and l.data->>'playerId'=new.data->>'playerId' and l.data->>'streamer_id'=new.data->>'streamer_id' and l.data->>'allocationSettlement' in ('return','adjustment') and nullif(l.data->>'voided_at','') is null) or exists(select 1 from papa_v2_entities where kind='queue' and space_id=new.space_id
   and (data->>'source_transaction_id'=new.id or new.data->>'queueId' is null and new.data->>'allocation_id' is not null and data->>'allocation_id'=new.data->>'allocation_id' and data->>'playerId'=new.data->>'playerId' and data->>'streamer_id'=new.data->>'streamer_id') and data->>'status' in ('pending','waiting','completed'))
  then raise exception 'ACCOUNTING_VOID_INVALID';end if;
 end if;
 if new.kind='ledger' and new.data->>'reversal_of' is not null then
  select data into source from papa_v2_entities where kind='ledger' and id=new.data->>'reversal_of' and space_id=new.space_id for update;
  if source is null or source->>'playerId' is distinct from new.data->>'playerId'
   or source->>'streamer_id' is distinct from new.data->>'streamer_id' or coalesce(source->>'storage_pool','shengma') is distinct from coalesce(new.data->>'storage_pool','shengma')
   or source->>'queueId' is not null and not (
    source->>'allocationSettlement' in ('return','adjustment') and exists(
     select 1 from papa_v2_entities root join papa_v2_entities q on q.kind='queue' and q.id=source->>'queueId' and q.space_id=root.space_id
     where root.kind='ledger' and root.id=source->>'void_source_transaction_id' and root.space_id=new.space_id
      and root.data->>'playerId'=source->>'playerId' and root.data->>'streamer_id'=source->>'streamer_id'
      and root.data->>'allocation_id'=source->>'allocation_id' and q.data->>'allocation_id'=source->>'allocation_id'
      and q.data->>'playerId'=source->>'playerId' and q.data->>'streamer_id'=source->>'streamer_id'
      and nullif(root.data->>'voided_at','') is not null and q.data->>'status' in ('cancelled','stored') and q.data->>'completedAt' is null)
    or source->>'allocationSettlement'='return' and (source->>'amount')::numeric>0 and exists(
     -- Legacy prepaid returns may outlive a zero-valued source that the old
     -- application hard-deleted. Require the exact creation, allocation and
     -- withdrawal Audit chain; missing source IDs or song names are not proof.
     select 1 from papa_v2_entities q
     join papa_events refund on refund.streamer_id=source->>'streamer_id' and refund.entity_kind='ledger'
      and refund.entity_id=new.data->>'reversal_of' and refund.action='queue:store' and refund.before_data is null
     join papa_events allocated on allocated.streamer_id=source->>'streamer_id' and allocated.entity_kind='ledger'
      and allocated.entity_id=source->>'void_source_transaction_id' and allocated.action='allocate'
     join papa_events queued on queued.streamer_id=source->>'streamer_id' and queued.entity_kind='queue'
      and queued.entity_id=q.id and queued.action='allocate' and queued.created_at=allocated.created_at
     join papa_events withdrawn on withdrawn.streamer_id=source->>'streamer_id' and withdrawn.entity_kind='ledger'
      and withdrawn.entity_id=allocated.entity_id and withdrawn.after_data is null and withdrawn.before_data is not null
     where q.kind='queue' and q.id=source->>'queueId' and q.space_id=new.space_id
      and q.data->>'playerId'=source->>'playerId' and q.data->>'streamer_id'=source->>'streamer_id'
      and q.data->>'allocation_id'=source->>'allocation_id' and q.data->>'allocation_model' is null
      and q.data->>'status' in ('cancelled','stored') and q.data->>'completedAt' is null
      and coalesce(q.data->>'allocation_storage_pool','shengma')=coalesce(source->>'storage_pool','shengma')
      and coalesce((q.data->>'creditCost')::numeric,1)=(source->>'amount')::numeric
      and refund.after_data->>'playerId'=source->>'playerId' and refund.after_data->>'streamer_id'=source->>'streamer_id'
      and refund.after_data->>'queueId'=q.id and refund.after_data->>'allocation_id'=source->>'allocation_id'
      and refund.after_data->>'allocationSettlement'='return' and (refund.after_data->>'amount')::numeric=(source->>'amount')::numeric
      and coalesce(refund.after_data->>'storage_pool','shengma')=coalesce(source->>'storage_pool','shengma')
      and allocated.after_data->>'playerId'=source->>'playerId' and allocated.after_data->>'streamer_id'=source->>'streamer_id'
      and allocated.after_data->>'queueId' is null and coalesce(allocated.after_data->'conversion','false')<>'true'::jsonb
      and (allocated.before_data->>'amount')::numeric>0 and (allocated.after_data->>'amount')::numeric=0
      and coalesce(allocated.after_data->>'storage_pool','shengma')=coalesce(source->>'storage_pool','shengma')
      and queued.after_data->>'playerId'=source->>'playerId' and queued.after_data->>'streamer_id'=source->>'streamer_id'
      and queued.after_data->>'allocation_id'=source->>'allocation_id'
      and coalesce(queued.after_data->>'allocation_storage_pool','shengma')=coalesce(source->>'storage_pool','shengma')
      and withdrawn.before_data->>'playerId'=source->>'playerId' and withdrawn.before_data->>'streamer_id'=source->>'streamer_id'
      and withdrawn.before_data->>'queueId' is null and coalesce(withdrawn.before_data->'conversion','false')<>'true'::jsonb
      and (withdrawn.before_data->>'amount')::numeric=0
      and coalesce(withdrawn.before_data->>'storage_pool','shengma')=coalesce(source->>'storage_pool','shengma')
      and allocated.created_at<=refund.created_at and refund.created_at<=withdrawn.created_at
      and not exists(select 1 from papa_v2_entities root where root.kind='ledger' and root.id=allocated.entity_id)
      and not exists(select 1 from papa_events other where other.streamer_id=allocated.streamer_id and other.entity_kind='ledger'
       and other.action='allocate' and other.created_at=allocated.created_at and other.entity_id<>allocated.entity_id
       and other.after_data->>'playerId'=source->>'playerId' and other.after_data->>'queueId' is null
       and coalesce(other.after_data->>'storage_pool','shengma')=coalesce(source->>'storage_pool','shengma')
       and coalesce(other.after_data->'conversion','false')<>'true'::jsonb)
      and not exists(select 1 from papa_events performed where performed.streamer_id=source->>'streamer_id'
       and performed.entity_kind='queue' and performed.entity_id=q.id
       and (performed.before_data->>'status'='completed' or performed.after_data->>'status'='completed'))))
   or source->>'reversal_of' is not null
   or nullif(source->>'voided_at','') is null or (source->>'amount')::numeric<>-(new.data->>'amount')::numeric
  then raise exception 'ACCOUNTING_REVERSAL_INVALID';end if;
  select count(*) into debit_count from papa_v2_entities where kind='ledger' and space_id=new.space_id and data->>'reversal_of'=new.data->>'reversal_of';
  if debit_count<>1 then raise exception 'ACCOUNTING_DUPLICATE_REVERSAL';end if;
 end if;
 return null;
end $$;
commit;
