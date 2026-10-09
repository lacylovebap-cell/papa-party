begin;

-- Keep the original native transaction, including 006 provisioning, identity
-- locks, revision update, audit and notices. Only its guarded entry is replaced.
alter function public.papa_room_native_commit(bigint,jsonb,jsonb,jsonb,jsonb,text,boolean)
 rename to papa_room_native_commit_platform_ids_original;
revoke all on function public.papa_room_native_commit_platform_ids_original(bigint,jsonb,jsonb,jsonb,jsonb,text,boolean)
 from public,anon,authenticated,service_role;

create function public.papa_room_native_commit(expected bigint,changes jsonb,removed jsonb,
 actor_context jsonb,notices jsonb,requested_room text,operational boolean)
returns bigint language plpgsql security definer set search_path=public as $$
declare room_space text;invalid_ids boolean;duplicate_ids boolean;trim_chars text;
begin
 select space_id into room_space from papa_space_streamers where streamer_id=requested_room;
 if room_space is null or room_space='space-001' then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 perform papa_room_native_actor_guard(actor_context,requested_room,room_space);
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_typeof(removed) is distinct from 'array'
  or jsonb_typeof(notices) is distinct from 'array'
  or jsonb_array_length(changes)>(case when operational then 1000 else 2000 end)
  or jsonb_array_length(removed)>(case when operational then 1000 else 2000 end)
  or jsonb_array_length(notices)>1000
 then raise exception 'ROOM_WRITE_BATCH_INVALID';end if;

 -- All room transactions share this lock. The original commit consumes this
 -- expected revision once; concurrent profile changes cannot pass an old check.
 perform 1 from papa_v2_revision where id=1 and revision=expected for update;
 if not found then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 if exists(select 1 from jsonb_array_elements(changes) c where c->>'kind'='players') then
  if exists(select 1 from jsonb_array_elements(changes) c where c->>'kind'='players'
   and (jsonb_typeof(c->'id') is distinct from 'string'
    or nullif(btrim(c->>'id'),'') is null or jsonb_typeof(c->'data') is distinct from 'object'))
   or exists(select 1 from jsonb_array_elements(changes) c where c->>'kind'='players'
    group by c->>'id' having count(*)>1)
  then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;

  -- Match the existing client String.trim rules without folding case. Empty
  -- values and the legacy unknown marker do not reserve a platform identity.
  trim_chars=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)
   ||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)
   ||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)
   ||chr(8287)||chr(12288)||chr(65279);
  with patches as materialized (
   select c->>'id' player_id,c->'data' data from jsonb_array_elements(changes) c
   where c->>'kind'='players'
  ), effective_profiles as materialized (
   select p.player_id,p.data||coalesce(c.data,'{}'::jsonb) data
   from papa_space_player_profiles p left join patches c on c.player_id=p.player_id
   where p.space_id=room_space
  ), ids as materialized (
   select p.player_id,value,btrim(value#>>'{}',trim_chars) platform_id
   from effective_profiles p cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.data->'ids')='array' then p.data->'ids' else '[]'::jsonb end)
  )
  select exists(select 1 from effective_profiles where data ? 'ids'
    and jsonb_typeof(data->'ids') is distinct from 'array')
   or exists(select 1 from ids where jsonb_typeof(value) is distinct from 'string'),
   exists(select 1 from ids where jsonb_typeof(value)='string' and platform_id not in ('','未知')
    group by platform_id collate "C" having count(distinct player_id collate "C")>1)
  into invalid_ids,duplicate_ids;
  if invalid_ids then raise exception 'ROOM_PLAYER_PLATFORM_IDS_INVALID';end if;
  if duplicate_ids then raise exception 'ROOM_PLAYER_PLATFORM_ID_CONFLICT';end if;
 end if;
 return papa_room_native_commit_platform_ids_original(expected,changes,removed,
  actor_context,notices,requested_room,operational);
end $$;

-- Native commit remains internal. The original public admin/operational and
-- explicit-binding APIs retain their existing service-role grants.
revoke all on function public.papa_room_native_commit(bigint,jsonb,jsonb,jsonb,jsonb,text,boolean)
 from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
