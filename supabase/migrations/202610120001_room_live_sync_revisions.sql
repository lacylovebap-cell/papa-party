begin;

-- Additive Phase 2 foundation. Counters are hints for authorized scoped reads,
-- not replacement write tokens. Every existing global revision check remains.
-- Shared Space/master dependencies use one parent counter, never room fan-out.
create table public.papa_room_sync_revisions (
 scope_kind text not null check(scope_kind in ('room','space','catalog')),
 space_id text not null,
 streamer_id text not null default '',
 domain text not null check(domain in ('songs','queue','ledger','crowns','cards','wishes',
  'players','settings','directory','metadata','catalog_relations','shared_catalog')),
 revision bigint not null check(revision>0),
 primary key(scope_kind,space_id,streamer_id,domain),
 check((scope_kind='room' and space_id<>'' and streamer_id<>'')
  or (scope_kind='space' and space_id<>'' and streamer_id='')
  or (scope_kind='catalog' and space_id='' and streamer_id='' and domain='shared_catalog'))
);
alter table public.papa_room_sync_revisions enable row level security;
revoke all on public.papa_room_sync_revisions from public,anon,authenticated;
grant select on public.papa_room_sync_revisions to service_role;

create function public.papa_room_sync_bump(scope_kind text,space_id text,streamer_id text,domain text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.papa_room_sync_revisions as head(scope_kind,space_id,streamer_id,domain,revision)
 values(scope_kind,space_id,streamer_id,domain,1)
 on conflict on constraint papa_room_sync_revisions_pkey do update set revision=head.revision+1;
end $$;
revoke all on function public.papa_room_sync_bump(text,text,text,text) from public,anon,authenticated,service_role;

create function public.papa_room_sync_entity_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_data jsonb='{}';new_data jsonb='{}';entry_data jsonb;room_id text;mapped_space text;
 changed_kind text;old_room text;old_space text;room_key text;affected_space text;
begin
 if tg_op='UPDATE' and old.data is not distinct from new.data
  and old.space_id is not distinct from new.space_id then return null;end if;
 if tg_op<>'INSERT' then old_data=old.data;end if;
 if tg_op<>'DELETE' then new_data=new.data;end if;
 changed_kind=case when tg_op='DELETE' then old.kind else new.kind end;
 if changed_kind in ('songs','queue','ledger','crowns','cards','wishes') then
  -- Include the old scope for a deletion or explicit, separately guarded move.
  if tg_op<>'INSERT' then
   old_room=old_data->>'streamer_id';old_space=old.space_id;
   if tg_op='DELETE' or old_room is distinct from new_data->>'streamer_id'
    or old_space is distinct from new.space_id then
    if old_space is not null and old_room is not null then
     perform public.papa_room_sync_bump('room',old_space,old_room,changed_kind);
     if changed_kind='songs' and exists(select 1 from public.papa_catalog_song_links
      where streamer_id=old_room and song_id=old.id) then
      perform public.papa_room_sync_bump('space',old_space,'','catalog_relations');
     end if;
    end if;
   end if;
  end if;
  if tg_op<>'DELETE' then
   room_id=new_data->>'streamer_id';mapped_space=new.space_id;
   if mapped_space is not null and room_id is not null then
    perform public.papa_room_sync_bump('room',mapped_space,room_id,changed_kind);
    if changed_kind='songs' and exists(select 1 from public.papa_catalog_song_links
     where streamer_id=room_id and song_id=new.id) then
     perform public.papa_room_sync_bump('space',mapped_space,'','catalog_relations');
    end if;
   end if;
  end if;
 elsif changed_kind='players' then
  -- Legacy profiles are shared only by rooms in the original Space.
  perform public.papa_room_sync_bump('space','space-001','','players');
 elsif changed_kind='settings' then
  perform public.papa_room_sync_bump('space','space-001','','settings');
 elsif changed_kind='meta' then
  -- Compare only changed room-setting keys, not every room's business rows.
  for room_key in
   select key from jsonb_object_keys(case when jsonb_typeof(old_data->'streamerSettings')='object'
    then old_data->'streamerSettings' else '{}'::jsonb end) item(key)
   union select key from jsonb_object_keys(case when jsonb_typeof(new_data->'streamerSettings')='object'
    then new_data->'streamerSettings' else '{}'::jsonb end) item(key)
  loop
   if old_data->'streamerSettings'->room_key is distinct from new_data->'streamerSettings'->room_key then
    select scope.space_id into mapped_space from public.papa_space_streamers scope where scope.streamer_id=room_key;
    if mapped_space is not null then perform public.papa_room_sync_bump('room',mapped_space,room_key,'settings');end if;
   end if;
  end loop;
  -- A descriptor is displayed in its Space's room directory. A transaction
  -- changing several descriptors in one Space still touches one Space head.
  for affected_space in
   with previous as (select room->>'id' id,room from jsonb_array_elements(
    case when jsonb_typeof(old_data->'streamers')='array' then old_data->'streamers' else '[]'::jsonb end) room),
   latest as (select room->>'id' id,room from jsonb_array_elements(
    case when jsonb_typeof(new_data->'streamers')='array' then new_data->'streamers' else '[]'::jsonb end) room)
   select distinct scope.space_id from previous full join latest using(id)
   join public.papa_space_streamers scope on scope.streamer_id=coalesce(previous.id,latest.id)
   where previous.room is distinct from latest.room
  loop perform public.papa_room_sync_bump('space',affected_space,'','directory');end loop;
  if old_data-array['streamers','streamerSettings','revision']
   is distinct from new_data-array['streamers','streamerSettings','revision'] then
   perform public.papa_room_sync_bump('space','space-001','','metadata');
  end if;
 end if;
 return null;
end $$;
create trigger papa_room_sync_entity_signal after insert or update or delete on public.papa_v2_entities
 for each row execute function public.papa_room_sync_entity_changed();

create function public.papa_room_sync_profile_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and old.data is not distinct from new.data then return null;end if;
 perform public.papa_room_sync_bump('space',case when tg_op='DELETE' then old.space_id else new.space_id end,'','players');
 return null;
end $$;
create trigger papa_room_sync_profile_signal after insert or update or delete on public.papa_space_player_profiles
 for each row execute function public.papa_room_sync_profile_changed();

create function public.papa_room_sync_mapping_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous_space text;latest_space text;
begin
 if tg_op='UPDATE' and to_jsonb(old) is not distinct from to_jsonb(new) then return null;end if;
 if tg_table_name='papa_spaces' then
  if tg_op<>'INSERT' then previous_space=old.id;end if;
  if tg_op<>'DELETE' then latest_space=new.id;end if;
 else
  if tg_op<>'INSERT' then previous_space=old.space_id;end if;
  if tg_op<>'DELETE' then latest_space=new.space_id;end if;
 end if;
 if previous_space is not null then perform public.papa_room_sync_bump('space',previous_space,'','directory');end if;
 if latest_space is not null and latest_space is distinct from previous_space then
  perform public.papa_room_sync_bump('space',latest_space,'','directory');
 end if;
 return null;
end $$;
create trigger papa_room_sync_mapping_signal after insert or update or delete on public.papa_space_streamers
 for each row execute function public.papa_room_sync_mapping_changed();
create trigger papa_room_sync_space_signal after insert or update or delete on public.papa_spaces
 for each row execute function public.papa_room_sync_mapping_changed();

create function public.papa_room_sync_catalog_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb;old_item jsonb;new_item jsonb;room_id text;mapped_space text;
begin
 if tg_op='UPDATE' and to_jsonb(old)-'updated_at' is not distinct from to_jsonb(new)-'updated_at' then return null;end if;
 if tg_table_name in ('papa_catalog_families','papa_catalog_variants','papa_catalog_languages',
  'papa_catalog_performer_types','papa_catalog_lyric_revisions') then
  perform public.papa_room_sync_bump('catalog','','','shared_catalog');return null;
 end if;
 if tg_op<>'INSERT' then old_item=to_jsonb(old);end if;
 if tg_op<>'DELETE' then new_item=to_jsonb(new);end if;
 -- Room relationship changes update their one room, plus the Space's common
 -- catalog view for links. They never rewrite all rooms linked to a variant.
 for room_id in select distinct value from unnest(array[old_item->>'streamer_id',new_item->>'streamer_id']) candidate(value) where value is not null
 loop
  select scope.space_id into mapped_space from public.papa_space_streamers scope where scope.streamer_id=room_id;
  if mapped_space is not null then
   perform public.papa_room_sync_bump('room',mapped_space,room_id,'songs');
   if tg_table_name='papa_catalog_song_links' then
    perform public.papa_room_sync_bump('space',mapped_space,'','catalog_relations');
   end if;
  end if;
 end loop;
 return null;
end $$;
do $$ declare watched_table text;begin
 foreach watched_table in array array['papa_catalog_families','papa_catalog_variants','papa_catalog_languages',
  'papa_catalog_performer_types','papa_catalog_lyric_revisions','papa_catalog_song_links',
  'papa_catalog_lyric_selections','papa_catalog_language_filters','papa_catalog_language_filter_items'] loop
  if to_regclass('public.'||watched_table) is not null then
   execute format('create trigger papa_room_sync_catalog_signal after insert or update or delete on public.%I for each row execute function public.papa_room_sync_catalog_changed()',watched_table);
  end if;
 end loop;
end $$;
-- Private notes/candidates do not affect ordinary room metadata and are not
-- included. Account/Membership access changes require their own proven guard.

create function public.papa_room_sync_head(requested_room text,requested_space text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if requested_room is null or requested_space is null or not exists(
  select 1 from public.papa_space_streamers room join public.papa_spaces space on space.id=room.space_id
  where room.streamer_id=requested_room and room.space_id=requested_space and space.status='active')
 then raise exception 'ROOM_SYNC_SCOPE_INVALID';end if;
 -- Edge must separately authenticate the actor and authorize this exact room.
 -- No raw records, actors, entity IDs, lyric bodies or channel tokens appear.
 select jsonb_build_object('version',1,'spaceId',requested_space,'streamerId',requested_room,
  'room',coalesce((select jsonb_object_agg(domain,revision) from public.papa_room_sync_revisions
   where scope_kind='room' and space_id=requested_space and streamer_id=requested_room),'{}'::jsonb),
  'space',coalesce((select jsonb_object_agg(domain,revision) from public.papa_room_sync_revisions
   where scope_kind='space' and space_id=requested_space),'{}'::jsonb),
  'catalog',coalesce((select jsonb_object_agg(domain,revision) from public.papa_room_sync_revisions
   where scope_kind='catalog'),'{}'::jsonb),
  'globalRevision',(select revision from public.papa_v2_revision where id=1),
  'capabilities',jsonb_build_object('scopedRevision',true,'authoritative',false,'delta',false,'realtime',false)) into result;
 return result;
end $$;
revoke all on function public.papa_room_sync_head(text,text) from public,anon,authenticated;
grant execute on function public.papa_room_sync_head(text,text) to service_role;
revoke all on function public.papa_room_sync_entity_changed(),public.papa_room_sync_profile_changed(),
 public.papa_room_sync_mapping_changed(),public.papa_room_sync_catalog_changed() from public,anon,authenticated;

-- No table backfill, record rewrite, revision reset, Realtime topic, polling,
-- public policy or modification of existing commit/snapshot functions.
notify pgrst,'reload schema';
commit;
