begin;

-- Additive selected-Space message-center queries. Existing notice IDs, content,
-- preferences and read_at are untouched by this migration. Unknown/mismapped
-- legacy Space rows fail closed; this migration does not guess their owners.
create function public.papa_notice_category(notice_type text)
returns text language sql immutable set search_path=public as $$
 select case when notice_type='message' then 'message'
  when notice_type in ('comment','announcement') then 'board' else 'system' end;
$$;

create function public.papa_notice_preference_type(notice_type text)
returns text language sql immutable set search_path=public as $$
 select case when notice_type in ('live','saved','cancel','ready','accepted','completed','credit','status','failed',
  'message','comment','announcement','achievement','wish','system','delivery') then notice_type else 'system' end;
$$;

create function public.papa_notice_category_scope(requested_space text,requested_room text,
 actor_context jsonb,scope_mode text default 'room')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare ctx jsonb;owner_id text;pref_room text;
begin
 if requested_space is null or length(requested_space) not between 1 and 128
  or requested_room is null or length(requested_room) not between 1 and 200
  or jsonb_typeof(actor_context) is distinct from 'object'
  or scope_mode is null or scope_mode not in ('room','space')
 then raise exception 'NOTICE_SCOPE_INVALID';end if;
 ctx=public.papa_communication_context(requested_space,requested_room,actor_context);
 if scope_mode='space' and ctx->>'role' not in ('admin','super_admin')
 then raise exception 'NOTICE_SCOPE_INVALID';end if;
 owner_id=case ctx->>'role' when 'player' then ctx->>'player_id'
  when 'streamer_admin' then '__admin__' else '__super__' end;
 if owner_id is null or owner_id='' then raise exception 'NOTICE_ACTOR_INVALID';end if;
 pref_room=case when owner_id='__super__' then '__global__' else requested_room end;
 return jsonb_build_object('spaceId',requested_space,'streamerId',case when scope_mode='room' then requested_room else null end,
  'mode',scope_mode,'recipient',owner_id,'preferencesRoom',pref_room);
end $$;

create index papa_notice_category_room_date
 on public.papa_notifications(space_id,streamer_id,recipient,public.papa_notice_category(type),created_at desc,id desc);
create index papa_notice_category_space_date
 on public.papa_notifications(space_id,recipient,public.papa_notice_category(type),created_at desc,id desc);
create index papa_notice_category_unread
 on public.papa_notifications(space_id,recipient,streamer_id,public.papa_notice_category(type)) where read_at is null;

-- Short-lived UUID membership snapshots preserve page positions even when an
-- earlier transaction commits later or a notice is inserted with an old date.
-- No bodies or preferences are copied into this cache; every request rechecks
-- Account/Membership, canonical scope and the current preference fingerprint.
create table public.papa_notice_page_snapshots(
 id uuid primary key default gen_random_uuid(),
 space_id text not null,room_id text not null,recipient text not null,
 account_id uuid not null,actor_role text not null,scope_mode text not null,
 category text not null,preferences_hash text not null,notice_ids uuid[] not null,
 snapshot_at timestamptz not null,expires_at timestamptz not null
);
create index papa_notice_snapshot_expiry on public.papa_notice_page_snapshots(expires_at);
alter table public.papa_notice_page_snapshots enable row level security;
revoke all on public.papa_notice_page_snapshots from public,anon,authenticated;
grant select,insert,delete on public.papa_notice_page_snapshots to service_role;

create function public.papa_notice_category_page(requested_space text,requested_room text,actor_context jsonb,
 category_filter text,page_number int default 0,scope_mode text default 'room',snapshot_at timestamptz default null,
 snapshot_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb;pref jsonb;result jsonb;frozen public.papa_notice_page_snapshots%rowtype;
 selected_ids uuid[];cutoff timestamptz;
begin
 scope=public.papa_notice_category_scope(requested_space,requested_room,actor_context,scope_mode);
 if category_filter is null or category_filter not in ('system','message','board')
  or page_number is null or page_number<0 or page_number>100000
  or snapshot_at>now()
 then raise exception 'NOTICE_PAGE_INVALID';end if;
 select preferences into pref from public.papa_notice_preferences
  where streamer_id=scope->>'preferencesRoom' and recipient=scope->>'recipient';
 pref=coalesce(pref,'{}'::jsonb);
 if snapshot_id is null then
  -- Bounded cache cleanup only; never delete notifications or formal records.
  delete from public.papa_notice_page_snapshots where id in
   (select id from public.papa_notice_page_snapshots where expires_at<now() order by expires_at limit 100);
  cutoff=coalesce(snapshot_at,now());
  select coalesce(array_agg(n.id order by n.created_at desc,n.id desc),'{}'::uuid[]) into selected_ids
  from (select n.id,n.created_at from public.papa_notifications n
   join public.papa_space_streamers m on m.streamer_id=n.streamer_id and m.space_id=n.space_id
   where n.space_id=requested_space and n.recipient=scope->>'recipient'
    and (scope_mode='space' or n.streamer_id=requested_room)
    and public.papa_notice_category(n.type)=category_filter and n.created_at<=cutoff
    and (pref->'types'->public.papa_notice_preference_type(n.type)->>'center') is distinct from 'false'
   order by n.created_at desc,n.id desc limit 100001) n;
  if cardinality(selected_ids)>100000 then raise exception 'NOTICE_SNAPSHOT_TOO_LARGE';end if;
  insert into public.papa_notice_page_snapshots(space_id,room_id,recipient,account_id,actor_role,scope_mode,
   category,preferences_hash,notice_ids,snapshot_at,expires_at)
  values(requested_space,requested_room,scope->>'recipient',(actor_context->>'account_id')::uuid,
   actor_context->>'role',scope_mode,category_filter,md5(pref::text),selected_ids,cutoff,now()+interval '15 minutes')
  returning * into frozen;
 else
  select * into frozen from public.papa_notice_page_snapshots where id=snapshot_id;
  if not found or frozen.expires_at<=now() or frozen.space_id<>requested_space or frozen.room_id<>requested_room
   or frozen.recipient<>scope->>'recipient' or frozen.account_id<>(actor_context->>'account_id')::uuid
   or frozen.actor_role<>actor_context->>'role' or frozen.scope_mode<>scope_mode or frozen.category<>category_filter
   or frozen.preferences_hash<>md5(pref::text)
  then raise exception 'NOTICE_SNAPSHOT_INVALID';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'space_id',n.space_id,'streamer_id',n.streamer_id,
  'streamer_name',n.streamer_name,'recipient',n.recipient,'type',n.type,'level',n.level,'body',n.body,
  'entity_id',n.entity_id,'created_at',n.created_at,'read_at',n.read_at) order by n.position),'[]'::jsonb)
 into result from (
  select n.id,n.space_id,n.streamer_id,n.streamer_name,n.recipient,n.type,n.level,n.body,n.entity_id,n.created_at,n.read_at,chosen.position
  from unnest(frozen.notice_ids[(page_number*50+1):((page_number+1)*50)]) with ordinality as chosen(value,position)
  join public.papa_notifications n on n.id=chosen.value
  join public.papa_space_streamers m on m.streamer_id=n.streamer_id and m.space_id=n.space_id
  where n.space_id=requested_space and n.recipient=scope->>'recipient'
   and (scope_mode='space' or n.streamer_id=requested_room)
   and public.papa_notice_category(n.type)=category_filter
   and (pref->'types'->public.papa_notice_preference_type(n.type)->>'center') is distinct from 'false'
  order by chosen.position
 ) n;
 return jsonb_build_object('version',1,'scope',scope-'recipient'-'preferencesRoom','category',category_filter,
  'page',page_number,'pageSize',50,'total',cardinality(frozen.notice_ids),'snapshotAt',frozen.snapshot_at,'snapshotId',frozen.id,
  'rows',result,'hasMore',(page_number+1)*50<cardinality(frozen.notice_ids));
end $$;

create function public.papa_notice_category_counts(requested_space text,requested_room text,actor_context jsonb,
 scope_mode text default 'room')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare scope jsonb;pref jsonb;totals jsonb;unread_categories jsonb;unread_types jsonb;badge_categories jsonb;
begin
 scope=public.papa_notice_category_scope(requested_space,requested_room,actor_context,scope_mode);
 select preferences into pref from public.papa_notice_preferences
  where streamer_id=scope->>'preferencesRoom' and recipient=scope->>'recipient';
 pref=coalesce(pref,'{}'::jsonb);
 with selected as (
  select n.type,n.read_at,public.papa_notice_category(n.type) category,
   (pref->'types'->public.papa_notice_preference_type(n.type)->>'center') is distinct from 'false' visible,
   (pref->'types'->public.papa_notice_preference_type(n.type)->>'badge') is distinct from 'false' badge_enabled
  from public.papa_notifications n join public.papa_space_streamers m on m.streamer_id=n.streamer_id and m.space_id=n.space_id
  where n.space_id=requested_space and n.recipient=scope->>'recipient' and (scope_mode='space' or n.streamer_id=requested_room)
 ), grouped as (
  select category,count(*) filter(where visible) total,count(*) filter(where visible and read_at is null) unread,
   count(*) filter(where badge_enabled and read_at is null) badge_unread
  from selected group by category
 ), types as (select type,count(*) unread from selected where read_at is null group by type)
 select (select coalesce(jsonb_object_agg(category,total),'{}'::jsonb) from grouped),
  (select coalesce(jsonb_object_agg(category,unread),'{}'::jsonb) from grouped),
  (select coalesce(jsonb_object_agg(type,unread),'{}'::jsonb) from types),
  (select coalesce(jsonb_object_agg(category,badge_unread),'{}'::jsonb) from grouped)
 into totals,unread_categories,unread_types,badge_categories;
 return jsonb_build_object('version',1,'scope',scope-'recipient'-'preferencesRoom',
  'totalsByCategory','{"system":0,"message":0,"board":0}'::jsonb||totals,
  'unreadByCategory','{"system":0,"message":0,"board":0}'::jsonb||unread_categories,'unreadByType',unread_types,
  'badgeUnreadByCategory','{"system":0,"message":0,"board":0}'::jsonb||badge_categories);
end $$;

create function public.papa_notice_category_read(requested_space text,requested_room text,actor_context jsonb,
 category_filter text,notice_ids uuid[] default null,scope_mode text default 'room')
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb;pref jsonb;marked bigint;
begin
 scope=public.papa_notice_category_scope(requested_space,requested_room,actor_context,scope_mode);
 if category_filter is null or category_filter not in ('system','message','board')
  or notice_ids is not null and (cardinality(notice_ids)>50 or array_position(notice_ids,null) is not null)
 then raise exception 'NOTICE_READ_INVALID';end if;
 select preferences into pref from public.papa_notice_preferences
  where streamer_id=scope->>'preferencesRoom' and recipient=scope->>'recipient';
 pref=coalesce(pref,'{}'::jsonb);
 update public.papa_notifications n set read_at=now()
 from public.papa_space_streamers m
 where m.streamer_id=n.streamer_id and m.space_id=n.space_id
  and n.space_id=requested_space and n.recipient=scope->>'recipient'
  and (scope_mode='space' or n.streamer_id=requested_room)
  and public.papa_notice_category(n.type)=category_filter and n.read_at is null
  and (pref->'types'->public.papa_notice_preference_type(n.type)->>'center') is distinct from 'false'
  and (notice_ids is null or n.id=any(notice_ids));
 get diagnostics marked=row_count;
 return jsonb_build_object('version',1,'scope',scope-'recipient'-'preferencesRoom','category',category_filter,'marked',marked);
end $$;

revoke all on function public.papa_notice_category(text),public.papa_notice_preference_type(text),
 public.papa_notice_category_scope(text,text,jsonb,text),public.papa_notice_category_page(text,text,jsonb,text,int,text,timestamptz,uuid),
 public.papa_notice_category_counts(text,text,jsonb,text),public.papa_notice_category_read(text,text,jsonb,text,uuid[],text)
 from public,anon,authenticated;
grant execute on function public.papa_notice_category(text),public.papa_notice_preference_type(text),
 public.papa_notice_category_scope(text,text,jsonb,text),public.papa_notice_category_page(text,text,jsonb,text,int,text,timestamptz,uuid),
 public.papa_notice_category_counts(text,text,jsonb,text),public.papa_notice_category_read(text,text,jsonb,text,uuid[],text)
 to service_role;

commit;
