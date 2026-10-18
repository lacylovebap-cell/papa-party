# 10.17-WEB.1 上線範圍 — 2026-10-18

使用者已明確指示「上線」。本批發布網站與必要的 `party-api`；不執行正式資料庫更新或維護。

- 基準：main `0aa7fd5`；正式網站與 API 上線前均為 `10.16-WEB.6`。
- 網站：公開大廳、同一公開 Space 切主播保留歌本、共用 Footer。政策／聯絡頁仍未建立，保持純文字，沒有假連結。Pages 使用 main 根目錄，因此將 `v2.html` 與現有 index／preview 入口同步，而非只更新 dist。
- API：公開大廳沿用既有目錄及共同歌本 RPC，固定公開 `space-001`，不傳玩家、帳務、歌詞或 Audit。
- 不執行 `202610170001_native_operation_receipts.sql`、`202610170002_native_push_registration.sql`，不執行任何其他 migration、帳務補正、VACUUM、REINDEX 或容量維護。
- 原生客戶端／FCM transport 已保存程式及測試，但未接 App 或 sender；`nativeApps:false`、其他 Space 業務 guard 及現行 Web Push 維持。不宣稱 Android／Windows App 或原生推播已完成。

## 驗證與回復

- 既有本批測試：大廳／Edge／回執／註冊 108 項；導航修正 45 項；原生 adapter 及共享契約 46 項，均通過。沒有重跑全站 suite。
- 本輪入口／Footer／cache 5 項通過，網站及 Edge bundle 建置與 Edge 語法檢查通過。
- Edge bundle SHA256：`47d725b40f0eef24c0b1f25ca3dd491df7e031a139937a0bb4175a4d070bfee1`。
- 發布前由正式編輯器複製保存原程式，本機正規化比對與 main 產生的 WEB.6 完全相同。原檔 SHA256：`8f6bd7553f5b62069e9743dbbf792027cf74328b3ec3d6ad9cb80b1d37a8dbf6`。新程式亦經 UI 全選複製回讀，與候選 bundle 正規化比對一致。
- 回復：網站以原 main commit 還原發布；API 以保存的正式 WEB.6 程式重新部署。不刪除業務資料、通知、回執或 Audit。
- 後台目前有上一帳期超額、11/1 可能限制的提醒；API 近一小時 5xx 為 0%，本批不升級方案或進行容量維護。

實際部署結果另記錄於本機 `deployment-result-20261018.json`；此計畫本身不作為發布成功證明。
