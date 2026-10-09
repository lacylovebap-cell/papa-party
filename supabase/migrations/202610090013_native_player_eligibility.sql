begin;

-- Explicit profile provisioning continues through the original 006 room
-- transaction. This read only lists existing verified bindings to choose; it
-- creates no Account, Membership, profile, permission, or session.
create function public.papa_native_player_eligibility_page(
 requested_space text,actor_context jsonb,query_text text default '',
 page_limit integer default 20,page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare subject uuid;rows_json jsonb;total_count bigint;
begin
 if requested_space is null or requested_space='space-001'
  or not exists(select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'PLAYER_ELIGIBILITY_SCOPE_INVALID';end if;
 if jsonb_typeof(actor_context) is distinct from 'object'
  or jsonb_typeof(actor_context->'account_id') is distinct from 'string'
  or jsonb_typeof(actor_context->'role') is distinct from 'string'
  or actor_context->>'role' not in ('super_admin','president')
  or jsonb_typeof(actor_context->'space_id') is distinct from 'string'
  or actor_context->>'space_id' is distinct from requested_space
 then raise exception 'PLAYER_ELIGIBILITY_ACTOR_INVALID';end if;
 begin subject=(actor_context->>'account_id')::uuid;
 exception when invalid_text_representation then raise exception 'PLAYER_ELIGIBILITY_ACTOR_INVALID';end;
 -- Match the existing President registry guard; caller-supplied role labels
 -- and any ambient actor GUC provide no additional authority.
 if subject is null or not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  or not exists(select 1 from papa_platform_roles where account_id=subject and role='president')
  or not exists(select 1 from papa_manager_account_links where account_id=subject and manager_key='president')
 then raise exception 'PLAYER_ELIGIBILITY_ACTOR_INVALID';end if;
 if query_text is null or length(query_text)>100 or page_limit is null or page_limit not between 1 and 50
  or page_offset is null or page_offset not between 0 and 10000000
 then raise exception 'PLAYER_ELIGIBILITY_PAGE_INVALID';end if;

 with eligible as materialized (
  select a.id account_id,m.id membership_id,m.space_id,m.role,m.status,m.created_at,
   coalesce(case when jsonb_typeof(legacy.data->'name')='string'
    then nullif(left(btrim(legacy.data->>'name'),200),'') end,
    '已驗證玩家 '||left(a.id::text,8)) display_label
  from papa_space_memberships m join papa_accounts a on a.id=m.account_id and a.disabled_at is null
  left join papa_account_legacy_players binding on binding.account_id=a.id
  left join papa_v2_entities legacy on legacy.kind='players' and legacy.id=binding.legacy_player_id
   and legacy.space_id is null
  where m.space_id=requested_space and m.role='player' and m.status='active' and m.streamer_id is null
   and not exists(select 1 from papa_space_player_profiles profile
    where profile.space_id=requested_space and profile.account_id=a.id)
 ), matched as materialized (
  select account_id,membership_id,space_id,role,status,created_at,display_label from eligible
  where query_text='' or strpos(lower(display_label),lower(query_text))>0
   or strpos(account_id::text,lower(query_text))>0 or strpos(membership_id::text,lower(query_text))>0
 ), paged as materialized (
  select account_id,membership_id,space_id,role,status,created_at,display_label from matched
  order by lower(display_label),account_id,membership_id limit page_limit offset page_offset
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'membershipId',membership_id,
   'spaceId',space_id,'role',role,'status',status,'createdAt',created_at,'displayLabel',display_label)
   order by lower(display_label),account_id,membership_id),'[]'::jsonb) from paged)
 into total_count,rows_json;
 return jsonb_build_object('revision',(select revision from papa_v2_revision where id=1),
  'rows',rows_json,'total',total_count,'pageLimit',page_limit,'pageOffset',page_offset);
end $$;

revoke all on function public.papa_native_player_eligibility_page(text,jsonb,text,integer,integer)
 from public,anon,authenticated;
grant execute on function public.papa_native_player_eligibility_page(text,jsonb,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
