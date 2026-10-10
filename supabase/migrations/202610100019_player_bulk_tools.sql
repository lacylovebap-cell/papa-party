begin;

-- Desired-state preference batches share the original single-song advisory
-- locks. They never acquire or advance the accounting revision.
create function public.papa_song_favorites_set_batch(requested_space text,requested_room text,
 actor_context jsonb,song_ids text[],requested_favorite boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare subject uuid;player text;targets jsonb;changed_count integer;affected integer;
 before_songs jsonb;after_songs jsonb;previous_context text;result_rows jsonb;
begin
 subject=papa_song_favorite_actor(requested_space,requested_room,actor_context);player=actor_context->>'player_id';
 if song_ids is null or coalesce(array_ndims(song_ids),0)<>1 or cardinality(song_ids) not between 1 and 50
  or requested_favorite is null or exists(select 1 from unnest(song_ids) id where id is null
   or length(id) not between 1 and 200 or id<>btrim(id) or id~'[[:cntrl:]]' or strpos(id,chr(8232))>0 or strpos(id,chr(8233))>0)
  or exists(select 1 from unnest(song_ids) id group by id collate "C" having count(*)>1)
 then raise exception 'SONG_FAVORITES_INPUT_INVALID';end if;
 perform 1 from papa_spaces where id=requested_space and status='active' for share;
 if not found then raise exception 'SONG_FAVORITES_SCOPE_INVALID';end if;
 perform 1 from papa_space_streamers where streamer_id=requested_room and space_id=requested_space for share;
 if not found then raise exception 'SONG_FAVORITES_SCOPE_INVALID';end if;
 perform 1 from papa_v2_entities where kind='meta' and id='1' for share;
 perform 1 from papa_accounts where id=subject and disabled_at is null for share;
 if not found then raise exception 'SONG_FAVORITES_ACTOR_INVALID';end if;
 perform 1 from papa_space_memberships where account_id=subject and space_id=requested_space
  and role='player' and status='active' order by id for share;
 if requested_space='space-001' then
  perform 1 from papa_account_legacy_players where account_id=subject and legacy_player_id=player for share;
  perform 1 from papa_v2_entities where kind='players' and id=player and space_id is null for share;
 else
  perform 1 from papa_space_player_profiles where space_id=requested_space and player_id=player and account_id=subject for share;
 end if;
 perform papa_song_favorite_actor(requested_space,requested_room,actor_context);
 perform pg_advisory_xact_lock(lock_key) from (
  select distinct hashtextextended(jsonb_build_array(subject,requested_space,player,requested_room,id)::text,0) lock_key
  from unnest(song_ids) id) locks order by lock_key;
 perform 1 from papa_v2_entities where kind='songs' and space_id=requested_space
  and data->>'streamer_id'=requested_room and id=any(song_ids) order by id for share;
 with requested as (select id,ordinal from unnest(song_ids) with ordinality requested(id,ordinal))
 select jsonb_agg(jsonb_build_object('songId',requested.id,'ordinal',requested.ordinal,
  'sourceExists',song.id is not null,'hidden',coalesce((song.data->>'hidden')::boolean,false),
  'deleted',coalesce((song.data->>'deleted')::boolean,false),'favoriteExists',favorite.song_id is not null,
  'previous',coalesce(favorite.is_favorite,false),'title',coalesce(variant.title,song.data->>'title','歌曲'),
  'artist',coalesce(variant.artist,song.data->>'artist','')) order by requested.ordinal) into targets
 from requested left join papa_v2_entities song on song.kind='songs' and song.id=requested.id
  and song.space_id=requested_space and song.data->>'streamer_id'=requested_room
 left join papa_song_favorites favorite on favorite.account_id=subject and favorite.space_id=requested_space
  and favorite.player_id=player and favorite.streamer_id=requested_room and favorite.song_id=requested.id
 left join papa_catalog_song_links link on link.streamer_id=requested_room and link.song_id=requested.id
  and song.id is not null and link.source_hash=papa_catalog_source_hash(song.data)
 left join papa_catalog_variants variant on variant.id=link.variant_id and variant.active
  and exists(select 1 from papa_catalog_families family where family.id=variant.family_id and family.active);
 if exists(select 1 from jsonb_array_elements(targets) target where
  requested_favorite and (target->'sourceExists'<>'true'::jsonb or target->'hidden'='true'::jsonb or target->'deleted'='true'::jsonb)
  or not requested_favorite and target->'sourceExists'<>'true'::jsonb and target->'favoriteExists'<>'true'::jsonb)
 then raise exception 'SONG_FAVORITES_SONG_INVALID';end if;
 select jsonb_agg(jsonb_build_object('songId',id,'favorite',requested_favorite) order by ordinal)
  into result_rows from unnest(song_ids) with ordinality requested(id,ordinal);
 select count(*) into changed_count from jsonb_array_elements(targets) target where (target->>'previous')::boolean<>requested_favorite;
 if changed_count=0 then return jsonb_build_object('changed',false,'rows',result_rows);end if;
 if requested_favorite then
  insert into papa_song_favorites(account_id,space_id,player_id,streamer_id,song_id,is_favorite)
  select subject,requested_space,player,requested_room,target->>'songId',true from jsonb_array_elements(targets) target
   where target->'previous'='false'::jsonb
  on conflict(account_id,space_id,player_id,streamer_id,song_id) do update
   set is_favorite=true,updated_at=now() where not papa_song_favorites.is_favorite;
 else
  update papa_song_favorites set is_favorite=false,updated_at=now() where account_id=subject and space_id=requested_space
   and player_id=player and streamer_id=requested_room and song_id=any(song_ids) and is_favorite;
 end if;
 get diagnostics affected=row_count;
 if affected<>changed_count then raise exception 'SONG_FAVORITES_BATCH_CONFLICT';end if;
 select jsonb_agg(jsonb_build_object('songId',target->>'songId','title',target->>'title','artist',target->>'artist',
   'songSnapshot',jsonb_build_object('title',target->>'title','artist',target->>'artist'),'favorite',(target->>'previous')::boolean)
   order by (target->>'ordinal')::integer),
  jsonb_agg(jsonb_build_object('songId',target->>'songId','title',target->>'title','artist',target->>'artist',
   'songSnapshot',jsonb_build_object('title',target->>'title','artist',target->>'artist'),'favorite',requested_favorite)
   order by (target->>'ordinal')::integer) into before_songs,after_songs
 from jsonb_array_elements(targets) target where (target->>'previous')::boolean<>requested_favorite;
 previous_context=current_setting('papa.actor_context',true);
 perform set_config('papa.actor_context',jsonb_build_object('role','player','account_id',subject,
  'space_id',requested_space,'streamer_id',requested_room,'player_id',player,'action','favoriteBatchSet')::text,true);
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,before_data,after_data)
 values(requested_room,'song_favorites',player,'favoriteBatchSet','player',player,
  jsonb_build_object('playerId',player,'songs',before_songs),jsonb_build_object('playerId',player,'songs',after_songs));
 perform set_config('papa.actor_context',coalesce(previous_context,''),true);
 return jsonb_build_object('changed',true,'rows',result_rows);
end $$;
revoke all on function public.papa_song_favorites_set_batch(text,text,jsonb,text[],boolean) from public,anon,authenticated;
grant execute on function public.papa_song_favorites_set_batch(text,text,jsonb,text[],boolean) to service_role;

-- Match Core's quotaTime/timeValue inputs: explicit offsets stay authoritative;
-- legacy date/time text without an offset belongs to Asia/Taipei, not DB UTC.
create function public.papa_player_quota_time(record_data jsonb) returns timestamptz
language plpgsql immutable set search_path=public set timezone='UTC' as $$
declare value jsonb;parts text[];parsed timestamptz;
begin
 value=case when record_data->'quota_effective_at' is not null and record_data->'quota_effective_at'<>'null'::jsonb
  and record_data->'quota_effective_at'<>'""'::jsonb and record_data->'quota_effective_at'<>'0'::jsonb
  and record_data->'quota_effective_at'<>'false'::jsonb then record_data->'quota_effective_at' else record_data->'at' end;
 if jsonb_typeof(value)='number' then parsed=to_timestamp((value#>>'{}')::double precision/1000);
 elsif jsonb_typeof(value)='string' then
  if value#>>'{}'~'^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d' and value#>>'{}'!~'(Z|[+-]\d\d:\d\d)$' then
   parts=regexp_match(value#>>'{}','(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?');
   if parts is null then return null;end if;
   parsed=make_timestamptz(parts[1]::integer,parts[2]::integer,parts[3]::integer,parts[4]::integer,parts[5]::integer,coalesce(parts[6],'0')::double precision,'Asia/Taipei');
  else parsed=(value#>>'{}')::timestamptz;end if;
 else return null;end if;
 if isfinite(parsed) then return parsed;end if;
 return null;
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return null;
end $$;
revoke all on function public.papa_player_quota_time(jsonb) from public,anon,authenticated,service_role;

create function public.papa_player_streamer_summary(requested_space text,actor_context jsonb,
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
   case when settings.value->'radio_enabled'='true'::jsonb and settings.value->>'current_space'='radio' then 'radio' else 'shengma' end pool
  from jsonb_array_elements(coalesce(meta->'streamers','[]'::jsonb)) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id' and scope.space_id=requested_space
  cross join lateral (select coalesce(meta->'streamerSettings'->scope.streamer_id,
   case when requested_space='space-001' and scope.streamer_id='papa' then legacy_settings end,'{}'::jsonb) value) settings
  where coalesce((room->>'active')::boolean,true)
 ),page as materialized (
  select streamer_id,slug,name,status,pool from rooms order by
   case status when 'idle' then 0 when 'preparing' then 1 when 'busy' then 2 else 3 end,lower(name),streamer_id
  limit page_limit offset page_offset
 ),credits as materialized (
  select page.streamer_id,sum((ledger.data->>'amount')::numeric) balance
  from page join papa_v2_entities ledger on ledger.kind='ledger' and ledger.space_id=requested_space
   and ledger.data->>'streamer_id'=page.streamer_id and ledger.data->>'playerId'=player
   and coalesce(ledger.data->>'storage_pool','shengma')=page.pool group by page.streamer_id
 ),queues as materialized (
  select page.streamer_id,count(*) filter(where queue.data->>'status' in ('pending','waiting')) waiting,
   coalesce(sum(coalesce((queue.data->>'creditCost')::numeric,1)) filter(where queue.data->>'kind'='saved'
    and queue.data->>'status' in ('completed','pending','waiting')
    and date_trunc('hour',papa_player_quota_time(queue.data))=date_trunc('hour',now())),0) personal_used
  from page join papa_v2_entities queue on queue.kind='queue' and queue.space_id=requested_space
   and queue.data->>'streamer_id'=page.streamer_id and queue.data->>'playerId'=player group by page.streamer_id
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('streamerId',page.streamer_id,
  'slug',page.slug,'name',page.name,'status',page.status,'storedCredits',coalesce(credits.balance,0),
  'waitingCount',coalesce(queues.waiting,0),'personalRemaining',greatest(0,
   case when quota.enabled then quota.extra_quota else 0 end-coalesce(queues.personal_used,0)))
  order by case page.status when 'idle' then 0 when 'preparing' then 1 when 'busy' then 2 else 3 end,lower(page.name),page.streamer_id)
  from page left join credits on credits.streamer_id=page.streamer_id left join queues on queues.streamer_id=page.streamer_id
  left join papa_player_extra_quotas quota on quota.space_id=requested_space and quota.streamer_id=page.streamer_id and quota.player_id=player),'[]'::jsonb),
  'total',(select count(*) from rooms),'pageLimit',page_limit,'pageOffset',page_offset) into result;
 return result;
end $$;
revoke all on function public.papa_player_streamer_summary(text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.papa_player_streamer_summary(text,jsonb,integer,integer) to service_role;

-- A small visible-song chooser for an authenticated player's selected room.
-- Only public choice metadata is searched or returned; tags use AND semantics.
create function public.papa_player_song_choices(requested_space text,requested_room text,actor_context jsonb,
 query_text text default '',tags text[] default '{}',page_limit integer default 20,page_offset integer default 0,
 random_choice boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare subject uuid;words text[];result jsonb;
begin
 subject=papa_song_favorite_actor(requested_space,requested_room,actor_context);
 if query_text is null or length(query_text)>100 or page_limit is null or page_limit not between 1 and 20
  or page_offset is null or page_offset not between 0 and 10000 or random_choice is null
  or random_choice and (page_limit<>1 or page_offset<>0) or tags is null or coalesce(array_ndims(tags),1)<>1 or cardinality(tags)>30
  or array_position(tags,null) is not null or exists(select 1 from unnest(tags) tag where length(tag) not between 1 and 100)
 then raise exception 'PLAYER_SONG_CHOICES_INPUT_INVALID';end if;
 words=regexp_split_to_array(lower(btrim(query_text)),'[[:space:]　]+');
 with source as materialized (
  select song.id song_id,jsonb_build_object('creditCost',song.data->'creditCost','shortMode',song.data->'shortMode',
   'pairSongIds',song.data->'pairSongIds','tags',coalesce((select jsonb_agg(tag order by tag#>>'{}')
   from (select distinct value tag from jsonb_array_elements(case when jsonb_typeof(song.data->'tags')='array'
     then song.data->'tags' else '[]'::jsonb end) tags(value)
    where jsonb_typeof(value)='string' and length(value#>>'{}') between 1 and 100
    union select to_jsonb('新練'::text) where song.data->'new'='true'::jsonb) own_tags),'[]'::jsonb)) data,
   coalesce(variant.title,song.data->>'title','歌曲') title,
   coalesce(variant.artist,song.data->>'artist','') artist,
   case when jsonb_typeof(song.data->'_order')='number' then (song.data->>'_order')::numeric else 0 end source_order
  from papa_v2_entities song
  left join papa_catalog_song_links link on link.streamer_id=requested_room and link.song_id=song.id
   and link.source_hash=papa_catalog_source_hash(song.data)
  left join papa_catalog_variants variant on variant.id=link.variant_id and variant.active
   and exists(select 1 from papa_catalog_families family where family.id=variant.family_id and family.active)
  where song.kind='songs' and song.space_id=requested_space and song.data->>'streamer_id'=requested_room
   and not coalesce((song.data->>'hidden')::boolean,false) and not coalesce((song.data->>'deleted')::boolean,false)
   and song.data->'active' is distinct from 'false'::jsonb and song.data->'available' is distinct from 'false'::jsonb
   and song.data->'disabled' is distinct from 'true'::jsonb
 ),matched as materialized (
  select song_id,data,title,artist,source_order from source
  where not exists(select 1 from unnest(words) word where word<>'' and strpos(lower(concat_ws(' ',title,artist,
   case when jsonb_typeof(data->'tags')='array' then data->>'tags' else '' end)),word)=0)
   and not exists(select 1 from unnest(tags) tag where not exists(select 1 from jsonb_array_elements(
    case when jsonb_typeof(data->'tags')='array' then data->'tags' else '[]'::jsonb end) own_tag
    where own_tag=to_jsonb(tag)))
 ),ranked as materialized (
  select song_id,data,title,artist,source_order,case when random_choice then random() else 0 end random_order from matched
 ),page as materialized (
  select song_id,data,title,artist,source_order,random_order from ranked
  order by random_order,source_order,song_id limit page_limit offset page_offset
 ),pairs as materialized (
  select page.song_id owner_song_id,pair.ordinal,paired.id song_id,
   coalesce(variant.title,paired.data->>'title','歌曲') title,coalesce(variant.artist,paired.data->>'artist','') artist
  from page cross join lateral jsonb_array_elements(case when jsonb_typeof(page.data->'pairSongIds')='array'
   then page.data->'pairSongIds' else '[]'::jsonb end) with ordinality pair(value,ordinal)
  join papa_v2_entities paired on paired.kind='songs' and paired.id=pair.value#>>'{}'
   and paired.space_id=requested_space and paired.data->>'streamer_id'=requested_room
   and not coalesce((paired.data->>'hidden')::boolean,false) and not coalesce((paired.data->>'deleted')::boolean,false)
   and paired.data->'active' is distinct from 'false'::jsonb and paired.data->'available' is distinct from 'false'::jsonb
   and paired.data->'disabled' is distinct from 'true'::jsonb
  left join papa_catalog_song_links link on link.streamer_id=requested_room and link.song_id=paired.id
   and link.source_hash=papa_catalog_source_hash(paired.data)
  left join papa_catalog_variants variant on variant.id=link.variant_id and variant.active
   and exists(select 1 from papa_catalog_families family where family.id=variant.family_id and family.active)
  where jsonb_typeof(pair.value)='string' and pair.ordinal<=50
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('songId',page.song_id,'title',page.title,'artist',page.artist,
  'tags',coalesce((select jsonb_agg(value) from jsonb_array_elements(case when jsonb_typeof(data->'tags')='array'
   then data->'tags' else '[]'::jsonb end) tag(value) where jsonb_typeof(value)='string'),'[]'::jsonb),
  'creditCost',coalesce((data->>'creditCost')::numeric,1),'shortMode',coalesce(data->>'shortMode','repeat'),
  'pairSongIds',coalesce((select jsonb_agg(pairs.song_id order by ordinal) from pairs where owner_song_id=page.song_id),'[]'::jsonb),
  'pairOptions',coalesce((select jsonb_agg(jsonb_build_object('songId',pairs.song_id,'title',pairs.title,'artist',pairs.artist)
   order by ordinal) from pairs where owner_song_id=page.song_id),'[]'::jsonb)) order by random_order,source_order,page.song_id) from page),'[]'::jsonb),
  'tagOptions',coalesce((select jsonb_agg(tag order by tag) from (select tag from
   (select distinct value#>>'{}' tag from source cross join lateral jsonb_array_elements(source.data->'tags') tags(value)) all_tags
   order by case when tag='新練' then 0 else 1 end,tag limit 100) tags),'[]'::jsonb),
  'total',(select count(*) from matched),'pageLimit',page_limit,'pageOffset',page_offset) into result;
 return result;
end $$;
revoke all on function public.papa_player_song_choices(text,text,jsonb,text,text[],integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.papa_player_song_choices(text,text,jsonb,text,text[],integer,integer,boolean) to service_role;
notify pgrst,'reload schema';
commit;
