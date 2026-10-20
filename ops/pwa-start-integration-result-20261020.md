# APP 安裝來源與預設首頁 — 本機完成，待正式 RPC 核准

## 根因

原 manifest 的 `start_url=./?appLaunch=1` 固定進官網；無偏好時 `launchPlan` 也回官網。舊設定只靠瀏覽器 localStorage、只能儲存目前頁面且允許恢復官網，不符合 APP 首頁需求。

iOS 17.2 官方文件明確說加入主畫面時只複製 cookies，不複製其他 local storage：[WebKit 17.2](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/)。因此預安裝 browser storage 不能當唯一來源。固定 manifest `id` 可讓不同 `start_url` 維持同一應用識別：[Web app manifest](https://web.dev/articles/add-manifest)。

## 已完成的本機修正

- 固定原 APP id、scope、圖標及名稱；由同站 manifest URL 攜帶白名單 stable Space／streamer ID，初始啟動為 `app.html?install=...`。來源包含公開 ID，不含登入憑證、玩家資料或可任意指定的網址。
- 漂亮網址的初始 HTML 已在載入業務資料前帶入來源 manifest；舊式主播頁由已確認的 currentStreamer 準備來源。安裝事件綁定來源變更時會丟棄舊 prompt，避免 A 主播的事件被 B 沿用。
- APP launcher 以儲存的使用者／既有偏好優先，再用初始來源。瀏覽其他主播、登出或重新登入均不寫偏好。舊 v1 設定無損遷移，原儲存鍵保留。
- 沒有來源／來源確定失效時進 APP 內選擇器；離線／逾時保留原偏好並顯示重試，不將連線錯誤當成停用，也不跳銷售官網。
- 「預設開啟首頁」顯示廳／主播名稱，可搜尋、分類、分頁、選擇並儲存。只有明確儲存才寫單一新偏好鍵；不清除登入、推播或業務資料。
- 新增兩個唯讀 Edge operation，經唯一新 read-only RPC 做 DB 內搜尋／統計／分頁；每次至多 12 筆。無 polling、Realtime、全量歷史下載或每主播 fan-out。

## 驗證

- `pwa-start-integration-tests-20261020.tap`：154 項 targeted tests 通過、0 失敗／跳過。
- 最後補驗初始 HTML 先提供來源 manifest、舊 bare-root APP 啟動遷移及 cache query：35 項相關測試通過（與前群重疊）；新增一項不同測試，非將重疊數字相加。
- 真實 workerd 最終 14 項通過，含動態 manifest、iOS 空 storage 傳遞、固定 id／scope、舊主播、未知／停用來源及原網址 200／308／HEAD／Range 回歸。
- 本機瀏覽器全為假資料、所有 API 止於 localhost：無來源進 chooser；怕怕來源首次啟動自動開怕怕；暫看米雪未改偏好、重開仍怕怕；手動改米雪後仍從原怕怕 install URL 重開也進米雪。
- 390×844 viewport 的設定 dialog 幾何為 358.4×661.95，左右各 16px、沒有水平超出。實際設定畫面在 `pwa-home-settings-local-20261020.png`，桌面截圖。
- 網站與 Edge bundle 建置成功；未進行正式資料庫變更或正式部署。本輪正式環境仍為前次 WEB.2。

## 待核准的唯一資料庫變更

精確 SQL：`ops/pwa-public-homes-rpc-20261020.sql`。

只新增 `papa_public_app_homes(text,text,int,int,text,text,text)` 一個 STABLE 唯讀函式及 schema reload 通知；沒有新表／索引／trigger，沒有 UPDATE／DELETE／帳務補正。撤銷 PUBLIC、anon、authenticated 的 EXECUTE，只授予 service_role，由現有 Edge 白名單公開必要名稱與 stable IDs。

成本為函式定義的少量 catalog 容量；每次啟動一個 exact source 查詢，打開或搜尋 chooser 才讀當頁 12 筆。正式套用前檢查同名函式不存在、既有 schema 相容、保存純結構證據；失敗交易整組回復。這項新函式不在上次四張 URL metadata 表的核准範圍，依使用者既有正式 migration 確認要求等待批准。

正式已公開業務目前仍受既有 Space capability guard 控制。APP 的來源格式／偏好／launcher 為通用 stable-ID 設計；不把尚未開放的原生 Space 當成可用首頁，也不改租戶權限。未來平台正式開放其他 Space 時，需同步擴大現有業務 capability 範圍，不能宣稱本次已開放全部多租戶業務。

## 部署與回復

批准後：先套用此唯一 RPC → 驗證有界公開結果與 service-only 權限 → Edge → 靜態 APP shell／UI → Worker manifest → 公開來源與既有 URL smoke。原正式玩家／歌曲／帳務不作測試異動。

一旦有人安裝新 manifest，必須保留 `app.html`、啟動模組、API resolve 及唯讀 RPC 的相容性；不得完整退回不含新 APP 入口的舊版。以相容修正回復，資料庫函式可安全保留，不刪偏好或原資料。尚未有安裝使用前才可退回先前部署。回復 Worker 時也保留原 URL registry 及解析功能。

## 尚需實機驗收

離線測試已分別涵蓋 Android standalone、iOS navigator.standalone 及 iOS 空 storage；這不等於真實手機已安裝／強制停止／重新開機測試。正式部署後仍需 Android 與 iPhone 各驗證首次安裝、重開、改預設及登出登入；不要求使用者刪除原 APP 或資料。
