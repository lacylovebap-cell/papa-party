-- Additive, service-only read. No tables, indexes, cron or existing rows changed.
begin;
set local lock_timeout='3s';
create function public.papa_notice_delta(room text,owner_id text,after_time timestamptz,after_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at,n.id),'[]'::jsonb)
 from (
  select id,streamer_id,streamer_name,recipient,type,level,body,entity_id,created_at,read_at,space_id
  from papa_notifications
  where recipient=owner_id
   and (streamer_id=room or (room='__global__' and owner_id='__super__'))
   and (created_at,id)>(after_time,after_id)
  order by created_at,id limit 51
 ) n;
$$;
revoke all on function public.papa_notice_delta(text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.papa_notice_delta(text,text,timestamptz,uuid) to service_role;
commit;
