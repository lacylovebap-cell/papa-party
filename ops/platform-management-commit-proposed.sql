-- Approved management integration; apply only after the deployment validation gate.
-- Keeps business calculation, receipts, ledger and Audit in their existing RPCs.
begin;
-- Hold the same authority rows until the delegated operation commits. In
-- particular Space FOR SHARE serializes against papa_manage_space's status,
-- membership and archive changes (which take Space FOR UPDATE first).
create or replace function public.papa_management_lock_room(actor_context jsonb,permission_name text)
returns void language plpgsql security definer set search_path='' as $$
declare subject uuid;room text;target_space text;
begin
 if jsonb_typeof(actor_context) is distinct from 'object' or actor_context->>'role' is distinct from 'streamer_admin'
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 begin subject=(actor_context->>'account_id')::uuid;
 exception when invalid_text_representation then raise exception 'MANAGEMENT_ACCESS_DENIED';end;
 room=actor_context->>'actor_streamer_id';target_space=actor_context->>'space_id';
 if subject is null or nullif(room,'') is null or nullif(target_space,'') is null
  or actor_context->>'streamer_id' is not null and actor_context->>'streamer_id' is distinct from room
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_accounts where id=subject and disabled_at is null for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_spaces where id=target_space and status='active' for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_space_streamers where streamer_id=room and space_id=target_space and archived_at is null for share;
 if not found then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 perform 1 from public.papa_space_memberships where account_id=subject and space_id=target_space order by id for share;
 perform 1 from public.papa_manager_account_links where account_id=subject for share;
 perform 1 from public.papa_streamer_accounts where streamer_id=room for share;
 if not coalesce(public.papa_management_room_permission(subject,room,permission_name),false)
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
end;$$;
revoke all on function public.papa_management_lock_room(jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.papa_management_business_commit(commit_name text,arguments jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; subject uuid; room text; target_space text; permission_name text; action_name text; result jsonb;
begin
 if commit_name is null or commit_name not in ('papa_release_b_commit','papa_room_operational_commit','papa_room_admin_commit','papa_room_operational_commit_receipted','papa_room_admin_commit_with_player_bindings')
  or jsonb_typeof(arguments) is distinct from 'object' then raise exception 'MANAGEMENT_COMMIT_INVALID';end if;
 ctx=arguments->'actor_context';
 if ctx->>'role' is distinct from 'streamer_admin' then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 subject=(ctx->>'account_id')::uuid;room=ctx->>'streamer_id';target_space=ctx->>'space_id';
 if subject is null or room is null or target_space is null or ctx->>'actor_streamer_id' is distinct from room
  or commit_name<>'papa_release_b_commit' and arguments->>'requested_room' is distinct from room
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 action_name=split_part(coalesce(ctx->>'action',''),':',1);
 permission_name=case
  when action_name in ('song','songsBulk','restoreSongEdits','lyrics','newPracticeSet','newPracticeOrder','songOrder','wishAdmin') then 'songs'
  when action_name in ('queue','onBehalf','streamerDraw','queueOrder') then 'queue'
  when action_name in ('player','ledger','allocate','extraQuota','crown','card','playerProvision') then 'players'
  else 'all' end;
 perform public.papa_management_lock_room(ctx,permission_name);
 -- Names are strictly allowlisted above; all data remains bound parameters.
 if commit_name='papa_release_b_commit' then
  execute 'select to_jsonb(public.papa_release_b_commit(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices''))' into result using arguments;
 elsif commit_name='papa_room_operational_commit_receipted' then
  execute 'select public.papa_room_operational_commit_receipted(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices'',$1->>''requested_room'',($1->>''operation_id'')::uuid,$1->>''actor_key'',$1->>''request_hash'')' into result using arguments;
 elsif commit_name='papa_room_admin_commit_with_player_bindings' then
  execute 'select to_jsonb(public.papa_room_admin_commit_with_player_bindings(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices'',$1->>''requested_room'',$1->''player_bindings''))' into result using arguments;
 else
  execute format('select to_jsonb(public.%I(($1->>''expected'')::bigint,$1->''changes'',$1->''removed'',$1->''actor_context'',$1->''notices'',$1->>''requested_room''))',commit_name) into result using arguments;
 end if;
 return result;
end;$$;
revoke all on function public.papa_management_business_commit(text,jsonb) from public,anon,authenticated;
grant execute on function public.papa_management_business_commit(text,jsonb) to service_role;

-- Existing badge/catalog/quota mutations bypass the snapshot commits above.
-- Dispatch only these established RPCs, with their current named signatures;
-- adding a future endpoint never implicitly grants delegated write access.
create or replace function public.papa_management_guarded_rpc(rpc_name text,arguments jsonb,actor_context jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare permission_name text;room text;target_space text;signature record;argument record;
 candidates integer=0;sql_arguments text='';expression text;result jsonb;catalog_actor jsonb;
begin
 permission_name=case
  when rpc_name in ('papa_catalog_import_link_batch','papa_catalog_link_room_song','papa_catalog_report_issue',
   'papa_catalog_language_filter_save','papa_catalog_lyric_choice','papa_catalog_batch_add') then 'songs'
  when rpc_name in ('papa_achievement_visibility_set','papa_achievement_manual_grant',
   'papa_achievement_manual_grant_batch','papa_achievement_revoke','papa_manage_player_extra_quota') then 'players'
  when rpc_name='papa_public_route_save' then 'all'
  else null end;
 if permission_name is null or jsonb_typeof(arguments) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(arguments))>50
 then raise exception 'MANAGEMENT_RPC_INVALID';end if;
 perform public.papa_management_lock_room(actor_context,permission_name);
 room=actor_context->>'actor_streamer_id';target_space=actor_context->>'space_id';
 -- Do not let canonical authority for one room accompany another room's args.
 if arguments?'requested_room' and arguments->>'requested_room' is distinct from room
  or arguments?'room_id' and arguments->>'room_id' is distinct from room
  or arguments?'requested_space' and arguments->>'requested_space' is distinct from target_space
  or arguments?'actor_context' and arguments->'actor_context' is distinct from actor_context
 then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 if arguments?'actor_id' then
  if left(arguments->>'actor_id',9) is distinct from 'verified:' then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
  begin catalog_actor=substring(arguments->>'actor_id' from 10)::jsonb;
  exception when invalid_text_representation then raise exception 'MANAGEMENT_ACCESS_DENIED';end;
  if catalog_actor is distinct from actor_context then raise exception 'MANAGEMENT_ACCESS_DENIED';end if;
 end if;
 -- Match a single overload by its supplied names and required parameters.
 -- Names/types originate only from pg_catalog; values remain bound JSON.
 for signature in select p.* from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=rpc_name and p.prokind='f' and p.provariadic=0 and not p.proretset
  and not exists(select 1 from jsonb_object_keys(arguments) key where not key=any(p.proargnames[1:p.pronargs]))
  and not exists(select 1 from generate_series(1,p.pronargs-p.pronargdefaults) i where not arguments?p.proargnames[i])
 loop
  candidates=candidates+1;
  if candidates>1 then raise exception 'MANAGEMENT_RPC_SIGNATURE_INVALID';end if;
  for argument in select p.proargnames[i] name,p.proargtypes[i-1] type_oid,t.typcategory
   from pg_catalog.pg_proc p cross join lateral generate_series(1,p.pronargs) i
   join pg_catalog.pg_type t on t.oid=p.proargtypes[i-1]
   where p.oid=signature.oid and arguments?p.proargnames[i] order by i
  loop
   if sql_arguments<>'' then sql_arguments=sql_arguments||',';end if;
   if argument.type_oid in ('jsonb'::regtype,'json'::regtype) then
    expression=format('($1->%L)::%s',argument.name,pg_catalog.format_type(argument.type_oid,null));
   elsif argument.typcategory='A' then
    if arguments->argument.name<>'null'::jsonb and jsonb_typeof(arguments->argument.name)<>'array'
    then raise exception 'MANAGEMENT_RPC_ARGUMENT_INVALID';end if;
    expression=format('case when $1->%L=''null''::jsonb then null else array(select jsonb_array_elements_text($1->%L))::%s end',argument.name,argument.name,pg_catalog.format_type(argument.type_oid,null));
   else expression=format('($1->>%L)::%s',argument.name,pg_catalog.format_type(argument.type_oid,null));end if;
   sql_arguments=sql_arguments||format('%I := %s',argument.name,expression);
  end loop;
 end loop;
 if candidates<>1 then raise exception 'MANAGEMENT_RPC_SIGNATURE_INVALID';end if;
 execute format('select to_jsonb(public.%I(%s))',rpc_name,sql_arguments) into result using arguments;
 return result;
end;$$;
revoke all on function public.papa_management_guarded_rpc(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.papa_management_guarded_rpc(text,jsonb,jsonb) to service_role;
commit;
