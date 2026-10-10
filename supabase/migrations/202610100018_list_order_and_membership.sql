begin;
-- Additive list APIs retain existing deployed signatures and projections.
-- Recorded creation timestamps only: missing/invalid dates sort last by ID.
create function public.papa_list_record_created(data jsonb) returns timestamptz
language plpgsql immutable set search_path=public as $$
declare value text;result timestamptz;
begin
 foreach value in array array[data->>'created_at',data->>'createdAt'] loop
  if value is not null and value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then
   begin result=value::timestamptz;return result;exception when others then null;end;
  end if;
 end loop;
 return null;
end $$;
create function public.papa_list_song_new(data jsonb) returns boolean
language sql immutable set search_path=public as $$
 select coalesce(data->'new'='true'::jsonb,false) or
  (case when jsonb_typeof(data->'tags')='array' then data->'tags' else '[]'::jsonb end) ? '新練';
$$;


create function public.papa_player_management_page_v3(
 requested_space text,requested_room text,list_mode text,query_text text default '',
 page_limit integer default 20,page_offset integer default 0,archived_filter boolean default false,sort_order text default 'default')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room_settings jsonb;current_pool text;search_text text;result jsonb;
begin
 if list_mode is null or list_mode not in ('stored','all')
  or query_text is null or char_length(query_text)>100
  or page_limit is null or page_limit<1 or page_limit>50
  or page_offset is null or page_offset<0 or page_offset>10000000 or archived_filter is null or sort_order is null or sort_order not in ('default','newest','oldest')
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
   lower(coalesce(profile.data->>'name','')) sort_name,papa_list_record_created(profile.data) sort_date
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
  select player_id,data,stored_credits,sort_name,row_number() over(order by case when sort_order='default' then sort_name end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,player_id) page_order from matched
  order by case when sort_order='default' then sort_name end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,player_id limit page_limit offset page_offset
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(
   coalesce((select jsonb_object_agg(field.key,field.value) from jsonb_each(page.data) field
    where field.key=any(array['playerId','name','ids','names','certification','test'])
     or field.key in ('archiveAt','restoreAt') and jsonb_typeof(field.value)='string'),'{}'::jsonb)
   ||jsonb_build_object('playerId',page.player_id,'storedCredits',page.stored_credits,
    'archived',coalesce(page.data->'archived'='true'::jsonb,false))
   order by page.page_order) from page),'[]'::jsonb),
  'total',(select count(1) from matched),'pageLimit',page_limit,'pageOffset',page_offset)
 into result;
 return result;
end $$;

create function public.papa_song_search_room_v4(room_id text,query_text text default '',tags text[] default '{}',
 page_limit int default 30,page_offset int default 0,language_name text default null,
 visibility text default 'visible',catalog_status text default 'all',requested_space text default null,sort_order text default 'default',tag_match text default 'any') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare words text[];anchor text;pattern text;n int;ids jsonb;canonical_space text;
begin
 if coalesce(room_id,'')='' or length(coalesce(query_text,''))>120 or page_limit is null or
  page_offset is null or page_limit<1 or page_limit>50 or page_offset<0 or page_offset>10000 or
  coalesce(array_length(tags,1),0)>30 or length(coalesce(language_name,''))>120 then
  raise exception 'CATALOG_SEARCH_LIMIT';end if;
 if visibility is null or visibility not in ('all','visible','hidden') or
  catalog_status is null or catalog_status not in ('all','linked','unlinked','pending') or
  sort_order is null or sort_order not in ('default','newest','oldest') or
  tag_match is null or tag_match not in ('any','all') or
  exists(select 1 from unnest(tags) tag where tag is null or length(tag)>50) then
  raise exception 'CATALOG_SEARCH_FILTER_INVALID';end if;
 select scope.space_id into canonical_space
 from papa_space_streamers scope join papa_spaces space on space.id=scope.space_id and space.status='active'
 join papa_v2_entities meta on meta.kind='meta' and meta.id='1'
 cross join lateral jsonb_array_elements(coalesce(meta.data->'streamers','[]'::jsonb)) room
 where scope.streamer_id=room_id and room->>'id'=room_id and coalesce((room->>'active')::boolean,true);
 if canonical_space is null then raise exception 'CATALOG_ROOM_MISSING';end if;
 if requested_space is not null and requested_space<>canonical_space then raise exception 'CATALOG_SCOPE_INVALID';end if;
 words=regexp_split_to_array(lower(trim(coalesce(query_text,''))),'[[:space:]　]+');
 anchor=papa_catalog_search_anchor(lower(trim(coalesce(query_text,''))));
 pattern=papa_catalog_search_pattern(anchor);
 with source_hits as materialized (
  -- Retain the original selective source predicate before room filtering so
  -- the expression GIN index can avoid reading every legacy lyric in a room.
  select e.id,e.space_id,e.data->>'streamer_id' as streamer_id from papa_v2_entities e
   where anchor is not null and e.kind='songs'
    and papa_song_search_source(e.data) like pattern escape E'\\'
 ),candidate_ids as materialized (
  select e.id from papa_v2_entities e
   where anchor is null and e.kind='songs' and e.space_id=canonical_space and e.data->>'streamer_id'=room_id
  union
  select e.id from papa_v2_entities e where anchor is not null and '新練' like pattern escape E'\\'
   and e.kind='songs' and e.space_id=canonical_space and e.data->>'streamer_id'=room_id and papa_list_song_new(e.data)
  union
  select id from source_hits where space_id=canonical_space and streamer_id=room_id
  union
  select sl.song_id from papa_catalog_variants v join papa_catalog_song_links sl on sl.variant_id=v.id
   where anchor is not null and v.active and sl.streamer_id=room_id and
    lower(v.title||' '||v.artist||' '||v.version_label||' '||v.language_text||' '||v.performer_type_text)
     like pattern escape E'\\'
  union
  select sl.song_id from papa_catalog_languages l join papa_catalog_variants v on v.language_id=l.id and v.active
   join papa_catalog_song_links sl on sl.variant_id=v.id
   where anchor is not null and sl.streamer_id=room_id and lower(l.name) like pattern escape E'\\'
  union
  select sl.song_id from papa_catalog_performer_types p join papa_catalog_variants v on v.performer_type_id=p.id and v.active
   join papa_catalog_song_links sl on sl.variant_id=v.id
   where anchor is not null and sl.streamer_id=room_id and lower(p.name) like pattern escape E'\\'
  union
  select ls.song_id from papa_catalog_lyric_selections ls
   where anchor is not null and ls.streamer_id=room_id and ls.mode in ('copy','own')
    and lower(ls.body) like pattern escape E'\\'
  union
  select sl.song_id from papa_catalog_lyric_revisions lr join papa_catalog_song_links sl on sl.variant_id=lr.variant_id
   where anchor is not null and lr.active and sl.streamer_id=room_id and lower(lr.body) like pattern escape E'\\'
 ),matched as materialized (
  select e.id,case when e.data->>'_order'~'^[0-9]{1,9}$' then (e.data->>'_order')::int else 0 end as song_order,papa_list_record_created(e.data) sort_date
  from candidate_ids c join papa_v2_entities e on e.kind='songs' and e.id=c.id
   and e.space_id=canonical_space and e.data->>'streamer_id'=room_id
  left join papa_catalog_song_links sl on sl.streamer_id=room_id and sl.song_id=e.id
  left join papa_catalog_variants v on v.id=sl.variant_id and v.active
   and sl.source_hash=papa_catalog_source_hash(e.data)
   and exists(select 1 from papa_catalog_families f where f.id=v.family_id and f.active)
  left join papa_catalog_candidates candidate on candidate.streamer_id=room_id and candidate.song_id=e.id
   and candidate.source_hash=papa_catalog_source_hash(e.data)
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  left join papa_catalog_lyric_selections ls on ls.streamer_id=room_id and ls.song_id=e.id
  left join papa_catalog_lyric_revisions lr on lr.variant_id=v.id and lr.active
  where (visibility='all' or visibility='hidden' and coalesce((e.data->>'hidden')::boolean,false)
    or visibility='visible' and not coalesce((e.data->>'hidden')::boolean,false))
   and (catalog_status='all' or catalog_status=case when v.id is not null then 'linked'
    when candidate.status='pending' then 'pending' else 'unlinked' end)
   and (coalesce(language_name,'')='' or coalesce(l.name,v.language_text,e.data->>'cat','')=language_name)
   and (coalesce(array_length(tags,1),0)=0 or
    tag_match='all' and not exists(select 1 from unnest(tags) tag where not
     (case when tag='新練' then papa_list_song_new(e.data) else
      (case when jsonb_typeof(e.data->'tags')='array' then e.data->'tags' else '[]'::jsonb end) ? tag end)) or
    tag_match='any' and exists(select 1 from unnest(tags) tag where
     case when tag='新練' then papa_list_song_new(e.data) else
      (case when jsonb_typeof(e.data->'tags')='array' then e.data->'tags' else '[]'::jsonb end) ? tag end))
   and not exists(select 1 from unnest(words) word where word<>'' and
    lower(concat_ws(' ',coalesce(v.title,e.data->>'title'),coalesce(v.artist,e.data->>'artist'),
     coalesce(l.name,v.language_text,e.data->>'cat'),coalesce(p.name,v.performer_type_text,e.data->>'artistType'),e.data->>'murmur',e.data->>'tags',case when papa_list_song_new(e.data) then '新練' end,
     coalesce(case when ls.mode in ('copy','own') then ls.body
      when v.id is not null then lr.body end,e.data->>'lyrics','')))
      not like papa_catalog_search_pattern(word) escape E'\\')
 )
 select (select count(1) from matched),
  (select coalesce(jsonb_agg(page_rows.id order by page_rows.page_order),'[]'::jsonb)
   from (select id,row_number() over(order by case when sort_order='default' then song_order end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id) page_order from matched
    order by case when sort_order='default' then song_order end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id limit page_limit offset page_offset) page_rows)
 into n,ids;
 return jsonb_build_object('songIds',ids,'total',n,'hasMore',page_offset+page_limit<n);
end $$;


-- One grouped relationship scan: scoped room membership is applied before
-- count/page. Stale links, other Spaces and inactive rooms cannot mark Added.
create function public.papa_list_catalog_scope(requested_space text,viewer_room text,membership_filter text) returns void
language plpgsql stable security definer set search_path=public as $$
begin
 if requested_space is not null and not exists(select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
 if membership_filter is null or membership_filter not in ('all','added','missing') then raise exception 'CATALOG_MEMBERSHIP_INVALID';end if;
 if membership_filter<>'all' and viewer_room is null then raise exception 'CATALOG_MEMBERSHIP_ROOM_REQUIRED';end if;
 if viewer_room is not null and not exists(
  select 1 from papa_space_streamers scope join papa_spaces space on space.id=scope.space_id and space.status='active'
  join papa_v2_entities meta on meta.kind='meta' and meta.id='1'
  cross join lateral jsonb_array_elements(coalesce(meta.data->'streamers','[]'::jsonb)) room
  where scope.streamer_id=viewer_room and room->>'id'=viewer_room and coalesce((room->>'active')::boolean,true)
   and (requested_space is null or scope.space_id=requested_space))
 then raise exception 'CATALOG_SCOPE_INVALID';end if;
end $$;

create function public.papa_list_catalog_members(viewer_room text,requested_space text)
returns table(variant_id uuid,streamer_count int,already_added boolean)
language sql stable security definer set search_path=public as $$
 with rooms as materialized (
  select room->>'id' id,scope.space_id from papa_v2_entities meta
  cross join lateral jsonb_array_elements(coalesce(meta.data->'streamers','[]'::jsonb)) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id'
   and (requested_space is null or scope.space_id=requested_space)
  join papa_spaces space on space.id=scope.space_id and space.status='active'
  where meta.kind='meta' and meta.id='1' and coalesce((room->>'active')::boolean,true)
 )
 select sl.variant_id,count(distinct sl.streamer_id)::int,bool_or(sl.streamer_id=viewer_room)
 from papa_catalog_song_links sl join rooms r on r.id=sl.streamer_id
 join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id and e.space_id=r.space_id
  and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
 group by sl.variant_id;
$$;

create function public.papa_catalog_search_filtered_v2(query_text text default '',page_limit int default 30,
 page_offset int default 0,room_id text default null,language_filter text default null,performer_filter text default null,search_mode text default 'metadata',requested_space text default 'space-001',
 membership_filter text default 'all',sort_order text default 'default',version_filter text default '',version_label_filter text default '') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare q text=lower(trim(coalesce(query_text,''))); anchor text; pattern text;
 phrase_pattern text; n int; rows_json jsonb;options_json jsonb;
begin
 if page_limit is null or page_offset is null or page_limit<1 or page_limit>50 or
  page_offset<0 or page_offset>10000 or length(q)>120 or coalesce(search_mode,'') not in ('metadata','lyrics') then
  raise exception 'CATALOG_PAGE_LIMIT';end if;
 if sort_order is null or sort_order not in ('default','newest','oldest') or
  greatest(length(coalesce(language_filter,'')),length(coalesce(performer_filter,'')),length(coalesce(version_filter,'')),length(coalesce(version_label_filter,'')))>120
 then raise exception 'CATALOG_SEARCH_FILTER_INVALID';end if;
 perform papa_list_catalog_scope(requested_space,room_id,membership_filter);
 anchor=papa_catalog_search_anchor(q);
 pattern=papa_catalog_search_pattern(anchor);
 phrase_pattern=papa_catalog_search_pattern(q);
 with members as materialized (select * from papa_list_catalog_members(room_id,requested_space)),
 facets as materialized (
  select v.version_kind,v.version_label from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active where v.active
 ),candidate_ids as materialized (
  select v.id from papa_catalog_variants v where anchor is null and v.active
  union
  select v.id from papa_catalog_variants v where anchor is not null and v.active and
   lower(v.title||' '||v.artist||' '||v.version_label||' '||v.language_text||' '||v.performer_type_text)
    like pattern escape E'\\'
  union
  select v.id from papa_catalog_languages l join papa_catalog_variants v on v.language_id=l.id
   where anchor is not null and v.active and lower(l.name) like pattern escape E'\\'
  union
  select v.id from papa_catalog_performer_types p join papa_catalog_variants v on v.performer_type_id=p.id
   where anchor is not null and v.active and lower(p.name) like pattern escape E'\\'
  union
  select v.id from papa_catalog_lyric_revisions lr join papa_catalog_variants v on v.id=lr.variant_id
   where search_mode='lyrics' and anchor is not null and lr.active and v.active
    and lower(lr.body) like pattern escape E'\\'
 ), matched as materialized (
  select v.id,v.title,v.artist,v.created_at sort_date from candidate_ids c
  join papa_catalog_variants v on v.id=c.id and v.active
  join papa_catalog_families f on f.id=v.family_id and f.active
  left join members member on member.variant_id=v.id
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  where (coalesce(language_filter,'')='' or coalesce(l.name,v.language_text)=language_filter)
   and (coalesce(performer_filter,'')='' or coalesce(p.name,v.performer_type_text)=performer_filter)
   and (coalesce(version_filter,'')='' or v.version_kind=version_filter)
   and (coalesce(version_label_filter,'')='' or v.version_label=version_label_filter)
   and (membership_filter='all' or coalesce(member.already_added,false)=(membership_filter='added'))
   and ((search_mode='lyrics' and exists(select 1 from papa_catalog_lyric_revisions lr
      where lr.variant_id=v.id and lr.active and lower(lr.body) like phrase_pattern escape E'\\'))
    or (search_mode='metadata' and (q='' or lower(concat_ws(' ',v.title,v.artist,v.version_label,
     coalesce(l.name,v.language_text),coalesce(p.name,v.performer_type_text))) like phrase_pattern escape E'\\')))
 ), current_page as materialized (
  select id,title,artist,row_number() over(order by case when sort_order='default' then title end,case when sort_order='default' then artist end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id) page_order from matched
  order by case when sort_order='default' then title end,case when sort_order='default' then artist end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id limit page_limit offset page_offset
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg((to_jsonb(page_rows)-'page_order') order by page_rows.page_order),'[]'::jsonb)
   from (
    select page.page_order,v.id,v.family_id as "familyId",v.title,v.artist,v.language_id as "languageId",v.updated_at as "updatedAt",v.created_at as "createdAt",
     coalesce(l.name,v.language_text) as language,v.performer_type_id as "performerTypeId",
     coalesce(p.name,v.performer_type_text) as "performerType",v.version_label as "versionLabel",
     v.version_kind as "versionKind",v.performer_detail as "performerDetail",v.version_note as "versionNote",
     coalesce(member.already_added,false) as "alreadyAdded"
    from current_page page join papa_catalog_variants v on v.id=page.id
    left join members member on member.variant_id=v.id
    left join papa_catalog_languages l on l.id=v.language_id
    left join papa_catalog_performer_types p on p.id=v.performer_type_id
   ) page_rows),
  jsonb_build_object('versionKinds',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct version_kind x from facets where version_kind<>'') k),
   'versionLabels',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct version_label x from facets where version_label<>'') k))
 into n,rows_json,options_json;
 return jsonb_build_object('rows',rows_json,'total',n,'hasMore',page_offset+page_limit<n,'filters',options_json);
end $$;


create function public.papa_catalog_families_page_v4_in_space(query_text text default '',lyrics_filter text default 'all',
 page_limit int default 20,page_offset int default 0,language_filter text default '',
 version_filter text default '',viewer_room text default null,requested_space text default 'space-001',
 membership_filter text default 'all',sort_order text default 'default',version_label_filter text default '')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;options_json jsonb;
begin
 if requested_space is not null and not exists(
  select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
 if page_limit is null or page_offset is null or page_limit not between 1 and 50 or page_offset not between 0 and 10000
  or greatest(length(coalesce(query_text,'')),length(coalesce(language_filter,'')),length(coalesce(version_filter,'')))>100
  or coalesce(lyrics_filter,'') not in ('all','with','without','proposals')
 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 if sort_order is null or sort_order not in ('default','newest','oldest') or length(coalesce(version_label_filter,''))>120
 then raise exception 'CATALOG_SEARCH_FILTER_INVALID';end if;
 perform papa_list_catalog_scope(requested_space,viewer_room,membership_filter);
 with rooms as materialized (
  select r->>'id' id,scope.space_id from papa_v2_entities m
  cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) r
  join papa_space_streamers scope on scope.streamer_id=r->>'id'
   and (requested_space is null or scope.space_id=requested_space)
  join papa_spaces space on space.id=scope.space_id and space.status='active'
  where m.kind='meta' and m.id='1' and coalesce((r->>'active')::boolean,true)
 ), proposal_counts as materialized (
  select lp.variant_id,count(*)::int n from papa_catalog_lyric_proposals lp
  join rooms r on r.id=lp.streamer_id
  join papa_catalog_lyric_selections ls on ls.streamer_id=lp.streamer_id and ls.song_id=lp.song_id
   and ls.variant_id=lp.variant_id and ls.mode in ('copy','own') and trim(coalesce(ls.body,''))<>''
  join papa_catalog_song_links sl on sl.streamer_id=lp.streamer_id and sl.song_id=lp.song_id and sl.variant_id=lp.variant_id
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id and e.space_id=r.space_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
  where lp.status='pending' group by lp.variant_id
 ), members_all as materialized (select * from papa_list_catalog_members(viewer_room,requested_space)),base as materialized (
  select v.id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,v.performer_detail,v.version_note,
   v.language_id,v.performer_type_id,v.updated_at,v.created_at sort_date,coalesce(l.name,v.language_text,'') language,
   coalesce(p.name,v.performer_type_text,'') performer_type,
   exists(select 1 from papa_catalog_lyric_revisions lr where lr.variant_id=v.id and lr.active and trim(lr.body)<>'') has_lyrics,
   coalesce(pc.n,0) proposal_count,coalesce(member.streamer_count,0) n,coalesce(member.already_added,false) already_added
  from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  left join proposal_counts pc on pc.variant_id=v.id
  left join members_all member on member.variant_id=v.id where v.active
 ), matching as materialized (
  select b.id,b.family_id,b.title,b.artist,b.version_label,b.version_kind,b.performer_detail,b.version_note,
   b.language_id,b.performer_type_id,b.updated_at,b.sort_date,b.language,b.performer_type,b.has_lyrics,b.proposal_count,b.n,b.already_added
  from base b where (coalesce(query_text,'')='' or position(lower(query_text) in lower(b.title||' '||b.artist||' '||b.version_label))>0)
   and (coalesce(language_filter,'')='' or b.language=language_filter)
   and (coalesce(version_filter,'')='' or b.version_kind=version_filter)
   and (coalesce(version_label_filter,'')='' or b.version_label=version_label_filter)
   and (membership_filter='all' or b.already_added=(membership_filter='added'))
   and (lyrics_filter='all' or lyrics_filter='proposals' and b.proposal_count>0 or
    lyrics_filter in ('with','without') and b.has_lyrics=(lyrics_filter='with'))
 ), families as materialized (
  select distinct f.id,f.title,f.created_at sort_date from papa_catalog_families f join matching v on v.family_id=f.id
 ), paged as materialized (
  select id,title,sort_date,row_number() over(order by case when sort_order='default' then title end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id) page_order from families
  order by case when sort_order='default' then title end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id limit page_limit offset page_offset
 )
 select (select count(*) from families),
  (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'variants',
   coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'variantId',v.id,'familyId',v.family_id,
    'title',v.title,'artist',v.artist,'versionLabel',v.version_label,'versionKind',v.version_kind,
    'performerDetail',v.performer_detail,'versionNote',v.version_note,'language',v.language,
    'languageId',v.language_id,'performerType',v.performer_type,'performerTypeId',v.performer_type_id,
    'updatedAt',v.updated_at,'variantUpdatedAt',v.updated_at,'createdAt',v.sort_date,'streamerCount',v.n,
    'alreadyAdded',v.already_added,'hasSharedLyrics',v.has_lyrics,'lyricProposalCount',v.proposal_count)
    order by case when sort_order='default' then v.version_label end,case when sort_order='newest' then v.sort_date end desc nulls last,case when sort_order='oldest' then v.sort_date end asc nulls last,v.id) from matching v where v.family_id=f.id),'[]'::jsonb))
   order by f.page_order),'[]'::jsonb) from paged f),
  jsonb_build_object('languages',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from
    (select distinct language x from base where language<>'') l),
   'versionKinds',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from
    (select distinct version_kind x from base where version_kind<>'') k),
   'versionLabels',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from
    (select distinct version_label x from base where version_label<>'') k))
 into total_count,rows_json,options_json;
 return jsonb_build_object('rows',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count,'filters',options_json);
end $$;

create function public.papa_catalog_public_page_filtered_v2_in_space(query_text text default '',
 language_filter text default '',performer_filter text default '',version_filter text default '',
 page_limit int default 12,page_offset int default 0,requested_space text default 'space-001',sort_order text default 'default',version_label_filter text default '')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;total_count int;options_json jsonb;
begin
 if requested_space is null or not exists(
  select 1 from papa_spaces where id=requested_space and status='active')
 then raise exception 'CATALOG_SPACE_INVALID';end if;
 if page_limit is null or page_offset is null or page_limit not between 1 and 20 or page_offset not between 0 and 10000
  or greatest(length(coalesce(query_text,'')),length(coalesce(language_filter,'')),
   length(coalesce(performer_filter,'')),length(coalesce(version_filter,'')))>100
 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 if sort_order is null or sort_order not in ('default','newest','oldest') or length(coalesce(version_label_filter,''))>120
 then raise exception 'CATALOG_SEARCH_FILTER_INVALID';end if;
 with rooms as materialized (
  select room->>'id' id,room->>'slug' slug,room->>'display_name' name,scope.space_id
  from papa_v2_entities m cross join lateral jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  join papa_space_streamers scope on scope.streamer_id=room->>'id' and scope.space_id=requested_space
  where m.kind='meta' and m.id='1' and coalesce((room->>'active')::boolean,true)
 ), visible as materialized (
  select v.id variant_id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,v.created_at variant_date,
   coalesce(l.name,v.language_text,'') language,coalesce(p.name,v.performer_type_text,'') performer_type,
   r.id streamer_id,r.slug,r.name,sl.song_id
  from papa_catalog_song_links sl join rooms r on r.id=sl.streamer_id
  join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id and e.space_id=r.space_id
   and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
   and coalesce((e.data->>'hidden')::boolean,false)=false
  join papa_catalog_variants v on v.id=sl.variant_id and v.active
  join papa_catalog_families f on f.id=v.family_id and f.active
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
 ), filtered as materialized (
  select v.variant_id,v.family_id,v.title,v.artist,v.version_label,v.version_kind,v.language,
   v.performer_type,v.streamer_id,v.slug,v.name,v.song_id,v.variant_date from visible v where
   (coalesce(language_filter,'')='' or v.language=language_filter)
   and (coalesce(performer_filter,'')='' or v.performer_type=performer_filter)
   and (coalesce(version_filter,'')='' or v.version_kind=version_filter)
   and (coalesce(version_label_filter,'')='' or v.version_label=version_label_filter)
   and (coalesce(query_text,'')='' or position(lower(query_text) in lower(v.title||' '||v.artist))>0)
 ), matched as materialized (
  select distinct f.id,f.title,f.created_at sort_date from papa_catalog_families f join filtered v on v.family_id=f.id
 ), paged as materialized (
  select id,title,sort_date,row_number() over(order by case when sort_order='default' then title end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id) page_order from matched
  order by case when sort_order='default' then title end,case when sort_order='newest' then sort_date end desc nulls last,case when sort_order='oldest' then sort_date end asc nulls last,id limit page_limit offset page_offset
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(jsonb_build_object('familyId',f.id,'title',f.title,
   'variants',coalesce((select jsonb_agg(jsonb_build_object('variantId',v.variant_id,
    'title',v.title,'artist',v.artist,'versionLabel',v.version_label,'versionKind',v.version_kind,
    'language',v.language,'performerType',v.performer_type,'createdAt',v.variant_date,'streamers',v.rooms)
    order by case when sort_order='default' then v.version_label end,case when sort_order='newest' then v.variant_date end desc nulls last,case when sort_order='oldest' then v.variant_date end asc nulls last,v.variant_id)
    from (select distinct vv.variant_id,vv.title,vv.artist,vv.version_label,vv.version_kind,vv.language,vv.performer_type,vv.variant_date,
     (select coalesce(jsonb_agg(jsonb_build_object('streamerId',x.streamer_id,'name',x.name,'slug',x.slug,'songId',x.song_id)
       order by x.name,x.song_id),'[]'::jsonb)
      from (select distinct on (s.streamer_id) s.streamer_id,s.name,s.slug,s.song_id
       from filtered s where s.variant_id=vv.variant_id order by s.streamer_id,s.song_id) x) rooms
     from filtered vv where vv.family_id=f.id) v),'[]'::jsonb)) order by f.page_order),'[]'::jsonb) from paged f),
  jsonb_build_object(
   'languages',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct language x from visible where language<>'') a),
   'performerTypes',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct performer_type x from visible where performer_type<>'') a),
   'versionKinds',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct version_kind x from visible where version_kind<>'') a),
   'versionLabels',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct version_label x from visible where version_label<>'') a))
 into total_count,rows_json,options_json;
 return jsonb_build_object('rows',rows_json,'total',total_count,'hasMore',page_offset+page_limit<total_count,'filters',options_json);
end $$;


revoke all on function public.papa_list_record_created(jsonb),public.papa_list_song_new(jsonb),
 public.papa_list_catalog_scope(text,text,text),public.papa_list_catalog_members(text,text),
 public.papa_player_management_page_v3(text,text,text,text,integer,integer,boolean,text),
 public.papa_song_search_room_v4(text,text,text[],int,int,text,text,text,text,text,text),
 public.papa_catalog_search_filtered_v2(text,int,int,text,text,text,text,text,text,text,text,text),
 public.papa_catalog_families_page_v4_in_space(text,text,int,int,text,text,text,text,text,text,text),
 public.papa_catalog_public_page_filtered_v2_in_space(text,text,text,text,int,int,text,text,text)
 from public,anon,authenticated;
grant execute on function public.papa_list_record_created(jsonb),public.papa_list_song_new(jsonb),
 public.papa_list_catalog_scope(text,text,text),public.papa_list_catalog_members(text,text),
 public.papa_player_management_page_v3(text,text,text,text,integer,integer,boolean,text),
 public.papa_song_search_room_v4(text,text,text[],int,int,text,text,text,text,text,text),
 public.papa_catalog_search_filtered_v2(text,int,int,text,text,text,text,text,text,text,text,text),
 public.papa_catalog_families_page_v4_in_space(text,text,int,int,text,text,text,text,text,text,text),
 public.papa_catalog_public_page_filtered_v2_in_space(text,text,text,text,int,int,text,text,text)
 to service_role;
notify pgrst,'reload schema';
commit;
