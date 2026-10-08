begin;

-- Public identity metadata only. Parameters use exact equality, including
-- native profile IDs that are not safe to interpolate into PostgREST filters.
create function papa_communication_player_name(chosen_space text,chosen_player text)
returns text language sql stable security definer set search_path=public as $$
 select case when chosen_space='space-001' then
  (select data->>'name' from papa_v2_entities where kind='players' and id=chosen_player)
 else (select data->>'name' from papa_space_player_profiles
  where space_id=chosen_space and player_id=chosen_player) end;
$$;
create function papa_communication_player_exists(chosen_space text,chosen_player text)
returns boolean language sql stable security definer set search_path=public as $$
 select case when chosen_space='space-001' then
  exists(select 1 from papa_v2_entities where kind='players' and id=chosen_player)
 else exists(select 1 from papa_space_player_profiles p
  join papa_space_memberships m on m.id=p.membership_id and m.account_id=p.account_id and m.space_id=p.space_id
  join papa_accounts a on a.id=p.account_id and a.disabled_at is null
  where p.space_id=chosen_space and p.player_id=chosen_player and m.role='player' and m.status='active') end;
$$;
create function papa_communication_player_names(chosen_space text,chosen_players text[])
returns table(player_id text,player_name text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from papa_spaces where id=chosen_space and status='active')
  or chosen_players is null or cardinality(chosen_players)>101
  or exists(select 1 from unnest(chosen_players) id where id is null or length(id) not between 1 and 200)
 then raise exception 'COMMUNICATION_SCOPE_INVALID';end if;
 return query select id,papa_communication_player_name(chosen_space,id)
  from (select distinct unnest(chosen_players) id) selected
  where papa_communication_player_exists(chosen_space,id);
end $$;
create function papa_board_directory_in_space(chosen_space text,search_text text)
returns table(player_id text,player_name text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from papa_spaces where id=chosen_space and status='active')
 then raise exception 'COMMUNICATION_SCOPE_INVALID';end if;
 if length(trim(search_text)) not between 1 and 80 or search_text is null then return;end if;
 if chosen_space='space-001' then
  return query select * from papa_board_directory(search_text);
 else
  return query select p.player_id,p.data->>'name' from papa_space_player_profiles p
   where p.space_id=chosen_space and papa_communication_player_exists(chosen_space,p.player_id)
    and (position(lower(trim(search_text)) in lower(coalesce(p.data->>'name','')))>0
     or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(p.data->'ids')='array'
      then p.data->'ids' else '[]'::jsonb end) item(value)
      where position(lower(trim(search_text)) in lower(item.value))>0))
   order by p.player_id limit 30;
 end if;
end $$;

-- Legacy keys remain exact. A hexadecimal Space namespace cannot collide
-- with arbitrary native player identifiers or another Space's namespace.
create function papa_communication_actor_key(chosen_space text,local_key text)
returns text language sql immutable set search_path=public as $$
 select case when chosen_space='space-001' then local_key
  else 'space:'||encode(convert_to(chosen_space,'UTF8'),'hex')||':'||local_key end;
$$;
create function papa_board_room_key(chosen_space text)
returns text language sql immutable set search_path=public as $$
 select case when chosen_space='space-001' then '__global__'
  else '__global__:'||encode(convert_to(chosen_space,'UTF8'),'hex') end;
$$;
create function papa_communication_key_exists(chosen_space text,chosen_key text,allow_president boolean default false)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare local_key text;prefix text;
begin
 prefix=papa_communication_actor_key(chosen_space,'');
 if left(chosen_key,length(prefix)) is distinct from prefix then return false;end if;
 local_key=substring(chosen_key from length(prefix)+1);
 if local_key='super' then return allow_president;end if;
 if left(local_key,7)='player:' then
  return length(substring(local_key from 8)) between 1 and 200
   and papa_communication_player_exists(chosen_space,substring(local_key from 8));
 end if;
 if left(local_key,9)='streamer:' then
  return exists(select 1 from jsonb_array_elements(papa_streamer_directory_in_space(chosen_space)) room
   where room->>'id'=substring(local_key from 10) and coalesce((room->>'active')::boolean,false));
 end if;
 return false;
end $$;

create function papa_communication_context(allowed_space text,requested_room text,actor_context jsonb,allow_other_room boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor_kind text;subject uuid;player text;result jsonb;
begin
 if not exists(select 1 from papa_space_streamers r join papa_spaces s on s.id=r.space_id
  where r.streamer_id=requested_room and r.space_id=allowed_space and s.status='active')
 then raise exception 'COMMUNICATION_SCOPE_INVALID';end if;
 actor_kind=actor_context->>'role';player=actor_context->>'player_id';
 if actor_kind is null or actor_kind not in ('player','streamer_admin','admin','super_admin')
  or actor_kind in ('player','streamer_admin') and actor_context->>'space_id' is distinct from allowed_space
  or actor_kind='streamer_admin' and not allow_other_room and actor_context->>'actor_streamer_id' is distinct from requested_room
 then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
 if nullif(actor_context->>'account_id','') is not null then
  begin subject=(actor_context->>'account_id')::uuid;
  exception when invalid_text_representation then raise exception 'COMMUNICATION_ACTOR_INVALID';end;
  if not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
 elsif allowed_space<>'space-001' then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
 if actor_kind='player' then
  if not papa_communication_player_exists(allowed_space,player)
   or subject is not null and (not exists(select 1 from papa_space_memberships
     where account_id=subject and space_id=allowed_space and role='player' and status='active')
    or (case when allowed_space='space-001' then
     not exists(select 1 from papa_account_legacy_players where account_id=subject and legacy_player_id=player)
    else not exists(select 1 from papa_space_player_profiles
     where account_id=subject and space_id=allowed_space and player_id=player) end))
  then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
 elsif actor_kind='streamer_admin' then
  if not exists(select 1 from papa_space_streamers where streamer_id=actor_context->>'actor_streamer_id' and space_id=allowed_space)
  then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
  if subject is not null and (not exists(select 1 from papa_space_memberships
   where account_id=subject and space_id=allowed_space and role='streamer_admin'
    and streamer_id=actor_context->>'actor_streamer_id' and status='active')
   or not exists(select 1 from papa_manager_account_links
    where account_id=subject and manager_key='streamer:'||(actor_context->>'actor_streamer_id')))
  then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
 elsif subject is not null and not exists(select 1 from papa_platform_roles
  where account_id=subject and role='president') then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
 result=actor_context||jsonb_build_object('space_id',allowed_space,'streamer_id',requested_room);
 return result;
end $$;

alter table papa_board_posts add column space_id text references papa_spaces(id);
update papa_board_posts p set space_id=m.space_id from papa_space_streamers m
 where m.streamer_id=case when p.scope='global' then p.origin_room else p.streamer_id end;
do $$ begin if exists(select 1 from papa_board_posts where space_id is null)
 then raise exception 'BOARD_SPACE_BACKFILL_INCOMPLETE';end if;end $$;
alter table papa_board_posts alter column space_id set not null;
do $$ declare constraint_name text;begin
 for constraint_name in select conname from pg_constraint where conrelid='papa_board_posts'::regclass
  and contype='c' and pg_get_constraintdef(oid) like '%scope%' and pg_get_constraintdef(oid) like '%__global__%'
 loop execute format('alter table papa_board_posts drop constraint %I',constraint_name);end loop;
end $$;
alter table papa_board_posts add constraint papa_board_space_scope
 check((scope='global')=(streamer_id=papa_board_room_key(space_id)));
create index papa_board_space_feed on papa_board_posts(space_id,streamer_id,seq desc);
alter table papa_board_blocks add column space_id text not null default 'space-001' references papa_spaces(id);
alter table papa_board_blocks alter column space_id drop default;
alter table papa_board_blocks drop constraint papa_board_blocks_pkey;
alter table papa_board_blocks add primary key(space_id,owner_key,target_key);
alter table papa_board_history add column space_id text references papa_spaces(id),
 add column actor_account_id uuid references papa_accounts(id),
 add column actor_display_name_snapshot text,
 add column target_player_id text,add column target_player_name_snapshot text;
update papa_board_history h set space_id=p.space_id from papa_board_posts p where p.id=h.post_id;
alter table papa_board_history alter column space_id set not null;

create function papa_board_space_guard() returns trigger
language plpgsql set search_path=public as $$
declare mapped text;root papa_board_posts;
begin
 select space_id into mapped from papa_space_streamers where streamer_id=new.origin_room;
 if mapped is null or new.space_id is not null and new.space_id<>mapped
  or new.scope='streamer' and new.streamer_id<>new.origin_room
  or new.scope='global' and new.streamer_id<>papa_board_room_key(mapped)
 then raise exception 'BOARD_SPACE_MISMATCH';end if;
 if tg_op='UPDATE' and (old.space_id<>mapped or old.streamer_id<>new.streamer_id
  or old.origin_room<>new.origin_room or old.author_key<>new.author_key or old.root_id is distinct from new.root_id)
 then raise exception 'BOARD_IDENTITY_IMMUTABLE';end if;
 if new.root_id is not null then
  select * into root from papa_board_posts where id=new.root_id;
  if root.id is null or root.space_id<>mapped or root.streamer_id<>new.streamer_id or root.root_id is not null
  then raise exception 'BOARD_SPACE_MISMATCH';end if;
 end if;
 new.space_id=mapped;return new;
end $$;
create trigger papa_board_space_guard_trigger before insert or update on papa_board_posts
for each row execute function papa_board_space_guard();
create function papa_board_block_space_guard() returns trigger
language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from papa_spaces where id=new.space_id and status='active')
  or not papa_communication_key_exists(new.space_id,new.owner_key,true)
  or not papa_communication_key_exists(new.space_id,new.target_key,true)
 then raise exception 'BOARD_SPACE_MISMATCH';end if;
 if tg_op='UPDATE' and (old.space_id<>new.space_id or old.owner_key<>new.owner_key or old.target_key<>new.target_key)
 then raise exception 'BOARD_IDENTITY_IMMUTABLE';end if;
 return new;
end $$;
create trigger papa_board_block_space_guard_trigger before insert or update on papa_board_blocks
for each row execute function papa_board_block_space_guard();

-- Project the supplied before/after value, never the current metadata table,
-- so audit snapshots retain the settings at the time of the mutation. Native
-- room events contain one room only; platform/legacy events keep their contract.
create function papa_native_meta_audit_projection(value jsonb,requested_room text)
returns jsonb language sql immutable set search_path=public as $$
 select case when value is null then null else jsonb_build_object(
  'streamers',coalesce((select jsonb_build_array(coalesce((select jsonb_object_agg(field.key,field.value)
    from jsonb_each(room) field where field.key=any(array[
     'id','slug','display_name','home_title','subtitle','description','avatar_url','banner_url','active','created_at','updated_at'])),
    '{}'::jsonb))
   from jsonb_array_elements(case when jsonb_typeof(value->'streamers')='array'
    then value->'streamers' else '[]'::jsonb end) room
   where room->>'id'=requested_room limit 1),'[]'::jsonb),
  'streamerSettings',case when jsonb_typeof(value->'streamerSettings')='object'
    and value->'streamerSettings' ? requested_room
   then jsonb_build_object(requested_room,value->'streamerSettings'->requested_room)
   else '{}'::jsonb end) end;
$$;

-- Resolve new actor and target snapshots in their canonical Space. Historical
-- rows are untouched and platform catalog events retain a null Space.
create or replace function papa_event_actor_snapshot() returns trigger
language plpgsql set search_path=public as $$
declare ctx jsonb;body jsonb;actor_room text;actor_player text;identity_space text;verified jsonb;subject uuid;
begin
 ctx=coalesce(nullif(current_setting('papa.actor_context',true),''),'{}')::jsonb;
 body=coalesce(new.after_data,new.before_data,'{}'::jsonb);
 if new.entity_kind='shared_catalog' and left(new.actor_role,9)='verified:' then
  begin verified=substring(new.actor_role from 10)::jsonb;subject=(verified->>'account_id')::uuid;
  exception when others then raise exception 'COMMUNICATION_ACTOR_INVALID';end;
  if jsonb_typeof(verified) is distinct from 'object' or subject is null
   or verified->>'role' is null or verified->>'role' not in ('player','streamer_admin','super_admin','admin','president')
   or not exists(select 1 from papa_accounts where id=subject and disabled_at is null)
  then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
  if verified->>'role'='player' then
   if not exists(select 1 from papa_space_memberships where account_id=subject and space_id=verified->>'space_id' and role='player' and status='active')
    or not papa_communication_player_exists(verified->>'space_id',verified->>'player_id')
    or (case when verified->>'space_id'='space-001' then
     not exists(select 1 from papa_account_legacy_players where account_id=subject and legacy_player_id=verified->>'player_id')
    else not exists(select 1 from papa_space_player_profiles where account_id=subject and space_id=verified->>'space_id' and player_id=verified->>'player_id') end)
   then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
  elsif verified->>'role'='streamer_admin' then
   if not exists(select 1 from papa_manager_account_links where account_id=subject and manager_key='streamer:'||(verified->>'actor_streamer_id'))
    or not exists(select 1 from papa_space_memberships where account_id=subject and space_id=verified->>'space_id'
     and streamer_id=verified->>'actor_streamer_id' and role='streamer_admin' and status='active')
   then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
  elsif not exists(select 1 from papa_platform_roles where account_id=subject and role='president')
  then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
  ctx=ctx||verified;
  new.actor_role=case when verified->>'role' in ('admin','super_admin','president') then 'president' else verified->>'role' end;
  new.actor_player_id=case when verified->>'role'='player' then verified->>'player_id' else null end;
 end if;
 select space_id into identity_space from papa_space_streamers where streamer_id=new.streamer_id;
 if new.entity_kind='meta' and identity_space is not null and identity_space<>'space-001' then
  new.before_data=papa_native_meta_audit_projection(new.before_data,new.streamer_id);
  new.after_data=papa_native_meta_audit_projection(new.after_data,new.streamer_id);
  body=coalesce(new.after_data,new.before_data,'{}'::jsonb);
 end if;
 identity_space=coalesce(identity_space,new.space_id,nullif(ctx->>'space_id',''),'space-001');
 if ctx->>'account_id' ~ '^[a-f0-9-]{36}$' then new.actor_account_id=(ctx->>'account_id')::uuid;end if;
 if new.entity_kind='chat' and ctx->>'role' in ('player','streamer_admin','super_admin','admin')
 then new.actor_role=ctx->>'role';end if;
 if new.entity_kind='shared_catalog' and new.actor_account_id is null then
  if new.actor_role='president' then
   select account_id into new.actor_account_id from papa_manager_account_links where manager_key='president';
  elsif new.actor_role like 'streamer:%' then
   select account_id into new.actor_account_id from papa_manager_account_links where manager_key=new.actor_role;
  elsif new.actor_role like 'player:%' and identity_space='space-001' then
   actor_player=substring(new.actor_role from 8);
   select account_id into new.actor_account_id from papa_account_legacy_players where legacy_player_id=actor_player;
  end if;
 end if;
 if new.actor_role='streamer_admin' then actor_room=coalesce(nullif(ctx->>'actor_streamer_id',''),new.streamer_id);
 elsif new.actor_role like 'streamer:%' then actor_room=substring(new.actor_role from 10);end if;
 if actor_room is not null then
  new.actor_streamer_id=actor_room;
  select room->>'display_name' into new.actor_display_name_snapshot from jsonb_array_elements(papa_streamer_directory()) room
   where room->>'id'=actor_room limit 1;
 elsif new.actor_role in ('super_admin','admin','president') then new.actor_display_name_snapshot='PA Party總裁';
 elsif new.actor_role='system' then new.actor_display_name_snapshot='系統';
 elsif new.actor_role='player' or new.entity_kind='shared_catalog' and new.actor_role like 'player:%' then
  actor_player=coalesce(actor_player,new.actor_player_id,case when new.actor_role like 'player:%' then substring(new.actor_role from 8) end);
  new.actor_display_name_snapshot=papa_communication_player_name(identity_space,actor_player);
 end if;
 new.target_player_id=coalesce(nullif(body->>'playerId',''),nullif(body->>'player_id',''),
  case when new.entity_kind='players' then new.entity_id else null end);
 if new.target_player_id is not null then
  new.target_player_name_snapshot=coalesce(nullif(body->>'name',''),papa_communication_player_name(identity_space,new.target_player_id));
 end if;
 new.space_id=case when new.entity_kind='shared_catalog' and new.streamer_id='__global__' then null
  else coalesce((select space_id from papa_space_streamers where streamer_id=new.streamer_id),new.space_id) end;
 if new.space_id is null and not (new.entity_kind='shared_catalog' and new.streamer_id='__global__')
  and exists(select 1 from papa_spaces where id=ctx->>'space_id') then new.space_id=ctx->>'space_id';end if;
 return new;
end $$;
create function papa_board_history_snapshot() returns trigger
language plpgsql set search_path=public as $$
declare p papa_board_posts;ctx jsonb;local_key text;
begin
 select * into p from papa_board_posts where id=new.post_id;
 if p.id is null or new.space_id is not null and new.space_id<>p.space_id then raise exception 'BOARD_SPACE_MISMATCH';end if;
 new.space_id=p.space_id;ctx=coalesce(nullif(current_setting('papa.actor_context',true),''),'{}')::jsonb;
 if ctx->>'account_id' ~ '^[a-f0-9-]{36}$' then new.actor_account_id=(ctx->>'account_id')::uuid;end if;
 local_key=substring(new.actor_key from length(papa_communication_actor_key(p.space_id,''))+1);
 if local_key='super' then new.actor_display_name_snapshot='PA Party總裁';
 elsif left(local_key,7)='player:' then new.actor_display_name_snapshot=papa_communication_player_name(p.space_id,substring(local_key from 8));
 elsif left(local_key,9)='streamer:' then
  select room->>'display_name' into new.actor_display_name_snapshot from jsonb_array_elements(papa_streamer_directory_in_space(p.space_id)) room
   where room->>'id'=substring(local_key from 10) limit 1;
 end if;
 local_key=substring(p.author_key from length(papa_communication_actor_key(p.space_id,''))+1);
 if left(local_key,7)='player:' then new.target_player_id=substring(local_key from 8);
  new.target_player_name_snapshot=papa_communication_player_name(p.space_id,new.target_player_id);end if;
 return new;
end $$;
create trigger papa_board_history_snapshot_trigger before insert on papa_board_history
for each row execute function papa_board_history_snapshot();

create function papa_chat_send_in_space(room text,player text,side text,sender text,content text,request_id uuid,
 room_name text,player_name text,allowed_space text,actor_context jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx jsonb;expected_side text;expected_sender text;
begin
 ctx=papa_communication_context(allowed_space,room,actor_context);
 expected_side=case when ctx->>'role'='player' then 'player' else 'manager' end;
 expected_sender=case when ctx->>'role'='player' then ctx->>'player_id'
  when ctx->>'role'='streamer_admin' then 'streamer:'||room else 'super' end;
 if side is distinct from expected_side or sender is distinct from expected_sender
  or ctx->>'role'='player' and player is distinct from ctx->>'player_id'
  or not papa_communication_player_exists(allowed_space,player)
 then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
 perform set_config('papa.actor_context',ctx::text,true);
 return papa_chat_send(room,player,side,sender,content,request_id,room_name,
  papa_communication_player_name(allowed_space,player));
end $$;
create function papa_chat_read_in_space(room text,player text,reader_key text,through_seq bigint,
 allowed_space text,actor_context jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare ctx jsonb;expected_reader text;
begin
 ctx=papa_communication_context(allowed_space,room,actor_context);
 expected_reader=case ctx->>'role' when 'player' then 'player' when 'streamer_admin' then 'streamer' else 'super' end;
 if reader_key is distinct from expected_reader or not papa_communication_player_exists(allowed_space,player)
  or ctx->>'role'='player' and player is distinct from ctx->>'player_id'
 then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
 perform papa_chat_read(room,player,reader_key,through_seq);
end $$;

create function papa_chat_page_in_space(room text,player text,before_seq bigint,after_seq bigint,
 allowed_space text,actor_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare ctx jsonb;rows_json jsonb;receipts jsonb;
begin
 ctx=papa_communication_context(allowed_space,room,actor_context);
 if before_seq is not null and after_seq is not null or before_seq is not null and before_seq<1
  or after_seq is not null and after_seq<0 or not papa_communication_player_exists(allowed_space,player)
  or ctx->>'role'='player' and player is distinct from ctx->>'player_id'
 then raise exception 'COMMUNICATION_ACTOR_INVALID';end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by case when after_seq is null then -m.seq else m.seq end),'[]'::jsonb)
 into rows_json from (select id,seq,sender_side,body,created_at from papa_chat_messages
  where streamer_id=room and player_id=player and (before_seq is null or seq<before_seq) and (after_seq is null or seq>after_seq)
  order by case when after_seq is null then -seq else seq end limit 51) m;
 select coalesce(jsonb_agg(jsonb_build_object('reader',reader,'last_seq',last_seq)),'[]'::jsonb) into receipts
 from papa_chat_reads where streamer_id=room and player_id=player;
 return jsonb_build_object('rows',rows_json,'receipts',receipts);
end $$;

create function papa_board_participants_in_space(post_id uuid,allowed_space text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from papa_board_posts where id=post_id and space_id=allowed_space and root_id is null)
 then raise exception 'BOARD_SPACE_MISMATCH';end if;
 return (select coalesce(jsonb_agg(author_key),'[]'::jsonb) from
  (select distinct author_key from papa_board_posts where space_id=allowed_space and (id=post_id or root_id=post_id)) p);
end $$;
create function papa_board_recipient_blocks_in_space(owner_keys text[],allowed_space text)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('owner',owner_key,'target',target_key)),'[]'::jsonb)
 from papa_board_blocks where space_id=allowed_space and owner_key=any(owner_keys);
$$;
create function papa_board_create_in_space(payload jsonb,notices jsonb,allowed_space text,actor_context jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx jsonb;expected_key text;target text;n jsonb;r papa_board_posts;
begin
 ctx=papa_communication_context(allowed_space,actor_context->>'streamer_id',actor_context,true);
 expected_key=papa_communication_actor_key(allowed_space,case ctx->>'role' when 'player' then 'player:'||(ctx->>'player_id')
  when 'streamer_admin' then 'streamer:'||(ctx->>'actor_streamer_id') else 'super' end);
 if payload->>'space_id' is distinct from allowed_space or payload->>'author_key' is distinct from expected_key
  or payload->>'scope' is null or payload->>'scope' not in ('global','streamer')
  or payload->>'streamer_id' is distinct from (case when payload->>'scope'='global' then papa_board_room_key(allowed_space) else ctx->>'streamer_id' end)
  or not exists(select 1 from papa_space_streamers where streamer_id=payload->>'origin_room' and space_id=allowed_space)
  or jsonb_typeof(payload->'targets') is distinct from 'array' or jsonb_array_length(payload->'targets')>50
 then raise exception 'BOARD_SPACE_MISMATCH';end if;
 for target in select jsonb_array_elements_text(payload->'targets') loop
  if not papa_communication_key_exists(allowed_space,target) then raise exception 'BOARD_SPACE_MISMATCH';end if;
 end loop;
 if payload->>'root_id' is not null then
  select * into r from papa_board_posts where id=(payload->>'root_id')::uuid;
  if r.id is null or r.space_id<>allowed_space or r.streamer_id<>payload->>'streamer_id' or r.origin_room<>payload->>'origin_room'
  then raise exception 'BOARD_SPACE_MISMATCH';end if;
 elsif payload->>'origin_room' is distinct from ctx->>'streamer_id' then raise exception 'BOARD_SPACE_MISMATCH';end if;
 if jsonb_typeof(notices) is distinct from 'array' then raise exception 'BOARD_SPACE_MISMATCH';end if;
 for n in select jsonb_array_elements(notices) loop
  if not exists(select 1 from papa_space_streamers where streamer_id=n->>'room' and space_id=allowed_space)
   or n->>'recipient' is null or n->>'recipient' not in ('__admin__','__super__') and not papa_communication_player_exists(allowed_space,n->>'recipient')
  then raise exception 'BOARD_SPACE_MISMATCH';end if;
 end loop;
 perform set_config('papa.actor_context',ctx::text,true);
 return papa_board_create(payload,notices);
end $$;

-- Keep the existing version/moderation transaction, recognizing the qualified
-- actor keys for native Spaces. Space 001 predicates remain equivalent.
create or replace function papa_board_change(post_id uuid,expected int,actor_key text,operation text,content text)
returns void language plpgsql security definer set search_path=public as $$
declare m papa_board_posts;moderator boolean;
begin
 select * into m from papa_board_posts where id=post_id for update;
 if m.id is null or m.version<>expected then raise exception 'VERSION_CONFLICT';end if;
 if operation not in ('edit','remove','restore') then raise exception 'Invalid action';end if;
 moderator=actor_key=papa_communication_actor_key(m.space_id,'super')
  or m.scope='streamer' and actor_key=papa_communication_actor_key(m.space_id,'streamer:'||m.streamer_id);
 if m.moderated and not moderator then raise exception 'BOARD_MODERATED';end if;
 if operation='edit' and (m.deleted or actor_key<>m.author_key) then raise exception 'BOARD_MODERATED';end if;
 insert into papa_board_history(post_id,actor_key,action,before_data) values(m.id,actor_key,operation,to_jsonb(m));
 update papa_board_posts set body=case when operation='edit' then content else body end,
  deleted=case when operation='remove' then true when operation='restore' then false else deleted end,
  moderated=case when operation='remove' then m.moderated or actor_key<>m.author_key when operation='restore' then false else m.moderated end,
  version=version+1,updated_at=now() where id=m.id;
end $$;
create function papa_board_change_in_space(post_id uuid,expected int,actor_key text,operation text,content text,
 allowed_space text,actor_context jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare ctx jsonb;p papa_board_posts;expected_key text;moderator boolean;
begin
 ctx=papa_communication_context(allowed_space,actor_context->>'streamer_id',actor_context,true);
 expected_key=papa_communication_actor_key(allowed_space,case ctx->>'role' when 'player' then 'player:'||(ctx->>'player_id')
  when 'streamer_admin' then 'streamer:'||(ctx->>'actor_streamer_id') else 'super' end);
 select * into p from papa_board_posts where id=post_id;
 if p.id is null or p.space_id<>allowed_space or actor_key is distinct from expected_key
  or p.scope='streamer' and p.streamer_id is distinct from ctx->>'streamer_id'
 then raise exception 'BOARD_SPACE_MISMATCH';end if;
 moderator=ctx->>'role' in ('admin','super_admin') or ctx->>'role'='streamer_admin'
  and p.scope='streamer' and p.streamer_id=ctx->>'actor_streamer_id';
 if operation='edit' and (p.author_key<>actor_key or p.deleted or p.moderated)
  or operation in ('remove','restore') and not (moderator or p.author_key=actor_key and not p.moderated)
 then raise exception 'BOARD_MODERATED';end if;
 perform set_config('papa.actor_context',ctx::text,true);
 perform papa_board_change(post_id,expected,actor_key,operation,content);
end $$;

-- All new entry points and helpers remain behind the authenticated Edge.
do $$ declare signature regprocedure;begin
 for signature in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
  and proname in ('papa_communication_player_name','papa_communication_player_exists','papa_communication_player_names',
   'papa_board_directory_in_space','papa_communication_actor_key','papa_board_room_key','papa_communication_key_exists',
   'papa_communication_context','papa_board_space_guard','papa_board_block_space_guard','papa_board_history_snapshot','papa_native_meta_audit_projection',
   'papa_chat_send_in_space','papa_chat_read_in_space','papa_chat_page_in_space','papa_board_participants_in_space','papa_board_recipient_blocks_in_space',
   'papa_board_create_in_space','papa_board_change_in_space')
 loop execute format('revoke all on function %s from public,anon,authenticated',signature);
  execute format('grant execute on function %s to service_role',signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;
