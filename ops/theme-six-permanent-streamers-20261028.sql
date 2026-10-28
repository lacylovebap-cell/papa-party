-- 六位永久免費全功能主播：主題功能開通（需總裁先核對，不可只靠名稱）
-- 前提：已套用 supabase/migrations/20261028040000_homepage_themes.sql
-- 此檔不建立、不修改、不刪除任何主播帳號、歌曲、玩家或歷史資料。

-- 步驟 1（唯讀）：列出正式資料庫現有主播 ID 與名稱，人工核對六位的 streamer_id。
select s->>'id' as streamer_id, s->>'slug' as slug, s->>'display_name' as display_name,
       coalesce(s->>'spaceId','space-001') as space_id, (s->>'active')::boolean as active
from papa_v2_entities e, jsonb_array_elements(e.data->'streamers') s
where e.kind='meta' and e.id='1'
order by display_name;

-- 步驟 2：把核對後的 ID 填入下列陣列再執行。'papa' 已在程式中確認為怕怕；
-- 其餘五位請以步驟 1 結果替換 <...>，未確認的請刪掉該行，不要猜。
-- 以複製主播功能建立的新主播使用新的 streamer_id，不會因此繼承資格。
begin;
insert into papa_streamer_plans(streamer_id,plan,status,valid_until,features,updated_at)
select id,'lifetime_free_full','active',null,'{}',now()
from unnest(array[
 'papa'            -- 怕怕
 -- ,'<米雪的 streamer_id>'
 -- ,'<咪醬的 streamer_id>'
 -- ,'<風間駿的 streamer_id>'
 -- ,'<樹兒的 streamer_id>'
 -- ,'<小楓的 streamer_id>'
]) id
where exists(select 1 from papa_v2_entities e, jsonb_array_elements(e.data->'streamers') s
             where e.kind='meta' and e.id='1' and s->>'id'=id)
on conflict(streamer_id) do update set plan='lifetime_free_full',status='active',valid_until=null,updated_at=now();
-- 核對：應回傳實際填入的筆數，名稱需與上方一致
select p.streamer_id, s->>'display_name' as display_name, p.plan, p.status
from papa_streamer_plans p
join papa_v2_entities e on e.kind='meta' and e.id='1'
join lateral jsonb_array_elements(e.data->'streamers') s on s->>'id'=p.streamer_id
where p.plan='lifetime_free_full';
commit;
