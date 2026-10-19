# 專屬網址與分享整合結果 — 2026-10-19

更新：使用者批准後已完成 10.19-WEB.2 正式部署，最新結果見 `public-links-deployment-result-20261019.md`。以下保留批准前候選驗證與門檻的歷史記錄。

## 已完成

- 聲瑪 `/sm`、怕怕 `/pa`、聲瑪其他主播 `/{ID}`；其他廳 `/{hall}.{ID}`；獨立主播 `/pa.{ID}`。
- 穩定 Space／主播 ID 的永久舊網址歸屬、直接解析最新網址、子頁目的地保留、大小寫與重複／保留名稱防護。
- 主播自己的網址設定、總裁管理、伺服器權限檢查、CAS、原子交易及獨立網址 Audit。
- 目前瀏覽主播的首頁分享、原官方 LOGO QR、PNG／SVG、複製及原生分享 fallback。
- 大廳小型玩家登入／管理登入／分享入口，移除指定的小字，沿用既有登入流程。
- Pages fallback 及候選 Cloudflare Route Worker；後者尚未在實際 Cloudflare runtime 啟用。

主要修改：`src/app.js`、`src/public-route-*.js`、`src/public-links.js`、`src/public-link-settings.js`、`src/branded-qr.js`、`src/share-dialog.*`、`src/lobby-*`、`lobby.html`、`v2.html`、`404.html`、兩個 build 腳本、Edge handler／public-routes helper、候選 migration、相關 targeted tests。

## 本次驗證證據

- `build-edge.mjs`、`build.mjs` 成功；保留目前版本標籤，未宣稱新正式版本。
- `public-links-final-tests-20261019.tap`：133 項中 132 通過，0 失敗；解碼測試因指定的 bundled Python 缺 OpenCV 而跳過。
- 找到既有 Python314 OpenCV 後僅補跑 QR 測試：`public-links-qr-decode-20261019.tap` 5/5 通過、0 跳過。補齊上述唯一跳過項，因此 133 個不同 targeted tests 全部已有通過證據。
- 實際 QR 解碼涵蓋 4 組網址 × 3 種尺寸 × 有／無官方 LOGO，共 24 組完整 SVG rasterize PNG 後正確解碼；未安裝新正式相依。
- `git diff --check` 無空白錯誤。
- 前次本機手機 fixture 已驗證分享、舊網址保留歌本目的地、重新整理／返回、登入入口。截圖為假資料本機預覽，並非正式上線證據。
- 既有 `tests/edge-bundle.test.js` 的 catalog fixture 問題在同一 main 基準亦失敗，未為此改動業務邏輯；不宣稱 full suite 全通過。新的完整 Edge handler targeted tests 通過。

## 正式變更與剩餘門檻

精確 SQL：`supabase/migrations/202610190001_public_routes.sql`。
影響、權限、備份及回復：`ops/public-routes-migration-20261019.md`。
Worker 部署與回復方案：`ops/public-route-worker-20261019.md`。

候選 migration 僅新增 4 個網址 metadata 表、索引、RLS、函式及已確認 `/sm`、`/pa` seed；不修改原有歌曲、玩家、帳務、演唱或既有 Audit。新增少量容量，回收容量為 0 MB。執行前須確認正式容量／schema 與 stable mapping 可用，不能在不符條件時硬套。

先等待使用者明確批准正式 migration。啟用前另須完成隔離 PostgreSQL 兩連線 advisory lock 驗證，以及實際 Cloudflare preview/runtime、Route 回源設定驗證；本機 PGlite CAS 與 fetch mock 不取代它們。目前無本機 PostgreSQL／Docker runtime。沒有上述驗證不得宣稱實際 HTTP 200／308 已成立。

保留現有業務原生 Space guard：網址 registry 支援其他廳／獨立格式，不代表其他原生 Space 的完整業務首頁已開放。不能將未知廳落入聲瑪。

回復使用相容解析版本及 `PUBLIC_ROUTES_READ_ONLY=true` 停止改碼；已啟用 aliases／Audit 不刪除。套用前由業主管控的核准備份機制保存必要資料，不自行匯出私人玩家或 Audit 原文。
