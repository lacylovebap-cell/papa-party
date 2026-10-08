begin;

-- Current production preflight: all 1,057 notification rows map to one of
-- eight known streamer IDs. Preserve IDs, bodies, read state and jobs.
alter table public.papa_notifications
 add column space_id text references public.papa_spaces(id);
update public.papa_notifications n set space_id=m.space_id
from public.papa_space_streamers m
where n.streamer_id=m.streamer_id;
do $$ begin
 if exists(select 1 from public.papa_notifications where space_id is null)
 then raise exception 'NOTIFICATION_SPACE_BACKFILL_INCOMPLETE'; end if;
end $$;
alter table public.papa_notifications alter column space_id set not null;
create index papa_notice_space_recipient_date
 on public.papa_notifications(space_id,recipient,created_at desc,id desc);

create function public.papa_notification_space_guard() returns trigger
language plpgsql set search_path=public as $$
declare mapped text;
begin
 select space_id into mapped from public.papa_space_streamers
 where streamer_id=new.streamer_id;
 if mapped is null then raise exception 'UNKNOWN_NOTIFICATION_STREAMER'; end if;
 if new.space_id is not null and new.space_id<>mapped
 then raise exception 'NOTIFICATION_SPACE_MISMATCH'; end if;
 if tg_op='UPDATE' and old.space_id<>mapped
 then raise exception 'NOTIFICATION_MOVE_REQUIRES_EXPLICIT_MIGRATION'; end if;
 new.space_id:=mapped;
 return new;
end $$;
create trigger papa_notification_space_guard_trigger
before insert or update on public.papa_notifications
for each row execute function public.papa_notification_space_guard();
revoke all on function public.papa_notification_space_guard()
 from public,anon,authenticated;

commit;
