begin;
-- Public hourly capacity must be exhausted before an exclusive player unit is
-- consumed. Replace only the selected-page summary projection; formal rows,
-- requests, ledger settlement and IDs are untouched.
create index if not exists papa_queue_room_kind_status on public.papa_v2_entities
 (space_id,(data->>'streamer_id'),(data->>'kind'),(data->>'status')) where kind='queue';
create or replace function public.papa_player_streamer_summary(requested_space text,actor_context jsonb,
 page_limit integer default 20,page_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public set timezone='UTC' as $$
declare subject uuid;player text;meta jsonb;legacy_settings jsonb;result jsonb;
begin
 subject=papa_song_favorite_actor(requested_space,actor_context->>'streamer_id',actor_context);player=actor_context->>'player_id';
 if page_limit is null or page_limit not between 1 and 50 or page_offset is null or page_offset not between 0 and 10000000
 then raise exception 'PLAYER_STREAMER_PAGE_INVALID';end if;
 select data into meta from papa_v2_entities where kind='meta' and id='1';
 select data into legacy_settings from papa_v2_entities where kind='settings' and id='1';
 if exists(select 1 from jsonb_array_elements(coalesce(meta->'streamers','[]'::jsonb)) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id' and scope.space_id=requested_space
  cross join lateral (select coalesce(meta->'streamerSettings'->scope.streamer_id,
   case when requested_space='space-001' and scope.streamer_id='papa' then legacy_settings end,'{}'::jsonb) value) settings
  where coalesce((room->>'active')::boolean,true) and (jsonb_typeof(settings.value) is distinct from 'object'
   or settings.value ? 'radio_enabled' and jsonb_typeof(settings.value->'radio_enabled') is distinct from 'boolean'
   or settings.value ? 'current_space' and (jsonb_typeof(settings.value->'current_space') is distinct from 'string'
    or settings.value->>'current_space' not in ('shengma','radio'))
   or settings.value ? 'status' and settings.value->>'status' not in ('空閒中','準備中','忙碌中','暫停點歌')))
 then raise exception 'PLAYER_STREAMER_DATA_INVALID';end if;
 if exists(select 1 from papa_v2_entities ledger
  join papa_space_streamers scope on scope.streamer_id=ledger.data->>'streamer_id' and scope.space_id=requested_space
  where ledger.kind='ledger' and ledger.space_id=requested_space and ledger.data->>'playerId'=player
   and coalesce(ledger.data->>'storage_pool','shengma') not in ('shengma','radio')
   and exists(select 1 from jsonb_array_elements(coalesce(meta->'streamers','[]'::jsonb)) room
    where room->>'id'=scope.streamer_id and coalesce((room->>'active')::boolean,true)))
 then raise exception 'PLAYER_STREAMER_DATA_INVALID';end if;
 with rooms as materialized (
  select scope.streamer_id,coalesce(room->>'slug',scope.streamer_id) slug,
   coalesce(room->>'display_name',scope.streamer_id) name,
   case coalesce(settings.value->>'status','空閒中') when '空閒中' then 'idle' when '準備中' then 'preparing'
    when '忙碌中' then 'busy' else 'paused' end status,
   case when settings.value->'radio_enabled'='true'::jsonb and settings.value->>'current_space'='radio' then 'radio' else 'shengma' end pool,
   coalesce((settings.value->>'hourlyLimit')::numeric,2) hourly_limit
  from jsonb_array_elements(coalesce(meta->'streamers','[]'::jsonb)) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id' and scope.space_id=requested_space
  cross join lateral (select coalesce(meta->'streamerSettings'->scope.streamer_id,
   case when requested_space='space-001' and scope.streamer_id='papa' then legacy_settings end,'{}'::jsonb) value) settings
  where coalesce((room->>'active')::boolean,true)
 ),page as materialized (
  select streamer_id,slug,name,status,pool,hourly_limit from rooms order by
   case status when 'idle' then 0 when 'preparing' then 1 when 'busy' then 2 else 3 end,lower(name),streamer_id
  limit page_limit offset page_offset
 ),credits as materialized (
  select page.streamer_id,sum((ledger.data->>'amount')::numeric) balance
  from page join papa_v2_entities ledger on ledger.kind='ledger' and ledger.space_id=requested_space
   and ledger.data->>'streamer_id'=page.streamer_id and ledger.data->>'playerId'=player
   and coalesce(ledger.data->>'storage_pool','shengma')=page.pool group by page.streamer_id
 ),queue_rows as materialized (
  select page.streamer_id,page.hourly_limit,queue.id,coalesce((queue.data->>'_order')::bigint,0) sort_order,queue.data,
   coalesce((queue.data->>'creditCost')::numeric,1) cost,papa_player_quota_time(queue.data) quota_at
  from page join papa_v2_entities queue on queue.kind='queue' and queue.space_id=requested_space
   and queue.data->>'streamer_id'=page.streamer_id
  where (queue.data->>'playerId'=player and queue.data->>'status' in ('pending','waiting'))
   or (queue.data->>'kind'='saved' and queue.data->>'status' in ('completed','pending','waiting')
    and date_trunc('hour',papa_player_quota_time(queue.data))=date_trunc('hour',now()))
 ),ordered_quota as materialized (
  select queue_rows.*,coalesce(sum(cost) over(partition by streamer_id order by quota_at,sort_order,id
   rows between unbounded preceding and 1 preceding),0) prior_cost
  from queue_rows where data->>'kind'='saved' and data->>'status' in ('completed','pending','waiting')
   and date_trunc('hour',quota_at)=date_trunc('hour',now())
 ),personal as materialized (
  select streamer_id,sum(greatest(0,least(cost,prior_cost+cost-hourly_limit))) personal_used
  from ordered_quota where data->>'playerId'=player group by streamer_id
 ),queues as materialized (
  select streamer_id,count(*) waiting,
   (array_agg(data->>'title' order by quota_at,sort_order,id))[1] waiting_title
  from queue_rows where data->>'playerId'=player and data->>'status' in ('pending','waiting') group by streamer_id
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('streamerId',page.streamer_id,
  'slug',page.slug,'name',page.name,'status',page.status,'storedCredits',coalesce(credits.balance,0),
  'waitingCount',coalesce(queues.waiting,0),'waitingTitle',coalesce(queues.waiting_title,''),'personalRemaining',greatest(0,
   case when quota.enabled then quota.extra_quota else 0 end-coalesce(personal.personal_used,0)))
  order by case page.status when 'idle' then 0 when 'preparing' then 1 when 'busy' then 2 else 3 end,lower(page.name),page.streamer_id)
  from page left join credits on credits.streamer_id=page.streamer_id left join queues on queues.streamer_id=page.streamer_id
  left join personal on personal.streamer_id=page.streamer_id
  left join papa_player_extra_quotas quota on quota.space_id=requested_space and quota.streamer_id=page.streamer_id and quota.player_id=player),'[]'::jsonb),
  'total',(select count(*) from rooms),'pageLimit',page_limit,'pageOffset',page_offset) into result;
 return result;
end $$;
revoke all on function public.papa_player_streamer_summary(text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.papa_player_streamer_summary(text,jsonb,integer,integer) to service_role;
commit;
