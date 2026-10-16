begin;
create or replace function public.papa_achievement_public_rows()
returns table(player_key text,account_id uuid,space_id text,streamer_id text,player_id text,player_name text,streamer_name text,
 code text,name text,lifetime text,visibility text,condition_text text,acquired_at timestamptz,recorded_active boolean)
language sql stable security definer set search_path=pg_catalog,public as $$
 with profiles as (
 select b.account_id,'space-001'::text space_id,p.id player_id from public.papa_account_legacy_players b join public.papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
 union all select account_id,space_id,player_id from public.papa_space_player_profiles
 ),rooms as(select r->>'id' id,r->>'spaceId' space_id,r->>'display_name' name from jsonb_array_elements(public.papa_streamer_directory()) r where coalesce((r->>'active')::boolean,true)),
 rows as(select held.*,p.player_id,rooms.name streamer_name,c.lifetime,c.condition_text,
 case when left(coalesce(c.badge_id,''),1) in ('H','L') then c.default_visibility else coalesce(v.visibility,c.default_visibility) end visibility,
 c.badge_id,(select min(a.acquired_at) from public.papa_achievement_awards a where a.space_id=held.space_id and a.streamer_id=held.streamer_id and a.player_id=p.player_id and a.code=held.code) acquired_at
 from public.papa_badge_rank_rows() held join profiles p on p.account_id=held.account_id and p.space_id=held.space_id
 join rooms on rooms.id=held.streamer_id and rooms.space_id=held.space_id
 join public.papa_achievement_catalog c on c.code=held.code
 left join public.papa_achievement_visibility v on v.space_id=held.space_id and v.streamer_id=held.streamer_id and v.code=held.code
 where held.badge_scope='streamer')
 select player_key,account_id,space_id,streamer_id,player_id,player_name,streamer_name,code,name,lifetime,visibility,
 case when visibility='condition_hidden' then null else condition_text end,acquired_at,true
 from rows where visibility<>'hidden';
$$;
revoke all on function public.papa_achievement_public_rows() from public,anon,authenticated,service_role;
create or replace function public.papa_achievement_collection(requested_space text,requested_room text,actor_context jsonb,
 view_mode text default 'room',query_text text default '',page_number int default 0,public_player text default null,target_room text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;result jsonb;selected_room text;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if view_mode is null or view_mode not in ('room','global','global_single','global_streamers','global_total','songs_room','songs_global','rooms','gallery','mine')
  or page_number is null or page_number not between 0 and 100000 or query_text is null or length(query_text)>100
  or public_player is not null and public_player !~ '^[a-f0-9]{32}$'
 then raise exception 'ACHIEVEMENT_COLLECTION_INVALID';end if;
 selected_room=coalesce(target_room,requested_room);
 if view_mode in ('songs_room','room') and not exists(select 1 from public.papa_space_streamers where streamer_id=selected_room and space_id=requested_space)
 then raise exception 'ACHIEVEMENT_COLLECTION_ROOM_INVALID';end if;
 if view_mode='rooms' then
  with rooms as(select r.player_key,r.space_id,r.streamer_id,min(r.streamer_name) name,count(distinct r.code)::int total from public.papa_achievement_public_rows() r where r.player_key=public_player group by r.player_key,r.space_id,r.streamer_id
   union all select r.player_key,null,'__global__','全站勳章',count(distinct r.code)::int from public.papa_badge_rank_rows() r where r.player_key=public_player and r.badge_scope='global' group by r.player_key),
  paged as(select * from rooms order by name,streamer_id limit 20 offset page_number*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'),'total',(select count(*) from rooms),'page',page_number) into result;
 elsif view_mode='gallery' and selected_room='__global__' then
  select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('code',c.code,'badgeId',c.badge_id,'emoji',c.emoji,'scope','global','name',c.name,
   'condition',case when left(coalesce(c.badge_id,''),1)='H' then null else c.condition_text end,'lifetime',c.lifetime,'visibility',c.default_visibility,'qualified',true,'recorded',true,'currentActive',true,
   'acquiredAt',g.acquired_at) order by c.code),'[]'),'totalDefinitions',(select count(*) from public.papa_achievement_catalog where not retired)) into result
  from public.papa_badge_rank_rows() r join public.papa_achievement_catalog c on c.code=r.code join public.papa_global_badge_awards g on g.account_id=r.account_id and g.code=r.code
  where r.player_key=public_player and r.badge_scope='global' and c.default_visibility<>'hidden';
 elsif view_mode in ('room','global') then
  with rows as materialized(
   select r.player_key,r.account_id,r.player_name,r.code,r.name,r.badge_scope,r.space_id,r.streamer_id
   from public.papa_badge_rank_rows() r where view_mode='global' and r.badge_scope='global'
    or view_mode='room' and r.badge_scope='streamer' and r.space_id=requested_space and r.streamer_id=selected_room
  ),grouped as(
   select r.player_key,min(r.player_name) name,count(distinct r.code)::int total,
    array_remove(array_agg(distinct case when r.badge_scope='global' or exists(select 1 from public.papa_achievement_public_rows() visible where visible.account_id=r.account_id and visible.space_id=r.space_id and visible.streamer_id=r.streamer_id and visible.code=r.code) then r.name end),null) preview
   from rows r group by r.player_key
  ),ranked as(select *,rank() over(order by total desc)::int rank from grouped),
  filtered as(select player_key,name,total,preview,rank from ranked where position(lower(query_text) in lower(name))>0)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by rank,player_key) from(
   select player_key,name,total,preview[1:3] preview,rank from filtered order by rank,player_key limit 20 offset page_number*20)p),'[]'),
   'total',(select count(*) from filtered),'page',page_number) into result;
 elsif view_mode in ('global_single','global_streamers','global_total') then
  with held as materialized(select * from public.papa_badge_rank_rows() where badge_scope='streamer'),
  per_room as(select player_key,space_id,streamer_id,min(player_name) name,count(distinct code)::int total from held group by player_key,space_id,streamer_id),
  grouped as(select player_key,min(name) name,
   case when view_mode='global_single' then max(total) when view_mode='global_streamers' then count(*)::int else sum(total)::int end total
   from per_room group by player_key),
  ranked as(select *,rank() over(order by total desc)::int rank from grouped),
  filtered as(select * from ranked where position(lower(query_text) in lower(name))>0)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by rank,player_key) from(
   select f.*,coalesce((select jsonb_agg(jsonb_build_object('spaceId',r.space_id,'streamerId',r.streamer_id)) from per_room r where r.player_key=f.player_key and r.total=f.total),'[]') bestRooms
   from filtered f order by rank,player_key limit 20 offset page_number*20)p),'[]'),
   'total',(select count(*) from filtered),'page',page_number) into result;
 elsif view_mode in ('songs_room','songs_global') then
  -- Only aggregate fields stay inside PostgreSQL. No song bodies, lyrics,
  -- requests or Audit history are returned to Edge or the browser.
  with queues as(
   select e.id,e.data from public.papa_v2_entities e where e.kind='queue'
    and (view_mode='songs_global' or e.space_id=requested_space and e.data->>'streamer_id'=selected_room)
    and e.data->>'status'='completed' and e.data->>'kind' in ('live','saved') and public.papa_accounting_time(e.data->>'completedAt')<=now()
    and coalesce(e.data->>'source',case when e.data->'selfProvided'='true' then 'self' else 'manual' end)='manual'
    and coalesce(e.data->'selfProvided','false')<>'true'
    and coalesce(e.data->'test','false')<>'true' and nullif(e.data->>'voided_at','') is null
    and nullif(e.data->>'performance_duplicate_of','') is null
    and public.papa_achievement_player_valid(e.space_id,e.data->>'playerId',false)
  ),units as(
   select lower(btrim(public.papa_badge_song_field(q.data,i,'title'))) title,lower(btrim(coalesce(public.papa_badge_song_field(q.data,i,'artist'),''))) artist,
    btrim(public.papa_badge_song_field(q.data,i,'title')) display_title,btrim(coalesce(public.papa_badge_song_field(q.data,i,'artist'),'')) display_artist,
    case when i->>'performances' ~ '^[0-9]{1,4}$' then greatest(1,least(1000,(i->>'performances')::int)) else 1 end n
   from queues q cross join lateral jsonb_array_elements(case when jsonb_typeof(q.data->'items')='array' and jsonb_array_length(q.data->'items')>0
    then q.data->'items' else jsonb_build_array(jsonb_build_object('title',q.data->>'title','artist',q.data->>'artist')) end) i
  ),grouped as(select title,artist,min(display_title) display_title,min(display_artist) display_artist,sum(n)::int total from units where nullif(title,'') is not null group by title,artist),
  ranked as(select *,rank() over(order by total desc)::int rank from grouped),
  filtered as(select display_title title,display_artist artist,display_title name,total,rank from ranked where position(lower(query_text) in title||' '||artist)>0)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by rank,title,artist) from(
   select title,artist,name,total,rank from filtered order by rank,title,artist limit 20 offset page_number*20)p),'[]'),
   'total',(select count(*) from filtered),'page',page_number) into result;
 elsif view_mode='mine' then
  with rooms as(select room->>'id' id,room->>'display_name' name from jsonb_array_elements(public.papa_streamer_directory_in_space(requested_space)) room
    where coalesce((room->>'active')::boolean,true) and room->>'id'<>requested_room),
  grouped as(select requested_space space_id,rooms.id streamer_id,rooms.name,count(distinct held.code)::int total
   from rooms left join public.papa_badge_rank_rows() held on held.space_id=requested_space and held.streamer_id=rooms.id
    and held.account_id=(actor_context->>'account_id')::uuid
   where exists(select 1 from public.papa_achievement_awards a where a.space_id=requested_space and a.streamer_id=rooms.id
    and public.papa_badge_account(requested_space,a.player_id)=(actor_context->>'account_id')::uuid)
   group by rooms.id,rooms.name)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by name,streamer_id) from(
   select space_id,streamer_id,name,total from grouped order by name,streamer_id limit 20 offset page_number*20)p),'[]'),
   'total',(select count(*) from grouped),'page',page_number) into result;
 else
  result=public.papa_achievement_collection_badge_legacy(requested_space,requested_room,actor_context,view_mode,query_text,page_number,public_player,target_room);
  if view_mode='gallery' then
   result=jsonb_set(result,'{rows}',coalesce((select jsonb_agg(row.value||jsonb_build_object('badgeId',c.badge_id,'emoji',c.emoji,'scope',c.badge_scope,
    'condition',case when left(c.badge_id,1)='H' then null else row.value->>'condition' end))
    from jsonb_array_elements(result->'rows') row(value) join public.papa_achievement_catalog c on c.code=row.value->>'code' and not c.retired),'[]'));
  end if;
  if view_mode='gallery' then result=result||jsonb_build_object('totalDefinitions',(select count(*) from public.papa_achievement_catalog where not retired));end if;
  return result;
 end if;
 return result||jsonb_build_object('version',1,'mode',view_mode);
end $$;
revoke all on function public.papa_achievement_collection(text,text,jsonb,text,text,int,text,text) from public,anon,authenticated;
grant execute on function public.papa_achievement_collection(text,text,jsonb,text,text,int,text,text) to service_role;
commit;
