begin;

-- Original entity/profile UPDATE triggers continue to own the single audit
-- event. Reduce only these new archive actions before actor/target snapshots;
-- private source bodies and historical audit rows remain untouched.
create function public.papa_player_archive_event_summary() returns trigger
language plpgsql set search_path=public as $$
declare player_name text;
begin
 if new.entity_kind='players' and new.action in ('playerArchive','playerRestore') then
  player_name=coalesce(case when jsonb_typeof(new.after_data->'name')='string' then nullif(new.after_data->>'name','') end,
   case when jsonb_typeof(new.before_data->'name')='string' then nullif(new.before_data->>'name','') end,'玩家');
  new.before_data=jsonb_build_object('playerId',new.entity_id,'name',player_name,
   'archived',coalesce(new.before_data->'archived'='true'::jsonb,false));
  new.after_data=jsonb_build_object('playerId',new.entity_id,'name',player_name,
   'archived',coalesce(new.after_data->'archived'='true'::jsonb,false));
 end if;
 return new;
end $$;
-- PostgreSQL runs equal-kind triggers in name order; archive precedes event.
create trigger papa_archive_event_summary_trigger before insert on public.papa_events
for each row execute function public.papa_player_archive_event_summary();
revoke all on function public.papa_player_archive_event_summary() from public,anon,authenticated,service_role;

create function public.papa_player_archive(requested_space text,requested_player text,
 expected_revision bigint,actor_context jsonb,requested_archived boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare subject uuid;current_revision bigint;source_player jsonb;next_player jsonb;
 previous_archived boolean;previous_context text;action_name text;
begin
 if nullif(requested_player,'') is null or length(requested_player)>200 or requested_archived is null
  or expected_revision is null or expected_revision<0 then raise exception 'PLAYER_ARCHIVE_INPUT_INVALID';end if;
 if requested_space is null or not exists(select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'PLAYER_ARCHIVE_SCOPE_INVALID';end if;
 if jsonb_typeof(actor_context) is distinct from 'object' or actor_context->>'role' is null
  or actor_context->>'role' not in ('president','super_admin','admin')
  or actor_context->>'space_id' is distinct from requested_space or actor_context->>'streamer_id' is not null
  or nullif(actor_context->>'account_id','') is null then raise exception 'PLAYER_ARCHIVE_ACTOR_INVALID';end if;
 begin subject=(actor_context->>'account_id')::uuid;
 exception when invalid_text_representation then raise exception 'PLAYER_ARCHIVE_ACTOR_INVALID';end;
 if not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  or not exists(select 1 from papa_platform_roles where account_id=subject and role='president')
 then raise exception 'PLAYER_ARCHIVE_ACTOR_INVALID';end if;
 -- Share the original global commit lock so pending work cannot race archive.
 select revision into current_revision from papa_v2_revision where id=1 for update;
 if current_revision is distinct from expected_revision then raise exception 'VERSION_CONFLICT' using errcode='40001';end if;
 if requested_space='space-001' then
  select data into source_player from papa_v2_entities
  where kind='players' and id=requested_player and space_id is null for update;
 else
  select data into source_player from papa_space_player_profiles
  where space_id=requested_space and player_id=requested_player for update;
 end if;
 if source_player is null then raise exception 'PLAYER_ARCHIVE_TARGET_INVALID';end if;
 previous_archived=coalesce(source_player->'archived'='true'::jsonb,false);
 if previous_archived=requested_archived then
  return jsonb_build_object('revision',current_revision,'playerId',requested_player,'archived',requested_archived,'changed',false);
 end if;
 if requested_archived and exists(select 1 from papa_v2_entities queue
  where queue.kind='queue' and queue.space_id=requested_space and queue.data->>'playerId'=requested_player
   and queue.data->>'status' in ('pending','waiting')) then raise exception 'PLAYER_ARCHIVE_PENDING_QUEUE';end if;
 next_player=source_player||jsonb_build_object('archived',requested_archived)
  ||case when requested_archived then jsonb_build_object('archiveAt',now(),'archiveBy',subject)
   else jsonb_build_object('restoreAt',now(),'restoreBy',subject) end;
 action_name=case when requested_archived then 'playerArchive' else 'playerRestore' end;
 previous_context=current_setting('papa.actor_context',true);
 perform set_config('papa.actor_context',jsonb_build_object('role','president','account_id',subject,
  'space_id',requested_space,'streamer_id',null,'player_id',null,'action',action_name)::text,true);
 if requested_space='space-001' then
  update papa_v2_entities set data=next_player where kind='players' and id=requested_player and space_id is null;
 else
  update papa_space_player_profiles set data=next_player where space_id=requested_space and player_id=requested_player;
 end if;
 perform set_config('papa.actor_context',coalesce(previous_context,''),true);
 update papa_v2_revision set revision=current_revision+1 where id=1;
 return jsonb_build_object('revision',current_revision+1,'playerId',requested_player,'archived',requested_archived,'changed',true);
end $$;
revoke all on function public.papa_player_archive(text,text,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.papa_player_archive(text,text,bigint,jsonb,boolean) to service_role;

-- Move the original directory query once, adding archive scope before its
-- count/page. Its original credits, search and identity checks stay together.
create function public.papa_player_management_page_v2(
 requested_space text,requested_room text,list_mode text,query_text text default '',
 page_limit integer default 20,page_offset integer default 0,archived_filter boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room_settings jsonb;current_pool text;search_text text;result jsonb;
begin
 if list_mode is null or list_mode not in ('stored','all')
  or query_text is null or char_length(query_text)>100
  or page_limit is null or page_limit<1 or page_limit>50
  or page_offset is null or page_offset<0 or page_offset>10000000 or archived_filter is null
 then raise exception 'PLAYER_MANAGEMENT_PAGE_INVALID';end if;
 if requested_space is null or requested_room is null or not exists(
  select 1 from papa_space_streamers room join papa_spaces space on space.id=room.space_id
  where room.streamer_id=requested_room and room.space_id=requested_space and space.status='active')
 then raise exception 'PLAYER_MANAGEMENT_SCOPE_INVALID';end if;
 select coalesce(data->'streamerSettings'->requested_room,'{}'::jsonb) into room_settings
 from papa_v2_entities where kind='meta' and id='1';
 room_settings=coalesce(room_settings,'{}'::jsonb);
 if jsonb_typeof(room_settings) is distinct from 'object'
  or room_settings ? 'radio_enabled' and jsonb_typeof(room_settings->'radio_enabled') is distinct from 'boolean'
  or room_settings ? 'current_space' and (jsonb_typeof(room_settings->'current_space') is distinct from 'string'
   or room_settings->>'current_space' not in ('shengma','radio'))
  or exists(select 1 from papa_v2_entities ledger
   where ledger.kind='ledger' and ledger.space_id=requested_space and ledger.data->>'streamer_id'=requested_room
    and ledger.data ? 'storage_pool' and ledger.data->'storage_pool'<>'null'::jsonb
    and (jsonb_typeof(ledger.data->'storage_pool') is distinct from 'string'
     or ledger.data->>'storage_pool' not in ('shengma','radio')))
 then raise exception 'PLAYER_MANAGEMENT_POOL_INVALID';end if;
 current_pool=case when room_settings->'radio_enabled'='true'::jsonb
  and room_settings->>'current_space'='radio' then 'radio' else 'shengma' end;
 search_text=lower(btrim(query_text));
 with profiles as (
  select entity.id player_id,entity.data
  from papa_v2_entities entity where requested_space='space-001' and entity.space_id is null and entity.kind='players'
  union all
  select profile.player_id,profile.data
  from papa_space_player_profiles profile
  join papa_accounts account on account.id=profile.account_id and account.disabled_at is null
  join papa_space_memberships membership on membership.id=profile.membership_id
   and membership.account_id=profile.account_id and membership.space_id=profile.space_id
   and membership.role='player' and membership.status='active'
  where requested_space<>'space-001' and profile.space_id=requested_space
 ),credits as (
  select ledger.data->>'playerId' player_id,sum((ledger.data->>'amount')::numeric) stored_credits
  from papa_v2_entities ledger
  where ledger.kind='ledger' and ledger.space_id=requested_space and ledger.data->>'streamer_id'=requested_room
   and coalesce(ledger.data->>'storage_pool','shengma')=current_pool
  group by ledger.data->>'playerId'
 ),matched as (
  select profile.player_id,profile.data,coalesce(credit.stored_credits,0) stored_credits,
   lower(coalesce(profile.data->>'name','')) sort_name
  from profiles profile left join credits credit on credit.player_id=profile.player_id
  where coalesce(profile.data->'archived'='true'::jsonb,false)=archived_filter
   and (list_mode='all' or coalesce(credit.stored_credits,0)>0)
   and (search_text='' or strpos(lower(coalesce(profile.data->>'name','')),search_text)>0
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(profile.data->'ids')='array'
      then profile.data->'ids' else '[]'::jsonb end) alias(value)
     where jsonb_typeof(alias.value)='string' and strpos(lower(alias.value#>>'{}'),search_text)>0)
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(profile.data->'names')='array'
      then profile.data->'names' else '[]'::jsonb end) alias(value)
     where jsonb_typeof(alias.value)='string' and strpos(lower(alias.value#>>'{}'),search_text)>0))
 ),page as (
  select player_id,data,stored_credits,sort_name from matched
  order by sort_name,player_id limit page_limit offset page_offset
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(
   coalesce((select jsonb_object_agg(field.key,field.value) from jsonb_each(page.data) field
    where field.key=any(array['playerId','name','ids','names','certification','test'])
     or field.key in ('archiveAt','restoreAt') and jsonb_typeof(field.value)='string'),'{}'::jsonb)
   ||jsonb_build_object('playerId',page.player_id,'storedCredits',page.stored_credits,
    'archived',coalesce(page.data->'archived'='true'::jsonb,false))
   order by page.sort_name,page.player_id) from page),'[]'::jsonb),
  'total',(select count(1) from matched),'pageLimit',page_limit,'pageOffset',page_offset)
 into result;
 return result;
end $$;
revoke all on function public.papa_player_management_page_v2(text,text,text,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.papa_player_management_page_v2(text,text,text,text,integer,integer,boolean) to service_role;

create or replace function public.papa_player_management_page(
 requested_space text,requested_room text,list_mode text,query_text text default '',
 page_limit integer default 20,page_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public as $$
 select papa_player_management_page_v2(requested_space,requested_room,list_mode,query_text,page_limit,page_offset,false);
$$;
revoke all on function public.papa_player_management_page(text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.papa_player_management_page(text,text,text,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
