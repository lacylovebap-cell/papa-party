begin;
-- Preserve the existing Taipei 19:00 show boundary. Query-only function replacement; no financial data writes.
create or replace function papa_accounting_summary(requested_space text,requested_room text,requested_day date)
returns jsonb language plpgsql stable security definer set search_path=public set timezone='Asia/Taipei' as $$
declare result jsonb;start_at timestamptz;end_at timestamptz;
begin
 if requested_day is null or not exists(select 1 from papa_space_streamers
  where space_id=requested_space and streamer_id=requested_room)
 then raise exception 'ACCOUNTING_SCOPE_INVALID';end if;
 start_at=(requested_day::timestamp+interval '19 hours') at time zone 'Asia/Taipei';end_at=((requested_day+1)::timestamp+interval '19 hours') at time zone 'Asia/Taipei';
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
 select jsonb_build_object('day',requested_day,'timezone','Asia/Taipei','rolloverHour',19,'scope',jsonb_build_object('spaceId',requested_space,'roomId',requested_room),
 'received',credits.received+queues.received,'sung',queues.sung,'saved',credits.balance,'reserved',queues.reserved,'available',credits.balance-queues.reserved,
 'revision',(select revision from papa_v2_revision where id=1)) into result from credits,queues;
 return result;
end $$;

commit;
