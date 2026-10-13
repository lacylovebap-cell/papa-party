# 10.13-WEB.4 本機整合檢查點

狀態：尚未推送、尚未部署；正式版本維持 10.13-WEB.3／10.13-EDGE.1。正式 Supabase 資料庫 106%、Egress 212%，使用者選擇先準備可審核的無損封存方案。新增 migration 尚未執行，正式 operation_receipts 表尚不存在。

| 本批項目 | 本機結果 | 正式狀態 |
|---|---|---|
| 操作回執 | 既有原子交易與回執同時提交／回滾；相同身分、Space、Room、operation ID 的重送不再次扣歌或回補 | 待容量處理後部署 |
| 回應中斷確認 | 僅一次業務寫入；結果未知時按 Room 查回執，確認後刷新權威狀態，不自動重放寫入 | 待部署 |
| 表單重複送出 | 送出中及結果未知時鎖住重複點擊／Enter；確認未送出才允許修改重送 | 待部署 |
| 行動版通知入口 | 頁首通知鈴鐺沿用既有未讀計數／通道，不加查詢輪詢；320／390 px 無水平溢出，六個後台按鈕同排 | 待部署 |
| 封存審查 | 33,759 筆歌曲排序事件待核對原始 Space；無任何事件搬移／刪除 | 方案見 AUDIT-ARCHIVE-REVIEW-2026-10-14.md |

改動：`src/operation-recovery.js`、`src/app.js`、`src/notifications.js`、`src/theme.css`、三個 HTML 入口、`build.mjs`、Edge `party-api/index.ts`、`202610130005_operation_receipts.sql` 及必要回歸測試。回執僅保存身分雜湊、請求雜湊、操作 ID、scope、revision、時間；不建立第二套帳本，不保存完整歌曲或交易快照，不補寫舊資料。原 Core、Ledger、帳務防護及 RPC 保留。

範圍：現有 scoped operational 單筆寫入、玩家 requestsBatch／ownQueueBatch。其他匯入、歌本／勳章管理與原生 App 不視為本批完成。舊客戶端沿用原 RPC；未確認結果不宣稱失敗，也不允許盲目重試。回執無自動清理或縮短稽核保留。

已驗證：真實隔離 PostgreSQL 原子提交／回滾／重複 ID／scope 防護；Edge 回應中斷、回執讀取、重送、玩家批次與身分邊界；客戶端一次寫入、跨身分／Space 放棄過時回應、權威 revision 刷新、未知結果保留表單；既有帳務分配、取消、完成、過檔及 UI 顯示回歸。Web 與 Edge 本機 build 成功。行動版瀏覽器驗證使用隔離 demo，並非正式 WEB.4 驗收。

2026-10-14 最後一輪必要 targeted tests：82 項通過、0 失敗；`git diff --check` 通過。測試輸出保存在工作目錄外 `../web4-final-targeted-tests-1014.txt`。未重跑全部測試或反覆部署。

此前已完成：Android 總裁身分 WebPush 前景、背景、鎖屏均由使用者確認收到；這不代表原生 FCM／APK 或 Windows 安裝包已完成。阿欽兩筆已核准的舊退回各沖銷 1 首已在正式庫確認，新增 3 首、真實演唱及 Audit 保留，本批不再次補正。

部署條件：確認容量解決方案及實際剩餘空間 → 核對 migration ACL 與舊 guard 不變 → 一次整合部署 → 有界正式功能驗收。若僅核定封存方案，不能視為已允許匯出、清除歷史或容量維護。
