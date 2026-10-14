begin;
-- Prefer the narrow existing audit indexes; no new table or historical rewrite.
alter function public.papa_event_total(text,boolean) set enable_seqscan=off;

-- One bounded count batch or one on-demand page of names; never private profiles.
create function public.papa_song_favorite_audience(requested_space text,requested_room text,actor_context jsonb,
 song_ids text[],requested_song text default null,page_number int default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;result jsonb;
begin
 ctx=papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'FAVORITE_AUDIENCE_FORBIDDEN';end if;
 if song_ids is null or cardinality(song_ids) not between 1 and 50 or page_number is null or page_number not between 0 and 100000
  or exists(select 1 from unnest(song_ids) id where id is null or length(id) not between 1 and 200)
  or requested_song is not null and not requested_song=any(song_ids) then raise exception 'FAVORITE_AUDIENCE_INPUT_INVALID';end if;
 with songs as materialized(select id from papa_v2_entities where kind='songs' and space_id=requested_space
  and data->>'streamer_id'=requested_room and id=any(song_ids)),
 audience as materialized(select distinct on (f.song_id,f.account_id) f.song_id,f.account_id,
  coalesce(nullif(case when requested_space='space-001' then p.data->>'name' else n.data->>'name' end,''),'玩家') name
  from papa_song_favorites f join songs s on s.id=f.song_id
  join papa_accounts a on a.id=f.account_id and a.disabled_at is null
  left join papa_v2_entities p on requested_space='space-001' and p.kind='players' and p.id=f.player_id
  left join papa_space_player_profiles n on requested_space<>'space-001' and n.space_id=f.space_id and n.player_id=f.player_id and n.account_id=f.account_id
  where f.space_id=requested_space and f.streamer_id=requested_room and f.is_favorite
  and (requested_song is null or f.song_id=requested_song)
  order by f.song_id,f.account_id,f.updated_at desc,f.player_id),
 counts as (select s.id,count(a.account_id)::int n from songs s left join audience a on a.song_id=s.id group by s.id),
 names as (select name,account_id from audience where song_id=requested_song order by name,account_id limit 20 offset page_number*20)
 select case when requested_song is null then jsonb_build_object('counts',coalesce((select jsonb_object_agg(id,n) from counts),'{}'::jsonb))
 else jsonb_build_object('songId',requested_song,'page',page_number,'total',(select count(*) from audience),'rows',coalesce((select jsonb_agg(jsonb_build_object('name',name) order by name,account_id) from names),'[]'::jsonb)) end into result;
 return result;
end $$;
revoke all on function public.papa_song_favorite_audience(text,text,jsonb,text[],text,int) from public,anon,authenticated;
grant execute on function public.papa_song_favorite_audience(text,text,jsonb,text[],text,int) to service_role;
commit;
