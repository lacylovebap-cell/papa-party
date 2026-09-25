begin;
insert into papa_release_backups(release,snapshot) values('9.24-C.1-before',papa_v2_snapshot()) on conflict do nothing;
create table if not exists papa_chat_messages(
 id uuid primary key default gen_random_uuid(),seq bigserial unique not null,
 streamer_id text not null,player_id text not null,sender_side text not null check(sender_side in ('player','manager')),
 sender_id text not null,body text not null check(length(body) between 1 and 2000),client_id uuid not null,
 created_at timestamptz not null default now(),unique(streamer_id,player_id,sender_id,client_id));
create index if not exists papa_chat_thread_seq on papa_chat_messages(streamer_id,player_id,seq desc);
create table if not exists papa_chat_reads(streamer_id text not null,player_id text not null,reader text not null check(reader in ('player','streamer','super')),last_seq bigint not null default 0,primary key(streamer_id,player_id,reader));
alter table papa_chat_messages enable row level security;
alter table papa_chat_reads enable row level security;
revoke all on papa_chat_messages,papa_chat_reads from anon,authenticated;
grant all on papa_chat_messages,papa_chat_reads to service_role;
grant usage,select on sequence papa_chat_messages_seq_seq to service_role;

create or replace function papa_chat_send(room text,player text,side text,sender text,content text,request_id uuid,room_name text,player_name text) returns jsonb language plpgsql security definer set search_path=public as $$
declare m papa_chat_messages;
begin
 perform pg_advisory_xact_lock(hashtextextended(room||':'||player||':'||sender,0));
 select * into m from papa_chat_messages where streamer_id=room and player_id=player and sender_id=sender and client_id=request_id;
 if m.id is not null then
  if m.body<>content then raise exception 'CHAT_REQUEST_REUSED';end if;
  return to_jsonb(m);
 end if;
 if exists(select 1 from papa_chat_messages where streamer_id=room and player_id=player and sender_id=sender and created_at>now()-interval '2 seconds') then raise exception 'CHAT_RATE_LIMIT';end if;
 insert into papa_chat_messages(streamer_id,player_id,sender_side,sender_id,body,client_id) values(room,player,side,sender,content,request_id) returning * into m;
 insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id)
 values(room,room_name,case when side='player' then '__admin__' else player end,'message',2,room_name||'｜'||case when side='player' then player_name||' 傳來私人訊息' else '你收到新的私人訊息' end,m.id::text);
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,effective_at,after_data)
 values(room,'chat',m.id::text,'chat_send',case when side='player' then 'player' else 'manager' end,case when side='player' then player else null end,m.created_at::text,jsonb_build_object('player_id',player,'sender_side',side));
 return to_jsonb(m);
end $$;

create or replace function papa_chat_inbox(room text,owner_player text,reader_key text,page_number int default 0) returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
  select latest.player_id,latest.body,latest.created_at,latest.seq,
   (select count(*) from papa_chat_messages m where m.streamer_id=room and m.player_id=latest.player_id and m.sender_side=case when reader_key='player' then 'manager' else 'player' end and m.seq>coalesce((select r.last_seq from papa_chat_reads r where r.streamer_id=room and r.player_id=m.player_id and r.reader=reader_key),0)) unread
  from (select distinct on(player_id) player_id,body,created_at,seq from papa_chat_messages where streamer_id=room and (owner_player is null or player_id=owner_player) order by player_id,seq desc) latest
  order by latest.seq desc limit 51 offset greatest(0,least(page_number,100000))*50
 ) t;
$$;
create or replace function papa_chat_read(room text,player text,reader_key text,through_seq bigint) returns void language plpgsql security definer set search_path=public as $$
declare capped bigint;recipient_key text;
begin
 select coalesce(max(seq),0) into capped from papa_chat_messages where streamer_id=room and player_id=player and seq<=through_seq;
 insert into papa_chat_reads values(room,player,reader_key,capped) on conflict(streamer_id,player_id,reader) do update set last_seq=greatest(papa_chat_reads.last_seq,excluded.last_seq);
 recipient_key:=case reader_key when 'player' then player when 'streamer' then '__admin__' else '__super__' end;
 update papa_notifications n set read_at=coalesce(read_at,now()) where n.streamer_id=room and n.recipient=recipient_key and n.type='message' and n.read_at is null and exists(select 1 from papa_chat_messages m where m.id::text=n.entity_id and m.streamer_id=room and m.player_id=player and m.seq<=capped);
end $$;
revoke all on function papa_chat_send(text,text,text,text,text,uuid,text,text),papa_chat_inbox(text,text,text,int),papa_chat_read(text,text,text,bigint) from public,anon,authenticated;
grant execute on function papa_chat_send(text,text,text,text,text,uuid,text,text),papa_chat_inbox(text,text,text,int),papa_chat_read(text,text,text,bigint) to service_role;
commit;
