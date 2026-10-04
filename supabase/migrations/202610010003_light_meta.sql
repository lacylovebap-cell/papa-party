begin;

-- Chat, board and notifications need streamer names and room IDs only.
-- Keep home settings and all player/song/history entities out of their polls.
create or replace function public.papa_streamer_directory()
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce((select data->'streamers' from public.papa_v2_entities
                  where kind='meta' and id='1'),'[]'::jsonb);
$$;

revoke all on function public.papa_streamer_directory() from public,anon,authenticated;
grant execute on function public.papa_streamer_directory() to service_role;

commit;
