# 勳章管理改版：部署前審核（2026-10-16）

狀態：使用者已確認移除「主播歌曲榜／全站歌曲榜」，其餘上線。正式資料庫與 Edge 已更新，網站隨本次提交部署。版本 10.16-WEB.3。
基準：origin/main 9d153172b0882acfc28915dad8b638343b1909a5。
已以最新 202610150100–107 規則為基礎，不使用舊 WEB.6 候選直接覆蓋。

## 實作
- 主播更多新增勳章管理；手機三欄、桌面六欄。
- 主播統一顯示政策，玩家端移除個別公開控制。
- 全站勳章禁止主播授予/改政策；H/L 類政策鎖定；玩家永遠看不到 H 真實條件。
- 管理說明提供獲得者搜尋分頁、跨頁多選、明確確認後批次授予。
- 玩家資料說明限定目前玩家；權限、Space、主播、玩家皆由服務端驗證。
- 批次失敗整組回滾、重複授予不增加紀錄；手動來源與 Audit 保留。
- 保留最新歌曲/全站勳章排行，增加單主播最高、主播數量、跨主播總數。
- 不更動最新名稱、Emoji、觸發規則、業務資料；不回放歷史、不補正餘額。
- 名單按需每頁20筆，最多授予50位；無新增輪詢/Realtime；同步函式未部署的正式站沿用既有 revision，另有回歸測試。

## 修改檔案
src/app.js、src/achievements-view.js、src/medal-management.js、src/theme.css。
supabase/functions/party-api/index.ts。
supabase/migrations/202610160001_medal_management.sql、202610160002_medal_public_views.sql。
tests/achievements-client.test.js、achievements-edge.test.js、medal-management-client.test.js、medal-management-fixture.js、medal-management-v2-rpc.test.js。

## 驗證
- 107項針對性測試全部通過；記錄 ../medal-management-final-tests.txt。
- 前端與 Edge bundle 建置成功，git diff --check 成功。
- 隔離 PGlite 執行既有規則 migration 加本次兩份 migration，驗證權限、全站/H/L、原子回滾、重複操作、排行榜、隱藏規則及業務資料未變。
- Chrome 本機假資料：390px 三欄，1280px 六欄；跨頁選取01/21兩位、二次確認、授予後名單2位及已取得禁止重授予均通過。
- ops/medal-management-mobile.png 為假資料介面證據，不是正式資料。

## 尚待規則確認
永久與本場勳章沿用現有授予到期處理；其餘限時/動態勳章未明確定義手動到期，停用手動授予，不擅自永久化。

## 正式部署方案與風險
使用者已確認部署；兩份 migration 已在同一交易提交，party-api 已驗證 10.16-WEB.3。部署前再次檢查 main 是否前進、目前容量及既有函式版本。
兩份 SQL 主要更新函式、權限與同步觸發器，新增獲得者查詢索引，保留既有資料表及所有紀錄。索引需要額外容量，建置與函式更名可能短暫鎖定；部署前實測資料庫521,432,211 bytes（約497.3 MiB），唯讀限制off，連線17；此次索引對應77筆授予資料，未執行容量維護。最終容量與時間見部署結果，不承諾零停機。不得與未授權的 VACUUM/REINDEX/刪除/搬移混在一起。
不包含歷史勳章回放、修改勳章定義、玩家帳務或私人原文匯出。
回復：部署前保存當前函式定義/權限及網站與 Edge 版本；若驗證失敗還原程式和函式定義，保留本次合法授予及 Audit，不以刪除資料回復。停用新入口直到版本一致。

## 本次使用者調整
移除玩家勳章頁「主播歌曲榜／全站歌曲榜」兩個入口，保留既有歌曲資料及後端相容程式；勳章排行保留。正式資料庫提交後 revision 4349，勳章目錄指紋完全一致，未回放或授予任何玩家。正式上線證據保存於相鄰 medal-management-release-1016 目錄。
