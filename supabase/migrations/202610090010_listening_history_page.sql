begin;

-- Aggregate the original completed performances in the selected room. This is
-- a read projection, not another accounting store or a favorites ranking.
create index papa_completed_player_room on public.papa_v2_entities
 (space_id,(data->>'streamer_id'),(data->>'playerId'))
 where kind='queue' and data->>'status'='completed';

-- Invalid legacy dates must not break browsing or win a snapshot tie.
create function public.papa_listening_snapshot_time(record_data jsonb)
returns timestamptz language plpgsql immutable set search_path=public set timezone='UTC' as $$
declare field text;value timestamptz;
begin
 foreach field in array array['history_effective_at','completedAt','effective_at','at'] loop
  if jsonb_typeof(record_data->field)='string' then
   begin
    value=(record_data->>field)::timestamptz;
    if isfinite(value) then return value;end if;
   exception when invalid_datetime_format or datetime_field_overflow then null;end;
  end if;
 end loop;
 return '-infinity'::timestamptz;
end $$;
revoke all on function public.papa_listening_snapshot_time(jsonb) from public,anon,authenticated,service_role;

create function public.papa_listening_history_page(
 requested_space text,requested_room text,requested_player text,actor_context jsonb,
 page_limit integer default 20,page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor_kind text;result jsonb;
begin
 if page_limit is null or page_limit<1 or page_limit>50 or page_offset is null
  or page_offset<0 or page_offset>10000000 or requested_player is null
  or length(requested_player) not between 1 and 128
 then raise exception 'LISTENING_HISTORY_PAGE_INVALID';end if;
 if requested_space is null or requested_room is null or not exists(
  select 1 from papa_space_streamers scope join papa_spaces space on space.id=scope.space_id
  join papa_v2_entities meta on meta.kind='meta' and meta.id='1'
  cross join lateral jsonb_array_elements(coalesce(meta.data->'streamers','[]'::jsonb)) room
  where scope.space_id=requested_space and scope.streamer_id=requested_room
   and space.status='active' and room->>'id'=requested_room
   and (actor_context->>'role' in ('super_admin','streamer_admin') or coalesce((room->>'active')::boolean,true)))
 then raise exception 'LISTENING_HISTORY_SCOPE_INVALID';end if;
 actor_kind=actor_context->>'role';
 if actor_kind='player' then
  perform papa_song_favorite_actor(requested_space,requested_room,actor_context);
  if requested_player is distinct from actor_context->>'player_id'
  then raise exception 'LISTENING_HISTORY_ACTOR_INVALID';end if;
 elsif actor_kind in ('super_admin','streamer_admin') then
  perform papa_room_native_actor_guard(actor_context,requested_room,requested_space);
 else raise exception 'LISTENING_HISTORY_ACTOR_INVALID';end if;
 if requested_space='space-001' then
  if not exists(select 1 from papa_v2_entities profile where profile.kind='players'
   and profile.space_id is null and profile.id=requested_player)
  then raise exception 'LISTENING_HISTORY_PLAYER_INVALID';end if;
 else
  if not exists(select 1 from papa_space_player_profiles profile
   join papa_space_memberships membership on membership.id=profile.membership_id
    and membership.account_id=profile.account_id and membership.space_id=profile.space_id
    and membership.role='player' and membership.status='active'
   join papa_accounts account on account.id=profile.account_id and account.disabled_at is null
   where profile.space_id=requested_space and profile.player_id=requested_player)
  then raise exception 'LISTENING_HISTORY_PLAYER_INVALID';end if;
 end if;
 with completed as materialized (
  select entry.id,entry.data from papa_v2_entities entry
  where entry.kind='queue' and entry.space_id=requested_space
   and entry.data->>'streamer_id'=requested_room and entry.data->>'playerId'=requested_player
   and entry.data->>'status'='completed' and entry.data->>'kind' is distinct from 'self'
   and entry.data->'test' is distinct from 'true'::jsonb
   and entry.data->'selfProvided' is distinct from 'true'::jsonb
 ),items as (
  select completed.id,completed.data,item.value,item.ordinal,
   case when jsonb_typeof(item.value->'performances')='number' then
    case when (item.value->>'performances')::numeric between 1 and 9007199254740991
     and trunc((item.value->>'performances')::numeric)=(item.value->>'performances')::numeric
     then (item.value->>'performances')::numeric end end performances
  from completed cross join lateral jsonb_array_elements(case
   when jsonb_typeof(completed.data->'items')='array' then completed.data->'items'
   else jsonb_build_array(jsonb_build_object('songId',completed.data->>'songId',
    'title',completed.data->>'title','artist',completed.data->>'artist','performances',1)) end)
   with ordinality item(value,ordinal)
 ),counts as materialized (
  select value->>'songId' song_id,sum(performances) listened_count,
   (array_agg(coalesce(nullif(value->>'title',''),case when value->>'songId'=data->>'songId' then nullif(data->>'title','') end,'歌曲')
    order by papa_listening_snapshot_time(data) desc,id desc,ordinal desc))[1] title_snapshot,
   (array_agg(coalesce(nullif(value->>'artist',''),case when value->>'songId'=data->>'songId' then data->>'artist' end,'')
    order by papa_listening_snapshot_time(data) desc,id desc,ordinal desc))[1] artist_snapshot
  from items where performances is not null and jsonb_typeof(value->'songId')='string'
   and length(value->>'songId') between 1 and 128
  group by value->>'songId'
 ),page as materialized (
  select song_id,listened_count,title_snapshot,artist_snapshot from counts
  order by listened_count desc,song_id limit page_limit offset page_offset
 ),projected as (
  select page.song_id,page.listened_count,jsonb_build_object(
   'songId',page.song_id,'title',coalesce(variant.title,nullif(song.data->>'title',''),page.title_snapshot),
   'artist',coalesce(variant.artist,song.data->>'artist',page.artist_snapshot),
   'listenedCount',page.listened_count,'requestable',song.id is not null
    and song.data->'hidden' is distinct from 'true'::jsonb
    and song.data->'deleted' is distinct from 'true'::jsonb
    and song.data->'active' is distinct from 'false'::jsonb
    and song.data->'disabled' is distinct from 'true'::jsonb
    and song.data->'available' is distinct from 'false'::jsonb) row_data
  from page left join papa_v2_entities song on song.kind='songs' and song.id=page.song_id
   and song.space_id=requested_space and song.data->>'streamer_id'=requested_room
  left join papa_catalog_song_links link on link.streamer_id=requested_room and link.song_id=page.song_id
   and link.source_hash=papa_catalog_source_hash(song.data)
  left join papa_catalog_variants variant on variant.id=link.variant_id and variant.active
   and exists(select 1 from papa_catalog_families family where family.id=variant.family_id and family.active)
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row_data order by listened_count desc,song_id) from projected),'[]'::jsonb),
  'total',(select count(1) from counts),'pageLimit',page_limit,'pageOffset',page_offset,
  'hasMore',page_offset+page_limit<(select count(1) from counts)) into result;
 return result;
end $$;
revoke all on function public.papa_listening_history_page(text,text,text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.papa_listening_history_page(text,text,text,jsonb,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
