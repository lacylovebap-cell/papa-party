begin;
-- One qualifying full-hour failure per player, streamer, and hour.
alter table public.papa_events add column if not exists hour_bucket bigint;
create unique index if not exists papa_events_failed_hour
on public.papa_events(streamer_id,actor_player_id,hour_bucket)
where action='request_failed';
create or replace function public.papa_record_failed_request(room_id text,player_id text,song_id text,bucket bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare inserted_id bigint;
begin
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,effective_at,hour_bucket,after_data)
 values(room_id,'queue',song_id,'request_failed','player',player_id,now()::text,bucket,jsonb_build_object('songId',song_id,'reason','hourly_limit'))
 on conflict do nothing returning id into inserted_id;
 return inserted_id is not null;
end $$;
revoke all on function public.papa_record_failed_request(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.papa_record_failed_request(text,text,text,bigint) to service_role;
commit;
