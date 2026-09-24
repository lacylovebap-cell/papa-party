begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
-- Retry delivery even when every browser is closed. Secrets stay in a server-only table.
select cron.schedule('papa-notification-retry','* * * * *',$job$
 select net.http_post(
  url:='https://zwhcgqwbtummydapuori.supabase.co/functions/v1/party-api',
  headers:='{"Content-Type":"application/json"}'::jsonb,
  body:=jsonb_build_object('op','pushWorker','secret',(select value->>'secret' from public.papa_notice_config where id='worker')),
  timeout_milliseconds:=20000
 ) where exists(select 1 from public.papa_push_jobs where status='pending' and available_at<=now() and attempts<5);
$job$);
commit;
