begin;
-- Ephemeral activity metadata, not accounting, chat bodies or Audit history.
-- No backfill. No new polling, device credential, access role or subscription.
create table papa_player_activity(
 space_id text not null,streamer_id text not null,player_id text not null,actor_key text not null check(actor_key ~ '^[a-f0-9]{64}$'),
 page text not null check(page in ('home','book','common-book','center','gallery')),
 visible boolean not null,last_seen timestamptz not null,
 primary key(space_id,streamer_id,player_id,actor_key)
);
create index papa_activity_recent on papa_player_activity(space_id,last_seen desc);
alter table papa_player_activity enable row level security;
revoke all on papa_player_activity from public,anon,authenticated,service_role;
create function papa_activity_record(requested_space text,requested_room text,actor_context jsonb,requested_actor_key text,page_name text,is_visible boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare room text;ctx jsonb;
begin
 if actor_context->>'role' is distinct from 'player' or requested_actor_key is null or requested_actor_key !~ '^[a-f0-9]{64}$'
  or page_name is null or page_name not in ('home','book','common-book','center','gallery') or is_visible is null then raise exception 'ACTIVITY_INPUT_INVALID';end if;
 select r->>'id' into room from papa_v2_entities e cross join lateral jsonb_array_elements(e.data->'streamers') r
  join papa_space_streamers m on m.streamer_id=r->>'id' and m.space_id=requested_space
  where e.kind='meta' and (r->>'id'=requested_room or r->>'slug'=requested_room) limit 1;
 if room is null then raise exception 'ACTIVITY_SCOPE_INVALID';end if;
 ctx=papa_communication_context(requested_space,room,actor_context);
 if ctx->>'role' is distinct from 'player' or not papa_achievement_player_valid(requested_space,ctx->>'player_id') then raise exception 'ACTIVITY_PLAYER_INVALID';end if;
 insert into papa_player_activity values(requested_space,room,ctx->>'player_id',requested_actor_key,page_name,is_visible,now())
 on conflict(space_id,streamer_id,player_id,actor_key) do update set page=excluded.page,visible=excluded.visible,last_seen=excluded.last_seen
 where papa_player_activity.last_seen<now()-interval '120 seconds' or papa_player_activity.page is distinct from excluded.page or papa_player_activity.visible is distinct from excluded.visible;
 return jsonb_build_object('ok',true);
end $$;
create function papa_activity_page(requested_space text,requested_room text,actor_context jsonb,page_number int default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;result jsonb;total bigint;
begin
 ctx=papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' is distinct from '__super__' then raise exception 'ACTIVITY_PRESIDENT_REQUIRED';end if;
 if page_number is null or page_number<0 or page_number>100000 then raise exception 'ACTIVITY_PAGE_INVALID';end if;
 with recent as(select player_id,streamer_id,max(last_seen) last_seen,bool_or(visible and last_seen>now()-interval '3 minutes') online
  from papa_player_activity where space_id=requested_space and last_seen>now()-interval '24 hours' group by player_id,streamer_id)
 select count(*) into total from recent;
 with recent as(select distinct on (player_id,streamer_id) player_id,streamer_id,page,last_seen,
  bool_or(visible and last_seen>now()-interval '3 minutes') over(partition by player_id,streamer_id) online
  from papa_player_activity where space_id=requested_space and last_seen>now()-interval '24 hours'
  order by player_id,streamer_id,last_seen desc),
 bounded as(select player_id,streamer_id,page,last_seen,online from recent order by last_seen desc,player_id,streamer_id limit 50 offset page_number*50)
 select coalesce(jsonb_agg(to_jsonb(b) order by last_seen desc,player_id,streamer_id),'[]') into result from bounded b;
 return jsonb_build_object('version',1,'spaceId',requested_space,'page',page_number,'pageSize',50,'total',total,'rows',result);
end $$;
revoke all on function papa_activity_record(text,text,jsonb,text,text,boolean),papa_activity_page(text,text,jsonb,int) from public,anon,authenticated;
grant execute on function papa_activity_record(text,text,jsonb,text,text,boolean),papa_activity_page(text,text,jsonb,int) to service_role;
notify pgrst,'reload schema';
commit;
