begin;

-- Preserve the single-player API and its original source/audit triggers. A
-- batch validates every target before changing any row, under one revision.
create function public.papa_players_archive(requested_space text,requested_players text[],
 expected_revision bigint,actor_context jsonb,requested_archived boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare subject uuid;current_revision bigint;target_count integer;changed_count integer;
 updated_count integer;previous_context text;result_players jsonb;change_metadata jsonb;
begin
 if requested_players is null or coalesce(array_ndims(requested_players),0)<>1
  or cardinality(requested_players) not between 1 and 100 or requested_archived is null
  or expected_revision is null or expected_revision<0
  or exists(select 1 from unnest(requested_players) id where id is null or length(id) not between 1 and 200
   or id<>btrim(id) or id~'[[:cntrl:]]' or strpos(id,chr(8232))>0 or strpos(id,chr(8233))>0)
  or exists(select 1 from unnest(requested_players) id group by id collate "C" having count(*)>1)
 then raise exception 'PLAYER_ARCHIVE_INPUT_INVALID';end if;
 if requested_space is null or not exists(select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'PLAYER_ARCHIVE_SCOPE_INVALID';end if;
 if jsonb_typeof(actor_context) is distinct from 'object'
  or jsonb_typeof(actor_context->'role') is distinct from 'string'
  or actor_context->>'role' not in ('president','super_admin','admin')
  or actor_context->>'space_id' is distinct from requested_space or actor_context->>'streamer_id' is not null
  or jsonb_typeof(actor_context->'account_id') is distinct from 'string'
 then raise exception 'PLAYER_ARCHIVE_ACTOR_INVALID';end if;
 begin subject=(actor_context->>'account_id')::uuid;
 exception when invalid_text_representation then raise exception 'PLAYER_ARCHIVE_ACTOR_INVALID';end;
 if subject is null or not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  or not exists(select 1 from papa_platform_roles where account_id=subject and role='president')
 then raise exception 'PLAYER_ARCHIVE_ACTOR_INVALID';end if;

 select revision into current_revision from papa_v2_revision where id=1 for update;
 if current_revision is distinct from expected_revision then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 -- Recheck and retain authority while the batch is committed. Do not create or
 -- alter Accounts, Memberships, sessions, or the original identity bindings.
 perform 1 from papa_spaces where id=requested_space and status='active' for share;
 if not found then raise exception 'PLAYER_ARCHIVE_SCOPE_INVALID';end if;
 perform 1 from papa_accounts where id=subject and disabled_at is null for share;
 if not found then raise exception 'PLAYER_ARCHIVE_ACTOR_INVALID';end if;
 perform 1 from papa_platform_roles where account_id=subject and role='president' for share;
 if not found then raise exception 'PLAYER_ARCHIVE_ACTOR_INVALID';end if;
 if requested_space='space-001' then
  perform 1 from papa_v2_entities where kind='players' and space_id is null
   and id=any(requested_players) order by id for update;
  select count(*),count(*) filter(where coalesce(data->'archived'='true'::jsonb,false)<>requested_archived)
   into target_count,changed_count from papa_v2_entities
   where kind='players' and space_id is null and id=any(requested_players);
 else
  perform 1 from papa_space_player_profiles where space_id=requested_space
   and player_id=any(requested_players) order by player_id for update;
  select count(*),count(*) filter(where coalesce(data->'archived'='true'::jsonb,false)<>requested_archived)
   into target_count,changed_count from papa_space_player_profiles
   where space_id=requested_space and player_id=any(requested_players);
 end if;
 if target_count<>cardinality(requested_players) then raise exception 'PLAYER_ARCHIVE_TARGET_INVALID';end if;
 select jsonb_agg(jsonb_build_object('playerId',id,'archived',requested_archived) order by ordinal)
  into result_players from unnest(requested_players) with ordinality target(id,ordinal);
 if changed_count=0 then
  return jsonb_build_object('revision',current_revision,'changed',false,'players',result_players);
 end if;
 if requested_archived and exists(select 1 from papa_v2_entities queue
  where queue.kind='queue' and queue.space_id=requested_space
   and queue.data->>'playerId'=any(requested_players) and queue.data->>'status' in ('pending','waiting'))
 then raise exception 'PLAYER_ARCHIVE_PENDING_QUEUE';end if;

 change_metadata=jsonb_build_object('archived',requested_archived)
  ||case when requested_archived then jsonb_build_object('archiveAt',now(),'archiveBy',subject)
   else jsonb_build_object('restoreAt',now(),'restoreBy',subject) end;
 previous_context=current_setting('papa.actor_context',true);
 perform set_config('papa.actor_context',jsonb_build_object('role','president','account_id',subject,
  'space_id',requested_space,'streamer_id',null,'player_id',null,
  'action',case when requested_archived then 'playerArchive' else 'playerRestore' end)::text,true);
 if requested_space='space-001' then
  update papa_v2_entities set data=data||change_metadata where kind='players' and space_id is null
   and id=any(requested_players) and coalesce(data->'archived'='true'::jsonb,false)<>requested_archived;
 else
  update papa_space_player_profiles set data=data||change_metadata where space_id=requested_space
   and player_id=any(requested_players) and coalesce(data->'archived'='true'::jsonb,false)<>requested_archived;
 end if;
 get diagnostics updated_count=row_count;
 if updated_count<>changed_count then raise exception 'PLAYER_ARCHIVE_TARGET_INVALID';end if;
 perform set_config('papa.actor_context',coalesce(previous_context,''),true);
 update papa_v2_revision set revision=current_revision+1 where id=1;
 return jsonb_build_object('revision',current_revision+1,'changed',true,'players',result_players);
end $$;
revoke all on function public.papa_players_archive(text,text[],bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.papa_players_archive(text,text[],bigint,jsonb,boolean) to service_role;
notify pgrst,'reload schema';
commit;
