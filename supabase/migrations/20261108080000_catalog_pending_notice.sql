-- 11.08-CATN.3: 共同曲庫有新待審 → 通知總裁號（不出聲；前端對 entity_id='catalog-review' 不播音效）
-- 同一批新增只會有一則通知；10 分鐘內仍未讀就合併成同一則（更新數字），避免洗版。
create or replace function public.papa_catalog_pending_notice() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare added int;total int;msg text;hit uuid;
begin
 begin
 select count(*) into added from new_rows where status='pending';
 if added=0 then return null;end if;
 select count(*) into total from papa_catalog_candidates where status='pending';
 msg='共同曲庫有 '||added||' 首新歌待審核（目前共 '||total||' 筆待審）';
 select id into hit from papa_notifications
  where recipient='__super__' and entity_id='catalog-review' and read_at is null and created_at>now()-interval '10 minutes'
  order by created_at desc limit 1;
 if hit is not null then
  update papa_notifications set body=msg where id=hit;
 else
  insert into papa_notifications(streamer_id,streamer_name,recipient,type,level,body,entity_id,space_id)
  values('papa','共同曲庫','__super__','system',2,msg,'catalog-review','space-001');
 end if;
 exception when others then null;
 end;
 return null;
end $$;
revoke all on function public.papa_catalog_pending_notice() from public,anon,authenticated;
drop trigger if exists papa_catalog_pending_notice_t on public.papa_catalog_candidates;
create trigger papa_catalog_pending_notice_t after insert on public.papa_catalog_candidates
 referencing new table as new_rows for each statement execute function public.papa_catalog_pending_notice();
