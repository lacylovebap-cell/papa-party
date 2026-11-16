-- 玩家在任何主播頁都能收到「取得勳章」動畫彈窗：
-- 1) papa_notice_inbox 額外回傳 crossAchievements（同玩家其他房間、10 分鐘內、未讀的勳章通知，最多 5 筆）。
-- 2) papa_notice_wakeup 對玩家的「取得勳章」通知，也對該玩家其他房間的即時頻道發訊號。
create or replace function public.papa_notice_inbox(room text, owner_id text, page_number integer default 0)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare pref jsonb;result jsonb;unread jsonb;ch text;cross_rows jsonb;
begin
 insert into papa_notice_preferences(streamer_id,recipient) values(room,owner_id) on conflict do nothing;
 select preferences,topic into pref,ch from papa_notice_preferences where streamer_id=room and recipient=owner_id;
 select coalesce(jsonb_agg(to_jsonb(n)),'[]') into result from (select * from papa_notifications where recipient=owner_id and (streamer_id=room or (room='__global__' and owner_id='__super__')) order by created_at desc,id desc limit 51 offset greatest(0,page_number)*50) n;
 select coalesce(jsonb_object_agg(type,n),'{}') into unread from (select type,count(*) n from papa_notifications where recipient=owner_id and (streamer_id=room or (room='__global__' and owner_id='__super__')) and read_at is null group by type) c;
 if left(owner_id,2)<>'__' and page_number=0 then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into cross_rows from (select id,streamer_id,streamer_name,type,body,entity_id,created_at from papa_notifications where recipient=owner_id and type='achievement' and streamer_id<>room and read_at is null and created_at>now()-interval '10 minutes' order by created_at desc limit 5) x;
 else cross_rows='[]'::jsonb; end if;
 return jsonb_build_object('rows',result,'preferences',pref,'unread',unread,'topic',ch,'crossAchievements',cross_rows);
end $function$;

create or replace function public.papa_notice_wakeup()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare ch text;pref_room text;peer record;
begin
 pref_room=case when NEW.recipient='__super__' then '__global__' else NEW.streamer_id end;
 insert into papa_notice_preferences(streamer_id,recipient) values(pref_room,NEW.recipient) on conflict do nothing;
 select topic into ch from papa_notice_preferences where streamer_id=pref_room and recipient=NEW.recipient;
 begin perform realtime.send('{}'::jsonb,'changed','papa-notice:'||ch,false);exception when others then null;end;
 if NEW.type='achievement' and left(NEW.recipient,2)<>'__' then
  for peer in select distinct topic from papa_notice_preferences where recipient=NEW.recipient and topic is not null and topic<>ch loop
   begin perform realtime.send('{}'::jsonb,'changed','papa-notice:'||peer.topic,false);exception when others then null;end;
  end loop;
 end if;
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
