# 專屬網址發布預檢 — 2026-10-19

使用者已批准新增四張網址 metadata 表／相關 RPC、初始化聲瑪 `/sm` 與怕怕 `/pa`，並於隔離並發及實際路由驗證通過後部署。本檔為唯讀預檢及本機整合證據，本身不是正式套用／部署成功證明。

## 正式環境唯讀證據

- 遠端 main 已由候選基準 `b422e16d22e0350a22c01e2b858a5993753f7964` 前進至 `05a5e60d2f0cbb2a98f59141a5a34f1faf8b44b6`，新增 PR #21 的 PWA 啟動修復。必須整合後發布，避免覆蓋其入口循環修正。
- `https://paparty.app/release.json` 回報 `10.19-WEB.1`、backend `10.19-WEB.1`，builtAt `2026-10-18T20:35:01.281Z`。
- 正式 `releaseInfo` 回報 WEB.1、尚無 publicLinks capability、nativeApps=false。
- `party-api` 為 ACTIVE、平台版本 51、verify_jwt=false；既有應用層 actor 驗證必須保留。MCP migration history 當時為空清單。
- PostgreSQL 17.6；2026-10-19T14:10:49Z 量得資料庫 528,510,099 bytes。這是量測快照，不是容量上限或可回收容量。
- 新 registry 表及 `papa_public_route_%` 函式均未存在；既有 `papa_space_streamers` 有 `(streamer_id, space_id)` UNIQUE，可支援新增 metadata 外鍵。
- 所需 Account／manager／platform role／membership／streamer account／Space／entity 欄位型別相容；只檢查 schema 與指定公開 papa 描述，沒有讀取密碼值、玩家明細或 Audit 原文。papa 的公開 id/slug 均為 papa 且 active=true。
- schema-only 依賴備份：`public-routes-schema-only-preflight-20261019.json`，涵蓋八張既有依賴表的欄位、型別、default、RLS、ACL、constraints、indexes、triggers，沒有資料列值。SHA256 `C01217F61357E367592AF5252CB66DB78D82ABE0C6718F3F9A4B998AA9015BBA`。候選只新增物件，因此不需要回寫這些既有 DDL。

## 本機整合

解決 `lobby.html`、`src/app.js`、`src/lobby-entry.js`、`v2.html` 四個 merge 衝突，保留分享／網址設定／lobby scope guard 及 PWA 開啟位置功能。保留 main 的 `spaceDestination` 回到 v2.html 行為，避免官網與已驗權入口循環。

輕量補充 `updateAppStart(room, href)`：主播頁傳入既有 `roomContextHref()` 投影，受支援的大廳傳入既有 lobby.html 投影。偏好仍由原 `pagePreference` 驗證，保存穩定主播／Space ID 與既有安全頁面 URL，不另建路由系統、不查詢後端、不儲存秘密 query；其他原生 Space guard 及通知／登入入口不提示規則維持。

新增兩項對應 PWA 測試，並使既有 VM fixture 的 import 剝除支援 Windows CRLF。PWA、public links、bootstrap、lobby 分享、頁面定位、Space 入口及官網入口共 78 項 targeted tests 通過，0 失敗、0 跳過。這組不取代獨立 PostgreSQL 多連線及 Cloudflare runtime 驗證。

## 最小部署次序

1. 完成隔離 PostgreSQL 多連線 advisory lock／CAS／失敗 atomic rollback；對整合後候選執行必要 targeted tests 與靜態／Edge build。保存候選 hash、正式 Edge 原檔及已取得 schema-only 證據。
2. 使用 Supabase MCP `apply_migration` 登記並套用已批准新增 metadata SQL；只 seed 已確認 stable mapping。失敗整筆回復，不以重跑／刪除覆蓋處理。
3. 唯讀核對新表 RLS／privilege／函式 EXECUTE、兩個 seed、RPC 結果及 advisors；不以正式玩家或改碼當測試資料。
4. 部署整合後 `party-api`，保留現有 verify_jwt=false 及應用 actor 驗證；新 releaseInfo 明示新功能與版本。透過小型公開 resolve/info 回應確認 `/sm`、`/pa`；無 token 的管理操作應拒絕。
5. 更新版本與 cache query，合入候選前再次核對最新 main；Pages 目前從 main 根目錄發布，因此根目錄 HTML／src／release.json 必須包含新成果，僅產生 dist 不等於發布。build 同步 v2.html 到 preview.html，原官網 index 保持獨立入口。
6. 確認發布 commit 與正式 release.json／靜態檔 hash一致後，依已核對的 Cloudflare Route 模式啟用 Worker／回源；實際驗證首頁、子頁、重整、舊路徑單次轉址、系統／asset bypass。完整實際 runtime 驗證由主代理處理，本預檢沒有變更 DNS／Worker。
7. 讀取公開頁面／功能能力回應完成驗證，保留所有 alias／網址 Audit。必要時以相容修正版或 `PUBLIC_ROUTES_READ_ONLY=true` 停止改碼，不回退到失去 URL 相容的舊版。

版本範圍：`build.mjs`、根 `release.json`、Edge releaseInfo、`404.html`／v2／preview／lobby／index 的必要 cache query、受影響 src import；PWA UI 本次變動另更新 PWA cache 版本。歷史 release 文件與既有 SW push 功能不因版本更新而重寫。

## 工具可用性

此機沒有 gh／supabase／docker／psql／wrangler 命令，常用 Supabase／Cloudflare／GitHub token 環境變數未設。Git credential helper 為 manager，Git fetch 成功；GitHub 與 Supabase MCP 已連線，可採既有發行途徑。沒有輸出或索取私人密鑰。Cloudflare 帳號／路由設定由主代理於已登入瀏覽器核對。

本預檢未執行正式 migration、部署、帳務寫入、維護、私人資料匯出、付費升級或正式有副作用測試。
