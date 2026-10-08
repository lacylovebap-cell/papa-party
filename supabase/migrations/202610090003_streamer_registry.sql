begin;

-- Edge restricts this metadata-only snapshot to verified presidents. It never
-- returns players, lyrics, operational histories, or a full business snapshot.
create function papa_streamer_registry_snapshot(requested_room text,subject uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room_id text;metadata jsonb;canonical_space jsonb;descriptors jsonb;
begin
 if subject is null or not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  or not exists(select 1 from papa_platform_roles where account_id=subject and role='president')
  or not exists(select 1 from papa_manager_account_links where account_id=subject and manager_key='president')
 then raise exception 'STREAMER_REGISTRY_ACTOR_INVALID';end if;
 select room->>'id',e.data,jsonb_build_object('id',space.id,'slug',space.slug,'name',space.display_name)
 into room_id,metadata,canonical_space from papa_v2_entities e
 cross join lateral jsonb_array_elements(case when jsonb_typeof(e.data->'streamers')='array'
  then e.data->'streamers' else '[]'::jsonb end) room
 join papa_space_streamers scope on scope.streamer_id=room->>'id'
 join papa_spaces space on space.id=scope.space_id and space.status='active'
 where e.kind='meta' and e.id='1' and (room->>'id'=requested_room or room->>'slug'=requested_room) limit 1;
 if room_id is null then raise exception 'STREAMER_REGISTRY_ROOM_INVALID';end if;
 -- Only the selected room needs settings. The selected Space's descriptors
 -- suffice for Core; global slug uniqueness is checked inside the commit.
 -- Attaching canonical mappings prevents stale JSON hints becoming authority.
 select coalesce(jsonb_agg(room||jsonb_build_object('spaceId',mapping.space_id) order by ord),'[]'::jsonb)
 into descriptors from jsonb_array_elements(metadata->'streamers') with ordinality as item(room,ord)
 join papa_space_streamers mapping on mapping.streamer_id=room->>'id'
 where mapping.space_id=canonical_space->>'id';
 metadata=jsonb_build_object('schemaVersion',3,'streamers',descriptors,'streamerSettings',
  jsonb_build_object(room_id,coalesce(metadata->'streamerSettings'->room_id,'{}'::jsonb)));
 return jsonb_build_object('revision',(select revision from papa_v2_revision where id=1),
  'canonicalSpace',canonical_space,'canonicalRoom',room_id,'rows',jsonb_build_array(
   jsonb_build_object('kind','meta','id','1','data',metadata),
   jsonb_build_object('kind','settings','id','1','data',coalesce(metadata->'streamerSettings'->room_id,'{}'::jsonb))));
end $$;

create function papa_streamer_registry_commit(expected bigint,requested_space text,
 replacement_room jsonb,room_settings jsonb,actor_context jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare subject uuid;room_id text;room_slug text;mapped_space text;old_meta jsonb;old_room jsonb;
 prepared_room jsonb;prepared_meta jsonb;public_patch jsonb;canonical_context jsonb;stamp text;
 public_fields text[]=array['id','slug','display_name','home_title','subtitle','description','avatar_url',
  'banner_url','active','created_at','updated_at'];
begin
 if jsonb_typeof(actor_context) is distinct from 'object' or actor_context->>'account_id' is null
  or actor_context->>'role' is null or actor_context->>'role' not in ('super_admin','president')
  or actor_context->>'space_id' is distinct from requested_space
 then raise exception 'STREAMER_REGISTRY_ACTOR_INVALID';end if;
 begin subject=(actor_context->>'account_id')::uuid;
 exception when invalid_text_representation then raise exception 'STREAMER_REGISTRY_ACTOR_INVALID';end;
 if not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  or not exists(select 1 from papa_platform_roles where account_id=subject and role='president')
  or not exists(select 1 from papa_manager_account_links where account_id=subject and manager_key='president')
 then raise exception 'STREAMER_REGISTRY_ACTOR_INVALID';end if;
 if not exists(select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'STREAMER_REGISTRY_SPACE_INVALID';end if;
 if jsonb_typeof(replacement_room) is distinct from 'object'
 then raise exception 'STREAMER_REGISTRY_DESCRIPTOR_INVALID';end if;
 room_id=replacement_room->>'id';room_slug=replacement_room->>'slug';
 if jsonb_typeof(replacement_room->'id') is distinct from 'string' or nullif(btrim(room_id),'') is null or length(room_id)>200
  or jsonb_typeof(replacement_room->'slug') is distinct from 'string' or room_slug !~ '^[a-z0-9][a-z0-9-]{0,39}$'
  or jsonb_typeof(replacement_room->'display_name') is distinct from 'string'
  or nullif(btrim(replacement_room->>'display_name'),'') is null
  or replacement_room ? 'active' and jsonb_typeof(replacement_room->'active') is distinct from 'boolean'
  or replacement_room ? 'spaceId' and (jsonb_typeof(replacement_room->'spaceId') is distinct from 'string'
   or replacement_room->>'spaceId' is distinct from requested_space)
  or exists(select 1 from jsonb_each(replacement_room) field
   where field.key=any(public_fields) and field.key<>'active' and jsonb_typeof(field.value) is distinct from 'string')
 then raise exception 'STREAMER_REGISTRY_DESCRIPTOR_INVALID';end if;
 -- Lock the original revision before reading metadata or inserting a mapping.
 -- The original B commit retains this same lock through its audit transaction.
 perform 1 from papa_v2_revision where id=1 and revision=expected for update;
 if not found then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 select data into old_meta from papa_v2_entities where kind='meta' and id='1';
 if jsonb_typeof(old_meta->'streamers') is distinct from 'array'
  or jsonb_typeof(old_meta->'streamerSettings') is distinct from 'object'
 then raise exception 'STREAMER_REGISTRY_METADATA_INVALID';end if;
 if (select count(*) from jsonb_array_elements(old_meta->'streamers') room where room->>'id'=room_id)>1
  or exists(select 1 from jsonb_array_elements(old_meta->'streamers') room
   where room->>'id' is distinct from room_id and room->>'slug'=room_slug)
 then raise exception 'STREAMER_REGISTRY_DUPLICATE';end if;
 select room into old_room from jsonb_array_elements(old_meta->'streamers') room where room->>'id'=room_id;
 select space_id into mapped_space from papa_space_streamers where streamer_id=room_id for update;
 if mapped_space is not null and mapped_space<>requested_space or old_room is not null and mapped_space is null
 then raise exception 'STREAMER_REGISTRY_SCOPE_INVALID';end if;
 -- Core preserves unknown descriptor fields when editing. Accept their exact
 -- old values, while rejecting newly supplied or changed private/unknown keys.
 if exists(select 1 from jsonb_each(replacement_room) field
  where field.key<>all(public_fields) and field.key<>'spaceId'
   and (old_room is null or field.value is distinct from old_room->field.key))
 then raise exception 'STREAMER_REGISTRY_DESCRIPTOR_INVALID';end if;
 select coalesce(jsonb_object_agg(field.key,field.value),'{}'::jsonb) into public_patch
 from jsonb_each(replacement_room) field where field.key=any(public_fields);
 stamp=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 prepared_room=coalesce(old_room,'{}'::jsonb)||public_patch||jsonb_build_object(
  'created_at',coalesce(old_room->>'created_at',public_patch->>'created_at',stamp),'updated_at',stamp,
  'active',coalesce(public_patch->'active',old_room->'active','true'::jsonb));
 prepared_meta=jsonb_set(old_meta,'{streamers}',case when old_room is null
  then old_meta->'streamers'||jsonb_build_array(prepared_room)
  else (select jsonb_agg(case when room->>'id'=room_id then prepared_room else room end order by ordinal)
   from jsonb_array_elements(old_meta->'streamers') with ordinality rooms(room,ordinal)) end);
 if old_room is null then
  if jsonb_typeof(room_settings) is distinct from 'object'
  then raise exception 'STREAMER_REGISTRY_SETTINGS_INVALID';end if;
  if old_meta->'streamerSettings' ? room_id
  then raise exception 'STREAMER_REGISTRY_METADATA_INVALID';end if;
  prepared_meta=jsonb_set(prepared_meta,'{streamerSettings}',
   old_meta->'streamerSettings'||jsonb_build_object(room_id,room_settings));
  -- Explicit native mapping precedes the legacy meta trigger, which otherwise
  -- assigns new IDs to Space 001. This insertion rolls back with any commit error.
  insert into papa_space_streamers(streamer_id,space_id) values(room_id,requested_space)
   on conflict(streamer_id) do nothing;
  if not exists(select 1 from papa_space_streamers where streamer_id=room_id and space_id=requested_space)
  then raise exception 'STREAMER_REGISTRY_SCOPE_INVALID';end if;
 end if;
 -- Existing settings remain the exact stored value. Only a new room receives
 -- its provided defaults; no operational row or legacy settings row is written.
 canonical_context=actor_context||jsonb_build_object('account_id',subject::text,
  'space_id',requested_space,'streamer_id',room_id,'action','streamer');
 return papa_release_b_commit(expected,jsonb_build_array(jsonb_build_object('kind','meta','id','1','data',prepared_meta)),
  '[]'::jsonb,canonical_context,'[]'::jsonb);
end $$;

revoke all on function papa_streamer_registry_snapshot(text,uuid),
 papa_streamer_registry_commit(bigint,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function papa_streamer_registry_snapshot(text,uuid),
 papa_streamer_registry_commit(bigint,text,jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
