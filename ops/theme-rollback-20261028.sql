-- 回復 20261028040000_homepage_themes.sql（只移除本次新增的物件）
-- 執行前：先匯出 papa_streamer_plans、papa_theme_audit 與 hall_theme* 政策列做備份。
-- 不影響歌曲、玩家、點歌、存歌、通知、勳章、帳務或歷史資料。
-- 主播主題存於各主播 settings 的 theme／themeDraft 欄位；舊版前端會忽略這兩個欄位，無需刪除。
begin;
drop function if exists public.papa_theme_assets_in_use(text[]);
drop function if exists public.papa_theme_plan_save(text,text,text,timestamptz,text[],uuid,text,text[]);
drop function if exists public.papa_theme_hall_save(text,text,jsonb,uuid);
-- 廳主題設定（可選；保留不會影響舊版前端）
-- delete from public.papa_space_policies where policy_key in ('hall_theme','hall_theme_draft');
delete from public.papa_space_entitlements where feature_key in ('theme_hall_basic','theme_hall_images','theme_hall_publish');
delete from public.papa_feature_registry where feature_key in ('theme_hall_basic','theme_hall_images','theme_hall_publish');
drop table if exists public.papa_theme_audit;
drop table if exists public.papa_streamer_plans;
commit;
