# 10.28-CANCEL.1｜待播取消統一及歷史回補標記

Web `10.28-CANCEL.1`（= 10.28-UI.1 + 本次變更）· Edge `party-api 10.28-CANCEL.1`（= ADMIN.4 + 10.28-UI.1 主題驗證 + 本次變更）· DB migration `20261028170000_cancel_settlement_native_guard.sql`

## 行為
- 尚未演唱的歌曲只剩一個「取消歌曲」。主播取消、玩家取消、舊「移出待播」(`queue:delete`)、批次移除 (`queueBulkDelete`)、玩家跨主播批次取消、撤銷收歌，全部走 `cancelQueue` 同一套釋放／回補。
- 取消當下在待播紀錄寫入一次性的 `cancel_settlement`：實際恢復首數、來源（存歌池、每小時名額／專屬提歌權、收歌分配、預扣分配回補帳 id）、取消前後可用首數、觸發來源 `via`。已存在就拒絕再結算。
- 已完成／已取消／已轉存的紀錄改用「封存歷史」(`queue:archive`、`queueBulkArchive`)：只設 `archived_at`，不寫帳、不改狀態、不回補。尚未演唱的歌曲不能封存。
- 待播歷史「已取消」旁小字：`✓ 已恢復`／`無額度變動`／`回補待核對`，下一行顯示「已恢復 N 首 · 來源：…」。
- 舊紀錄（沒有 `cancel_settlement`）只依可證明的事實推算，不回寫：提歌且無任何關聯帳 → 已恢復；舊制分配恰有一筆未撤銷 `return` 帳且首數一致 → 已恢復；未用額度的現點 → 無額度變動；其他 → 回補待核對。
- 取消成功後：操作端顯示「✅ 歌曲已取消」彈窗（補回首數、可用 X → Y 首）；玩家與主播各收到一則 `cancel` 通知並沿用既有 Web Push。稽核仍保留原始 `queue:cancel`／`queue:delete`／`cancelOwn` 等事件、操作者與時間。

## 上線前正式資料核對（唯讀，2026-10-28）
已取消 84 首（全部聲瑪廳，其中測試 37 筆）：
- 提歌 50 首：無任何關聯帳 → ✓ 已恢復（49×1 首、1×2 首）
- 舊制預扣分配 7 首：各一筆未撤銷 `return` 帳 → ✓ 已恢復（3×1 首、4×2 首）
- 現點未用額度 26 首 → 無額度變動
- 舊制預扣分配 1 首（`a4ee2afc…`，測試玩家，2026-09-28 取消）：無任何回補或來源帳 → 回補待核對，未自動補回
正式庫沒有任何未唱（待確認／待唱）歌曲，也沒有其他空間的待播資料。

## 測試
`node --test tests/*.test.js`：新增 `tests/queue-cancel-unified.test.js` 9 項全過；其餘失敗清單與上線前基準完全相同（本環境無法安裝 PGlite，基準 292 項失敗皆為既有）。

## 回復
- Edge：重新部署指向 `party-api-10.28-ADMIN.4.js`（commit `615dc9e`）的兩檔入口。
- DB：`ops/cancel-settlement-rollback-20261028.sql`（只在 Edge 回到 ADMIN.4 時需要）。
- Web：還原本 commit。已寫入的 `cancel_settlement` 只是顯示資料，可保留。
