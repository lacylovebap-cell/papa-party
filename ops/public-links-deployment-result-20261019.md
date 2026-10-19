# 10.19-WEB.2 專屬網址／QR／分享正式結果

2026-10-19 已正式部署。此文件取代同日早期候選報告中的「未部署／等待批准」狀態；早期報告保留當時證據。

- 使用者已明確批准新增四個網址資料表／RPC、初始化 `/sm`、`/pa`，及驗證後部署；另已確認官方 Wrangler 最小 OAuth 權限。
- 發行程式 commit：`655978d66bcf2cbf72eb7a194461b850af13f9b1`，包含最新 main PWA 修正及漂亮網址的 PWA 開啟位置整合。
- 正式網站 `release.json` 與 API `releaseInfo` 均為 `10.19-WEB.2`；API `publicLinks:1`、`nativeApps:false`。
- `party-api` 正式版本 52，ACTIVE；沿用既有 `verify_jwt:false` 及函式內認證，沒有放寬管理授權。
- `public_routes` additive migration 已成功套用：四表 RLS 開啟，anon／authenticated 不可直接呼叫任何新函式；僅六個入口 RPC 授權 service_role，內部 helper 不可直接呼叫。
- 初始 alias 只有已確認的兩筆，route Audit 0；沒有為了驗收修改正式主播代碼或製造歷史資料。四表含索引實際 163,840 bytes（160 KiB），不代表回收既有資料庫容量。
- Cloudflare Worker `pa-public-routes` 正式版本 `cc869052-8db5-4a71-9f14-6d7e5c65fd2f`，Route `https://paparty.app/*`；workers.dev／preview URLs 關閉。
- 原 GitHub Pages 的四 A、四 AAAA 地址保持原值，只啟用 apex Proxy；www CNAME 保持原值與 DNS only。已唯讀確認 TLS Full、自動模式及通用憑證使用中；未變更加密／憑證／付款方案。
- 最終 Worker bundle SHA256：`60e1a8945b50f48b4c41f2dcf71a156721ec71488e58a53dfda032ac76668056`；部署工具會正常 bundle 為單檔，不上傳額外 ops 檔案。正式使用 Wrangler 4.151.2；所有工具僅在忽略的本機驗證目錄，沒有正式前端相依。

## 驗收

- 原始 133 項 targeted tests 已有完整通過證據；新增 PWA／網址合併後 78 項與最終 release 的 57 項必要測試均通過。各群有重疊，不將數字相加冒充不同案例總數。已知 main 原有 catalog fixture 的 broad Edge test 問題維持記錄，沒有宣稱 full suite 全過。
- 真實隔離 PostgreSQL 17.11：6 項通過，觀察兩連線 advisory lock 等待、同 revision 一成一敗、無重複 Audit、失敗原子回滾、十張業務假資料表 digest 相同；測試伺服器已停止。
- 真實 workerd：10 項通過，最終 bundle SHA 與結果相符。
- 正式唯讀 smoke：7 項通過，見 `public-links-live-verification-20261019.json`。`/sm`、`/pa/book` 回 200 並具有正確 stable IDs／子頁；`/PA/book` 308 一跳保留歌本目的地；HEAD 200、圖片 Range 206、未知網址 404、根首頁 200。HTTP 與 www 仍為既有 301。
- 正式瀏覽器已驗證 `/pa/book` 顯示怕怕歌本及 WEB.2；`/sm` 登入連結保留大廳位置；分享呈現 `/sm`、官方 LOGO、PNG／SVG 與分享按鈕。實際下載的 1024px PNG 已由 OpenCV 解碼回 `https://paparty.app/sm`。沒有發送給任何收件人。
- 實際 QR 圖片共 24 組離線解碼通過；手機原生 share chooser／紙本掃描仍需裝置驗收，不冒充已完成實機驗收。
- 驗收畫面：`public-links-live-share-20261019.png`。瀏覽器驗收用 viewport override 已清除。

## 資料保護與範圍

此次僅新增已批准的 URL metadata／權限受限 RPC，未刪改原有玩家、歌曲、帳務、演唱、勳章及既有 Audit，未進行 VACUUM／REINDEX／搬移或私人資料匯出。純結構備份在 `public-routes-schema-only-preflight-20261019.json`。

目前正式啟用的是聲瑪 `/sm` 與怕怕 `/pa`；其他主播可透過自己的設定啟用代碼。其他廳／獨立格式的 registry 與權限已實作，但原本尚未開放的原生 Space 業務 guard 仍保留，不能宣稱多 Space 業務流程已全部開放。

安全 advisor 只有四個新表的 [RLS enabled no policy INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)：這些表刻意禁止直接表存取，RPC-only 且 grants 已核實。原有三個 [mutable search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)、一個 [anon SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、一個 [authenticated SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) 警告數量不變，均非本次新函式；未擅改既有授權。

## 回復

保留新 URL 解析、bootstrap、context 與歷史 aliases。緊急時以 `PUBLIC_ROUTES_READ_ONLY=true` 關閉改碼，使用相容版本向前修復，不刪網址表／Audit。解除 Worker route 可回既有 Pages fallback（漂亮網址 HTTP 可能恢復 404，但既有 query 網址與模板保留）。若需回復代理，可將同八條 apex 記錄改回 DNS only，地址保持原值；不移除 stable registry。
