begin;
-- Additive guards/projections on the existing ledger. No entity backfill.
create index if not exists papa_accounting_source on papa_v2_entities
 (space_id,(data->>'streamer_id'),(data->>'source_transaction_id')) where kind='queue';
create index if not exists papa_accounting_queue_settlement on papa_v2_entities
 (space_id,(data->>'streamer_id'),(data->>'queueId')) where kind='ledger';
create function papa_accounting_time(value text) returns timestamptz
language plpgsql immutable set timezone='Asia/Taipei' as $$
begin return value::timestamptz;exception when others then return null;end $$;

create function papa_accounting_summary(requested_space text,requested_room text,requested_day date)
returns jsonb language plpgsql stable security definer set search_path=public set timezone='Asia/Taipei' as $$
declare result jsonb;start_at timestamptz;end_at timestamptz;
begin
 if requested_day is null or not exists(select 1 from papa_space_streamers
  where space_id=requested_space and streamer_id=requested_room)
 then raise exception 'ACCOUNTING_SCOPE_INVALID';end if;
 start_at=requested_day::timestamp at time zone 'Asia/Taipei';end_at=(requested_day+1)::timestamp at time zone 'Asia/Taipei';
 with rows as materialized (select e.kind,e.data from papa_v2_entities e
  where e.space_id=requested_space and e.kind in ('ledger','queue') and e.data->>'streamer_id'=requested_room
   and coalesce(e.data->'test','false')<>'true'::jsonb
   and not exists(select 1 from papa_v2_entities p where p.kind='players' and p.space_id=requested_space
    and p.id=e.data->>'playerId' and p.data->'test'='true'::jsonb)),
 credits as (select coalesce(sum((data->>'amount')::numeric),0) balance,
  coalesce(sum(coalesce((data->>'receipt_quantity')::numeric,(data->>'amount')::numeric)) filter(
   where (data->>'amount')::numeric>0 and nullif(data->>'voided_at','') is null
   and coalesce(data->'excludeStats','false')<>'true'::jsonb and coalesce(data->'openingBalance','false')<>'true'::jsonb
   and coalesce(data->>'note','')<>'初始存歌' and coalesce(data->'conversion','false')<>'true'::jsonb
   and coalesce(data->'accounting_adjustment','false')<>'true'::jsonb
   and papa_accounting_time(data->>'at')>=start_at and papa_accounting_time(data->>'at')<end_at),0) received
  from rows where kind='ledger'),
 queues as (select coalesce(sum(coalesce((data->>'receivedCreditCost')::numeric,(data->>'creditCost')::numeric,1)) filter(
   where data->>'kind'='live' and coalesce(data->>'allocation_model','')<>'reservation-v1'
   and coalesce(data->'openingBalance','false')<>'true'::jsonb
   and papa_accounting_time(data->>'acceptedAt')>=start_at and papa_accounting_time(data->>'acceptedAt')<end_at),0) received,
  coalesce(sum(case when jsonb_typeof(data->'items')='array' and jsonb_array_length(data->'items')>0
   then (select sum(coalesce((item->>'performances')::numeric,1)) from jsonb_array_elements(data->'items') item) else 1 end) filter(
   where data->>'status'='completed' and data->>'kind'<>'self'
   and papa_accounting_time(data->>'completedAt')>=start_at and papa_accounting_time(data->>'completedAt')<end_at),0) sung,
  coalesce(sum(coalesce((data->>'creditCost')::numeric,1)) filter(where data->>'status' in ('pending','waiting')
   and (data->>'kind'='saved' or data->>'allocation_model'='reservation-v1')),0) reserved
  from rows where kind='queue')
 select jsonb_build_object('day',requested_day,'timezone','Asia/Taipei','scope',jsonb_build_object('spaceId',requested_space,'roomId',requested_room),
 'received',credits.received+queues.received,'sung',queues.sung,'saved',credits.balance,'reserved',queues.reserved,'available',credits.balance-queues.reserved,
 'revision',(select revision from papa_v2_revision where id=1)) into result from credits,queues;
 return result;
end $$;

create function papa_accounting_preserve_fact() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='DELETE' and old.kind='ledger' then raise exception 'ACCOUNTING_USE_REVERSAL';end if;
 if TG_OP='DELETE' and old.kind='queue' then raise exception 'ACCOUNTING_USE_CANCEL_OR_ARCHIVE';end if;
 if TG_OP='UPDATE' then
  if old.kind in ('ledger','queue') and (new.kind is distinct from old.kind or new.id is distinct from old.id or new.space_id is distinct from old.space_id) then raise exception 'ACCOUNTING_IDENTITY_IMMUTABLE';end if;
  if old.kind='ledger' and (old.data->'amount' is distinct from new.data->'amount'
   or old.data->>'playerId' is distinct from new.data->>'playerId'
   or old.data->>'streamer_id' is distinct from new.data->>'streamer_id'
   or old.data->>'storage_pool' is distinct from new.data->>'storage_pool'
   or old.data ? 'receipt_quantity' and old.data->'receipt_quantity' is distinct from new.data->'receipt_quantity'
   or old.data->>'queueId' is distinct from new.data->>'queueId'
   or old.data->>'reversal_of' is distinct from new.data->>'reversal_of'
   or nullif(old.data->>'voided_at','') is not null and old.data->>'voided_at' is distinct from new.data->>'voided_at')
  then raise exception 'ACCOUNTING_RECEIPT_IMMUTABLE';end if;
  if old.kind='queue' and old.data->>'status'='completed' and (new.data->>'status' is distinct from 'completed'
   or old.data->>'playerId' is distinct from new.data->>'playerId' or old.data->>'streamer_id' is distinct from new.data->>'streamer_id' or old.data->'creditCost' is distinct from new.data->'creditCost'
   or old.data->>'songId' is distinct from new.data->>'songId' or old.data->'items' is distinct from new.data->'items'
   or old.data->>'allocation_id' is distinct from new.data->>'allocation_id'
   or old.data->>'source_transaction_id' is distinct from new.data->>'source_transaction_id')
  then raise exception 'ACCOUNTING_PERFORMANCE_IMMUTABLE';end if;
 end if;
 if TG_OP='DELETE' then return old;end if;
 return new;
end $$;
create trigger papa_accounting_fact_guard before update or delete on papa_v2_entities
for each row execute function papa_accounting_preserve_fact();

create function papa_accounting_link_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare source jsonb;used numeric;debit_count integer;queue_row jsonb;
begin
 -- A deferred trigger checks the final row, not an intermediate image.
 select data into new.data from papa_v2_entities where kind=new.kind and id=new.id;
 if new.kind='queue' and new.data->>'allocation_model'='reservation-v1' then
  select data into source from papa_v2_entities where kind='ledger' and id=new.data->>'source_transaction_id'
   and space_id=new.space_id for update;
  if source is null or source->>'streamer_id' is distinct from new.data->>'streamer_id'
   or source->>'playerId' is distinct from new.data->>'playerId' or source->>'accounting_kind' is distinct from 'receipt'
   or source ? 'queueId' or nullif(source->>'voided_at','') is not null
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
  if debit_count<>1 or exists(select 1 from papa_v2_entities where kind='queue' and space_id=new.space_id
   and data->>'source_transaction_id'=new.id and data->>'status' in ('pending','waiting','completed'))
  then raise exception 'ACCOUNTING_VOID_INVALID';end if;
 end if;
 if new.kind='ledger' and new.data->>'reversal_of' is not null then
  select data into source from papa_v2_entities where kind='ledger' and id=new.data->>'reversal_of' and space_id=new.space_id for update;
  if source is null or source->>'playerId' is distinct from new.data->>'playerId'
   or source->>'streamer_id' is distinct from new.data->>'streamer_id' or coalesce(source->>'storage_pool','shengma') is distinct from coalesce(new.data->>'storage_pool','shengma')
   or source->>'queueId' is not null or source->>'reversal_of' is not null
   or nullif(source->>'voided_at','') is null or (source->>'amount')::numeric<>-(new.data->>'amount')::numeric
  then raise exception 'ACCOUNTING_REVERSAL_INVALID';end if;
  select count(*) into debit_count from papa_v2_entities where kind='ledger' and space_id=new.space_id and data->>'reversal_of'=new.data->>'reversal_of';
  if debit_count<>1 then raise exception 'ACCOUNTING_DUPLICATE_REVERSAL';end if;
 end if;
 return null;
end $$;
create constraint trigger papa_accounting_links after insert or update on papa_v2_entities
deferrable initially deferred for each row execute function papa_accounting_link_guard();
revoke all on function papa_accounting_summary(text,text,date),papa_accounting_time(text),papa_accounting_preserve_fact(),papa_accounting_link_guard() from public,anon,authenticated;
grant execute on function papa_accounting_summary(text,text,date) to service_role;
commit;
