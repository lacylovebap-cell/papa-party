begin;

-- The old APIs retain their signatures and exact Space 001 behavior. Native
-- writes extend the same guarded business transaction; they do not provision
-- Accounts, infer Memberships, or create rows in the legacy player table.
create function papa_v2_room_write_snapshot_in_space(
 requested_room text,selected_song_ids text[],allowed_space text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare snapshot jsonb;room_id text;room_space text;
begin
 if allowed_space is null or selected_song_ids is null or cardinality(selected_song_ids)>50
 then raise exception 'ROOM_WRITE_BATCH_INVALID';end if;
 snapshot=papa_v2_scoped_read_snapshot_in_space(requested_room,allowed_space);
 select r->>'id' into room_id from jsonb_array_elements(snapshot->'rows') e
 cross join lateral jsonb_array_elements(e->'data'->'streamers') r
 where e->>'kind'='meta' and (r->>'id'=requested_room or r->>'slug'=requested_room) limit 1;
 select space_id into room_space from papa_space_streamers where streamer_id=room_id;
 if room_space is distinct from allowed_space or exists(
  select 1 from unnest(selected_song_ids) selected(id) where not exists(
   select 1 from papa_v2_entities e where e.kind='songs' and e.id=selected.id
    and e.space_id=room_space and e.data->>'streamer_id'=room_id))
 then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 return jsonb_set(snapshot,'{rows}',(select jsonb_agg(case when entry->>'kind'='songs'
  and entry->>'id'=any(selected_song_ids) then jsonb_set(entry,'{data}',
   (select data from papa_v2_entities where kind='songs' and id=entry->>'id'
    and space_id=room_space and data->>'streamer_id'=room_id)) else entry end order by ordinal)
  from jsonb_array_elements(snapshot->'rows') with ordinality entries(entry,ordinal)));
end $$;
create or replace function papa_v2_room_write_snapshot(requested_room text,selected_song_ids text[] default '{}')
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_v2_room_write_snapshot_in_space(requested_room,selected_song_ids,'space-001');
$$;

create function papa_room_native_actor_guard(actor_context jsonb,requested_room text,room_space text)
returns text language plpgsql stable security definer set search_path=public as $$
declare subject uuid;actor_kind text;
begin
 if actor_context->>'account_id' is null or actor_context->>'space_id' is distinct from room_space
  or actor_context->>'streamer_id' is distinct from requested_room
  or not exists(select 1 from papa_spaces where id=room_space and status='active')
 then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 begin subject=(actor_context->>'account_id')::uuid;
 exception when invalid_text_representation then raise exception 'ROOM_WRITE_ACTOR_INVALID';end;
 if not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
 then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 actor_kind=actor_context->>'role';
 if actor_kind='super_admin' then
  if not exists(select 1 from papa_platform_roles where account_id=subject and role='president')
  then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 elsif actor_kind='streamer_admin' then
  if actor_context->>'actor_streamer_id' is distinct from requested_room or not exists(
   select 1 from papa_space_memberships where account_id=subject and space_id=room_space
    and role='streamer_admin' and streamer_id=requested_room and status='active')
  then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 elsif actor_kind='player' then
  if not exists(select 1 from papa_space_player_profiles p
   join papa_space_memberships m on m.id=p.membership_id and m.account_id=p.account_id and m.space_id=p.space_id
   where p.space_id=room_space and p.player_id=actor_context->>'player_id' and p.account_id=subject
    and m.role='player' and m.status='active')
  then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 else raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 return actor_kind;
end $$;

-- Check every player identifier, including cancellation actors and nested
-- records. A native ID may match a legacy ID, but resolves only in its Space.
create function papa_room_native_player_refs_valid(value jsonb,room_space text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare entry record;item jsonb;player_ref text;
begin
 if jsonb_typeof(value)='object' then
  for entry in select * from jsonb_each(value) loop
   if entry.key in ('playerId','player_id','cancelled_by') and entry.value<>'null'::jsonb then
    if jsonb_typeof(entry.value) is distinct from 'string' then return false;end if;
    player_ref=entry.value#>>'{}';
    if player_ref='' or not exists(select 1 from papa_space_player_profiles p
     join papa_space_memberships m on m.id=p.membership_id and m.account_id=p.account_id and m.space_id=p.space_id
     join papa_accounts a on a.id=p.account_id and a.disabled_at is null
     where p.space_id=room_space and p.player_id=player_ref and m.role='player' and m.status='active')
    then return false;end if;
   elsif not papa_room_native_player_refs_valid(entry.value,room_space) then return false;end if;
  end loop;
 elsif jsonb_typeof(value)='array' then
  for item in select * from jsonb_array_elements(value) loop
   if not papa_room_native_player_refs_valid(item,room_space) then return false;end if;
  end loop;
 end if;
 return true;
end $$;

-- Historical dangling references remain usable. An identifier that exists in
-- another room/Space cannot be used as a song, queue, crown or paired-song link.
create function papa_room_native_entity_refs_valid(value jsonb,requested_room text,room_space text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare entry record;item jsonb;ref_kind text;ref_id text;
begin
 if jsonb_typeof(value)='object' then
  for entry in select * from jsonb_each(value) loop
   ref_kind=case entry.key when 'songId' then 'songs' when 'pairSongId' then 'songs'
    when 'queueId' then 'queue' when 'crownId' then 'crowns' end;
   if ref_kind is not null then
    if entry.value='null'::jsonb then continue;end if;
    if jsonb_typeof(entry.value) is distinct from 'string' or nullif(btrim(entry.value#>>'{}'),'') is null
    then return false;end if;
    ref_id=entry.value#>>'{}';
    if exists(select 1 from papa_v2_entities e where e.kind=ref_kind and e.id=ref_id
     and (e.space_id is distinct from room_space or e.data->>'streamer_id' is distinct from requested_room))
    then return false;end if;
   elsif entry.key='pairSongIds' then
    if jsonb_typeof(entry.value) is distinct from 'array' then return false;end if;
    for item in select * from jsonb_array_elements(entry.value) loop
     if jsonb_typeof(item) is distinct from 'string' or nullif(btrim(item#>>'{}'),'') is null
     then return false;end if;
     if exists(select 1 from papa_v2_entities e where e.kind='songs' and e.id=item#>>'{}'
      and (e.space_id is distinct from room_space or e.data->>'streamer_id' is distinct from requested_room))
     then return false;end if;
    end loop;
   elsif not papa_room_native_entity_refs_valid(entry.value,requested_room,room_space) then return false;end if;
  end loop;
 elsif jsonb_typeof(value)='array' then
  for item in select * from jsonb_array_elements(value) loop
   if not papa_room_native_entity_refs_valid(item,requested_room,room_space) then return false;end if;
  end loop;
 end if;
 return true;
end $$;

create function papa_capture_space_profile_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare ctx jsonb;
begin
 if old.data=new.data then return new;end if;
 ctx=coalesce(nullif(current_setting('papa.actor_context',true),''),'{}')::jsonb;
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,
  effective_at,before_data,after_data,space_id)
 values(coalesce(ctx->>'streamer_id','platform'),'players',new.player_id,
  coalesce(ctx->>'action','update'),coalesce(ctx->>'role','legacy-server'),ctx->>'player_id',
  new.data->>'effective_at',papa_audit_redact(old.data),papa_audit_redact(new.data),new.space_id);
 return new;
end $$;
create trigger papa_space_profile_event after update of data on papa_space_player_profiles
for each row execute function papa_capture_space_profile_event();

create function papa_room_native_profile_data_safe(value jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare entry record;item jsonb;
begin
 if jsonb_typeof(value)='object' then
  for entry in select * from jsonb_each(value) loop
   if lower(entry.key) in ('password','currentpassword','token','refreshtoken','accesstoken','secret')
    or not papa_room_native_profile_data_safe(entry.value) then return false;end if;
  end loop;
 elsif jsonb_typeof(value)='array' then
  for item in select * from jsonb_array_elements(value) loop
   if not papa_room_native_profile_data_safe(item) then return false;end if;
  end loop;
 end if;
 return true;
end $$;
alter table papa_space_player_profiles add constraint papa_native_profile_credentials_absent
 check(papa_room_native_profile_data_safe(data));

create function papa_room_native_commit(expected bigint,changes jsonb,removed jsonb,
 actor_context jsonb,notices jsonb,requested_room text,operational boolean)
returns bigint language plpgsql security definer set search_path=public as $$
declare room_space text;actor_kind text;old_meta jsonb;room_meta jsonb;room_settings jsonb;
 prepared jsonb;profile_change jsonb;next_revision bigint;allowed_kinds text[];
begin
 select space_id into room_space from papa_space_streamers where streamer_id=requested_room;
 if room_space is null or room_space='space-001' then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 actor_kind=papa_room_native_actor_guard(actor_context,requested_room,room_space);
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_typeof(removed) is distinct from 'array'
  or jsonb_typeof(notices) is distinct from 'array'
  or jsonb_array_length(changes)>(case when operational then 1000 else 2000 end)
  or jsonb_array_length(removed)>(case when operational then 1000 else 2000 end)
  or jsonb_array_length(notices)>1000
 then raise exception 'ROOM_WRITE_BATCH_INVALID';end if;
 if actor_kind='player' and (not operational and actor_context->>'action' is distinct from 'self'
  or operational and coalesce(actor_context->>'action','') not in ('request','wish','cancelOwn'))
 then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 -- The original transaction owns this same revision lock. Lock before reading
 -- private bodies, profile identities or metadata and retain it through notices.
 perform 1 from papa_v2_revision where id=1 and revision=expected for update;
 if not found then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 allowed_kinds=case when operational then array['queue','ledger','wishes']
  else array['songs','queue','ledger','crowns','cards','wishes','players','meta','settings'] end;
 if exists(select 1 from jsonb_array_elements(changes) c
  left join papa_v2_entities e on e.kind=c->>'kind' and e.id=c->>'id'
  where jsonb_typeof(c->'id') is distinct from 'string' or nullif(btrim(c->>'id'),'') is null
   or jsonb_typeof(c->'data') is distinct from 'object'
   or jsonb_typeof(c->'kind') is distinct from 'string' or not (c->>'kind'=any(allowed_kinds))
   or c->>'kind' in ('meta','settings') and c->>'id'<>'1'
   or c->>'kind' in ('songs','queue','ledger','crowns','cards','wishes') and (
    c->'data'->>'streamer_id' is distinct from requested_room
    or c->'data'->>(case when c->>'kind'='songs' then 'songId' else 'id' end) is distinct from c->>'id'
    or e.id is not null and (e.space_id is distinct from room_space or e.data->>'streamer_id' is distinct from requested_room)
    or not papa_room_native_player_refs_valid(case when c->>'kind'='songs'
     then coalesce(e.data,'{}'::jsonb)||(c->'data') else c->'data' end,room_space)
    or not papa_room_native_entity_refs_valid(case when c->>'kind'='songs'
     then coalesce(e.data,'{}'::jsonb)||(c->'data') else c->'data' end,requested_room,room_space))
   or c->>'kind'='players' and (c->'data'->>'playerId' is distinct from c->>'id'
    or not papa_room_native_profile_data_safe(c->'data')
    or c->'data' ?| array['password','token','refreshToken','accessToken','currentPassword','secret',
     'account_id','accountId','membership_id','membershipId','space_id','spaceId']
    or not exists(select 1 from papa_space_player_profiles p
     join papa_space_memberships m on m.id=p.membership_id and m.account_id=p.account_id and m.space_id=p.space_id
     join papa_accounts a on a.id=p.account_id and a.disabled_at is null
     where p.space_id=room_space and p.player_id=c->>'id' and m.status='active' and m.role='player')))
  or exists(select 1 from jsonb_array_elements(changes) c group by c->>'kind',c->>'id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(removed) r
   left join papa_v2_entities e on e.kind=r->>'kind' and e.id=r->>'id'
   where actor_kind='player' or jsonb_typeof(r->'kind') is distinct from 'string'
    or jsonb_typeof(r->'id') is distinct from 'string' or nullif(btrim(r->>'id'),'') is null
    or not (r->>'kind'=any(case when operational then array['queue','ledger','wishes']
     else array['songs','queue','ledger','crowns','cards','wishes'] end))
    or e.id is null or e.space_id is distinct from room_space or e.data->>'streamer_id' is distinct from requested_room
    or not papa_room_native_player_refs_valid(e.data,room_space))
  or exists(select 1 from jsonb_array_elements(notices) n
   where n->>'streamer_id' is distinct from requested_room or nullif(n->>'recipient','') is null
    or n->>'recipient' not in ('__admin__','__super__') and not papa_room_native_player_refs_valid(
     jsonb_build_object('playerId',n->>'recipient'),room_space))
 then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 if actor_kind='player' and exists(select 1 from jsonb_array_elements(changes) c
  left join papa_v2_entities e on e.kind=c->>'kind' and e.id=c->>'id'
  left join papa_space_player_profiles p on p.space_id=room_space and p.player_id=c->>'id'
  where (not operational and (c->>'kind'<>'players' or c->>'id' is distinct from actor_context->>'player_id'
    or p.account_id is distinct from (actor_context->>'account_id')::uuid
    or (p.data||(c->'data'))-array['name','names','created_at','updated_at','effective_at','_order']
     is distinct from p.data-array['name','names','created_at','updated_at','effective_at','_order']))
   or (operational and (c->'data'->>'playerId' is distinct from actor_context->>'player_id'
    or actor_context->>'action'='request' and (c->>'kind'<>'queue' or e.id is not null)
    or actor_context->>'action'='wish' and (c->>'kind'<>'wishes' or e.id is not null)
    or actor_context->>'action'='cancelOwn' and (c->>'kind' not in ('queue','ledger')
     or c->>'kind'='queue' and (e.id is null or e.data->>'playerId' is distinct from actor_context->>'player_id'
      or e.data->>'status' is null or e.data->>'status' not in ('pending','waiting')
      or c->'data'->>'status' is distinct from 'cancelled'
      or c->'data' ? 'receivedCreditCost' and c->'data'->'receivedCreditCost'
       is distinct from coalesce(e.data->'receivedCreditCost',e.data->'creditCost','1'::jsonb)
      or (c->'data')-array['status','cancelledAt','cancelled_by','receivedCreditCost','allocationReturnedAt','allocationReturnedCredits','updated_at','effective_at','created_at']
       is distinct from e.data-array['status','cancelledAt','cancelled_by','receivedCreditCost','allocationReturnedAt','allocationReturnedCredits','updated_at','effective_at','created_at'])
     or c->>'kind'='ledger' and (e.id is not null or c->'data'->>'allocationSettlement' is distinct from 'return'
      or not exists(select 1 from jsonb_array_elements(changes) cancelled
       join papa_v2_entities original on original.kind='queue' and original.id=cancelled->>'id'
       where cancelled->>'kind'='queue' and cancelled->'data'->>'status'='cancelled'
        and cancelled->'data'->>'id'=c->'data'->>'queueId'
        and original.space_id=room_space and original.data->>'playerId'=actor_context->>'player_id'
        and original.data->>'kind'='live' and nullif(original.data->>'allocation_id','') is not null
        and original.data->>'allocationReturnedAt' is null
        and c->'data'->'amount'=coalesce(original.data->'creditCost','1'::jsonb)))))))
 then raise exception 'ROOM_WRITE_ACTOR_INVALID';end if;
 select data into old_meta from papa_v2_entities where kind='meta' and id='1';
 select c->'data' into room_meta from jsonb_array_elements(changes) c where c->>'kind'='meta';
 select c->'data' into room_settings from jsonb_array_elements(changes) c where c->>'kind'='settings';
 if room_meta is not null and (
  room_meta->'streamers' is distinct from papa_streamer_directory_in_space(room_space)
  or jsonb_typeof(room_meta->'streamerSettings') is distinct from 'object'
  or room_meta->'migrationIssues' is distinct from '[]'::jsonb
  or exists(select 1 from jsonb_each(room_meta->'streamerSettings') setting
   left join papa_space_streamers scope on scope.streamer_id=setting.key and scope.space_id=room_space
   where scope.streamer_id is null or setting.key<>requested_room
    and setting.value is distinct from old_meta->'streamerSettings'->setting.key)
  or exists(select 1 from jsonb_object_keys(coalesce(old_meta->'streamerSettings','{}'::jsonb)) key
   join papa_space_streamers scope on scope.streamer_id=key and scope.space_id=room_space
   where not room_meta->'streamerSettings' ? key)
  or jsonb_typeof(room_meta->'streamerSettings'->requested_room) is distinct from 'object'
  or room_settings is not null and room_settings is distinct from room_meta->'streamerSettings'->requested_room)
 then raise exception 'ROOM_WRITE_SCOPE_INVALID';end if;
 room_settings=coalesce(room_meta->'streamerSettings'->requested_room,room_settings);
 select coalesce(jsonb_agg(jsonb_build_object('kind',c->>'kind','id',c->>'id','data',
  case when c->>'kind'='songs' then coalesce(e.data,'{}'::jsonb)||(c->'data') else c->'data' end)),'[]'::jsonb)
 into prepared from jsonb_array_elements(changes) c
 left join papa_v2_entities e on e.kind=c->>'kind' and e.id=c->>'id'
 where c->>'kind' not in ('players','meta','settings');
 if room_settings is not null then
  prepared=prepared||jsonb_build_array(jsonb_build_object('kind','meta','id','1','data',
   old_meta||jsonb_build_object('streamerSettings',coalesce(old_meta->'streamerSettings','{}'::jsonb)
    ||jsonb_build_object(requested_room,room_settings))));
 end if;
 -- Includes original revision, entity triggers, failed-request notices, push
 -- wakeups and explicit notices. Any subsequent profile error rolls all back.
 next_revision=papa_release_b_commit(expected,prepared,removed,actor_context,notices);
 for profile_change in select c from jsonb_array_elements(changes) c where c->>'kind'='players' loop
  update papa_space_player_profiles set data=data||(profile_change->'data')
   where space_id=room_space and player_id=profile_change->>'id';
 end loop;
 return next_revision;
end $$;

alter function papa_room_operational_commit(bigint,jsonb,jsonb,jsonb,jsonb,text)
 rename to papa_room_operational_commit_space001;
alter function papa_room_admin_commit(bigint,jsonb,jsonb,jsonb,jsonb,text)
 rename to papa_room_admin_commit_space001;
create function papa_room_operational_commit(expected bigint,changes jsonb,removed jsonb,
 actor_context jsonb,notices jsonb,requested_room text)
returns bigint language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from papa_space_streamers where streamer_id=requested_room and space_id='space-001') then
  return papa_room_operational_commit_space001(expected,changes,removed,actor_context,notices,requested_room);
 end if;
 return papa_room_native_commit(expected,changes,removed,actor_context,notices,requested_room,true);
end $$;
create function papa_room_admin_commit(expected bigint,changes jsonb,removed jsonb,
 actor_context jsonb,notices jsonb,requested_room text)
returns bigint language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from papa_space_streamers where streamer_id=requested_room and space_id='space-001') then
  return papa_room_admin_commit_space001(expected,changes,removed,actor_context,notices,requested_room);
 end if;
 return papa_room_native_commit(expected,changes,removed,actor_context,notices,requested_room,false);
end $$;

revoke all on function papa_v2_room_write_snapshot_in_space(text,text[],text),
 papa_room_native_actor_guard(jsonb,text,text),papa_room_native_player_refs_valid(jsonb,text),
 papa_room_native_entity_refs_valid(jsonb,text,text),papa_capture_space_profile_event(),
 papa_room_native_profile_data_safe(jsonb),
 papa_room_native_commit(bigint,jsonb,jsonb,jsonb,jsonb,text,boolean),
 papa_room_operational_commit(bigint,jsonb,jsonb,jsonb,jsonb,text),
 papa_room_admin_commit(bigint,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function papa_v2_room_write_snapshot_in_space(text,text[],text),
 papa_room_operational_commit(bigint,jsonb,jsonb,jsonb,jsonb,text),
 papa_room_admin_commit(bigint,jsonb,jsonb,jsonb,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
