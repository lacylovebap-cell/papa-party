begin;
-- Applies only as part of the complete badge release. No source/history rows removed.
alter table public.papa_achievement_catalog
 add column badge_id text unique,add column emoji text,add column category text,
 add column badge_scope text not null default 'streamer',add column retired boolean not null default false;
alter table public.papa_achievement_awards add column expires_at timestamptz,add column rule_version integer not null default 1;
insert into public.papa_achievement_catalog(code,name,condition_text,lifetime,default_visibility,badge_id,emoji,category,badge_scope,retired) values
('first_live','今日第一點','當日第一位有效現點者，保留名額，完成該次演唱後授予。','24h','public','P01','🔥','點歌','streamer',false),
('night','夜貓點歌台','23:00–隔日05:00現點5首且完成演唱。','24h','public','P02','🌙','點歌','streamer',false),
('no_sleep','今晚不睡','01:00–05:00現點累積5首；直接新增存歌、未唱及轉存也算，同筆不重複計。','24h','public','P03','🍻','點歌','streamer',false),
('big_requester','點歌大戶','3日內現點累積100首；直接新增存歌、未唱及轉存也算，按首數計，達標永久保留。','permanent','public','P04','🚩','點歌','streamer',false),
('house','把這當自己家','近30個日曆日內15個不同日期現點現唱；按點歌日認列，少於15天撤下。','rolling30','public','P05','🏠','點歌','streamer',false),
('triple','三連發','本人順序連續3首現點在30分鐘內，之後全部唱完可取得；本人未唱或轉存中斷，其他玩家不影響。','24h','public','P06','⚡','點歌','streamer',false),
('categories','什麼都聽','本人現點或提歌且唱完，累積至少10個不同歌曲標籤；同歌多標籤全部計入。','permanent','public','P07','💯','點歌','streamer',false),
('sad3','今晚有故事','同場本人順序連續現點5首並唱完，5首共有至少一個標籤；本人未唱或轉存中斷。','24h','public','P08','💔','點歌','streamer',false),
('sweet3','甜度超標','同晚連續現場點3首甜歌／戀愛歌','show','public','P09',null,'點歌','streamer',true),
('ancient3','穿越人士','同晚現場點3首古風歌','show','public','P10',null,'點歌','streamer',true),
('cold30','冷門守護者','同主播所有玩家中，距同名歌上一次完成演唱超過30天；本次唱完時達標即可，從未唱完者排除。','permanent','public','P11','🧊','點歌','streamer',false),
('popular_show','大家都在點','每19:00結算前場最多不同玩家點的同名歌，至少2位；並列歌曲各取最後一位已唱完者，保留到再下一次19:00。','show','public','P12','🔥','點歌','streamer',false),
('same_song_show','英雄所見略同','同場同名歌至少2位不同玩家各自唱完後開始授予，各位及之後符合者均可取得。','show','public','P13','🤝','點歌','streamer',false),
('dice20','命運選歌王','實際使用骰子功能點歌或提歌，完成演唱累積20次；系統自帶及手選自帶不算。','permanent','public','P14','🎰','點歌','streamer',false),
('dice_repeat','又是你','3天內骰子點同名歌至少4次，4次也必須在這3天內全部完成演唱。','permanent','public','P15','🪃','點歌','streamer',false),
('streak7','連續報到','連續7個日曆日有本人現點或提歌且唱完；無合格紀錄日即中斷，按點歌或提歌日認列。','7d','public','P16','📆','點歌','streamer',false),
('fan15','鐵粉認證','連續15個日曆日有本人現點或提歌且唱完；無合格紀錄日即中斷。','permanent','public','P17','👼','點歌','streamer',false),
('every_hour','今晚住這了','同場19–20、20–21、21–22、22–23、23–00、00–01六格各至少1首現點或提歌且唱完；依過檔彈窗與主播最後調整歸格，01:00後完成可認列原格。','24h','public','P18','🛋️','點歌','streamer',false),
('love10','我就愛這首','本人跨主播同名歌現點或提歌且唱完累積15次。','permanent','public','P19','🔁','點歌','global',false),
('dna30','刻進DNA的歌','本人跨主播同名歌現點或提歌且唱完累積30次。','permanent','public','P20','🧬','點歌','global',false),
('explorer','歌單探險家','本人現點或提歌且唱完累積50首不同歌名；骰子、系統自帶及手選自帶均納入。','permanent','public','P21','🗺️','點歌','streamer',false),
('cleaner','歌單清道夫','實際骰子點到同主播所有玩家從未點過的同名歌並唱完；曾點但未唱完仍不符合，自帶排除。','7d','public','P22','🧹','點歌','streamer',false),
('cold90','古墓派傳人','同主播所有玩家中，距同名歌上一次完成演唱超過90天；本次唱完時達標即可，從未唱完者排除。','permanent','public','P23','🪦','點歌','streamer',false),
('sad5','失戀急診室','同晚現場點5首傷感歌','show','public','P24',null,'點歌','streamer',true),
('sweet5','戀愛腦發作','同晚現場點5首甜歌／戀愛歌','show','public','P25',null,'點歌','streamer',true),
('ancient5','今晚夢回古代','同晚現場點5首古風歌','show','public','P26',null,'點歌','streamer',true),
('moods','人格分裂','同場本人現點或提歌且唱完，累積至少4個不同標籤；同歌全部標籤可同時計入。','24h','public','P27','🎭','點歌','streamer',false),
('all_tags','什麼都來一點','本人跨主播現點或提歌且唱完，累積至少20個不同標籤keyword；相同keyword只計1個，單曲可累計多標籤，達標永久保留。','permanent','public','P28','🌈','點歌','global',false),
('comeback','突然殺出來','前14個日曆日無現點、直接新增存歌或提歌，回歸第一場現點5首且同場唱完。','permanent','public','P29','🧨','點歌','streamer',false),
('attendance30','全勤寶寶','30個日曆日內30個不同日期有現點；直接新增存歌也算，未唱也算，提歌不算。','permanent','public','P30','📅','點歌','streamer',false),
('regular','釘子戶','最近30個日曆日至少15天有本人現點或提歌且唱完；按點歌或提歌日認列，動態撤下。','holding','public','P31','🧱','點歌','streamer',false),
('popular_history','跟風成功','本次點歌前，同主播全部歷史已唱完次數並列第一的同名歌，現點或提歌並唱完。','24h','public','P32','🧲','點歌','streamer',false),
('same_artist_show','大家點我也點','同場連續歌曲整段共有至少一位歌手，累計至少3位不同玩家且前三位都唱完後，第三位及之後取得；前兩位可用門檻成立後的新點歌取得。','show','public','P33','🐑','點歌','streamer',false),
('five_players','今晚指定曲','同場同名歌至少5位不同玩家各自完成演唱，五位及之後符合者均可取得。','show','public','P34','🧯','點歌','streamer',false),
('eighth','第3才會爽','本場第3位不同現點玩家，重複點歌不佔新名次；需同場完成演唱。','24h','public','P35','🥉','點歌','streamer',false),
('stock50','囤歌症候群','目前未唱掉的存歌達50首','holding','public','S01','💾','存歌','streamer',false),
('stock100','百曲藏家','目前未唱掉的存歌達100首','holding','public','S02','🗃️','存歌','streamer',false),
('stock500','曲庫霸主','目前未唱掉的存歌達500首','holding','public','S03','🛎','存歌','streamer',false),
('stock1000','千曲帝國','目前未唱掉的存歌達1,000首','holding','public','S04','🏛️','存歌','streamer',false),
('saved50','提歌達人','累積成功提歌並完成演唱50首','permanent','public','R01','📤','提歌','streamer',false),
('saved100','提歌大戶','累積成功提歌並完成演唱100首','permanent','public','R02','🚅','提歌','streamer',false),
('saved500','清庫高手','累積成功提歌並完成演唱500首','permanent','public','R03','🚚','提歌','streamer',false),
('saved10','今天很會提','本場本人成功提歌且同場唱完10首；當日00:00到期。','day','public','R04','⚓','提歌','streamer',false),
('failure1','差一個名額','首次有效提歌失敗：有可用存歌，該小時已滿且系統阻擋；每人同小時最多1次。','permanent','public','R05','😭','提歌','streamer',false),
('failure10','又沒擠進去','累積10個小時有效提歌失敗；沒存歌、一般錯誤、取消不計。','permanent','public','R06','🚪','提歌','streamer',false),
('failure50','到底輪到我沒','累積50個小時有效提歌失敗；沒存歌、一般錯誤、取消不計。','permanent','public','R07','🫠','提歌','streamer',false),
('after_failure','這次有我','有效提歌失敗後下一個日曆日，成功提同名歌且必須當天唱完。','permanent','public','R08','🥰','提歌','streamer',false),
('first_mic','今日第一麥','當日全場第一首實際完成演唱歌曲所屬玩家。','day','public','C01','🥇','演唱','streamer',false),
('sung100','百歌斬','本人在同主播累積完成演唱100首；現點或提歌，每次實際完成各計1次。','permanent','public','C02','🌟','演唱','streamer',false),
('sung500','聽歌成癮症','本人在同主播累積完成演唱500首；現點或提歌，每次實際完成各計1次。','permanent','public','C03','🤯','演唱','streamer',false),
('repeat_show','換一首啦','本人同名歌同場完成演唱第3次。','show','public','C04','😖','演唱','streamer',false),
('seventh','幸運七號','本人的現點或提歌成為同場第7首完成演唱。','24h','public','C05','7️⃣','演唱','streamer',false),
('insomnia','陰間作息','近30個日曆日內至少5天於01:00–07:00現點，未唱也算；取得保留30×24小時。','30d','condition_hidden','H01','👹','隱藏','streamer',false),
('destiny','命中注定','本次骰子或自帶選歌前，本人普通現點或提歌已唱完次數最多且至少10次的同名歌，並列第一均符合；本次骰子或自帶唱完才取得。','24h','condition_hidden','H02','🧿','隱藏','streamer',false),
('coincidence','就是這麼巧','只看本人骰子或自帶順序，連續3次整段共有至少一位歌手且唱完；普通點歌不影響。','30d','condition_hidden','H03','🎯','隱藏','streamer',false),
('reunion','我們又見面了','19:00結算同主播前後兩場：前場按點歌／提歌時間最後一首必須唱完，本場跳過未唱者取最早已唱完的一首；同名則只授予本場首歌玩家。','30d','condition_hidden','H04','😝','隱藏','streamer',false),
('same10','怎麼又是這首','本人跨主播同名歌合格現點或提歌，恰好第50次完成演唱觸發，可依原第50次事件歷史補判。','permanent','condition_hidden','H05','😮','隱藏','global',false),
('majority','今晚由我包場','19:00結算本場至少完成3首合格歌曲，且本人現點或提歌完成首數嚴格超過全場一半。','24h','condition_hidden','H06','😎','隱藏','streamer',false),
('last_light','最後一盞燈','19:00結算本場最後一首完成演唱的現點或提歌所屬玩家。','24h','condition_hidden','H07','🕯️','隱藏','streamer',false),
('lucky','今天運氣不錯','每個合格新現點事件獨立抽1%，同事件重送不重抽，舊歷史不補抽。','24h','public','L01','🍀','隨機','streamer',false),
('legend','都市傳說','每個合格新現點事件獨立抽0.1%，同事件重送不重抽，舊歷史不補抽。','24h','public','L02','🦄','隨機','streamer',false),
('chosen','天選之人','每個合格新完成演唱事件獨立抽0.5%，同事件重送不重抽，舊歷史不補抽。','24h','public','L03','🎁','隨機','streamer',false)
on conflict(code) do update set name=excluded.name,condition_text=excluded.condition_text,lifetime=excluded.lifetime,
 default_visibility=excluded.default_visibility,badge_id=excluded.badge_id,emoji=excluded.emoji,category=excluded.category,
 badge_scope=excluded.badge_scope,retired=excluded.retired;
-- Explicit hidden/random presentation supersedes older per-room display choices.
update public.papa_achievement_visibility v set visibility=c.default_visibility
 from public.papa_achievement_catalog c where c.code=v.code and left(c.badge_id,1) in ('H','L');
create table public.papa_global_badge_awards(
 account_id uuid not null references public.papa_accounts(id),code text not null references public.papa_achievement_catalog(code),
 active boolean not null,acquired_at timestamptz not null,expires_at timestamptz,changed_at timestamptz not null default now(),
 source_event_id bigint references public.papa_events(id),manual_verified boolean not null default false,
 primary key(account_id,code)
);
alter table public.papa_global_badge_awards enable row level security;
revoke all on public.papa_global_badge_awards from public,anon,authenticated,service_role;
create index papa_global_badge_active on public.papa_global_badge_awards(code,account_id) where active;
create function public.papa_badge_account(s text,p text) returns uuid language sql stable security definer
 set search_path=pg_catalog,public as $$
 select account_id from public.papa_account_legacy_players where s='space-001' and legacy_player_id=p
 union all select account_id from public.papa_space_player_profiles where s<>'space-001' and space_id=s and player_id=p limit 1
$$;
create function public.papa_badge_expiry(lifetime text,at_time timestamptz,period text default null)
 returns timestamptz language sql immutable set timezone='Asia/Taipei' as $$
 select case lifetime when '24h' then at_time+interval '24 hours' when '7d' then at_time+interval '168 hours'
 when '30d' then at_time+interval '720 hours'
 when 'day' then ((at_time at time zone 'Asia/Taipei')::date+1)::timestamp at time zone 'Asia/Taipei'
 when 'show' then ((at_time at time zone 'Asia/Taipei'-interval '19 hours')::date+1+time '19:00') at time zone 'Asia/Taipei' end
$$;
revoke all on function public.papa_badge_account(text,text),public.papa_badge_expiry(text,timestamptz,text) from public,anon,authenticated,service_role;
commit;
