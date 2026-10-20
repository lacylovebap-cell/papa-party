-- REVIEW CANDIDATE ONLY: not applied to production, no migration history yet.
-- Add one read-only RPC over existing entities/Space/URL metadata, no new table,
-- account model, data repair, writes, triggers, indexes or maintenance operation.
begin;
create function public.papa_public_app_homes(
 query_text text default '',requested_kind text default 'all',page_limit int default 12,page_offset int default 0,
 source_space text default null,source_room text default null,source_kind text default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if query_text is null or length(query_text)>100 or requested_kind is null or requested_kind not in ('all','hall','streamer')
  or page_limit is null or page_limit not between 1 and 12 or page_offset is null or page_offset not between 0 and 6000
  or page_offset%page_limit<>0 then raise exception 'PUBLIC_APP_HOME_QUERY_INVALID';end if;
 if source_kind is null then
  if source_space is not null or source_room is not null then raise exception 'PUBLIC_APP_HOME_SOURCE_INVALID';end if;
 elsif source_kind not in ('hall','streamer') or requested_kind<>source_kind or page_limit<>1 or page_offset<>0
  or source_space is null or length(source_space) not between 1 and 200 or source_space ~ '[[:space:][:cntrl:]]'
  or (source_kind='hall')<>(source_room is null)
  or source_room is not null and (length(source_room) not between 1 and 200 or source_room ~ '[[:space:][:cntrl:]]')
 then raise exception 'PUBLIC_APP_HOME_SOURCE_INVALID';end if;

 -- Match the current public business-page capability guard. Native Spaces are
 -- not public-launchable while their existing data-page guards remain closed.
 -- Widen here only alongside that capability, never by a display-name guess.
 with business_spaces as materialized (
  select s.id,left(s.display_name,200) name,c.layout,c.code
  from public.papa_spaces s left join public.papa_public_route_spaces c on c.space_id=s.id
  where s.status='active' and s.id='space-001'
 ), rooms as materialized (
  select distinct on (m.space_id,room->>'id') m.space_id,room->>'id' id,room->>'slug' slug,
   left(coalesce(nullif(btrim(room->>'display_name'),''),room->>'slug'),200) name,c.layout,c.code,t.code room_code
  from public.papa_v2_entities e cross join lateral jsonb_array_elements(
   case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end
  ) with ordinality entry(room,ordinal)
  join public.papa_space_streamers m on m.streamer_id=room->>'id'
  join business_spaces c on c.id=m.space_id
  left join public.papa_public_route_streamers t on t.space_id=m.space_id and t.streamer_id=m.streamer_id
  where e.kind='meta' and e.id='1' and coalesce(room->'active','true'::jsonb)='true'::jsonb
   and room->>'slug' ~ '^[a-z0-9][a-z0-9-]{0,63}$'
   and length(room->>'id') between 1 and 200 and room->>'id' !~ '[[:space:][:cntrl:]]'
  order by m.space_id,room->>'id',ordinal
 ), homes as materialized (
  select 'hall' kind,s.id space_id,null::text room_id,s.name,s.name space_name,null::text room_slug,
   case when s.code is not null then '/'||s.code else null end canonical_path
  from business_spaces s where s.layout is distinct from 'independent'
  union all
  select 'streamer',r.space_id,r.id,r.name,s.name,r.slug,
   case when r.code is not null and r.room_code is not null then public.papa_public_route_home(r.layout,r.code,r.room_code) else null end
  from rooms r join business_spaces s on s.id=r.space_id
 ), matched as materialized (
  select * from homes h where (requested_kind='all' or h.kind=requested_kind)
   and (source_kind is null or h.kind=source_kind and h.space_id=source_space and h.room_id is not distinct from source_room)
   and (btrim(query_text)='' or position(lower(btrim(query_text)) in lower(h.name||' '||h.space_name||' '||coalesce(h.room_slug,'')))>0)
 ), paging as (
  select count(*) total,greatest(1,ceil(count(*)::numeric/page_limit)::int) total_pages,
   least(page_offset/page_limit+1,greatest(1,ceil(count(*)::numeric/page_limit)::int)) current_page from matched
 ), paged as (
  select * from matched order by kind,name,space_id,coalesce(room_id,'') limit page_limit offset (select (current_page-1)*page_limit from paging)
 )
 select jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object(
  'kind',p.kind,'spaceId',p.space_id,'streamerId',p.room_id,'name',p.name,'spaceName',p.space_name,
  'streamerSlug',p.room_slug,'canonicalPath',p.canonical_path,'active',true,
  'homePath',coalesce(p.canonical_path,case when p.kind='hall' then '/lobby.html' else '/v2.html?streamer='||p.room_slug||'#home' end)
 ) order by p.kind,p.name,p.space_id,coalesce(p.room_id,'')),'[]'::jsonb) from paged p),
 'page',(select current_page from paging),'pageSize',page_limit,'total',(select total from paging),
 'totalPages',(select total_pages from paging)) into result;
 return result;
end $$;
revoke all on function public.papa_public_app_homes(text,text,int,int,text,text,text) from public,anon,authenticated;
grant execute on function public.papa_public_app_homes(text,text,int,int,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
