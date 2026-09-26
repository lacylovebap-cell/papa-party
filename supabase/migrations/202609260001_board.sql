begin;
insert into papa_release_backups(release,snapshot) values('9.24-C.2-before',papa_v2_snapshot()) on conflict do nothing;
create table if not exists papa_board_posts(
 id uuid primary key default gen_random_uuid(),seq bigserial unique not null,
 scope text not null check(scope in ('global','streamer')),streamer_id text not null,origin_room text not null,
 root_id uuid references papa_board_posts(id),author_key text not null,anonymous boolean not null default false,
 visibility text not null check(visibility in ('public','include','exclude','streamers')),targets jsonb not null default '[]',
 body text not null check(length(body) between 1 and 2000),deleted boolean not null default false,
 version int not null default 1,client_id uuid not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(author_key,client_id),check(jsonb_typeof(targets)='array'),check((scope='global')=(streamer_id='__global__')));
create index if not exists papa_board_feed on papa_board_posts(streamer_id,seq desc);
create index if not exists papa_board_thread on papa_board_posts(root_id,seq desc);
create table if not exists papa_board_blocks(owner_key text not null,target_key text not null,created_at timestamptz not null default now(),primary key(owner_key,target_key),check(owner_key<>target_key));
create table if not exists papa_board_history(id bigserial primary key,post_id uuid not null references papa_board_posts(id),actor_key text not null,action text not null,before_data jsonb,created_at timestamptz not null default now());
alter table papa_board_posts enable row level security;
alter table papa_board_blocks enable row level security;
alter table papa_board_history enable row level security;
revoke all on papa_board_posts,papa_board_blocks,papa_board_history from anon,authenticated;
grant all on papa_board_posts,papa_board_blocks,papa_board_history to service_role;
grant usage,select on sequence papa_board_posts_seq_seq,papa_board_history_id_seq to service_role;

create or replace function papa_board_create(payload jsonb,notices jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare m papa_board_posts;r papa_board_posts;
begin
 perform pg_advisory_xact_lock(hashtextextended(payload->>'author_key',2));
 select * into m from papa_board_posts where author_key=payload->>'author_key' and client_id=(payload->>'client_id')::uuid;
 if m.id is not null then
  if m.body<>payload->>'body' or m.scope<>payload->>'scope' or m.streamer_id<>payload->>'streamer_id' or m.root_id is distinct from (payload->>'root_id')::uuid or m.anonymous<>(payload->>'anonymous')::boolean or m.visibility<>payload->>'visibility' or m.targets<>payload->'targets' then raise exception 'BOARD_RETRY_CHANGED';end if;
  return jsonb_build_object('id',m.id,'seq',m.seq);
 end if;
 if exists(select 1 from papa_board_posts where author_key=payload->>'author_key' and created_at>now()-interval '3 seconds') then raise exception 'BOARD_RATE_LIMIT';end if;
 if payload->>'root_id' is not null then
  select * into r from papa_board_posts where id=(payload->>'root_id')::uuid for update;
  if r.id is null or r.root_id is not null or r.deleted or r.streamer_id<>payload->>'streamer_id' or r.visibility<>payload->>'visibility' or r.targets<>payload->'targets' then raise exception 'VERSION_CONFLICT';end if;
 end if;
 insert into papa_board_posts(scope,streamer_id,origin_room,root_id,author_key,anonymous,visibility,targets,body,client_id)
 values(payload->>'scope',payload->>'streamer_id',payload->>'origin_room',(payload->>'root_id')::uuid,payload->>'author_key',(payload->>'anonymous')::boolean,payload->>'visibility',payload->'targets',payload->>'body',(payload->>'client_id')::uuid) returning * into m;
 insert into papa_board_history(post_id,actor_key,action) values(m.id,m.author_key,'create');
 insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id)
 select n->>'room',n->>'name',n->>'recipient','comment',1,n->>'body',m.id::text from jsonb_array_elements(notices) n;
 return jsonb_build_object('id',m.id,'seq',m.seq);
end $$;
create or replace function papa_board_change(post_id uuid,expected int,actor_key text,operation text,content text) returns void language plpgsql security definer set search_path=public as $$
declare m papa_board_posts;
begin
 select * into m from papa_board_posts where id=post_id for update;
 if m.id is null or m.version<>expected then raise exception 'VERSION_CONFLICT';end if;
 if operation not in ('edit','remove','restore') then raise exception 'Invalid action';end if;
 insert into papa_board_history(post_id,actor_key,action,before_data) values(m.id,actor_key,operation,to_jsonb(m));
 update papa_board_posts set body=case when operation='edit' then content else body end,deleted=case when operation='remove' then true when operation='restore' then false else deleted end,version=version+1,updated_at=now() where id=m.id;
end $$;
revoke all on function papa_board_create(jsonb,jsonb),papa_board_change(uuid,int,text,text,text) from public,anon,authenticated;
grant execute on function papa_board_create(jsonb,jsonb),papa_board_change(uuid,int,text,text,text) to service_role;
commit;
