-- 10.31-PUSH.2: one browser push endpoint may serve several identities of the same
-- room (e.g. the streamer and a test player on one phone). The old key
-- (streamer_id, endpoint) let the last sign-in overwrite the other identity's row.
-- Every existing row already satisfies the wider key, so nothing is rewritten.
alter table public.papa_push_subscriptions add constraint papa_push_subscriptions_room_endpoint_recipient_key unique (streamer_id, endpoint, recipient);
alter table public.papa_push_subscriptions drop constraint papa_push_subscriptions_streamer_id_endpoint_key;
