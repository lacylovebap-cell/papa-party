begin;

-- Search stays inside Postgres. Only the first 30 public directory identities
-- cross the PostgREST/Edge boundary; player notes and passwords never do.
create or replace function public.papa_board_directory(search_text text)
returns table(player_id text,player_name text)
language sql security definer set search_path=public as $$
 select e.id,e.data->>'name'
 from public.papa_v2_entities e
 where e.kind='players'
   and length(trim(search_text)) between 1 and 80
   and (
    lower(coalesce(e.data->>'name','')) like '%'||lower(trim(search_text))||'%'
    or exists (
     select 1
     from jsonb_array_elements_text(case when jsonb_typeof(e.data->'ids')='array' then e.data->'ids' else '[]'::jsonb end) as platform_id(value)
     where lower(platform_id.value) like '%'||lower(trim(search_text))||'%'
    )
   )
 order by e.id
 limit 30;
$$;

revoke all on function public.papa_board_directory(text) from public,anon,authenticated;
grant execute on function public.papa_board_directory(text) to service_role;

-- The notification inbox asks for this small version string every poll.
-- The base64 audio is fetched separately only when this value changes.
-- A stored generated value hashes on audio changes, not on every poll.
alter table public.papa_notice_config
 add column if not exists content_version text generated always as
 (case when id='player_sound' and nullif(value->>'data','') is not null then md5(value->>'data') else '' end) stored;

create or replace function public.papa_notice_sound_version()
returns text language sql stable security definer set search_path=public as $$
 select coalesce((select content_version from public.papa_notice_config where id='player_sound'),'');
$$;

revoke all on function public.papa_notice_sound_version() from public,anon,authenticated;
grant execute on function public.papa_notice_sound_version() to service_role;

commit;
