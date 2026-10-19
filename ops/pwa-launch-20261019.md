# PWA 啟動修復與本機開啟位置（未部署）

基準：origin/main b422e16，獨立分支 fix/pwa-launch-20261019。未合入原生 FCM 未完成工作。

## 已證實的根因

manifest 舊 start_url 為 ./#home。官網 legacyPortalDestination 將 #home 或帶 Space 的根網址送往 v2.html；既有 spaceDestination 在登入完成後又回傳根網址。enterSpace 比對網址不同便 replace，下一次啟動重新驗 Space 再返回根網址，構成循環。測試重現並證明修正後的第二次 spaceDestination 結果完全相同。

spaceDestination 現在回傳同 mount 下的 v2.html；既有 path=true 自訂 Space 路徑、登入驗權不變。manifest id/scope 維持 ./，只把 start_url 改為 ./?appLaunch=1。SW 未變更，不清快取、不清登入、不改推播訂閱。

## 已實作

- pwa-start.js：只有 standalone/iOS standalone 處理啟動標記；記錄有效正式路由、已由既有資料確認的 Space/主播 ID，白名單保存頁籤，排除憑證、玩家詳情及一次性操作。
- pwa-start-ui.js：APP 選單可查看、設目前頁及重設官網；第一次進有效頁面詢問，稍後再說後不反覆詢問。通知/送單入口不自動彈窗；彈窗用 textContent，無遠端資料寫入。
- index.html：必要的單次啟動導向，官網重設留在官網。app.js/lobby-entry.js 接設定按鈕及成功渲染後確認；記住的主播身分不符則安全回官網，保留偏好供使用者更改。
- 獨立 localStorage 鍵 papa.pwa.start.v1 和 papa.pwa.start.asked.v1；不操作其他本機鍵。重新整理/回前景不註冊重新導向事件，沒有新增 Supabase 查詢、輪詢、Realtime 或資料表。
- 已更新受影響入口/module 的 cache query，沒有改動全站業務版本或正式 release.json。

## 驗證與未完成事項

56 項既有及新增路由、Space 登入、PWA 安裝、官網入口、cache 測試通過，另 3 項 UI 行為測試通過，共 59 項。修改舊入口保守策略後重跑相關 10 項通過。node build.mjs 通過。測試全部本機，沒有正式 Supabase 呼叫。

尚不能宣稱完整驗收：
1. 舊 PWA 的 /#home 與無 referrer 的外部 /#home 連結無法可靠區分。因此舊入口安全進官網，不套用偏好；新 manifest 啟動標記才能確定套用。Android manifest 更新與 iOS 已安裝舊主畫面捷徑是否採用新 start_url 尚需真機確認，不能承諾舊 iPhone 捷徑自動更新。
2. 最新 main 沒有 /pa、/sm 短路由定義；目前只保存現有 v2.html?streamer=…#分頁 和 lobby.html。未假造對應，不修改原有自訂 Space/舊轉址。短網址需求仍待既有官方別名規格/實作確認。
3. Android/iPhone 真正安裝後關閉重啟、畫面視覺、通知點擊與登入持續性尚未實機測試。Node 的 standalone 模擬不等於真機通過。
4. 這輪沒有 push/merge/正式部署、資料庫 migration 或正式資料修改。原網站閃跳須部署修復後才會受益。
