-- Rollback for 20261031160000_push_subscription_per_recipient.sql.
-- Rows that now share (streamer_id, endpoint) must be reduced to one first: keep the newest
-- per (streamer_id, endpoint) and remove the others (their push jobs go with them).
-- Deploy the Edge that upserts on (streamer_id, endpoint) together with this script.
begin;
delete from public.papa_push_jobs j using public.papa_push_subscriptions s
 where j.subscription_id=s.id and exists(select 1 from public.papa_push_subscriptions n where n.streamer_id=s.streamer_id and n.endpoint=s.endpoint and (n.created_at,n.id)>(s.created_at,s.id));
delete from public.papa_push_subscriptions s
 where exists(select 1 from public.papa_push_subscriptions n where n.streamer_id=s.streamer_id and n.endpoint=s.endpoint and (n.created_at,n.id)>(s.created_at,s.id));
alter table public.papa_push_subscriptions add constraint papa_push_subscriptions_streamer_id_endpoint_key unique (streamer_id, endpoint);
alter table public.papa_push_subscriptions drop constraint papa_push_subscriptions_room_endpoint_recipient_key;
commit;
