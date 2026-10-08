begin;

-- Keep historical rows untouched. A missing old actor is unknown, never
-- reconstructed from the target player's identity.
alter table public.papa_events
 add column actor_account_id uuid references public.papa_accounts(id),
 add column actor_streamer_id text,
 add column actor_display_name_snapshot text,
 add column target_player_id text,
 add column target_player_name_snapshot text,
 add column space_id text references public.papa_spaces(id);
create index papa_event_actor_account on public.papa_events(actor_account_id,created_at desc)
 where actor_account_id is not null;

create function public.papa_event_actor_snapshot() returns trigger
language plpgsql set search_path=public as $$
declare ctx jsonb; body jsonb; actor_room text; actor_player text;
begin
 ctx=coalesce(nullif(current_setting('papa.actor_context',true),''),'{}')::jsonb;
 body=coalesce(new.after_data,new.before_data,'{}'::jsonb);
 if ctx->>'account_id' ~ '^[a-f0-9-]{36}$' then
  new.actor_account_id=(ctx->>'account_id')::uuid;
 end if;
 -- Catalog RPCs already receive a server-derived actor key rather than the
 -- request-level context. Resolve that key to its stable Account only for
 -- newly inserted catalog events; never guess the actor of historical rows.
 if new.entity_kind='shared_catalog' and new.actor_account_id is null then
  if new.actor_role='president' then
   select account_id into new.actor_account_id from public.papa_manager_account_links
    where manager_key='president';
  elsif new.actor_role like 'streamer:%' then
   select account_id into new.actor_account_id from public.papa_manager_account_links
    where manager_key=new.actor_role;
  elsif new.actor_role like 'player:%' then
   actor_player=substring(new.actor_role from 8);
   select account_id into new.actor_account_id from public.papa_account_legacy_players
    where legacy_player_id=actor_player;
  end if;
 end if;
 if new.actor_role='streamer_admin' then
  actor_room=coalesce(nullif(ctx->>'actor_streamer_id',''),new.streamer_id);
 elsif new.actor_role like 'streamer:%' then
  actor_room=substring(new.actor_role from 10);
 end if;
 if actor_room is not null then
  new.actor_streamer_id=actor_room;
  select room->>'display_name' into new.actor_display_name_snapshot
   from public.papa_v2_entities e
   cross join lateral jsonb_array_elements(
    case when jsonb_typeof(e.data->'streamers')='array' then e.data->'streamers' else '[]'::jsonb end
   ) room
   where e.kind='meta' and room->>'id'=actor_room limit 1;
 elsif new.actor_role in ('super_admin','admin','president') then
  new.actor_display_name_snapshot='PA Party總裁';
 elsif new.actor_role='system' then
  new.actor_display_name_snapshot='系統';
 elsif new.actor_role='player' or new.entity_kind='shared_catalog' and new.actor_role like 'player:%' then
  actor_player=coalesce(actor_player,new.actor_player_id);
  select data->>'name' into new.actor_display_name_snapshot
   from public.papa_v2_entities where kind='players' and id=actor_player;
 end if;
 new.target_player_id=coalesce(nullif(body->>'playerId',''),nullif(body->>'player_id',''),
  case when new.entity_kind='players' then new.entity_id else null end);
 if new.target_player_id is not null then
  new.target_player_name_snapshot=coalesce(nullif(body->>'name',''),
   (select data->>'name' from public.papa_v2_entities
     where kind='players' and id=new.target_player_id));
 end if;
 new.space_id=coalesce(
  (select m.space_id from public.papa_space_streamers m where m.streamer_id=new.streamer_id),
  case when ctx->>'space_id'='space-001' then 'space-001' else null end);
 return new;
end $$;
create trigger papa_event_actor_snapshot_trigger
before insert on public.papa_events for each row
execute function public.papa_event_actor_snapshot();

-- The existing bounded event feed now returns actor and target snapshots in
-- the same response. No extra browser request or per-row API query is needed.
create or replace function public.papa_event_page_v2(room_id text,page_number int default 0,include_global boolean default false,module_filter text default null,page_limit int default 50,page_offset int default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; total_rows bigint;
begin
 if coalesce(room_id,'')='' or page_number not between 0 and 200 or page_limit not between 1 and 50 or coalesce(page_offset,0) not between 0 and 10000 or module_filter is not null and module_filter<>'shared_catalog'
 then raise exception 'EVENT_PAGE_INVALID'; end if;
 if module_filter='shared_catalog' then
  select coalesce(jsonb_agg(papa_audit_redact(to_jsonb(t)) order by t.created_at desc,t.id desc),'[]') into result from
   (select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,
    actor_account_id,actor_streamer_id,actor_display_name_snapshot,target_player_id,target_player_name_snapshot,space_id,
    created_at,effective_at,before_data,after_data from papa_events e
    where e.entity_kind='shared_catalog' and (include_global or e.streamer_id=room_id)
    order by e.created_at desc,e.id desc limit page_limit+1 offset coalesce(page_offset,page_number*50)) t;
  select count(*) into total_rows from papa_events e where e.entity_kind='shared_catalog' and (include_global or e.streamer_id=room_id);
 elsif include_global then
  select coalesce(jsonb_agg(papa_audit_redact(to_jsonb(t)) order by t.created_at desc,t.id desc),'[]') into result from
   (select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,
    actor_account_id,actor_streamer_id,actor_display_name_snapshot,target_player_id,target_player_name_snapshot,space_id,
    created_at,effective_at,before_data,after_data from papa_events e
    order by e.created_at desc,e.id desc limit page_limit+1 offset coalesce(page_offset,page_number*50)) t;
 else
  select coalesce(jsonb_agg(papa_audit_redact(to_jsonb(t)) order by t.created_at desc,t.id desc),'[]') into result from
   (select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,
    actor_account_id,actor_streamer_id,actor_display_name_snapshot,target_player_id,target_player_name_snapshot,space_id,
    created_at,effective_at,before_data,after_data from papa_events e
    where e.streamer_id=room_id and e.entity_kind not in ('players','meta','shared_catalog')
    order by e.created_at desc,e.id desc limit page_limit+1 offset coalesce(page_offset,page_number*50)) t;
 end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(x order by n)
  from jsonb_array_elements(result) with ordinality t(x,n) where n<=page_limit),'[]'),
  'hasMore',jsonb_array_length(result)>page_limit,'total',total_rows);
end $$;
revoke all on function public.papa_event_actor_snapshot() from public,anon,authenticated;
revoke all on function public.papa_event_page_v2(text,int,boolean,text,int,int)
 from public,anon,authenticated;
grant execute on function public.papa_event_page_v2(text,int,boolean,text,int,int)
 to service_role;

commit;
