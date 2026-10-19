# 公開網址 Worker：單檔產物與實際本機 runtime 驗證

## 已完成

`ops/public-route-worker.bundle.mjs` 為可貼入 Cloudflare Dashboard editor 的**單一 ES module**，包含入口及純路由相依程式，沒有外部 import、source map、正式 secret、玩家或 Audit 原文。預設 API / publishable key 沿用網站已公開的 `src/config.js`，正式部署可用環境設定覆蓋。

產物與所有來源 SHA-256 記於 `ops/public-route-worker.bundle.json`。本次產物為 **26,595 bytes**，SHA-256：

```text
9c05783bc0acdc43c874b2031ac4ac967ea2fa787fcf93ac4948750be6b11e45
```

來源之後若有修改，須重新打包、重跑 runtime 驗證，再以新 manifest / result 為準。沒有透過此腳本執行上傳或部署。

## 固定工具版本與重現

- Node.js `v24.19.0`
- esbuild `0.28.2`
- Miniflare `4.20260730.0`
- workerd `1.20260730.1`（Miniflare 的固定依賴）
- Worker compatibility date：`2026-07-30`
- 工具只安裝在 `.local-public-route-validation/worker-runtime`，沒有更動專案的 production / development dependencies。
- 完整 npm resolution 及 integrity 位於 `ops/public-route-worker-toolchain/package-lock.json`，來源皆為官方 npm registry。

具備 npm 的環境可在 repo 根目錄執行以下 PowerShell；`node` / `npm` 可換成環境的絕對路徑。安裝只發生於本機隔離目錄，`--ignore-scripts` 不執行套件 lifecycle scripts。

```powershell
New-Item -ItemType Directory -Path .local-public-route-validation/worker-runtime -Force | Out-Null
Copy-Item ops/public-route-worker-toolchain/package.json .local-public-route-validation/worker-runtime/package.json
Copy-Item ops/public-route-worker-toolchain/package-lock.json .local-public-route-validation/worker-runtime/package-lock.json
npm ci --prefix .local-public-route-validation/worker-runtime --ignore-scripts --no-audit --no-fund
node ops/build-public-route-worker.mjs
node ops/validate-public-route-workerd.mjs
```

## 實測結果

驗證並非只在 Node 呼叫 handler。`validate-public-route-workerd.mjs` 透過 Cloudflare 官方 Miniflare 啟動 **workerd 子程序**，載入上述單檔 module，由 `dispatchFetch` 送入實際 runtime。所有 outbound fetch 都攔截到本機假 registry / 靜態來源，任何未預期 origin 立即失敗，未存取正式 API 或 origin。每次 runtime 都在 `finally` 關閉。

**10 項通過、0 項失敗**；機器可讀結果位於 `ops/public-route-workerd-result-20261019.json`：

1. canonical HTTP 200；既有 shell、base 及白名單穩定 ID metadata 正確。
2. 舊 alias 單次 HTTP 308；保留 admin 子頁與安全 query，移除 token。
3. canonical 子頁 `/pa/book` HTTP 200 且保留 book 目的地。
4. `/sm` 載入既有大廳 shell，不虛構 streamer ID。
5. canonical HEAD / alias HEAD 無 body，模板回源沿用 HEAD。
6. 平台根路徑與靜態檔跳過 registry；Cookie / Authorization / private query 不回源。
7. 影片 Range 維持 HTTP 206、Content-Range、Accept-Ranges 及 ETag。
8. 未知子頁保持來源 404，exact registry 查詢不超過 2 次。
9. POST 回 405，沒有 outbound request。
10. `ROUTE_ORIGIN_CONFIRMED=false` 回安全 HTTP 503，沒有 outbound request。

## 正式啟用限制

這項測試證明單檔程式可在實際 **本機 workerd** 執行；不代替 Cloudflare 帳號內的 Route、DNS proxy、TLS 及 GitHub Pages 回源驗證。`ASSET_MODE=route-origin` 只能用在既有網站前的 **Worker Route**，不能當作 Worker Custom Domain 或 workers.dev origin 使用。workers.dev 請求因 origin 不符而回 503 是預期安全行為。

正式 Route 設定需保留既有 GitHub Pages origin，使用 `ASSET_MODE=route-origin`、`ROUTE_ORIGIN_CONFIRMED=true`，以 `/`、`/sm`、`/pa`、子頁、HEAD 及公開媒體 Range 作最後唯讀驗證。未通過應解除此次 Worker Route，保留已建立的 URL metadata，回到既有 Pages fallback。

官方工具依據：[Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/) 與 [Cloudflare workerd](https://github.com/cloudflare/workerd)。同 zone 回源與 Route 語意見原方案 [Cloudflare Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)。
