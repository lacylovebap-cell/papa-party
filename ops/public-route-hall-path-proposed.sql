-- REVIEW ONLY: requires separate approval before any production execution.
-- The runner must set a verified enabled president's account UUID in the same
-- transaction: SET LOCAL papa.approved_route_actor = '...'. No guessed IDs.
-- Only route metadata is added; all previously activated aliases stay intact.
begin;
do $migration$
declare subject uuid;space record;room record;before_path text;after_path text;next_revision bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('papa-public-route-registry',0));
 if public.papa_public_route_home('hall','example','artist')='/example/artist' then return;end if;
 if public.papa_public_route_home('hall','example','artist') is distinct from '/example.artist'
 then raise exception 'PUBLIC_ROUTE_UNEXPECTED_LAYOUT_VERSION';end if;
 begin subject=nullif(current_setting('papa.approved_route_actor',true),'')::uuid;
 exception when invalid_text_representation then raise exception 'PUBLIC_ROUTE_APPROVED_ACTOR_REQUIRED';end;
 if subject is null or not exists(select 1 from public.papa_accounts a join public.papa_platform_roles p on p.account_id=a.id
  where a.id=subject and a.disabled_at is null and p.role='president')
  or not exists(select 1 from public.papa_manager_account_links l where l.account_id=subject and l.manager_key='president')
 then raise exception 'PUBLIC_ROUTE_APPROVED_ACTOR_REQUIRED';end if;

 execute $function$create or replace function public.papa_public_route_home(layout text,hall_code text,room_code text) returns text
 language sql immutable set search_path=pg_catalog,public as $body$
  select case layout when 'flat' then '/'||room_code when 'hall' then '/'||hall_code||'/'||room_code
   when 'independent' then '/pa.'||room_code end
 $body$$function$;

 -- One registry lock plus one transaction makes conflicts fail as a whole.
 -- Activation checks stable IDs; an old URL belonging to another room is never
 -- reused, even when that other room is disabled.
 for space in select * from public.papa_public_route_spaces where layout='hall' order by space_id for update loop
  if not exists(select 1 from public.papa_public_route_streamers t where t.space_id=space.space_id) then continue;end if;
  update public.papa_public_route_spaces set revision=revision+1,updated_at=now() where space_id=space.space_id returning revision into next_revision;
  for room in select * from public.papa_public_route_streamers t where t.space_id=space.space_id order by streamer_id loop
   before_path='/'||space.code||'.'||room.code;
   after_path=public.papa_public_route_home(space.layout,space.code,room.code);
   perform public.papa_public_route_activate(after_path,space.space_id,room.streamer_id,'streamer');
   insert into public.papa_public_route_audit(space_id,streamer_id,actor_account_id,action,before_path,after_path,revision)
   values(space.space_id,room.streamer_id,subject,'streamer_code',before_path,after_path,next_revision);
  end loop;
 end loop;
end $migration$;
notify pgrst,'reload schema';
commit;
