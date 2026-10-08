begin;

-- One right per room/player. No legacy settings, song, player or credit row is rewritten.
create table papa_player_extra_quotas (
 streamer_id text not null, player_id text not null, space_id text not null,
 extra_quota integer not null check(extra_quota between 0 and 100000),
 enabled boolean not null default true,
 updated_at timestamptz not null default now(), updated_by uuid references papa_accounts(id),
 primary key(streamer_id,player_id),
 foreign key(streamer_id,space_id) references papa_space_streamers(streamer_id,space_id)
);
create index papa_extra_quota_player_space on papa_player_extra_quotas(space_id,player_id) where enabled and extra_quota>0;
alter table papa_player_extra_quotas enable row level security;
revoke all on papa_player_extra_quotas from public,anon,authenticated;
grant select,insert,update on papa_player_extra_quotas to service_role;

create function papa_manage_player_extra_quota(expected bigint,requested_room text,target_player text,
 requested_extra integer,requested_enabled boolean,actor_context jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare room_space text;actor_kind text;previous jsonb;current_row jsonb;result bigint;
begin
 select space_id into room_space from papa_space_streamers where streamer_id=requested_room;
 if room_space is null or requested_extra is null or requested_extra<0 or requested_extra>100000
  or requested_enabled is null or nullif(target_player,'') is null
 then raise exception 'EXTRA_QUOTA_INVALID';end if;
 actor_kind=papa_room_native_actor_guard(actor_context,requested_room,room_space);
 if actor_kind not in ('streamer_admin','super_admin') then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 if not papa_communication_player_exists(room_space,target_player) then raise exception 'EXTRA_QUOTA_PLAYER_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 and revision=expected for update;
 if not found then raise exception 'VERSION_CONFLICT';end if;
 select jsonb_build_object('streamer_id',streamer_id,'playerId',player_id,'extra_quota',extra_quota,'enabled',enabled)
 into previous from papa_player_extra_quotas where streamer_id=requested_room and player_id=target_player;
 insert into papa_player_extra_quotas(streamer_id,player_id,space_id,extra_quota,enabled,updated_by)
 values(requested_room,target_player,room_space,requested_extra,requested_enabled and requested_extra>0,(actor_context->>'account_id')::uuid)
 on conflict(streamer_id,player_id) do update set extra_quota=excluded.extra_quota,enabled=excluded.enabled,
  updated_at=now(),updated_by=excluded.updated_by;
 current_row=jsonb_build_object('streamer_id',requested_room,'playerId',target_player,'extra_quota',requested_extra,'enabled',requested_enabled and requested_extra>0);
 perform set_config('papa.actor_context',(actor_context||jsonb_build_object('action','extraQuota'))::text,true);
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,before_data,after_data)
 values(requested_room,'extra_quota',target_player,'extraQuota',actor_kind,previous,current_row);
 update papa_v2_revision set revision=revision+1 where id=1 returning revision into result;
 return result;
end $$;
revoke all on function papa_manage_player_extra_quota(bigint,text,text,integer,boolean,jsonb) from public,anon,authenticated;
grant execute on function papa_manage_player_extra_quota(bigint,text,text,integer,boolean,jsonb) to service_role;

-- Extend the existing single scoped snapshot RPC with lightweight quota metadata.
-- Top-level projections never become legacy entities or operational write patches.
alter function papa_v2_scoped_read_snapshot_in_space(text,text) rename to papa_scoped_snapshot_before_extra_quota;
revoke all on function papa_scoped_snapshot_before_extra_quota(text,text) from public,anon,authenticated,service_role;
create function papa_extra_quota_snapshot_metadata(snapshot jsonb,requested_room text,allowed_space text,quota_player text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room_id text;directory jsonb;grants jsonb;rights jsonb;
begin
 if allowed_space is null then raise exception 'UNKNOWN_STREAMER_SPACE';end if;
 select e->'data'->'streamers' into directory from jsonb_array_elements(snapshot->'rows') e where e->>'kind'='meta';
 select r->>'id' into room_id from jsonb_array_elements(directory) r where r->>'id'=requested_room or r->>'slug'=requested_room limit 1;
 if snapshot ? 'extraQuotas' then grants=snapshot->'extraQuotas';else
 select coalesce(jsonb_agg(jsonb_build_object('streamer_id',q.streamer_id,'player_id',q.player_id,'extra_quota',q.extra_quota,'enabled',q.enabled) order by q.player_id),'[]') into grants
 from papa_player_extra_quotas q where q.space_id=allowed_space and q.streamer_id=room_id;
 end if;
 select coalesce(jsonb_object_agg(grouped.player_id,grouped.rights),'{}') into rights from (
  select q.player_id,jsonb_agg(jsonb_build_object('streamer_id',q.streamer_id,'streamer_name',r->>'display_name','extra_quota',q.extra_quota) order by q.streamer_id) rights
  from papa_player_extra_quotas q join jsonb_array_elements(directory) r on r->>'id'=q.streamer_id and (r->>'active')::boolean
  where q.space_id=allowed_space and q.player_id=quota_player and q.enabled and q.extra_quota>0 and q.player_id in
   (select e->>'id' from jsonb_array_elements(snapshot->'rows') e where e->>'kind'='players')
  group by q.player_id
 ) grouped;
 return snapshot||jsonb_build_object('extraQuotas',grants,'extraQuotaRights',rights);
end $$;
revoke all on function papa_extra_quota_snapshot_metadata(jsonb,text,text,text) from public,anon,authenticated,service_role;
create function papa_v2_scoped_read_snapshot_in_space(requested_room text,allowed_space text default 'space-001')
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_extra_quota_snapshot_metadata(papa_scoped_snapshot_before_extra_quota(requested_room,allowed_space),requested_room,allowed_space,null);
$$;
create function papa_v2_scoped_read_snapshot_with_quota(requested_room text,allowed_space text,quota_player text)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_extra_quota_snapshot_metadata(papa_scoped_snapshot_before_extra_quota(requested_room,allowed_space),requested_room,allowed_space,quota_player);
$$;
create function papa_v2_room_write_snapshot_with_quota(requested_room text,selected_song_ids text[],allowed_space text,quota_player text)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_extra_quota_snapshot_metadata(papa_v2_room_write_snapshot_in_space(requested_room,selected_song_ids,allowed_space),requested_room,allowed_space,quota_player);
$$;
revoke all on function papa_v2_scoped_read_snapshot_with_quota(text,text,text),papa_v2_room_write_snapshot_with_quota(text,text[],text,text) from public,anon,authenticated;
grant execute on function papa_v2_scoped_read_snapshot_with_quota(text,text,text),papa_v2_room_write_snapshot_with_quota(text,text[],text,text) to service_role;
revoke all on function papa_v2_scoped_read_snapshot_in_space(text,text) from public,anon,authenticated;
grant execute on function papa_v2_scoped_read_snapshot_in_space(text,text) to service_role;
create or replace function papa_v2_scoped_read_snapshot(requested_room text) returns jsonb
language sql stable security definer set search_path=public as $$
 select papa_v2_scoped_read_snapshot_in_space(requested_room,'space-001');
$$;
commit;
