begin;

-- Space 001 continues to read its exact legacy player rows. A different Space
-- has its own membership-bound business profile; it never inherits that row.
alter table papa_space_memberships add constraint papa_membership_identity_scope unique(id,account_id,space_id);
create table papa_space_player_profiles (
 space_id text not null references papa_spaces(id),
 player_id text not null,
 account_id uuid not null references papa_accounts(id),
 membership_id uuid not null,
 data jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(space_id,player_id),
 unique(space_id,account_id),
 foreign key(membership_id,account_id,space_id) references papa_space_memberships(id,account_id,space_id),
 check(space_id<>'space-001'),
 check(length(player_id) between 1 and 200),
 check(jsonb_typeof(data)='object' and data->>'playerId' is not distinct from player_id),
 check(not data ?| array['password','token','refreshToken','accessToken'])
);
create function papa_space_profile_guard() returns trigger
language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from papa_space_memberships where id=new.membership_id and role='player')
 then raise exception 'PLAYER_MEMBERSHIP_REQUIRED';end if;
 if tg_op='UPDATE' and (old.space_id<>new.space_id or old.player_id<>new.player_id
  or old.account_id<>new.account_id or old.membership_id<>new.membership_id)
 then raise exception 'PROFILE_IDENTITY_IMMUTABLE';end if;
 new.updated_at=now();return new;
end $$;
create trigger papa_space_profile_guard_trigger before insert or update
on papa_space_player_profiles for each row execute function papa_space_profile_guard();
alter table papa_space_player_profiles enable row level security;
revoke all on papa_space_player_profiles from public,anon,authenticated;
grant all on papa_space_player_profiles to service_role;

create function papa_space_player_rows(chosen_space text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not exists(select 1 from papa_spaces where id=chosen_space and status='active')
 then raise exception 'UNKNOWN_SPACE';end if;
 if chosen_space='space-001' then
  select coalesce(jsonb_agg(jsonb_build_object('kind','players','id',e.id,'data',e.data) order by e.id),'[]'::jsonb)
   into result from papa_v2_entities e where e.kind='players';
 else
  select coalesce(jsonb_agg(jsonb_build_object('kind','players','id',p.player_id,'data',p.data) order by p.player_id),'[]'::jsonb)
   into result from papa_space_player_profiles p where p.space_id=chosen_space;
 end if;
 return result;
end $$;

-- Directory projection is bounded metadata, with no player/song/history load.
create function papa_streamer_directory_in_space(chosen_space text) returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(room order by ordinal),'[]'::jsonb)
 from jsonb_array_elements(papa_streamer_directory()) with ordinality entry(room,ordinal)
 where room->>'spaceId'=chosen_space;
$$;

create function papa_v2_scoped_read_snapshot_in_space(requested_room text,allowed_space text default 'space-001')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room_id text;room_space text;result jsonb;meta jsonb;settings jsonb;rows_json jsonb;
begin
 select room->>'id',scope.space_id into room_id,room_space
 from papa_v2_entities e cross join lateral jsonb_array_elements(coalesce(e.data->'streamers','[]'::jsonb)) room
 join papa_space_streamers scope on scope.streamer_id=room->>'id'
 join papa_spaces space on space.id=scope.space_id and space.status='active'
 where e.kind='meta' and e.id='1' and (room->>'id'=requested_room or room->>'slug'=requested_room) limit 1;
 if room_id is null or room_space is null or allowed_space is not null and allowed_space<>room_space
 then raise exception 'UNKNOWN_STREAMER_SPACE';end if;
 select jsonb_build_object('schemaVersion',3,
  'streamers',papa_streamer_directory_in_space(room_space),
  'streamerSettings',coalesce((select jsonb_object_agg(entry.key,entry.value)
   from jsonb_each(coalesce(e.data->'streamerSettings','{}'::jsonb)) entry
   join papa_space_streamers scope on scope.streamer_id=entry.key and scope.space_id=room_space),'{}'::jsonb),
  'migrationIssues',case when room_space='space-001' then coalesce(e.data->'migrationIssues','[]'::jsonb) else '[]'::jsonb end)
 into meta from papa_v2_entities e where e.kind='meta' and e.id='1';
 -- Legacy platform settings belong only to Space 001. Other Spaces get their
 -- room's own settings or an empty value that Core fills with its defaults.
 if room_space='space-001' then
  select e.data into settings from papa_v2_entities e where e.kind='settings' and e.id='1';
 else settings=meta->'streamerSettings'->room_id;end if;
 select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'id',e.id,'data',case when e.kind='songs'
  then e.data-array['lyrics','lyricNotes','privateNote','privateNotes','lyricHistory','lyricsHistory'] else e.data end)),'[]'::jsonb)
 into rows_json from papa_v2_entities e where e.space_id=room_space and e.kind in
 ('songs','ledger','queue','crowns','cards','wishes') and e.data->>'streamer_id'=room_id;
 result=jsonb_build_object('revision',(select revision from papa_v2_revision where id=1),'rows',
  jsonb_build_array(jsonb_build_object('kind','meta','id','1','data',meta),
   jsonb_build_object('kind','settings','id','1','data',coalesce(settings,'{}'::jsonb)))
  ||papa_space_player_rows(room_space)||rows_json);
 return result;
end $$;
create or replace function papa_v2_scoped_read_snapshot(requested_room text) returns jsonb
language sql stable security definer set search_path=public as $$
 select papa_v2_scoped_read_snapshot_in_space(requested_room,'space-001');
$$;
revoke all on function papa_space_player_rows(text),papa_streamer_directory_in_space(text),
 papa_v2_scoped_read_snapshot_in_space(text,text) from public,anon,authenticated;
grant execute on function papa_space_player_rows(text),papa_streamer_directory_in_space(text),
 papa_v2_scoped_read_snapshot_in_space(text,text) to service_role;
notify pgrst,'reload schema';
commit;
