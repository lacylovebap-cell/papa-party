begin;

-- Only an explicitly edited song needs its original lyric/private body. Bulk
-- edits and tag edits use metadata, then merge the patch inside the transaction.
create function papa_v2_room_write_snapshot(requested_room text,selected_song_ids text[] default '{}')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare snapshot jsonb;room_id text;
begin
 if cardinality(selected_song_ids)>50 then raise exception 'ROOM_WRITE_BATCH_INVALID';end if;
 snapshot=papa_v2_scoped_read_snapshot_in_space(requested_room,'space-001');
 select r->>'id' into room_id from jsonb_array_elements(snapshot->'rows') e
 cross join lateral jsonb_array_elements(e->'data'->'streamers') r
 where e->>'kind'='meta' and (r->>'id'=requested_room or r->>'slug'=requested_room) limit 1;
 if exists(select 1 from unnest(selected_song_ids) selected(id) where not exists(
  select 1 from papa_v2_entities e where e.kind='songs' and e.id=selected.id
   and e.space_id='space-001' and e.data->>'streamer_id'=room_id))
 then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 return jsonb_set(snapshot,'{rows}',(select jsonb_agg(case when entry->>'kind'='songs'
  and entry->>'id'=any(selected_song_ids) then jsonb_set(entry,'{data}',
   (select data from papa_v2_entities where kind='songs' and id=entry->>'id')) else entry end order by ordinal)
  from jsonb_array_elements(snapshot->'rows') with ordinality entries(entry,ordinal)));
end $$;

create function papa_room_admin_commit(expected bigint,changes jsonb,removed jsonb,
 actor_context jsonb,notices jsonb,requested_room text)
returns bigint language plpgsql security definer set search_path=public as $$
declare room_space text;actor_kind text;prepared jsonb;old_meta jsonb;room_meta jsonb;
begin
 select space_id into room_space from papa_space_streamers where streamer_id=requested_room;
 if room_space is distinct from 'space-001' or actor_context->>'streamer_id' is distinct from requested_room
  or nullif(actor_context->>'space_id','') is not null and actor_context->>'space_id'<>room_space
 then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 actor_kind=actor_context->>'role';
 if actor_kind is null or actor_kind not in ('player','streamer_admin','super_admin')
  or actor_kind='streamer_admin' and actor_context->>'actor_streamer_id' is distinct from requested_room
  or actor_kind='player' and actor_context->>'action' is distinct from 'self'
 then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_typeof(removed) is distinct from 'array'
  or jsonb_typeof(notices) is distinct from 'array' or jsonb_array_length(changes)>2000
  or jsonb_array_length(removed)>2000 or jsonb_array_length(notices)>1000
 then raise exception 'ROOM_WRITE_BATCH_INVALID';end if;
 -- Lock revision before reading old source bodies/settings. The original
 -- commit checks this same row and performs audit/notice writes atomically.
 perform 1 from papa_v2_revision where id=1 and revision=expected for update;
 if not found then raise exception 'VERSION_CONFLICT';end if;
 select data into old_meta from papa_v2_entities where kind='meta' and id='1';
 select c->'data' into room_meta from jsonb_array_elements(changes) c where c->>'kind'='meta';
 if room_meta is not null and (
  room_meta->'streamers' is distinct from papa_streamer_directory_in_space(room_space)
  or exists(select 1 from jsonb_each(coalesce(room_meta->'streamerSettings','{}'::jsonb)) setting
   where setting.key<>requested_room and setting.value is distinct from old_meta->'streamerSettings'->setting.key)
  or exists(select 1 from jsonb_object_keys(coalesce(old_meta->'streamerSettings','{}'::jsonb)) key
   join papa_space_streamers scope on scope.streamer_id=key and scope.space_id=room_space
   where key<>requested_room and not coalesce(room_meta->'streamerSettings','{}'::jsonb) ? key))
 then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 if exists(select 1 from jsonb_array_elements(changes) c
  left join papa_v2_entities e on e.kind=c->>'kind' and e.id=c->>'id'
  where nullif(c->>'id','') is null or jsonb_typeof(c->'data') is distinct from 'object'
   or c->>'kind' is null or c->>'kind' not in ('songs','queue','ledger','crowns','cards','wishes','players','meta','settings')
   or c->>'kind' in ('meta','settings') and c->>'id'<>'1'
   or c->>'kind'='players' and (c->'data'->>'playerId' is distinct from c->>'id'
    or actor_kind='player' and c->>'id' is distinct from actor_context->>'player_id')
   or actor_kind='player' and c->>'kind' not in ('players','meta','settings')
   or c->>'kind' in ('songs','queue','ledger','crowns','cards','wishes') and (
    c->'data'->>'streamer_id' is distinct from requested_room
    or c->'data'->>(case when c->>'kind'='songs' then 'songId' else 'id' end) is distinct from c->>'id'
    or e.id is not null and (e.space_id<>room_space or e.data->>'streamer_id' is distinct from requested_room)))
  or exists(select 1 from jsonb_array_elements(removed) r
   left join papa_v2_entities e on e.kind=r->>'kind' and e.id=r->>'id'
   where actor_kind='player' or r->>'kind' not in ('songs','queue','ledger','crowns','cards','wishes')
    or r->>'kind' is null or e.id is null or e.space_id<>room_space or e.data->>'streamer_id' is distinct from requested_room)
  or exists(select 1 from jsonb_array_elements(notices) n where n->>'streamer_id' is distinct from requested_room)
 then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 select coalesce(jsonb_agg(jsonb_build_object('kind',c->>'kind','id',c->>'id','data',
  case when c->>'kind'='songs' then coalesce(e.data,'{}'::jsonb)||(c->'data')
   when c->>'kind'='meta' then old_meta||jsonb_build_object('streamerSettings',
    coalesce(old_meta->'streamerSettings','{}'::jsonb)||jsonb_build_object(requested_room,c->'data'->'streamerSettings'->requested_room))
   when c->>'kind'='settings' then coalesce(room_meta->'streamerSettings'->requested_room,c->'data')
   else c->'data' end)),'[]'::jsonb) into prepared
 from jsonb_array_elements(changes) c
 left join papa_v2_entities e on e.kind=c->>'kind' and e.id=c->>'id'
 where c->>'kind'<>'settings' or requested_room='papa';
 return papa_release_b_commit(expected,prepared,removed,actor_context,notices);
end $$;
revoke all on function papa_v2_room_write_snapshot(text,text[]),
 papa_room_admin_commit(bigint,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function papa_v2_room_write_snapshot(text,text[]),
 papa_room_admin_commit(bigint,jsonb,jsonb,jsonb,jsonb,text) to service_role;
commit;
