# 原生通知本機增量 — 2026-10-18

狀態：兩個底層模組與離線測試完成；尚未接入 App／正式傳送程序，未部署、未推送、未修改正式資料庫。Footer 已另存本機 commit `7c21e88`。

## 完成範圍

- `src/native-push-client.js`：沿用既有 `createDeviceSessions` 的 `token/identity` 及既有 `nativePushRegister/nativePushDisable` 契約。Android 固定 FCM、desktop 固定 desktop_os。每次綁定指定 session，保留玩家／管理者槽隔離；相同在途請求合併，token／權限異動依序處理；舊身分回應淘汰。停用只指定一個 registration，不掃描或清空其他裝置。
- `supabase/functions/party-api/fcm-transport.js`：只提供可注入的單次 FCM HTTP v1 transport。端點固定，拒絕重新導向；注入短效憑證，逾時涵蓋取證、傳送及讀取回應；限制 UTF-8 大小及回應容量，釋放未讀回應串流。內容固定為通用通知，只投影現有 canonical notification target 與通知 ID，不傳私訊正文、帳本或完整快照。
- 傳送結果區分 provider 接收、可重試、失效註冊、設定／驗證／內容錯誤及不確定結果。只有 404 且含 FCM 型別的 `UNREGISTERED` 才回報失效；一般 400／404 不會被當成失效 token。回傳不含 token、provider 原文或憑證。只提供 Retry-After 建議，沒有重試、睡眠或排程。
- `tests/native-push-client.test.js`、`tests/fcm-transport.test.js`：新增 23 項測試，全部使用假資料與注入的假 transport，沒有正式 API、FCM、Supabase 或私人資料存取。

## 驗證

整合指令：

```text
node --test tests/native-push-client.test.js tests/fcm-transport.test.js tests/device-client.test.js tests/notification-target.test.js tests/native-push-edge.test.js
```

結果：46 項通過、0 失敗、0 跳過，約 590 ms。完整輸出：`native-push-adapters-tests-20261018.txt`。另通過 `git diff --check`；未反覆執行全站測試或建置。

已驗證身分／Space pin、登入槽隔離、token 輪替、A→B→A 更新順序、重複請求、精準停用、晚回憑證不得再發送、逾時、重新導向、錯誤分類、串流清理，以及敏感資訊不回傳。現有 session 與 notification-target 回歸一併通過。

## 接線限制與仍未完成

- 目前沒有任何網站／Edge 入口 import 這兩個新模組；既有 Web Push、登入、業務 guard、`nativeApps:false`、帳務及資料表均未改動。沒有新增流量、輪詢、Realtime、migration 或正式測試通知。
- 未來 native host 必須在登出／切 Space 開始前呼叫 `invalidate(role)`，OS token 事件需固定原 `expectedDeviceSessionId`。沒有真 token 應延後註冊；不知道 registrationId 不得猜測停用。adapter 不能撤回已送出的請求，仍由服務端重新驗權。
- FCM `accepted` 僅代表供應商接收；逾時／網路錯誤可能已傳送，不能宣稱手機已收到，也不能直接無條件重送。
- 還缺既有 delivery 表的 claim／lease／ack／retry 與送前再驗權、受控憑證供應、原生 host 與 OS 接線、Android／Windows 可編譯工程、簽署與真機驗收。本批未選框架、安裝工具、讀取秘密、建立 Firebase 專案或擅定限時／重試政策。
- 正式 migration、部署及容量維護仍須依既有批准界線另行處理。這不是原生 App 交付或正式啟用證明。

參考：[Firebase HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api)、[錯誤代碼](https://firebase.google.com/docs/cloud-messaging/error-codes)、[訊息格式](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)。
