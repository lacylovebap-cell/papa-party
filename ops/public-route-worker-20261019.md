# Cloudflare 公開網址轉接器（僅本機準備，未部署）

GitHub Pages 本身無法讓未知漂亮路徑以 HTTP 200 回傳既有模板。`404.html` 雖可啟動畫面，原始 HTTP 狀態仍是 404。本候選 Worker 在公開網址前層解析穩定登記資料，對已配置的 canonical 路徑回 200；不取代既有網站、帳號或帳務系統。

## 檔案及設定

- `ops/public-route-worker.mjs`：Cloudflare module Worker handler，依賴本 repo 原有純路由 helpers。需要將入口與相依模組一併打包，不能只上傳這一個檔案；尚未產生／執行 wrangler 部署設定。
- `tests/public-route-worker.test.js`：離線 fake registry／asset origin 驗證，不存取正式資料。
- 預設 `ASSET_MODE=external`：`ASSET_ORIGIN` 必填，必須是**與 paparty.app 不同 origin** 的既有靜態網站根目錄，可包含 project mount，例如 `https://<已驗證來源>/<project>/`。不可指回 Worker 主機，不能含憑證、query、hash。所有上游 redirect 都安全失敗，不追隨，避免 GitHub Pages 綁 custom domain 後導回 paparty.app 而循環。
- 可審核的替代 `ASSET_MODE=route-origin`＋`ROUTE_ORIGIN_CONFIRMED=true`：僅供 **Cloudflare Route Worker 位於既有 proxied DNS/GitHub Pages origin 前層** 的模式。不需要外站 ASSET_ORIGIN；如有指定只允許 `https://paparty.app/`。此模式用同 zone `fetch(Request)` 回 DNS 設定的既有 origin，取得 `/v2.html`、`/lobby.html` 與靜態檔案。不能將相同開關套在 Worker **Custom Domain** 或 `workers.dev`；程式無法查證帳號內實際 Route 綁定，這是正式啟用前必須以平台唯讀設定確認的條件。未明確設為 `true` 一律 503，沒有自動猜測／切換模式。
- `API`／`PUBLISHABLE_KEY`：預設沿用 `src/config.js` 既有公開 party-api 與 publishable key，也可經 Worker 環境指定。只接受 publishable key 或已公開且 role=anon 的舊 JWT；**不接受 secret／service_role key**。正式資料庫 secret、玩家或管理者登入資料不應放入 Worker。
- `PUBLIC_ORIGIN`：預設 `https://paparty.app`。設定必須精確符合請求 origin；不依外部 Host 生成跨站目的地。

主工作已唯讀確認 GitHub repository URL 來源會 301 導回 `paparty.app/v2.html`，因此不能直接拿該網址當作 external 回源。可沿上述 `route-origin` 保留現有 hosting，但尚未驗證或變更實際 Cloudflare Route／proxied DNS 設定；不能把候選開關或示意來源當成已部署。

官方依據（2026-10-19 唯讀核對）：[Cloudflare Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/) 說明 Route 位於既有 DNS 定義的 application server 前層，`fetch()` 可向該 origin 發出 subrequest；同 zone 的 fetch 不以 Route 為目標，因此不再次觸發同一個 Route。[Routes and domains](https://developers.cloudflare.com/workers/configuration/routing/) 區分 Custom Domain 作為 Worker origin，與既有 server 前層的 Route。據此提供顯式可審核模式，沒有修改 DNS 或改用新 hosting。

## 行為與限制

1. 僅處理 GET／HEAD；其他 method 回 405，不代理 POST／Supabase 管理 API。
2. 平台 `/`、已知系統路徑與 `assets/`、`src/` 等直接映射至設定的 project mount；**不改寫平台首頁**，不查 registry。
3. 可能同時是 dotted 主播代碼與檔案的路徑（如 `/qq.MP4`）先查實際靜態檔：存在即直接回傳；404 才進 registry，沒有把副檔名變成禁止的主播代碼。影片 Range、HEAD 與原本靜態 cache headers 可沿用；Cookie、Authorization 不回源。
4. 專屬路徑重用 `resolvePublicPage`，最多一至兩個 exact indexed `publicRouteResolve` 公開查詢，不下載主播列表、不猜 stable IDs、不掃歷史。
5. 舊 alias 一次 HTTP 308 指向最新 canonical 前綴；保留已確認的子頁與 `adminTab`／`tab`／`player`／`queue`。純 helper 同時維持單一合法 `portalLogin=player|admin` 的介面意圖；大廳保留既有有界搜尋、排序與頁碼，憑證／通知／scope 提示一律去除。這些 query 不授予身分或權限。
6. canonical 主播路徑使用既有 `v2.html`，廳使用既有 `lobby.html`。插入 `<base href="/">` 及白名單公開 `public-route-data` JSON，回 HTTP 200。相對 assets 仍經本網域映射，不必改整套 app。模板拒絕外站 executable script、非 HTML、超限資料。
7. HEAD 同樣查穩定 registry，但模板用 HEAD，回 200 header 且無 body；alias HEAD 仍為無 body 的 308。
8. 未知 alias 沿用 asset origin 的原本 404；沒有自動進聲瑪、其他主播或合成新帳號。
9. registry body 最多 16 KiB；模板 body 最多 256 KiB，串流超限即取消。API 逾時 8 秒，回源 10 秒。錯誤回 503，訊息不包含 key、資料原文或私人資訊。
10. 動態 HTML、redirect 與錯誤使用 private/no-store 與 CDN no-store。沒有建立 Workers KV／Cache API、玩家 cache、輪詢、Storage、Realtime。Set-Cookie、自訂 private header、過期 Content-Length 等不傳回；上游不接收瀏覽器 Cookie、Authorization、管理者或玩家 token。

`public-route-data` 只供導航，不是登入或 membership。實際 app 與 RPC 仍沿用既有權限驗證。這個轉接器不修改 Space、streamer、歌曲、玩家、勳章或帳務。

## 本機驗證

```text
node --test tests/public-route-worker.test.js
```

測試包括：canonical 200＋base＋公開 stable IDs、alias 308 直達最新目的地、登入及大廳搜尋意圖保留、敏感 query 清除、其他 origin 阻擋、私密 header 剝除、GET／HEAD、未知 404、bounded 一至兩次查詢、影片/靜態 bypass、合法 `/qq.MP4` 仍可解析、POST 不轉送、service key 禁用、asset redirect 不循環、上游錯誤與 oversize／外站 script 拒絕。

這些是**離線候選驗證**，未聲稱 Cloudflare 帳號、DNS、路由綁定或正式 HTTP 行為已變更。

## 需另行批准及正式前檢查

- 已要求的非破壞性公開網址資料表／RPC migration 仍未授權執行。
- 確認適用的 Cloudflare 管理帳號、Worker 設定與流量費用（不自動升級付費方案）。
- 唯讀驗證候選 ASSET_ORIGIN 的 HTTP 200、無回 paparty.app redirect、project mount、模板與資源 MIME；缺少合適回源不可貿然啟用。
- 若採 `route-origin`，先唯讀確認該 Worker 綁的是 **Route**、既有 DNS 已 proxied 且仍指向 GitHub Pages、主機並非 Worker Custom Domain，之後才批准模式開關。這些設定尚未執行；不能只因假資料測試通過就開正式開關。
- 先以 preview hostname 與測試 registry 驗證實際 Worker 打包/runtime，再核准正式 Worker route／DNS；保留現有 TLS 與 GitHub Pages 設定。
- 正式切換前確認 `/`、`/sm`、`/pa`、子頁、舊 alias、分享 QR、HEAD、Range、重新整理與登入返回；使用只讀公開資料，不送正式帳務測試。
- 回復：解除本次 Worker route 即回原 Pages 流程；不刪 registry aliases，不改正式帳務。回到 Pages 後漂亮路徑可能恢復原 404 fallback HTTP 狀態，已知模板／舊 query 網址仍保留。

本次沒有部署、沒有 DNS／Pages 設定變更、沒有正式查詢或資料寫入。
