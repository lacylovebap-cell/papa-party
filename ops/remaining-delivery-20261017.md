# PA Party 未上線功能增量交付（2026-10-17）

## 基準與本批狀態

- 基於最新 main `0aa7fd5202e0929f59a3c7c7f1d21ce0e31c1c6e`，正式版本基準為 `10.16-WEB.6`。候選版為 `10.17-WEB.1`，並不表示已部署。
- 本批在獨立 `feature/remaining-1016` checkout 實作，沒有合入舊的未提交勳章草稿。WEB.6 的勳章管理、批量授予、進度、證據及稽核撤銷保留。
- 正式資料庫沒有執行寫入、migration、容量維護、補正或私人原文匯出；沒有部署網站／Edge，沒有開放新 Space。

| 項目 | 本批實際成果 | 仍需完成 |
| --- | --- | --- |
| 公開主播大廳 | 完成本機 UI、公開主播搜尋／分頁、跨主播共同歌曲探索、語言／演唱者／六種版本篩選、現點／提歌原歌曲入口 | 正式部署與公開資料的上線後小範圍驗證 |
| 同空間切換主播 | 修正歌本切主播被送回空間選擇／首頁；共同歌本的現點／提歌保留原歌曲到對方歌本 | 前端部署，無須資料庫更新 |
| 多 Space 操作回執 | 既有 commit wrapper 擴充、native 專用權限重驗 lookup、Edge 條件分派及隔離測試 | 正式 migration 審核；完整 Space 業務入口仍封鎖，不能宣稱全程啟用 |
| 原生裝置推播註冊 | 沿用既有 registration 表的原子 register／disable、同值免寫、token 輪替、Edge 裝置身分接線及隔離測試 | 正式 migration 審核、原生客戶端、FCM／Windows sender、delivery lease／ack／retry 接線及實機驗收 |
| Android／Windows App | 已核對可複用登入／通知目標契約與實際工具缺口 | 尚無可編譯 App 工程、安裝檔與簽署；需要選定 host、工具鏈、Firebase 公開設定／受控發送與簽署管道 |
| Scoped Realtime V2 | 完成現況與安全依賴核對；沿用現有通知與同步恢復 | 業務失效通知授權、可靠 delta／tombstone、Web 接線及登出／切 Space 撤權驗收 |
| 容量回收 | 維持已上線程式優化；未重跑既有正式修補 | 正式維護仍須另行核准；不能以假設回收容量宣稱已降至 400MB |

## 公開大廳

主要檔案：`lobby.html`、`src/public-lobby.js`、`src/lobby-entry.js`、`src/lobby.css`、`src/app.js`、`src/theme.css`、`supabase/functions/party-api/catalog.ts`／`index.ts`、`build.mjs`。

- 原首頁維持不變，選單新增「全站大廳」。這是公開資料探索，僅覆蓋目前已公開的 `space-001`；不讓網址／token／前端 streamer 提示擴大至私有 Space。
- 主播回應只保留 id／slug／顯示名，20 位一頁。歌曲複用原私有歌詞安全 RPC，12 個作品一頁。保持原 songId，點擊後進原本現點／提歌確認流程，不直接送單。
- 不讀玩家／帳本／歌詞／Audit，不加輪詢或 Realtime；60 秒固定有效期的有限快取、同請求合併、400ms 中文輸入防抖、過期回應淘汰。
- 搜尋、分類、排序與兩套頁碼保留在網址；頁碼輸入、跳頁按鈕及 Enter 可用。修復 BFCache 返回失效與快取命中延長有效期兩個審查問題。
- 320px、390px、1280px 本機瀏覽器驗證無橫向溢出；搜尋、LIVE／最舊篩選、兩套跳頁及重整保持通過，瀏覽器 error log 空白。
- 截圖 `ops/lobby-mobile-fixture-20261017.png` 全部使用假資料。本機 QA 透過同源 fixture、CSP 限制連線，沒有呼叫正式 Supabase。

## 兩份非破壞性 migration

### 前端跳轉補修（無 migration）

使用者回報怕怕歌本切主播時出現「選擇空間」。根因為原連結只改 streamer，仍攜帶 space／spaceId，重新啟動會進入 requiresSpaceEntry；若只有 spaceId，沒有可解析的 Space slug，就可能走 Home／Last／空間選單。即使同 Space 驗證通過，原 entry 仍會落到首頁，丟失歌本頁。

`src/streamer-navigation.js` 新增 publicStreamerDestination；只有目前與目標主播均來自伺服器回傳目錄、明確屬於公開 space-001、來源主播吻合、同源且一般 app 路徑時，才產生不帶過期 Space／通知／舊操作參數的既有公開主播網址，保留當前歌本等頁面。`src/app.js` 的兩個主播選擇入口與共同歌本統一沿用；共同歌本明確附上這次新選定的 songId／kind。

未知主播、缺少 canonical Space、不同 Space、停用主播、專屬 Space 路徑、偽造 scope 仍走原驗權。requiresSpaceEntry、原生業務 guard、帳本、登入憑證、資料庫與查詢流程皆不變。無額外查詢、輪詢或寫入。

新增 `tests/same-space-streamer-navigation.test.js` 8 項；直接執行實際 app 的 roomDestination／switchStreamer／共同歌本／start 函式重現，驗證重新載入不進選擇頁、雙向保留歌本、歌曲意圖只消費一次與危險／跨 Space 仍驗權。連同現有導航／頁碼／Space／cache 回歸，共 **45 項通過，0 失敗**。未因此重新執行無關帳務與推播 suite。

### `202610170001_native_operation_receipts.sql`

保留原表、global CAS 與原業務 commit；只擴充既有回執 wrapper，另加 native 專用 lookup。所有 native 命中／未命中／重送均先驗現行 Account／Membership／Profile／Space／Room／總裁權限及 actor-key 綁定。原四參數 legacy lookup 語義不變。

Edge 內部 proof／lookup 已接線；一般業務的 native activation guard 全保留。這項完成不代表第二個 Space 的帳務、歌本、通知、匯入、勳章已完整啟用。

### `202610170002_native_push_registration.sql`

沿用原 `papa_device_push_registrations`，只新增服務端 RPC／私有 helper／native metadata clock trigger。原 RLS 與表權限不放寬；不新增表、派送流、排程或第二份通知。

Edge 僅接受經核實的 `device:` 登入，subject／session 從同一 verified actor 取得；必須匹配 expectedDeviceSessionId。Android 僅 FCM、desktop 僅 desktop_os；實際平台、權限、session 到期與撤銷在 SQL 再驗。回應不含 token／destination／credentials。

## 正式執行界線、風險與回復

- 本文件不是正式 SQL 執行授權。上線前須核對目前 schema 定義、既有 migration 先決條件及容量；不能自動執行整個歷史 migrations 目錄。
- 大廳本身沒有 DB migration。兩份 native migration 應各自逐份審核；只會建立／更新函式、ACL 和單一 metadata trigger，無業務資料 UPDATE／DELETE、無資料搬移／索引重建。仍有短暫 DDL 鎖及少量 catalog 空間成本，不能宣稱零風險／零容量。
- 推播 migration 設 lock_timeout 3s、statement_timeout 60s；回執 migration 執行前同樣限制。鎖／先決條件失敗應整份回滾，不在正式環境反覆盲試。
- 部署前保存原回執 wrapper 定義與 ACL。回復網站／Edge 使用基準版本；回執函式還原保存定義、保留所有業務／Audit／receipt。若日後已開 native，先停止新送出入口。
- 推播回復：先回復 Edge／停止新 native 註冊，再撤銷兩個新增 RPC 的 service_role EXECUTE（精確簽名見 migration）。保留 registration／通知／Audit。無須刪表、清 token 歷史或移除業務資料；無授權不執行 DROP／清空。
- Android／Windows 編譯、實機推播、完整多 Space、Scoped Realtime 及容量維護未完成；不能把本機 fixture 或 PGlite 的單實例序列化視為正式多連線與真機驗收。

## 驗證證據

最終針對性測試與建置結果記錄於 `remaining-validation-20261017.json`；測試全部為本機假資料或 PGlite 隔離 DB。僅對本批相關搜尋、頁碼、cache、Edge 權限、回執及裝置推播做回歸，未反覆執行全站 suite。

其他現況與後續順序見 `remaining-platform-audit-20261016.md`、`remaining-native-audit-20261016.md` 及 `native-operation-receipts-20261017.md`。
