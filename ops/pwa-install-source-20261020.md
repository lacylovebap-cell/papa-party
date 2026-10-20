# PWA 安裝來源與共用 APP 識別

本機安裝來源分支；沒有執行部署或正式資料寫入。

- `manifest.webmanifest` 保留既有 `id: ./`、`scope: ./`、名稱及三張官方圖標；無來源 `start_url` 改為 `./app.html`。
- `pwa-install-source.js` 只編碼 `{v:1,kind,spaceId,streamerId}` 公開穩定識別，不保存帳號、權限、網址或顯示名稱。base64url 最多 1,024 字元，拒絕重複／未知秘密欄位與控制字元。
- `prepareInstallManifest` 設定真正同站 `manifest.webmanifest?install=...`，不使用 blob/data manifest、不依賴安裝前 localStorage。iOS 的新獨立儲存環境仍能由 manifest 的 `start_url` 取得來源。
- `createWebAppInstall({source,mountUrl})` 在初始化可設定來源，或用 `.prepareSource(source)` 更新目前已驗證公開頁面；相同來源不反覆更新 href。不同來源會撤銷舊的 deferred install event，避免把前一位主播誤當目前安裝來源。傳 null 會回復沒有來源的共用 manifest。
- Worker 對合法安裝來源僅一次呼叫公開 `publicAppHome`，核對 active、kind、Space 與主播 stable ID；停用、無效或跨範圍結果回 APP 內選擇器。合法但尚未設定 pretty URL 的老主播保留 stable source。網路失敗回 503 供瀏覽器重試，不假裝停用。
- 動態 manifest 保留共用 id/scope，使用 private/no-store，清除舊 ETag、Cookie 與長度標頭。HEAD 內部只讀原始小型 manifest，對外沒有 body。
- `/app.html` 是靜態系統入口，不查公開網址 registry、不轉到官網。
- 不新增 polling、Realtime、帳務查詢、全歷史下載、Storage 或會員寫入。

整合約定：從目前已驗證的 public view 傳入來源，不使用登入擁有者。APP 啟動後由 `pwa-start` 再驗證 stable source；使用者後續明確設定的首頁優先，暫時瀏覽不寫首頁偏好。

驗證：來源／安裝事件／manifest Worker 與原網址 Worker 的針對性 Node 測試通過；Cloudflare 真正 workerd 隔離執行包含 14 項驗證，證據為 `pwa-public-route-workerd-result-20261020.json`。所有 workerd 外連皆由本機假資料攔截。

限制：這些測試驗證 iOS 無預先 localStorage 的啟動資料傳遞與 Android 安裝事件機制；不等於已在 Android、iOS 真實手機完成解除安裝／重新安裝／重開機驗收。裝置端實測由整合部署驗收另外記錄。
