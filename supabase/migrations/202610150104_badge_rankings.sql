begin;
-- Current possession counts ALL medals, including unpublished medals (confirmed
-- 2026-10-16). Names/conditions in public details still obey publication choices.
create function public.papa_badge_rank_rows()
returns table(player_key text,account_id uuid,space_id text,streamer_id text,player_name text,code text,name text,badge_scope text)
language sql stable security definer set search_path=pg_catalog,public as $$
 with profiles as(
  select b.account_id,'space-001'::text space_id,p.id player_id,p.data from public.papa_account_legacy_players b
   join public.papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
  union all select account_id,space_id,player_id,data from public.papa_space_player_profiles
 ),valid_profiles as(
  select p.account_id,p.space_id,p.player_id,coalesce(nullif(p.data->>'name',''),'玩家') name
  from profiles p join public.papa_accounts a on a.id=p.account_id and a.disabled_at is null
   join public.papa_spaces s on s.id=p.space_id and s.status='active'
  where coalesce(p.data->'test','false')<>'true' and coalesce(p.data->'archived','false')<>'true'
   and exists(select 1 from public.papa_space_memberships m where m.account_id=p.account_id and m.space_id=p.space_id and m.role='player' and m.status='active')
 ),room_awards as(
  select distinct p.account_id,p.space_id,a.streamer_id,p.name player_name,c.code,c.name
  from valid_profiles p join public.papa_achievement_awards a on a.space_id=p.space_id and a.player_id=p.player_id
  join public.papa_achievement_catalog c on c.code=a.code and not c.retired and c.badge_scope='streamer'
  where a.active and (a.manual_verified or (a.rule_version=2 or c.badge_id is null)
   and (a.expires_at is null or a.expires_at>now()) and public.papa_badge_dynamic_valid(p.space_id,a.streamer_id,p.player_id,c.code))
 ),global_awards as(
  select p.account_id,min(p.name) player_name,c.code,c.name from valid_profiles p
  join public.papa_global_badge_awards g on g.account_id=p.account_id and g.active
  join public.papa_achievement_catalog c on c.code=g.code and not c.retired and c.badge_scope='global'
  where g.manual_verified or g.expires_at is null or g.expires_at>now() group by p.account_id,c.code,c.name
 )
 select md5('public-medals:'||a.account_id::text),a.account_id,a.space_id,a.streamer_id,a.player_name,a.code,a.name,'streamer' from room_awards a
 union all select md5('public-medals:'||g.account_id::text),g.account_id,null,null,g.player_name,g.code,g.name,'global' from global_awards g
$$;
revoke all on function public.papa_badge_rank_rows() from public,anon,authenticated,service_role;

alter function public.papa_achievement_public_rows() rename to papa_achievement_public_rows_badge_legacy;
create function public.papa_achievement_public_rows()
returns table(player_key text,account_id uuid,space_id text,streamer_id text,player_id text,player_name text,streamer_name text,
 code text,name text,lifetime text,visibility text,condition_text text,acquired_at timestamptz,recorded_active boolean)
language sql stable security definer set search_path=pg_catalog,public as $$
 with held as materialized(select account_id,code,badge_scope,space_id,streamer_id from public.papa_badge_rank_rows())
 select l.player_key,l.account_id,l.space_id,l.streamer_id,l.player_id,l.player_name,l.streamer_name,l.code,l.name,l.lifetime,
  case when left(c.badge_id,1) in ('H','L') then c.default_visibility else l.visibility end,
  case when left(c.badge_id,1)='H' then null else l.condition_text end,coalesce(g.acquired_at,l.acquired_at),
  exists(select 1 from held r where r.account_id=l.account_id and r.code=l.code
   and (r.badge_scope='global' or r.space_id=l.space_id and r.streamer_id=l.streamer_id))
 from public.papa_achievement_public_rows_badge_legacy() l join public.papa_achievement_catalog c on c.code=l.code and not c.retired
 left join public.papa_global_badge_awards g on c.badge_scope='global' and g.account_id=l.account_id and g.code=c.code
$$;
revoke all on function public.papa_achievement_public_rows(),public.papa_achievement_public_rows_badge_legacy() from public,anon,authenticated,service_role;

alter function public.papa_achievement_collection(text,text,jsonb,text,text,int,text,text) rename to papa_achievement_collection_badge_legacy;
create function public.papa_achievement_collection(requested_space text,requested_room text,actor_context jsonb,
 view_mode text default 'room',query_text text default '',page_number int default 0,public_player text default null,target_room text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;result jsonb;selected_room text;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if view_mode is null or view_mode not in ('room','global','songs_room','songs_global','rooms','gallery','mine')
  or page_number is null or page_number not between 0 and 100000 or query_text is null or length(query_text)>100
  or public_player is not null and public_player !~ '^[a-f0-9]{32}$'
 then raise exception 'ACHIEVEMENT_COLLECTION_INVALID';end if;
 selected_room=coalesce(target_room,requested_room);
 if view_mode in ('songs_room','room') and not exists(select 1 from public.papa_space_streamers where streamer_id=selected_room and space_id=requested_space)
 then raise exception 'ACHIEVEMENT_COLLECTION_ROOM_INVALID';end if;
 if view_mode in ('room','global') then
  with rows as materialized(
   select r.player_key,r.account_id,r.player_name,r.code,r.name,r.badge_scope,r.space_id,r.streamer_id
   from public.papa_badge_rank_rows() r where view_mode='global' and r.badge_scope='global'
    or view_mode='room' and r.badge_scope='streamer' and r.space_id=requested_space and r.streamer_id=selected_room
  ),grouped as(
   select r.player_key,min(r.player_name) name,count(distinct r.code)::int total,
    array_remove(array_agg(distinct case when exists(select 1 from public.papa_achievement_public_choices o where o.account_id=r.account_id
     and o.code=r.code and o.enabled and (r.badge_scope='global' or o.space_id=r.space_id and o.streamer_id=r.streamer_id)) then r.name end),null) preview
   from rows r group by r.player_key
  ),ranked as(select *,rank() over(order by total desc)::int rank from grouped),
  filtered as(select player_key,name,total,preview,rank from ranked where position(lower(query_text) in lower(name))>0)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by rank,player_key) from(
   select player_key,name,total,preview[1:3] preview,rank from filtered order by rank,player_key limit 20 offset page_number*20)p),'[]'),
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
  return result;
 end if;
 return result||jsonb_build_object('version',1,'mode',view_mode);
end $$;
revoke all on function public.papa_achievement_collection_badge_legacy(text,text,jsonb,text,text,int,text,text) from public,anon,authenticated,service_role;
revoke all on function public.papa_achievement_collection(text,text,jsonb,text,text,int,text,text) from public,anon,authenticated;
grant execute on function public.papa_achievement_collection(text,text,jsonb,text,text,int,text,text) to service_role;
commit;
