begin;
-- Public award projection only. No new awards, business counters or history edits.
create function public.papa_achievement_public_rows()
returns table(player_key text,account_id uuid,space_id text,streamer_id text,player_id text,player_name text,streamer_name text,code text,name text,lifetime text,visibility text,condition_text text,acquired_at timestamptz,recorded_active boolean)
language sql stable security definer set search_path=pg_catalog,public as $$
 with profiles as (
  select b.account_id,'space-001'::text space_id,p.id player_id,p.data from papa_account_legacy_players b join papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
  union all select account_id,space_id,player_id,data from papa_space_player_profiles
 ),rooms as(select r->>'id' id,r->>'spaceId' space_id,r->>'display_name' name from jsonb_array_elements(papa_streamer_directory()) r where coalesce((r->>'active')::boolean,true))
 select md5('public-medals:'||p.account_id::text),p.account_id,a.space_id,a.streamer_id,a.player_id,coalesce(nullif(p.data->>'name',''),'玩家'),r.name,c.code,c.name,c.lifetime,
 coalesce(v.visibility,c.default_visibility),case when coalesce(v.visibility,c.default_visibility)='condition_hidden' then null else c.condition_text end,
 min(a.acquired_at),bool_or(a.active and (c.lifetime<>'show' or a.period=((now() at time zone 'Asia/Taipei')-make_interval(hours=>s.accounting_rollover_hour))::date::text))
 from papa_achievement_awards a join profiles p on p.space_id=a.space_id and p.player_id=a.player_id
 join papa_accounts account on account.id=p.account_id and account.disabled_at is null
 join papa_space_memberships membership on membership.account_id=p.account_id and membership.space_id=p.space_id and membership.role='player' and membership.status='active'
 join papa_spaces s on s.id=a.space_id and s.status='active'
 join rooms r on r.id=a.streamer_id and r.space_id=a.space_id
 join papa_achievement_catalog c on c.code=a.code
 left join papa_achievement_visibility v on v.space_id=a.space_id and v.streamer_id=a.streamer_id and v.code=a.code
 where coalesce(p.data->'archived','false')<>'true'::jsonb and coalesce(p.data->'test','false')<>'true'::jsonb
 and coalesce(v.visibility,c.default_visibility)<>'hidden'
 group by p.account_id,a.space_id,a.streamer_id,a.player_id,p.data->>'name',r.name,c.code,c.name,c.lifetime,coalesce(v.visibility,c.default_visibility),c.condition_text;
$$;
revoke all on function public.papa_achievement_public_rows() from public,anon,authenticated,service_role;
create function public.papa_achievement_collection(requested_space text,requested_room text,actor_context jsonb,
 view_mode text default 'room',query_text text default '',page_number int default 0,public_player text default null,target_room text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;result jsonb;selected_room text;flags jsonb;target record;
begin
 ctx=papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if view_mode is null or view_mode not in ('room','global','rooms','gallery','mine') or page_number is null or page_number not between 0 and 100000
  or query_text is null or length(query_text)>100 or public_player is not null and public_player !~ '^[a-f0-9]{32}$' then raise exception 'ACHIEVEMENT_COLLECTION_INVALID';end if;
 selected_room=coalesce(target_room,requested_room);
 if view_mode='gallery' then
  select r.space_id,r.streamer_id,r.player_id into target from papa_achievement_public_rows() r where r.player_key=public_player and r.streamer_id=selected_room limit 1;
  if found then flags=papa_achievement_eligibility(target.space_id,target.streamer_id,target.player_id);else flags='{}';end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('code',r.code,'name',r.name,'condition',r.condition_text,'lifetime',r.lifetime,'visibility',r.visibility,
   'qualified',true,'currentActive',coalesce((flags->>r.code)::boolean,false),'acquiredAt',r.acquired_at) order by r.code),'[]'::jsonb)) into result
  from papa_achievement_public_rows() r where r.player_key=public_player and r.streamer_id=selected_room;
 elsif view_mode='mine' then
  with profile as(select b.legacy_player_id player_id from papa_account_legacy_players b where requested_space='space-001' and b.account_id=(actor_context->>'account_id')::uuid
   union all select p.player_id from papa_space_player_profiles p where requested_space<>'space-001' and p.space_id=requested_space and p.account_id=(actor_context->>'account_id')::uuid),
  rooms as(select r->>'id' streamer_id,r->>'display_name' name from jsonb_array_elements(papa_streamer_directory_in_space(requested_space)) r where coalesce((r->>'active')::boolean,true)),
  grouped as(select r.streamer_id,r.name,requested_space space_id,(select count(distinct a.code)::int from papa_achievement_awards a join profile p on p.player_id=a.player_id where a.space_id=requested_space and a.streamer_id=r.streamer_id) total
   from rooms r where r.streamer_id<>requested_room and (exists(select 1 from papa_achievement_awards a join profile p on p.player_id=a.player_id where a.space_id=requested_space and a.streamer_id=r.streamer_id)
    or exists(select 1 from papa_v2_entities e join profile p on p.player_id=e.data->>'playerId' where e.space_id=requested_space and e.kind in ('queue','ledger','cards','crowns','wishes') and e.data->>'streamer_id'=r.streamer_id)))
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by name,streamer_id) from(select * from grouped order by name,streamer_id limit 20 offset page_number*20)p),'[]'::jsonb),'total',(select count(*) from grouped),'page',page_number) into result;
 elsif view_mode='rooms' then
  with rows as materialized(select r.* from papa_achievement_public_rows() r where case when view_mode='mine' then r.account_id=(actor_context->>'account_id')::uuid else r.player_key=public_player end),
  grouped as(select space_id,streamer_id,min(streamer_name) name,count(*)::int total from rows group by space_id,streamer_id)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by name,streamer_id) from (select * from grouped order by name,streamer_id limit 20 offset page_number*20)p),'[]'::jsonb),'total',(select count(*) from grouped),'page',page_number) into result;
 else
  with rows as materialized(select r.* from papa_achievement_public_rows() r where view_mode='global' or (r.space_id=requested_space and r.streamer_id=selected_room)),
  grouped as(select player_key,min(player_name) name,count(*)::int total,(array_agg(name order by acquired_at desc,code))[1:3] preview from rows group by player_key),
  ranked as(select *,row_number() over(order by total desc,player_key) rank from grouped),
  filtered as(select * from ranked where position(lower(query_text) in lower(name))>0)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by rank) from(select * from filtered order by rank limit 20 offset page_number*20)p),'[]'::jsonb),'total',(select count(*) from filtered),'page',page_number) into result;
 end if;
 return result||jsonb_build_object('version',1,'mode',view_mode);
end $$;
revoke all on function public.papa_achievement_collection(text,text,jsonb,text,text,int,text,text) from public,anon,authenticated;
grant execute on function public.papa_achievement_collection(text,text,jsonb,text,text,int,text,text) to service_role;
commit;
