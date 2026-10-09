begin;

-- Player preferences are independent of requests, credits and shared masters.
-- Keep inactive and missing-song records for recovery/history; never infer an
-- Account or player binding from a display name.
create table public.papa_song_favorites (
 account_id uuid not null references public.papa_accounts(id),
 space_id text not null references public.papa_spaces(id),
 player_id text not null check(length(player_id) between 1 and 200),
 streamer_id text not null,
 song_id text not null check(length(song_id) between 1 and 200),
 is_favorite boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(account_id,space_id,player_id,streamer_id,song_id),
 foreign key(streamer_id,space_id) references public.papa_space_streamers(streamer_id,space_id)
);
create index papa_song_favorite_page on public.papa_song_favorites
 (account_id,space_id,player_id,streamer_id,updated_at desc,song_id) where is_favorite;
alter table public.papa_song_favorites enable row level security;
revoke all on public.papa_song_favorites from public,anon,authenticated,service_role;
grant select on public.papa_song_favorites to service_role;

create function public.papa_song_favorite_actor(requested_space text,requested_room text,actor_context jsonb)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare subject uuid;player text;
begin
 if requested_space is null or requested_room is null or not exists(
  select 1 from papa_space_streamers scope join papa_spaces space on space.id=scope.space_id
  join papa_v2_entities meta on meta.kind='meta' and meta.id='1'
  cross join lateral jsonb_array_elements(coalesce(meta.data->'streamers','[]'::jsonb)) room
  where scope.space_id=requested_space and scope.streamer_id=requested_room
   and space.status='active' and room->>'id'=requested_room and coalesce((room->>'active')::boolean,true))
 then raise exception 'SONG_FAVORITES_SCOPE_INVALID';end if;
 if jsonb_typeof(actor_context) is distinct from 'object' or actor_context->>'role' is distinct from 'player'
  or actor_context->>'space_id' is distinct from requested_space
  or actor_context->>'streamer_id' is distinct from requested_room
  or nullif(actor_context->>'player_id','') is null or nullif(actor_context->>'account_id','') is null
 then raise exception 'SONG_FAVORITES_ACTOR_INVALID';end if;
 begin subject=(actor_context->>'account_id')::uuid;
 exception when invalid_text_representation then raise exception 'SONG_FAVORITES_ACTOR_INVALID';end;
 player=actor_context->>'player_id';
 if not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  or (case when requested_space='space-001' then
   not exists(select 1 from papa_account_legacy_players binding
    join papa_v2_entities profile on profile.kind='players' and profile.id=binding.legacy_player_id
     and profile.data->>'playerId'=binding.legacy_player_id
    join papa_space_memberships membership on membership.account_id=binding.account_id
     and membership.space_id=requested_space and membership.role='player' and membership.status='active'
    where binding.account_id=subject and binding.legacy_player_id=player)
  else not exists(select 1 from papa_space_player_profiles profile
   join papa_space_memberships membership on membership.id=profile.membership_id
    and membership.account_id=profile.account_id and membership.space_id=profile.space_id
    and membership.role='player' and membership.status='active'
   where profile.space_id=requested_space and profile.player_id=player and profile.account_id=subject) end)
 then raise exception 'SONG_FAVORITES_ACTOR_INVALID';end if;
 return subject;
end $$;
revoke all on function public.papa_song_favorite_actor(text,text,jsonb) from public,anon,authenticated,service_role;

create function public.papa_song_favorite_set(requested_space text,requested_room text,actor_context jsonb,
 requested_song text,requested_favorite boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare subject uuid;player text;source_song jsonb;previous boolean;affected integer;title_snapshot text;artist_snapshot text;
begin
 subject=papa_song_favorite_actor(requested_space,requested_room,actor_context);player=actor_context->>'player_id';
 if requested_song is null or length(requested_song) not between 1 and 200 or requested_favorite is null
 then raise exception 'SONG_FAVORITES_INPUT_INVALID';end if;
 -- Serialize this preference only; never acquire or advance the accounting revision.
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(subject,requested_space,player,requested_room,requested_song)::text,0));
 select is_favorite into previous from papa_song_favorites where account_id=subject and space_id=requested_space
  and player_id=player and streamer_id=requested_room and song_id=requested_song;
 select data into source_song from papa_v2_entities where kind='songs' and id=requested_song
  and space_id=requested_space and data->>'streamer_id'=requested_room;
 if requested_favorite and (source_song is null or coalesce((source_song->>'hidden')::boolean,false)
    or coalesce((source_song->>'deleted')::boolean,false))
  or not requested_favorite and source_song is null and previous is null
 then raise exception 'SONG_FAVORITES_SONG_INVALID';end if;
 if requested_favorite then
  insert into papa_song_favorites(account_id,space_id,player_id,streamer_id,song_id,is_favorite)
  values(subject,requested_space,player,requested_room,requested_song,true)
  on conflict(account_id,space_id,player_id,streamer_id,song_id) do update
   set is_favorite=true,updated_at=now() where not papa_song_favorites.is_favorite;
 else
  update papa_song_favorites set is_favorite=false,updated_at=now()
  where account_id=subject and space_id=requested_space and player_id=player and streamer_id=requested_room
   and song_id=requested_song and is_favorite;
 end if;
 get diagnostics affected=row_count;
 if affected>0 then
  select coalesce(variant.title,source_song->>'title','歌曲'),coalesce(variant.artist,source_song->>'artist','') into title_snapshot,artist_snapshot
  from (values(1)) anchor(value)
  left join papa_catalog_song_links link on link.streamer_id=requested_room and link.song_id=requested_song
   and link.source_hash=papa_catalog_source_hash(source_song)
  left join papa_catalog_variants variant on variant.id=link.variant_id and variant.active
   and exists(select 1 from papa_catalog_families family where family.id=variant.family_id and family.active);
  perform set_config('papa.actor_context',(actor_context||jsonb_build_object('role','player','account_id',subject,
   'space_id',requested_space,'streamer_id',requested_room,'player_id',player,'action','favoriteSet'))::text,true);
  insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,before_data,after_data)
  values(requested_room,'song_favorites',requested_song,'favoriteSet','player',player,
   jsonb_build_object('playerId',player,'songId',requested_song,'title',title_snapshot,'artist',artist_snapshot,
    'songSnapshot',jsonb_build_object('title',title_snapshot,'artist',artist_snapshot),'favorite',coalesce(previous,false)),
   jsonb_build_object('playerId',player,'songId',requested_song,'title',title_snapshot,'artist',artist_snapshot,
    'songSnapshot',jsonb_build_object('title',title_snapshot,'artist',artist_snapshot),'favorite',requested_favorite));
 end if;
 return jsonb_build_object('songId',requested_song,'favorite',requested_favorite,'changed',affected>0);
end $$;

create function public.papa_song_favorite_flags(requested_space text,requested_room text,actor_context jsonb,song_ids text[])
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare subject uuid;result jsonb;
begin
 subject=papa_song_favorite_actor(requested_space,requested_room,actor_context);
 if song_ids is null or cardinality(song_ids)>50 or array_position(song_ids,null) is not null
  or exists(select 1 from unnest(song_ids) song_id where length(song_id) not between 1 and 200)
  or (select count(distinct song_id) from unnest(song_ids) song_id)<>cardinality(song_ids)
 then raise exception 'SONG_FAVORITES_INPUT_INVALID';end if;
 if exists(select 1 from unnest(song_ids) requested(song_id) where not exists(
  select 1 from papa_v2_entities song where song.kind='songs' and song.id=requested.song_id
   and song.space_id=requested_space and song.data->>'streamer_id'=requested_room
   and not coalesce((song.data->>'hidden')::boolean,false) and not coalesce((song.data->>'deleted')::boolean,false)))
 then raise exception 'SONG_FAVORITES_SONG_INVALID';end if;
 select jsonb_build_object('songIds',coalesce(jsonb_agg(requested.song_id order by requested.ordinal),'[]'::jsonb)) into result
 from unnest(song_ids) with ordinality requested(song_id,ordinal)
 join papa_song_favorites favorite on favorite.account_id=subject and favorite.space_id=requested_space
  and favorite.player_id=actor_context->>'player_id' and favorite.streamer_id=requested_room
  and favorite.song_id=requested.song_id and favorite.is_favorite;
 return result;
end $$;

create function public.papa_song_favorites_page(requested_space text,requested_room text,actor_context jsonb,
 page_limit integer default 20,page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare subject uuid;result jsonb;
begin
 subject=papa_song_favorite_actor(requested_space,requested_room,actor_context);
 if page_limit is null or page_limit<1 or page_limit>50 or page_offset is null or page_offset<0 or page_offset>10000000
 then raise exception 'SONG_FAVORITES_PAGE_INVALID';end if;
 with visible as materialized (
  select song.id song_id,song.data,favorite.updated_at favorite_at
  from papa_song_favorites favorite join papa_v2_entities song on song.kind='songs' and song.id=favorite.song_id
   and song.space_id=favorite.space_id and song.data->>'streamer_id'=favorite.streamer_id
  where favorite.account_id=subject and favorite.space_id=requested_space and favorite.player_id=actor_context->>'player_id'
   and favorite.streamer_id=requested_room and favorite.is_favorite
   and not coalesce((song.data->>'hidden')::boolean,false) and not coalesce((song.data->>'deleted')::boolean,false)
 ),page as materialized (
  select song_id,data,favorite_at from visible order by favorite_at desc,song_id limit page_limit offset page_offset
 ),projected as (
  select page.song_id,page.favorite_at,
   jsonb_strip_nulls(coalesce((select jsonb_object_agg(field.key,field.value) from jsonb_each(page.data) field
    where field.key=any(array['id','songId','streamer_id','title','artist','cat','artistType','tags','new','murmur',
     'creditCost','shortMode','pairSongIds','hidden'])),'{}'::jsonb))
   ||jsonb_build_object('songId',page.song_id,'streamer_id',requested_room,'favorite',true,'favoritedAt',page.favorite_at)
   ||jsonb_strip_nulls(jsonb_build_object('title',variant.title,'artist',variant.artist,'cat',coalesce(language.name,variant.language_text),
    'artistType',coalesce(performer.name,variant.performer_type_text),'version',variant.version_label,'catalogVariantId',variant.id))
   ||jsonb_build_object('hasLyrics',case when selection.mode in ('copy','own') then trim(coalesce(selection.body,''))<>''
     when variant.id is not null then trim(coalesce(lyrics.body,''))<>'' else trim(coalesce(page.data->>'lyrics',''))<>'' end,
    'lyricsMode',coalesce(selection.mode,case when trim(coalesce(page.data->>'lyrics',''))<>'' then 'own' else 'shared' end),
    'hasSharedLyrics',trim(coalesce(lyrics.body,''))<>'',
    'hasCustomLyrics',case when selection.mode in ('copy','own') then trim(coalesce(selection.body,''))<>''
     when selection.mode is null then trim(coalesce(page.data->>'lyrics',''))<>'' else false end) row_data
  from page
  left join papa_catalog_song_links link on link.streamer_id=requested_room and link.song_id=page.song_id
   and link.source_hash=papa_catalog_source_hash(page.data)
  left join papa_catalog_variants variant on variant.id=link.variant_id and variant.active
   and exists(select 1 from papa_catalog_families family where family.id=variant.family_id and family.active)
  left join papa_catalog_languages language on language.id=variant.language_id
  left join papa_catalog_performer_types performer on performer.id=variant.performer_type_id
  left join papa_catalog_lyric_selections selection on selection.streamer_id=requested_room and selection.song_id=page.song_id
  left join papa_catalog_lyric_revisions lyrics on lyrics.variant_id=variant.id and lyrics.active
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row_data order by favorite_at desc,song_id) from projected),'[]'::jsonb),
  'total',(select count(1) from visible),'pageLimit',page_limit,'pageOffset',page_offset,
  'hasMore',page_offset+page_limit<(select count(1) from visible)) into result;
 return result;
end $$;

revoke all on function public.papa_song_favorite_set(text,text,jsonb,text,boolean),
 public.papa_song_favorite_flags(text,text,jsonb,text[]),public.papa_song_favorites_page(text,text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.papa_song_favorite_set(text,text,jsonb,text,boolean),
 public.papa_song_favorite_flags(text,text,jsonb,text[]),public.papa_song_favorites_page(text,text,jsonb,integer,integer) to service_role;

-- Extend the established rare, privileged export without duplicating its
-- authorization, credential exclusions or existing recovery table registry.
alter function public.papa_president_full_backup(uuid) rename to papa_full_backup_before_song_favorites;
revoke all on function public.papa_full_backup_before_song_favorites(uuid) from public,anon,authenticated,service_role;
create function public.papa_president_full_backup(subject uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;favorites jsonb;
begin
 result=papa_full_backup_before_song_favorites(subject);
 select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'space_id',space_id,'player_id',player_id,
  'streamer_id',streamer_id,'song_id',song_id,'is_favorite',is_favorite,'created_at',created_at,'updated_at',updated_at)
  order by account_id,space_id,player_id,streamer_id,song_id),'[]'::jsonb) into favorites from papa_song_favorites;
 result=jsonb_set(result,'{architecture,tables,papa_song_favorites}',favorites);
 result=jsonb_set(result,'{architecture,counts,papa_song_favorites}',to_jsonb(jsonb_array_length(favorites)));
 result=jsonb_set(result,'{architecture,manifest,tableOrder}',result#>'{architecture,manifest,tableOrder}'||jsonb_build_array('papa_song_favorites'));
 return result;
end $$;
revoke all on function public.papa_president_full_backup(uuid) from public,anon,authenticated;
grant execute on function public.papa_president_full_backup(uuid) to service_role;
notify pgrst,'reload schema';
commit;
