begin;
insert into papa_release_backups(release,snapshot) values('9.24-C.2.1-before',jsonb_build_object(
 'business',papa_v2_snapshot(),
 'board_posts',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from papa_board_posts p),
 'board_blocks',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from papa_board_blocks p),
 'board_history',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from papa_board_history p),
 'chat_messages',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from papa_chat_messages p),
 'chat_reads',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from papa_chat_reads p))) on conflict do nothing;
alter table papa_board_posts add column if not exists moderated boolean not null default false;
-- Only currently hidden posts whose latest removal was by a moderator acquire a hold.
update papa_board_posts p set moderated=true where p.deleted and not p.moderated and exists(
 select 1 from (select distinct on(post_id) post_id,actor_key,action from papa_board_history where action in ('remove','restore') order by post_id,id desc) h
 where h.post_id=p.id and h.action='remove' and h.actor_key<>p.author_key);

create or replace function papa_board_change(post_id uuid,expected int,actor_key text,operation text,content text) returns void language plpgsql security definer set search_path=public as $$
declare m papa_board_posts;
begin
 select * into m from papa_board_posts where id=post_id for update;
 if m.id is null or m.version<>expected then raise exception 'VERSION_CONFLICT';end if;
 if operation not in ('edit','remove','restore') then raise exception 'Invalid action';end if;
 if m.moderated and not (actor_key='super' or m.scope='streamer' and actor_key='streamer:'||m.streamer_id) then raise exception 'BOARD_MODERATED';end if;
 if operation='edit' and (m.deleted or actor_key<>m.author_key) then raise exception 'BOARD_MODERATED';end if;
 insert into papa_board_history(post_id,actor_key,action,before_data) values(m.id,actor_key,operation,to_jsonb(m));
 update papa_board_posts set body=case when operation='edit' then content else body end,
  deleted=case when operation='remove' then true when operation='restore' then false else deleted end,
  moderated=case when operation='remove' then m.moderated or actor_key<>m.author_key when operation='restore' then false else m.moderated end,
  version=version+1,updated_at=now() where id=m.id;
end $$;

create or replace function papa_board_participants(post_id uuid) returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(author_key),'[]'::jsonb) from (select distinct author_key from papa_board_posts where id=post_id or root_id=post_id) p;
$$;
create or replace function papa_board_recipient_blocks(owner_keys text[]) returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('owner',owner_key,'target',target_key)),'[]'::jsonb) from papa_board_blocks where owner_key=any(owner_keys);
$$;
revoke all on function papa_board_change(uuid,int,text,text,text),papa_board_participants(uuid),papa_board_recipient_blocks(text[]) from public,anon,authenticated;
grant execute on function papa_board_change(uuid,int,text,text,text),papa_board_participants(uuid),papa_board_recipient_blocks(text[]) to service_role;
commit;
