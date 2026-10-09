begin;

-- A bounded player directory projection. Credits are grouped only for the
-- selected room and its current pool; no business snapshot or identity bridge.
create function public.papa_player_management_page(
 requested_space text,requested_room text,list_mode text,query_text text default '',
 page_limit integer default 20,page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room_settings jsonb;current_pool text;search_text text;result jsonb;
begin
 if list_mode is null or list_mode not in ('stored','all')
  or query_text is null or char_length(query_text)>100
  or page_limit is null or page_limit<1 or page_limit>50
  or page_offset is null or page_offset<0 or page_offset>10000000
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
  where (list_mode='all' or coalesce(credit.stored_credits,0)>0)
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
    where field.key=any(array['playerId','name','ids','names','certification','test'])),'{}'::jsonb)
   ||jsonb_build_object('playerId',page.player_id,'storedCredits',page.stored_credits)
   order by page.sort_name,page.player_id) from page),'[]'::jsonb),
  'total',(select count(1) from matched),'pageLimit',page_limit,'pageOffset',page_offset)
 into result;
 return result;
end $$;
revoke all on function public.papa_player_management_page(text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.papa_player_management_page(text,text,text,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
