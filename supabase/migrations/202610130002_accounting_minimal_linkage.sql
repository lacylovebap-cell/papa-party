begin;
-- Only the legacy PA Party Space retains its existing 19:00 rule. New Spaces default to calendar midnight.
alter table papa_spaces add column accounting_rollover_hour smallint not null default 0 check(accounting_rollover_hour between 0 and 23);
update papa_spaces set accounting_rollover_hour=19 where id='space-001' and slug='papa-party';
-- No existing entity, ledger, queue, performance or event is changed.
create or replace function papa_accounting_summary(requested_space text,requested_room text,requested_day date)
returns jsonb language plpgsql stable security definer set search_path=public set timezone='Asia/Taipei' as $$
declare result jsonb;start_at timestamptz;end_at timestamptz;rollover smallint;
begin
 if not exists(select 1 from papa_space_streamers where space_id=requested_space and streamer_id=requested_room) then raise exception 'ACCOUNTING_SCOPE_INVALID';end if;
 select accounting_rollover_hour into rollover from papa_spaces where id=requested_space;
 requested_day:=coalesce(requested_day,((now() at time zone 'Asia/Taipei')-make_interval(hours=>rollover))::date);
 start_at=(requested_day::timestamp+make_interval(hours=>rollover)) at time zone 'Asia/Taipei';end_at=start_at+interval '1 day';
 with receipt_audit as materialized(select entity_kind,entity_id,action,created_at,before_data,after_data from papa_events where entity_kind in ('ledger','queue') and streamer_id=requested_room and created_at>=start_at and created_at<end_at),
 withdrawn_receipts as(select distinct entity_id from receipt_audit d where d.entity_kind='ledger' and d.after_data is null and d.before_data is not null and d.before_data->>'queueId' is null and coalesce(d.before_data->'conversion','false')<>'true'::jsonb),
 withdrawn_groups as(
  select distinct g.allocation_id from receipt_audit h join withdrawn_receipts d using(entity_id)
   cross join lateral(values(h.before_data->>'allocation_id'),(h.after_data->>'allocation_id')) g(allocation_id) where h.entity_kind='ledger' and g.allocation_id is not null
  union
  -- Older allocate reduced the receipt in place without storing its group on
  -- the parent. Link only an unambiguous, same-transaction Audit allocation;
  -- missing source IDs alone never invalidate legacy receipts.
  select distinct a.after_data->>'allocation_id' from receipt_audit h join withdrawn_receipts d using(entity_id)
   join receipt_audit a on a.entity_kind='queue' and a.action='allocate' and a.created_at=h.created_at
    and a.after_data->>'playerId'=coalesce(h.after_data->>'playerId',h.before_data->>'playerId')
    and coalesce(a.after_data->>'allocation_storage_pool','shengma')=coalesce(h.after_data->>'storage_pool',h.before_data->>'storage_pool','shengma')
   where h.entity_kind='ledger' and h.action='allocate' and coalesce(h.after_data->>'queueId',h.before_data->>'queueId') is null
    and coalesce(h.after_data->'conversion',h.before_data->'conversion','false')<>'true'::jsonb and a.after_data->>'allocation_id' is not null
    and not exists(select 1 from receipt_audit other where other.entity_kind='ledger' and other.action='allocate' and other.created_at=h.created_at and other.entity_id<>h.entity_id
     and coalesce(other.after_data->>'playerId',other.before_data->>'playerId')=coalesce(h.after_data->>'playerId',h.before_data->>'playerId')
     and coalesce(other.after_data->>'storage_pool',other.before_data->>'storage_pool','shengma')=coalesce(h.after_data->>'storage_pool',h.before_data->>'storage_pool','shengma')
     and coalesce(other.after_data->>'queueId',other.before_data->>'queueId') is null and coalesce(other.after_data->'conversion',other.before_data->'conversion','false')<>'true'::jsonb)),
 rows as materialized(select e.kind,e.id,e.data from papa_v2_entities e where e.space_id=requested_space and e.kind in ('ledger','queue') and e.data->>'streamer_id'=requested_room
  and coalesce(e.data->'test','false')<>'true'::jsonb and not exists(select 1 from papa_v2_entities p where p.kind='players' and p.space_id=requested_space and p.id=e.data->>'playerId' and p.data->'test'='true'::jsonb)),
 receipts as materialized(select id,data from rows where kind='ledger' and (data->>'amount')::numeric>0 and nullif(data->>'voided_at','') is null
  and coalesce(data->'excludeStats','false')<>'true'::jsonb and coalesce(data->'openingBalance','false')<>'true'::jsonb and coalesce(data->>'note','')<>'初始存歌'
  and coalesce(data->'conversion','false')<>'true'::jsonb and coalesce(data->'accounting_adjustment','false')<>'true'::jsonb
  and papa_accounting_time(data->>'at')>=start_at and papa_accounting_time(data->>'at')<end_at),
 queues as materialized(select id,data,exists(select 1 from rows l where l.kind='ledger' and l.data->>'playerId'=q.data->>'playerId' and (l.id=q.data->>'source_transaction_id' or q.data->>'allocation_id' is not null and l.data->>'allocation_id'=q.data->>'allocation_id') and l.data->>'queueId' is null and coalesce(l.data->'conversion','false')<>'true'::jsonb) known_source,coalesce(q.data->>'allocation_id' in(select allocation_id from withdrawn_groups where allocation_id is not null),false) withdrawn_source,exists(select 1 from rows l where l.kind='ledger' and l.data->>'playerId'=q.data->>'playerId'
  and (l.id=q.data->>'source_transaction_id' or q.data->>'allocation_id' is not null and l.data->>'allocation_id'=q.data->>'allocation_id')
  and nullif(l.data->>'voided_at','') is null and l.data->>'queueId' is null and coalesce(l.data->'conversion','false')<>'true'::jsonb) valid_source from rows q where kind='queue'),
 movements as (
  select data->>'playerId' player,coalesce(data->>'storage_pool','shengma') pool,(data->>'amount')::numeric amount from receipts
  union all select l.data->>'playerId',coalesce(l.data->>'storage_pool','shengma'),(l.data->>'amount')::numeric from rows l join queues q on q.id=l.data->>'queueId'
   where l.kind='ledger' and (l.data->>'amount')::numeric>0 and l.data->'conversion'='true'::jsonb and nullif(l.data->>'voided_at','') is null
    and nullif(q.data->>'receipt_voided_at','') is null and (q.valid_source or not q.known_source and not q.withdrawn_source or q.data->>'allocation_id' is null and q.data->>'kind'='live')
    and papa_accounting_time(q.data->>'acceptedAt')>=start_at and papa_accounting_time(q.data->>'acceptedAt')<end_at
  union all select q.data->>'playerId',coalesce(q.data->>'allocation_storage_pool','shengma'),-coalesce((q.data->>'creditCost')::numeric,1) from queues q
   where q.data->>'allocation_model'='reservation-v1' and q.data->>'source_transaction_id' in(select id from receipts)
    and q.data->>'status' in ('pending','waiting','completed') and nullif(q.data->>'receipt_voided_at','') is null
  union all select q.data->>'playerId',coalesce(q.data->>'consumed_storage_pool','shengma'),-coalesce((q.data->>'creditCost')::numeric,1) from queues q
   where q.data->>'kind'='saved' and q.data->>'status' in ('pending','waiting') and papa_accounting_time(q.data->>'at')>=start_at
  union all select l.data->>'playerId',coalesce(l.data->>'storage_pool','shengma'),(l.data->>'amount')::numeric from rows l
   where l.kind='ledger' and (l.data->>'amount')::numeric<0 and nullif(l.data->>'voided_at','') is null and l.data->>'reversal_of' is null
    and coalesce(l.data->'conversion','false')<>'true'::jsonb and not exists(select 1 from receipts r where r.id=l.data->>'source_transaction_id') and papa_accounting_time(l.data->>'at')>=start_at),
 totals as(select coalesce(sum((data->>'amount')::numeric) filter(where kind='ledger'),0) saved from rows),
 performance as(select coalesce(sum(case when jsonb_typeof(data->'items')='array' and jsonb_array_length(data->'items')>0 then jsonb_array_length(data->'items') else 1 end) filter(where data->>'status'='completed' and data->>'kind'<>'self' and nullif(data->>'performance_duplicate_of','') is null and papa_accounting_time(data->>'completedAt')>=start_at and papa_accounting_time(data->>'completedAt')<end_at),0) sung,
  coalesce(sum(coalesce((data->>'creditCost')::numeric,1)) filter(where data->>'status' in ('pending','waiting') and (data->>'kind'='saved' or data->>'allocation_model'='reservation-v1')),0) reserved from queues)
 select jsonb_build_object('day',requested_day,'timezone','Asia/Taipei','rolloverHour',rollover,'scope',jsonb_build_object('spaceId',requested_space,'roomId',requested_room),
 'received',(select coalesce(sum(coalesce((data->>'receipt_quantity')::numeric,(data->>'amount')::numeric)),0) from receipts)+(select coalesce(sum(coalesce((data->>'receivedCreditCost')::numeric,(data->>'creditCost')::numeric,1)),0) from queues where data->>'kind'='live' and coalesce(data->>'allocation_model','')<>'reservation-v1' and nullif(data->>'receipt_voided_at','') is null and coalesce(data->'openingBalance','false')<>'true'::jsonb and (data->>'allocation_id' is null or valid_source or not known_source and not withdrawn_source) and papa_accounting_time(data->>'acceptedAt')>=start_at and papa_accounting_time(data->>'acceptedAt')<end_at),
 'stored',(select coalesce(sum(greatest(amount,0)),0) from(select sum(amount) amount from movements group by player,pool) credits),
 'sung',performance.sung,'saved',totals.saved,'reserved',performance.reserved,'available',totals.saved-performance.reserved,'revision',(select revision from papa_v2_revision where id=1)) into result from totals,performance;
 return result;
end $$;
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
   and (data->>'source_transaction_id'=new.id or new.data->>'allocation_id' is not null and data->>'allocation_id'=new.data->>'allocation_id' and data->>'playerId'=new.data->>'playerId' and data->>'streamer_id'=new.data->>'streamer_id') and data->>'status' in ('pending','waiting','completed'))
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
      and nullif(root.data->>'voided_at','') is not null and q.data->>'status' in ('cancelled','stored') and q.data->>'completedAt' is null))
   or source->>'reversal_of' is not null
   or nullif(source->>'voided_at','') is null or (source->>'amount')::numeric<>-(new.data->>'amount')::numeric
  then raise exception 'ACCOUNTING_REVERSAL_INVALID';end if;
  select count(*) into debit_count from papa_v2_entities where kind='ledger' and space_id=new.space_id and data->>'reversal_of'=new.data->>'reversal_of';
  if debit_count<>1 then raise exception 'ACCOUNTING_DUPLICATE_REVERSAL';end if;
 end if;
 return null;
end $$;
commit;
