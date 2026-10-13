begin;
-- Projection only: preserve original version labels, IDs, links and business data.
create function public.papa_catalog_version_category(kind text,label text default null)
returns text language sql immutable set search_path=pg_catalog,public as $$
 select case (case when regexp_replace(lower(coalesce(label,'')), '[[:space:]_-]','','g') in ('original','原版','原唱','原唱版','cover','翻唱','翻唱版','dj','dj版','live','live版','現場','現場版','现场版','remix','adaptation','adapted','改編','改編版','改编版') then regexp_replace(lower(label), '[[:space:]_-]','','g') else regexp_replace(lower(coalesce(kind,'')), '[[:space:]_-]','','g') end)
 when 'original' then 'original' when '原版' then 'original' when '原唱' then 'original' when '原唱版' then 'original'
 when 'cover' then 'cover' when '翻唱' then 'cover' when '翻唱版' then 'cover'
 when 'dj' then 'dj' when 'dj版' then 'dj'
 when 'live' then 'live' when 'live版' then 'live' when '現場' then 'live' when '現場版' then 'live' when '现场版' then 'live'
 when 'remix' then 'remix' when 'adaptation' then 'remix' when 'adapted' then 'remix' when '改編' then 'remix' when '改編版' then 'remix' when '改编版' then 'remix'
 else 'other' end;
$$;
revoke all on function public.papa_catalog_version_category(text,text) from public,anon,authenticated,service_role;

-- Modify only the version predicate in the existing scoped/paginated searches.
-- Abort on an unexpected function definition instead of replacing its guards.
do $$declare target record;definition text;changed text;needle text;
begin
 for target in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('papa_catalog_search_filtered_v2','papa_catalog_families_page_v4_in_space','papa_catalog_public_page_filtered_v2_in_space') loop
  definition=pg_get_functiondef(target.oid);
  needle=case when target.proname='papa_catalog_families_page_v4_in_space' then 'b.version_kind=version_filter' else 'v.version_kind=version_filter' end;
  if position(needle in definition)=0 then raise exception 'VERSION_FILTER_DEFINITION_CHANGED: %',target.proname;end if;
  changed=replace(definition,needle,case when target.proname='papa_catalog_families_page_v4_in_space'
   then 'public.papa_catalog_version_category(b.version_kind,b.version_label)=public.papa_catalog_version_category(version_filter,null)'
   else 'public.papa_catalog_version_category(v.version_kind,v.version_label)=public.papa_catalog_version_category(version_filter,null)' end);
  execute changed;
 end loop;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('papa_catalog_search_filtered_v2','papa_catalog_families_page_v4_in_space','papa_catalog_public_page_filtered_v2_in_space'))<>3 then raise exception 'VERSION_FILTER_FUNCTION_MISSING';end if;
end $$;

-- An on-demand count returns one integer. The Edge caches it for 60 seconds;
-- history rows remain bounded at 50, with the existing actor/scope guards.
create function public.papa_event_total(room_id text,include_global boolean default false)
returns bigint language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result bigint;
begin
 if nullif(room_id,'') is null or include_global is null then raise exception 'EVENT_SCOPE_INVALID';end if;
 if include_global then select count(*) into result from papa_events;
 else select count(*) into result from papa_events e where e.streamer_id=room_id and e.entity_kind not in ('players','meta','shared_catalog');end if;
 return result;
end $$;
revoke all on function public.papa_event_total(text,boolean) from public,anon,authenticated;
grant execute on function public.papa_event_total(text,boolean) to service_role;
do $$declare definition text;changed text;
begin
 definition=pg_get_functiondef('public.papa_event_page_v2(text,int,boolean,text,int,int)'::regprocedure);
 if position('page_number not between 0 and 200' in definition)=0 or position('coalesce(page_offset,0) not between 0 and 10000' in definition)=0 then raise exception 'EVENT_PAGE_DEFINITION_CHANGED';end if;
 changed=replace(replace(definition,'page_number not between 0 and 200','page_number not between 0 and 100000'),'coalesce(page_offset,0) not between 0 and 10000','coalesce(page_offset,0) not between 0 and 5000000');
 execute changed;
end $$;
notify pgrst,'reload schema';
commit;
