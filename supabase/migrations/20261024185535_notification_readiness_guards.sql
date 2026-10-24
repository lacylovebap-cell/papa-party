-- Non-destructive: replace existing bounded worker only. No data backfill, new table, or scheduler frequency change.
create or replace function public.papa_queue_prepare_due() returns int language plpgsql security definer set search_path=public,pg_temp as $$
declare row_data record; q jsonb; room_name text; done int=0; due_time timestamptz=clock_timestamp();
begin
 -- Serialize with normal commits; bump revision only when a queue changes.
 if not exists(select 1 from papa_v2_entities where kind='queue' and data->>'status'='waiting' and data->>'preparationEndsAt'<=to_char(due_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') and coalesce(data->>'readyAt','')='' and coalesce(data->>'archived_at','')='' and coalesce(data->>'voided_at','')='' and coalesce(data->>'awaitingAcknowledgment','false')<>'true' and coalesce(data->>'awaitingPreparation','false')<>'true') then return 0;end if;
 perform 1 from papa_v2_revision where id=1 for update;
 perform set_config('papa.actor_context','{"role":"system","action":"queue:ready"}',true);
 for row_data in select id,data from papa_v2_entities where kind='queue' and data->>'status'='waiting' and data->>'preparationEndsAt'<=to_char(due_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') and coalesce(data->>'readyAt','')='' and coalesce(data->>'archived_at','')='' and coalesce(data->>'voided_at','')='' and coalesce(data->>'awaitingAcknowledgment','false')<>'true' and coalesce(data->>'awaitingPreparation','false')<>'true' order by data->>'preparationEndsAt' limit 50 for update loop
  q=row_data.data;
  update papa_v2_entities set data=data||jsonb_build_object('readyAt',due_time,'stage','已準備好') where kind='queue' and id=row_data.id;
  if nullif(q->>'playerId','') is not null then
   select r->>'display_name' into room_name from papa_v2_entities m cross join lateral jsonb_array_elements(m.data->'streamers') r where m.kind='meta' and m.id='1' and r->>'id'=q->>'streamer_id';
   insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,entity_id,body)
   values(q->>'streamer_id',coalesce(room_name,'主播'),q->>'playerId','ready',2,row_data.id,coalesce(room_name,'主播')||'｜《'||coalesce(q->>'title','歌曲')||'》準備好演唱囉 🎤');
  end if;
  done=done+1;
 end loop;
 if done>0 then update papa_v2_revision set revision=revision+1 where id=1;end if;
 return done;
end $$;
revoke all on function public.papa_queue_prepare_due() from public,anon,authenticated;
grant execute on function public.papa_queue_prepare_due() to service_role;
