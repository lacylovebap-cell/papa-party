-- Rollback for 20261031161000_player_push_any_room.sql: the previous papa_notice_wakeup (same-room jobs only).
create or replace function public.papa_notice_wakeup()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare ch text;pref_room text;
begin
 pref_room=case when NEW.recipient='__super__' then '__global__' else NEW.streamer_id end;
 insert into papa_notice_preferences(streamer_id,recipient) values(pref_room,NEW.recipient) on conflict do nothing;
 select topic into ch from papa_notice_preferences where streamer_id=pref_room and recipient=NEW.recipient;
 begin perform realtime.send('{}'::jsonb,'changed','papa-notice:'||ch,false);exception when others then null;end;
 if TG_OP='INSERT' then
  insert into papa_push_jobs(notice_id,subscription_id) select NEW.id,id from papa_push_subscriptions where streamer_id=pref_room and recipient=NEW.recipient;
  if NEW.recipient='__admin__' then
   insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,created_at) values(NEW.streamer_id,NEW.streamer_name,'__super__',NEW.type,NEW.level,NEW.body,NEW.entity_id,NEW.created_at);
  end if;
 end if;
 return NEW;
end $function$;
