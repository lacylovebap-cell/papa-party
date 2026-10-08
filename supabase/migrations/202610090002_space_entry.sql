begin;

-- Future custom-domain resolution is explicit and private. This migration
-- registers no hostname and supplies no domain-management or purchase flow.
create table papa_space_hostnames (
 hostname text primary key,
 space_id text not null references papa_spaces(id),
 verified_at timestamptz,
 check(hostname=lower(hostname) and length(hostname) between 1 and 253
  and hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$')
);
alter table papa_space_hostnames enable row level security;
revoke all on papa_space_hostnames from public,anon,authenticated;
grant all on papa_space_hostnames to service_role;

create function papa_account_space_entry(subject uuid,actor_role text,chosen_streamer text,
 requested_slug text default null,requested_hostname text default null,
 page_limit int default 50,page_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare host_scope text;rows_json jsonb;total_count int;membership_count int;
begin
 if page_limit is null or page_offset is null or page_limit not between 1 and 100
  or page_offset not between 0 and 10000 then raise exception 'SPACE_ENTRY_PAGE_INVALID';end if;
 if subject is null or actor_role is null or actor_role not in ('player','streamer_admin','president')
  or not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  or actor_role='streamer_admin' and nullif(btrim(chosen_streamer),'') is null
 then return jsonb_build_object('spaces','[]'::jsonb,'total',0,'hasMore',false,'membershipCount',0);end if;
 if requested_slug is not null and (nullif(btrim(requested_slug),'') is null or length(requested_slug)>100)
 then return jsonb_build_object('spaces','[]'::jsonb,'total',0,'hasMore',false,'membershipCount',0);end if;
 if requested_hostname is not null then
  if length(requested_hostname)>253 then return jsonb_build_object('spaces','[]'::jsonb,'total',0,'hasMore',false,'membershipCount',0);end if;
  select space_id into host_scope from papa_space_hostnames
   where hostname=lower(btrim(requested_hostname)) and verified_at is not null;
  if host_scope is null then return jsonb_build_object('spaces','[]'::jsonb,'total',0,'hasMore',false,'membershipCount',0);end if;
 end if;
 -- Authorize the canonical Account role once per Space before aggregating its
 -- registry destinations. URL/hostname selection is only an additional filter.
 with authorized as materialized (
  select s.id,s.slug,s.display_name from papa_spaces s where s.status='active'
   and papa_device_space_scope_allowed(subject,actor_role,s.id,
    case when actor_role='streamer_admin' then chosen_streamer else null end)
 ), rooms as materialized (
  select scope.space_id,room->>'id' id,coalesce(nullif(room->>'slug',''),room->>'id') slug,
   coalesce(nullif(room->>'display_name',''),room->>'id') name,ordinal
  from papa_v2_entities e cross join lateral jsonb_array_elements(
   case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end)
   with ordinality entry(room,ordinal)
  join papa_space_streamers scope on scope.streamer_id=room->>'id'
  join authorized s on s.id=scope.space_id
  where e.kind='meta' and e.id='1' and coalesce(room->>'active','true')='true'
   and (actor_role<>'streamer_admin' or room->>'id'=chosen_streamer)
 ), summaries as materialized (
  select space_id,count(distinct id)::int room_count,
   (jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name) order by
    case when actor_role<>'streamer_admin' and (id=chosen_streamer or slug=chosen_streamer) then 0 else 1 end,
    ordinal,id)->0) first_room
  from rooms group by space_id
 ), eligible as materialized (
  select s.id,s.slug,s.display_name,r.room_count,r.first_room
  from authorized s join summaries r on r.space_id=s.id
 ), matched as materialized (
  select * from eligible where (requested_slug is null or slug=requested_slug)
   and (requested_hostname is null or id=host_scope)
 ), paged as materialized (
  select * from matched order by slug,id limit page_limit offset page_offset
 )
 select (select count(*)::int from matched),(select count(*)::int from eligible),
  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',display_name,
   'streamerCount',room_count,'streamerId',first_room->>'id','streamerSlug',first_room->>'slug',
   'streamerName',first_room->>'name') order by slug,id),'[]'::jsonb) from paged)
 into total_count,membership_count,rows_json;
 if total_count=0 and (requested_slug is not null or requested_hostname is not null) then membership_count=0;end if;
 return jsonb_build_object('spaces',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count,
  'membershipCount',membership_count);
end $$;
revoke all on function papa_account_space_entry(uuid,text,text,text,text,int,int) from public,anon,authenticated;
grant execute on function papa_account_space_entry(uuid,text,text,text,text,int,int) to service_role;
notify pgrst,'reload schema';
commit;
