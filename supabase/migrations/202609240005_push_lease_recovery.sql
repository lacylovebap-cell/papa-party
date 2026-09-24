begin;
-- A worker can terminate after its final lease. Close those jobs and retain a
-- delivery notice instead of leaving an unclaimable pending row forever.
create or replace function public.papa_claim_push() returns setof public.papa_push_jobs language plpgsql security definer set search_path=public as $$
begin
 with exhausted as (
  update papa_push_jobs set status='failed',last_error='推播工作逾時，通知中心紀錄保留'
  where status='pending' and attempts>=5 and available_at<=now() returning notice_id
 )
 insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id)
 select distinct n.streamer_id,n.streamer_name,'__admin__','delivery',1,n.streamer_name||'｜推播工作逾時，通知中心紀錄保留',n.id::text
 from exhausted e join papa_notifications n on n.id=e.notice_id where n.type<>'delivery';
 return query update papa_push_jobs set attempts=attempts+1,available_at=now()+interval '2 minutes',lease=gen_random_uuid()
 where id in (select id from papa_push_jobs where status='pending' and available_at<=now() and attempts<5 order by id for update skip locked limit 20) returning *;
end $$;
select cron.schedule('papa-notification-retry','* * * * *',$job$
 select net.http_post(
  url:='https://zwhcgqwbtummydapuori.supabase.co/functions/v1/party-api',
  headers:='{"Content-Type":"application/json"}'::jsonb,
  body:=jsonb_build_object('op','pushWorker','secret',(select value->>'secret' from public.papa_notice_config where id='worker')),
  timeout_milliseconds:=20000
 ) where exists(select 1 from public.papa_push_jobs where status='pending' and available_at<=now());
$job$);
commit;
