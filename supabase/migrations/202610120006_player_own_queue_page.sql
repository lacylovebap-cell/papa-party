begin;
-- Selected-page projection of the authenticated player's unfinished requests.
-- No source records, ledger/history rows or events are rewritten.
create index if not exists papa_queue_own_active on public.papa_v2_entities
 (space_id,(data->>'playerId'),(data->>'streamer_id'))
 where kind='queue' and data->>'status' in ('pending','waiting');
create function public.papa_player_queue_page(requested_space text,actor_context jsonb,
 requested_sort text default 'newest',page_limit integer default 20,page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare subject uuid;player text;result jsonb;
begin
 subject=papa_song_favorite_actor(requested_space,actor_context->>'streamer_id',actor_context);
 player=actor_context->>'player_id';
 if requested_sort is null or requested_sort not in ('newest','oldest') or page_limit is null
  or page_limit not between 1 and 20 or page_offset is null or page_offset not between 0 and 10000000
 then raise exception 'PLAYER_QUEUE_PAGE_INVALID';end if;
 with rooms as materialized (
  select scope.streamer_id,coalesce(room->>'slug',scope.streamer_id) slug,
   coalesce(room->>'display_name',scope.streamer_id) name,coalesce(room->'active','true'::jsonb)='true'::jsonb active
  from papa_v2_entities meta cross join lateral jsonb_array_elements(coalesce(meta.data->'streamers','[]'::jsonb)) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id' and scope.space_id=requested_space
  where meta.kind='meta' and meta.id='1'
 ), own_rows as materialized (
  select q.id,q.data,rooms.*,papa_player_quota_time(jsonb_build_object('at',q.data->'at')) created_time
  from papa_v2_entities q join rooms on rooms.streamer_id=q.data->>'streamer_id'
  where q.kind='queue' and q.space_id=requested_space and q.data->>'playerId'=player
   and q.data->>'status' in ('pending','waiting') and q.data->>'kind' in ('saved','live')
 ), page as (
  select * from own_rows order by streamer_id=actor_context->>'streamer_id' desc,
   case when requested_sort='newest' then created_time end desc nulls last,
   case when requested_sort='oldest' then created_time end asc nulls last,id
  limit page_limit offset page_offset
 )
 select jsonb_build_object('revision',(select revision from papa_v2_revision where id=1),
  'total',(select count(*) from own_rows),'rows',coalesce((select jsonb_agg(jsonb_build_object(
   'id',id,'streamerId',streamer_id,'slug',slug,'name',name,'active',active,
   'songId',data->>'songId','title',left(coalesce(data->>'title','歌曲'),300),'artist',left(coalesce(data->>'artist',''),200),
   'kind',data->>'kind','status',data->>'status','at',data->>'at',
   'awaitingAcknowledgment',coalesce(data->'awaitingAcknowledgment'='true'::jsonb,false),
   'awaitingPreparation',coalesce(data->'awaitingPreparation'='true'::jsonb,false),
   'preparationEndsAt',case when jsonb_typeof(data->'preparationEndsAt')='string' then data->>'preparationEndsAt' end,
   'selfProvided',coalesce(data->'selfProvided'='true'::jsonb,false),'source',left(coalesce(data->>'source',''),40),
   'test',coalesce(data->'test'='true'::jsonb,false),
   'items',case when jsonb_typeof(data->'items')='array' then (select coalesce(jsonb_agg(jsonb_build_object(
    'songId',item->>'songId','title',left(coalesce(item->>'title','歌曲'),300),
    'artist',left(coalesce(item->>'artist',''),200),'performances',case when item->'performances'='2'::jsonb then 2 else 1 end)),'[]'::jsonb)
    from (select item from jsonb_array_elements(data->'items') item limit 2) bounded) else '[]'::jsonb end)
   order by streamer_id=actor_context->>'streamer_id' desc,
    case when requested_sort='newest' then created_time end desc nulls last,
    case when requested_sort='oldest' then created_time end asc nulls last,id) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.papa_player_queue_page(text,jsonb,text,integer,integer) from public,anon,authenticated;
grant execute on function public.papa_player_queue_page(text,jsonb,text,integer,integer) to service_role;
commit;
