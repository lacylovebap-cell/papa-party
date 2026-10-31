-- 10.31-PUSH.2: a player turns push on once, on whichever streamer's page they are
-- reading. Before, a notice only reached subscriptions registered under the same
-- room, so turning push on at 咪醬's page never delivered 怕怕's notices.
-- Players (recipients not starting with '__') now also get one job per device they
-- enabled under any other room of the same Space. Managers are unchanged.
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
  if left(NEW.recipient,2)<>'__' then
   insert into papa_push_jobs(notice_id,subscription_id)
   select distinct on (s.endpoint) NEW.id,s.id from papa_push_subscriptions s
    join papa_space_streamers other on other.streamer_id=s.streamer_id and other.deleted_at is null
    join papa_space_streamers here on here.streamer_id=NEW.streamer_id and here.space_id=other.space_id
   where s.recipient=NEW.recipient and s.streamer_id<>pref_room
    and not exists(select 1 from papa_push_subscriptions same where same.streamer_id=pref_room and same.recipient=NEW.recipient and same.endpoint=s.endpoint)
   order by s.endpoint,s.created_at desc;
  end if;
  if NEW.recipient='__admin__' then
   insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,created_at) values(NEW.streamer_id,NEW.streamer_name,'__super__',NEW.type,NEW.level,NEW.body,NEW.entity_id,NEW.created_at);
  end if;
 end if;
 return NEW;
end $function$;
