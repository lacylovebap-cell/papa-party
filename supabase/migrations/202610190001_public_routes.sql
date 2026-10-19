begin;

-- Additive URL metadata only. Stable business IDs, Accounts, entities, Ledger,
-- existing Audit and existing Space slugs are never rewritten by this release.
create table public.papa_public_route_spaces (
 space_id text primary key references public.papa_spaces(id),
 layout text not null check(layout in ('flat','hall','independent')),
 code text not null check(code ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,39}$'),
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default now(),
 check((layout='flat')=(space_id='space-001')),
 check(layout<>'independent' or code='pa')
);
create table public.papa_public_route_streamers (
 space_id text not null references public.papa_public_route_spaces(space_id),
 streamer_id text not null,
 code text not null check(code ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,39}$'),
 updated_at timestamptz not null default now(),
 primary key(space_id,streamer_id),
 foreign key(streamer_id,space_id) references public.papa_space_streamers(streamer_id,space_id)
);
create unique index papa_public_route_current_code on public.papa_public_route_streamers(space_id,lower(code));
create table public.papa_public_route_aliases (
 path_key text primary key check(path_key=lower(path)),
 path text not null check(path ~ '^/[A-Za-z0-9][A-Za-z0-9.-]{0,80}(/[A-Za-z0-9][A-Za-z0-9-]{0,39})?$'),
 space_id text not null references public.papa_public_route_spaces(space_id),
 streamer_id text,
 home_code text,
 kind text not null check(kind in ('hall','streamer')),
 activated_at timestamptz not null default now(),
 check((kind='hall')=(streamer_id is null)),
 check((kind='hall')=(home_code is null)),
 foreign key(space_id,streamer_id) references public.papa_public_route_streamers(space_id,streamer_id)
);
create index papa_public_route_alias_owner on public.papa_public_route_aliases(space_id,streamer_id);
create index papa_public_route_code_history on public.papa_public_route_aliases(space_id,lower(home_code),streamer_id) where kind='streamer';
create table public.papa_public_route_audit (
 id bigint generated always as identity primary key,
 space_id text not null,
 streamer_id text,
 actor_account_id uuid not null references public.papa_accounts(id),
 action text not null check(action in ('hall_code','streamer_code')),
 before_path text,
 after_path text,
 revision bigint not null,
 created_at timestamptz not null default now()
);
alter table public.papa_public_route_spaces enable row level security;
alter table public.papa_public_route_streamers enable row level security;
alter table public.papa_public_route_aliases enable row level security;
alter table public.papa_public_route_audit enable row level security;
revoke all on public.papa_public_route_spaces,public.papa_public_route_streamers,
 public.papa_public_route_aliases,public.papa_public_route_audit from public,anon,authenticated,service_role;

create function public.papa_public_route_immutable() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin raise exception 'PUBLIC_ROUTE_HISTORY_IMMUTABLE';end $$;
revoke all on function public.papa_public_route_immutable() from public,anon,authenticated,service_role;
create trigger papa_public_route_alias_immutable before update or delete on public.papa_public_route_aliases
 for each row execute function public.papa_public_route_immutable();
create trigger papa_public_route_audit_immutable before update or delete on public.papa_public_route_audit
 for each row execute function public.papa_public_route_immutable();

create function public.papa_public_route_valid_code(value text) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
 select coalesce(value ~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,38}[A-Za-z0-9])?$' and lower(value)<>all(array[
 'admin','api','assets','src','supabase','tests','ops','node_modules','solo','pa','sm','home','lobby',
 'book','songs','catalog','shared','common-book','center','gallery','ledger','crowns','stats','events','activity',
 'player','players','queue','history','cards','wall','wishes','achievements',
 'medals','login','logout','auth','settings','share','manifest','index','preview','404','sw','favicon',
 'robots','sitemap','.well-known']),false)
$$;
revoke all on function public.papa_public_route_valid_code(text) from public,anon,authenticated,service_role;

create function public.papa_public_route_home(layout text,hall_code text,room_code text) returns text
language sql immutable set search_path=pg_catalog,public as $$
 select case layout when 'flat' then '/'||room_code when 'hall' then '/'||hall_code||'.'||room_code
  when 'independent' then '/pa.'||room_code end
$$;
revoke all on function public.papa_public_route_home(text,text,text) from public,anon,authenticated,service_role;

create function public.papa_public_route_authorize(s text,r text,a jsonb,super_only boolean default false) returns void
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare subject uuid;role_name text;
begin
 if jsonb_typeof(a) is distinct from 'object' then raise exception 'PUBLIC_ROUTE_ACTOR_INVALID';end if;
 begin subject=(a->>'account_id')::uuid;exception when invalid_text_representation then raise exception 'PUBLIC_ROUTE_ACTOR_INVALID';end;
 role_name=a->>'role';
 if subject is null or not exists(select 1 from public.papa_accounts where id=subject and disabled_at is null)
 then raise exception 'PUBLIC_ROUTE_ACTOR_INVALID';end if;
 if role_name='super_admin' then
  if not exists(select 1 from public.papa_platform_roles where account_id=subject and role='president')
   or not exists(select 1 from public.papa_manager_account_links where account_id=subject and manager_key='president')
  then raise exception 'PUBLIC_ROUTE_ACTOR_INVALID';end if;
 elsif role_name='streamer_admin' and not super_only and r is not null then
  if a->>'space_id' is distinct from s or a->>'actor_streamer_id' is distinct from r
   or not exists(select 1 from public.papa_manager_account_links where account_id=subject and manager_key='streamer:'||r)
   or not exists(select 1 from public.papa_space_memberships where account_id=subject and space_id=s
     and role='streamer_admin' and streamer_id=r and status='active')
   or not exists(select 1 from public.papa_streamer_accounts where streamer_id=r and enabled)
  then raise exception 'PUBLIC_ROUTE_SCOPE_DENIED';end if;
 else raise exception 'PUBLIC_ROUTE_MANAGER_REQUIRED';end if;
 if not exists(select 1 from public.papa_spaces where id=s and status='active')
 then raise exception 'PUBLIC_ROUTE_SPACE_INVALID';end if;
 if r is not null and not exists(select 1 from public.papa_space_streamers m
   join public.papa_v2_entities e on e.kind='meta' and e.id='1'
   cross join lateral jsonb_array_elements(coalesce(e.data->'streamers','[]'::jsonb)) room
   where m.space_id=s and m.streamer_id=r and room->>'id'=r and coalesce((room->>'active')::boolean,true))
 then raise exception 'PUBLIC_ROUTE_ROOM_INVALID';end if;
end $$;
revoke all on function public.papa_public_route_authorize(text,text,jsonb,boolean) from public,anon,authenticated,service_role;

create function public.papa_public_route_result(s text,r text,kind_value text) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('version',1,'spaceId',s,'streamerId',r,'kind',kind_value,
  'streamerSlug',case when r is null then null else (select room->>'slug' from public.papa_v2_entities e
    cross join lateral jsonb_array_elements(coalesce(e.data->'streamers','[]'::jsonb)) room
    where e.kind='meta' and e.id='1' and room->>'id'=r limit 1) end,
  'configured',c.space_id is not null and (r is null or t.streamer_id is not null),
  'layout',c.layout,'spaceCode',c.code,'code',case when r is null then c.code else t.code end,
  'revision',coalesce(c.revision,0),'canonicalPath',case when r is null then
   case when c.layout<>'independent' then '/'||c.code end
   else public.papa_public_route_home(c.layout,c.code,t.code) end)
 from (select 1) one left join public.papa_public_route_spaces c on c.space_id=s
 left join public.papa_public_route_streamers t on t.space_id=s and t.streamer_id=r
$$;
revoke all on function public.papa_public_route_result(text,text,text) from public,anon,authenticated,service_role;

-- Exact one/two-segment homepage lookup, backed by a primary-key index. The
-- caller tries longest registered prefix first and preserves its subpage tail.
create function public.papa_public_route_resolve(requested_path text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.papa_public_route_aliases%rowtype;result jsonb;
begin
 if requested_path is null or length(requested_path)>123 or requested_path !~ '^/[A-Za-z0-9][A-Za-z0-9.-]{0,80}(/[A-Za-z0-9][A-Za-z0-9-]{0,39})?$'
 then return null;end if;
 select * into a from public.papa_public_route_aliases where path_key=lower(requested_path);
 if not found or not exists(select 1 from public.papa_spaces where id=a.space_id and status='active') then return null;end if;
 if a.streamer_id is not null and not exists(select 1 from public.papa_space_streamers m
   join public.papa_v2_entities e on e.kind='meta' and e.id='1'
   cross join lateral jsonb_array_elements(coalesce(e.data->'streamers','[]'::jsonb)) room
   where m.space_id=a.space_id and m.streamer_id=a.streamer_id and room->>'id'=a.streamer_id and coalesce((room->>'active')::boolean,true))
 then return null;end if;
 result=public.papa_public_route_result(a.space_id,a.streamer_id,a.kind);
 return result||jsonb_build_object('matchedPath',a.path,'isAlias',requested_path is distinct from result->>'canonicalPath');
end $$;

create function public.papa_public_route_info(requested_space text,requested_room text,requested_kind text default 'streamer') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if requested_kind is null or requested_kind not in ('hall','streamer') or (requested_kind='hall')<>(requested_room is null)
  or requested_space is null or length(requested_space)>200 or length(coalesce(requested_room,''))>200 then return null;end if;
 result=public.papa_public_route_result(requested_space,requested_room,requested_kind);
 if not (result->>'configured')::boolean or result->>'canonicalPath' is null then return null;end if;
 return public.papa_public_route_resolve(result->>'canonicalPath');
end $$;

create function public.papa_public_route_settings(requested_space text,requested_room text,actor_context jsonb,requested_kind text default 'streamer') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if requested_kind is null or requested_kind not in ('hall','streamer') or (requested_kind='hall')<>(requested_room is null)
 then raise exception 'PUBLIC_ROUTE_TARGET_INVALID';end if;
 perform public.papa_public_route_authorize(requested_space,requested_room,actor_context,requested_kind='hall');
 return public.papa_public_route_result(requested_space,requested_room,requested_kind);
end $$;

create function public.papa_public_route_check(requested_space text,requested_room text,actor_context jsonb,requested_kind text,
 desired_code text,requested_layout text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare config public.papa_public_route_spaces%rowtype;candidate text;layout_value text;conflict_found boolean;
begin
 if requested_kind is null or requested_kind not in ('hall','streamer') or (requested_kind='hall')<>(requested_room is null)
 then raise exception 'PUBLIC_ROUTE_TARGET_INVALID';end if;
 perform public.papa_public_route_authorize(requested_space,requested_room,actor_context,requested_kind='hall');
 select * into config from public.papa_public_route_spaces where space_id=requested_space;
 layout_value=coalesce(requested_layout,config.layout,case when requested_space='space-001' then 'flat' else 'hall' end);
 if layout_value not in ('flat','hall','independent') or (layout_value='flat')<>(requested_space='space-001')
  or requested_kind='streamer' and requested_layout is not null and requested_layout is distinct from config.layout
  or config.space_id is not null and layout_value is distinct from config.layout
 then raise exception 'PUBLIC_ROUTE_LAYOUT_INVALID';end if;
 if desired_code is null or not public.papa_public_route_valid_code(desired_code)
  and not (requested_kind='hall' and (lower(desired_code)='sm' and requested_space='space-001'
   or desired_code='pa' and layout_value='independent'))
  and not (requested_kind='streamer' and lower(desired_code)='pa' and requested_space='space-001' and requested_room='papa')
 then return public.papa_public_route_result(requested_space,requested_room,requested_kind)||jsonb_build_object('available',false,'reason','invalid_code');end if;
 if requested_kind='streamer' and config.space_id is null then
  return public.papa_public_route_result(requested_space,requested_room,requested_kind)||jsonb_build_object('available',false,'reason','space_not_configured');end if;
 if requested_kind='hall' and layout_value='independent' and desired_code<>'pa'
 then return public.papa_public_route_result(requested_space,requested_room,requested_kind)||jsonb_build_object('available',false,'reason','invalid_code');end if;
 candidate=case when requested_kind='hall' then case when layout_value<>'independent' then '/'||desired_code end
  else public.papa_public_route_home(layout_value,config.code,desired_code) end;
 select exists(select 1 from public.papa_public_route_aliases a where a.path_key=lower(candidate)
  and (a.space_id,a.streamer_id,a.kind) is distinct from (requested_space,requested_room,requested_kind)) into conflict_found;
 if requested_kind='streamer' then
  conflict_found=conflict_found or exists(select 1 from public.papa_public_route_streamers t where t.space_id=requested_space
    and t.streamer_id<>requested_room and lower(t.code)=lower(desired_code))
   or exists(select 1 from public.papa_public_route_aliases a where a.space_id=requested_space and a.kind='streamer'
    and a.streamer_id<>requested_room and lower(a.home_code)=lower(desired_code));
 else
  -- A hall rename must be able to activate every new current child path as one
  -- transaction. Never reserve only the hall and leave children half-renamed.
  conflict_found=conflict_found or exists(select 1 from public.papa_public_route_streamers t
   join public.papa_public_route_aliases a on a.path_key=lower(public.papa_public_route_home(layout_value,desired_code,t.code))
   where t.space_id=requested_space and (a.space_id,a.streamer_id,a.kind) is distinct from (requested_space,t.streamer_id,'streamer'::text));
 end if;
 return public.papa_public_route_result(requested_space,requested_room,requested_kind)||jsonb_build_object(
  'available',not conflict_found,'reason',case when conflict_found then 'reserved_history_or_in_use' end,'proposedPath',candidate);
end $$;

create function public.papa_public_route_activate(path_value text,s text,r text,kind_value text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if path_value is null then return;end if;
 insert into public.papa_public_route_aliases(path_key,path,space_id,streamer_id,home_code,kind)
 values(lower(path_value),path_value,s,r,case when r is not null then (select code from public.papa_public_route_streamers where space_id=s and streamer_id=r) end,kind_value) on conflict(path_key) do nothing;
 if not exists(select 1 from public.papa_public_route_aliases a where a.path_key=lower(path_value)
   and a.space_id=s and a.streamer_id is not distinct from r and a.kind=kind_value)
 then raise exception 'PUBLIC_ROUTE_ALREADY_RESERVED' using errcode='23505';end if;
end $$;
revoke all on function public.papa_public_route_activate(text,text,text,text) from public,anon,authenticated,service_role;

create function public.papa_public_route_save(requested_space text,requested_room text,actor_context jsonb,requested_kind text,
 desired_code text,expected_revision bigint,requested_layout text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;before_value jsonb;config public.papa_public_route_spaces%rowtype;layout_value text;target_path text;room record;
begin
 -- This registry serializes rare URL edits only; no business revision or Realtime
 -- channel is touched. Global path uniqueness includes flat and hall aliases.
 perform pg_advisory_xact_lock(hashtextextended('papa-public-route-registry',0));
 result=public.papa_public_route_check(requested_space,requested_room,actor_context,requested_kind,desired_code,requested_layout);
 if not (result->>'available')::boolean then raise exception 'PUBLIC_ROUTE_UNAVAILABLE: %',result->>'reason';end if;
 if expected_revision is null or expected_revision<0 then raise exception 'PUBLIC_ROUTE_VERSION_CONFLICT' using errcode='40001';end if;
 before_value=public.papa_public_route_result(requested_space,requested_room,requested_kind);
 if before_value->>'code' is not distinct from desired_code and (before_value->>'configured')::boolean
 then return before_value||jsonb_build_object('changed',false);end if;
 if expected_revision is distinct from (result->>'revision')::bigint
 then raise exception 'PUBLIC_ROUTE_VERSION_CONFLICT' using errcode='40001';end if;
 select * into config from public.papa_public_route_spaces where space_id=requested_space for update;
 layout_value=coalesce(config.layout,requested_layout,case when requested_space='space-001' then 'flat' else 'hall' end);
 if requested_kind='hall' then
  insert into public.papa_public_route_spaces(space_id,layout,code) values(requested_space,layout_value,desired_code)
   on conflict(space_id) do update set code=excluded.code,updated_at=now();
  target_path=case when layout_value<>'independent' then '/'||desired_code end;
  perform public.papa_public_route_activate(target_path,requested_space,null,'hall');
  for room in select streamer_id,code from public.papa_public_route_streamers where space_id=requested_space loop
   perform public.papa_public_route_activate(public.papa_public_route_home(layout_value,desired_code,room.code),requested_space,room.streamer_id,'streamer');
  end loop;
 else
  insert into public.papa_public_route_streamers(space_id,streamer_id,code) values(requested_space,requested_room,desired_code)
   on conflict(space_id,streamer_id) do update set code=excluded.code,updated_at=now();
  target_path=public.papa_public_route_home(config.layout,config.code,desired_code);
  perform public.papa_public_route_activate(target_path,requested_space,requested_room,'streamer');
 end if;
 update public.papa_public_route_spaces set revision=revision+1,updated_at=now() where space_id=requested_space;
 result=public.papa_public_route_result(requested_space,requested_room,requested_kind);
 insert into public.papa_public_route_audit(space_id,streamer_id,actor_account_id,action,before_path,after_path,revision)
 values(requested_space,requested_room,(actor_context->>'account_id')::uuid,case when requested_kind='hall' then 'hall_code' else 'streamer_code' end,
  before_value->>'canonicalPath',result->>'canonicalPath',(result->>'revision')::bigint);
 return result||jsonb_build_object('changed',true);
end $$;

-- Only URLs explicitly confirmed by the owner are activated. No proposed
-- /solo path, guessed name, other Space or other streamer is automatically used.
do $$ begin
 if not exists(select 1 from public.papa_spaces where id='space-001')
  or not exists(select 1 from public.papa_space_streamers where space_id='space-001' and streamer_id='papa')
 then raise exception 'PUBLIC_ROUTE_CONFIRMED_SEED_SCOPE_MISSING';end if;
end $$;
insert into public.papa_public_route_spaces(space_id,layout,code)
 select id,'flat','sm' from public.papa_spaces where id='space-001';
insert into public.papa_public_route_streamers(space_id,streamer_id,code)
 select space_id,streamer_id,'pa' from public.papa_space_streamers where space_id='space-001' and streamer_id='papa';
insert into public.papa_public_route_aliases(path_key,path,space_id,streamer_id,home_code,kind)
 select '/sm','/sm',space_id,null,null,'hall' from public.papa_public_route_spaces where space_id='space-001';
insert into public.papa_public_route_aliases(path_key,path,space_id,streamer_id,home_code,kind)
 select '/pa','/pa',space_id,streamer_id,'pa','streamer' from public.papa_public_route_streamers where space_id='space-001' and streamer_id='papa';

revoke all on function public.papa_public_route_resolve(text),public.papa_public_route_info(text,text,text),public.papa_public_route_settings(text,text,jsonb,text),
 public.papa_public_route_check(text,text,jsonb,text,text,text),public.papa_public_route_save(text,text,jsonb,text,text,bigint,text)
 from public,anon,authenticated;
grant execute on function public.papa_public_route_resolve(text),public.papa_public_route_info(text,text,text),public.papa_public_route_settings(text,text,jsonb,text),
 public.papa_public_route_check(text,text,jsonb,text,text,text),public.papa_public_route_save(text,text,jsonb,text,text,bigint,text) to service_role;
notify pgrst,'reload schema';
commit;
