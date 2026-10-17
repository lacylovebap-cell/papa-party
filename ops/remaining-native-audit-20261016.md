# Android / Windows 原生交付稽核

稽核建立日：2026-10-17（台灣）；沿用本批指定檔名 `remaining-native-audit-20261016.md`。
稽核基準：本機 commit `0aa7fd5`，當時 `release.json` 為 `10.16-WEB.6`。未查詢正式資料庫、未確認任何 migration 已套用正式環境。其後已完成下列原生註冊 SQL 契約、Edge 入口與隔離測試；原生 App、sender 與正式部署仍未完成。

## 本輪已完成：原生註冊 SQL 契約（未部署）

- 新增 `supabase/migrations/202610170002_native_push_registration.sql`，沿用既有 `papa_device_push_registrations`，不新增表、帳本、通知流或 sender。前置缺少原註冊表 / 既有 Space 權限 helper 時整個 migration 失敗回滾。設定短 lock timeout，避免正式審核後執行時無限等鎖。
- `papa_register_native_push(subject uuid, chosen_session uuid, chosen_transport text, chosen_destination text, chosen_permission text default 'granted')`：`subject / chosen_session` 必須由未來 Edge 的已驗證裝置 actor 提供；SQL 再鎖 session、核對 Account / Membership / Space / 管理者綁定及 OS 配對。Android 僅 `fcm`、desktop 僅 `desktop_os`。同值註冊無 UPDATE，token 輪替沿用同一 registration id。權限為 `prompt / denied / unsupported` 時保留同一 binding 並停用。
- `papa_disable_native_push(subject uuid, chosen_session uuid, chosen_registration uuid, chosen_transport text)`：只停用完全相符的那個裝置 binding，重複停用不更新、不影響其他裝置。保留 registration 原紀錄。已撤銷、過期、失去授權的身分不得藉此修改 binding；之後 sender 仍必須每次送出前再驗權。
- 只授予兩個 entry RPC 的 `service_role` execute，既有 RLS / 客戶端封閉權限維持。內部驗權與時間 trigger helper 不另授 service role 呼叫權。回傳僅 `registrationId / permission / enabled / changed`，無 destination、token、refresh / access hash 或其他身分資料。
- 時間使用真正 `clock_timestamp()`，包含鎖後驗證、寫入後再次驗證與 native metadata。原共用 guard 仍使用原規則；新增 native 專用時間 trigger 在其後運作，Web / APNS 分支不改。任一最終檢查失敗，整組 token / 權限 / metadata 一起回滾。
- 新增 `tests/native-push-registration.test.js`，以實際既有 migration / 登入 / Space switch 函式建立 PGlite 假資料。新檔 **25 項**通過；同跑既有 device-push contract 與 Web-device push 兩項，共 **27 項通過，0 失敗**。測試命令：`node --test tests/native-push-registration.test.js tests/device-push-contract.test.js tests/web-device-push.test.js`。
- 已驗證：同值防重、token 輪替、權限變更、精準停用、實際寫入 trigger 失敗回滾、其他 Account / session 借用阻擋、會員暫停 / 移除、Account 停用、Space 暫停、主播停用 / 管理者綁定撤銷、總裁角色撤銷、真實切 Space、長交易過期與寫入中到期回滾、service-only / RLS，以及業務 / Audit / 原 Web Push / job / device-delivery 表完全不增加資料。
- PGlite 的平行 JS 呼叫由單一 DB 連線排隊，只證明重複呼叫防重；不宣稱已驗證兩條真實 PostgreSQL 連線的並發鎖競態。該驗收與原生真機測試仍待執行。

SQL 這輪只修改本文件與以上兩個新檔；未修改正式網站、正式資料、既有業務表或任何 App 安裝檔。以下第一輪缺口說明以本地新增 SQL 與下一節 Edge 入口為補充；sender / 原生工程仍然缺少。

## 後續已完成：原生註冊 Edge 入口（本機、未部署）

- 父層已在 `party-api/index.ts` 接 `nativePushRegister / nativePushDisable`，位於舊 native 業務保護前。使用真實 `actor(token, null)`，只接受 `device:`，Account / session 必須是已驗證有效 UUID；`expectedDeviceSessionId` 必填且必須完全相符。body 的 streamer / Space / Account / session / recipient 均不能取得授權。
- 入口只呼叫對應一個既有新原子 RPC；不讀 snapshot、目錄或業務歷史，不啟動 sender、通知或額外背景流。回應驗證形狀後明確只投影 `registrationId / permission / enabled / changed`，不透出 token / credentials。
- 本子任務新增 `tests/native-push-edge.test.js`，直接載入 shipping handler 與真 `actor()` / `api()`，只替換 fetch 邊界；**9 項通過，0 失敗**。覆蓋偽造 scope、expired / legacy / 無效身分、缺失 / 切換 expected session、非法輸入、server 額外 secret 投影、格式錯誤 / 缺 migration / RPC 故障不 fallback、無背景工作，以及舊 native 業務 guard 保持。
- 實際執行：`node --test tests/native-push-edge.test.js`。連同上一輪 SQL 25 項與既有推播 2 項，分批共 36 項曾通過；整合階段仍應由父層依最終 source 執行必要 targeted checks，不能把這些分批結果冒充正式環境已驗證。
- 本次子任務只新增 Edge 測試並更新本文件；Edge 實作由父層維護。SQL 仍是未執行正式 migration 的本機檔案，`nativeApps:false` 應保持，不宣稱 Android / Windows 成品完成。

## 狀態與範圍

| 交付 | 已存在 | 實際缺口 |
| --- | --- | --- |
| Android | 網站 / PWA、共享裝置登入與通知目標、SQL 的 `fcm` 平台契約 | 無 Android 原生工程、APK / AAB、OS 安全儲存 adapter、FCM 客戶端 / sender、Android deep-link handler、安裝 / 更新 / 簽署產物 |
| Windows | 網站 / PWA、共享裝置登入與通知目標；本機有 WebView2 runtime | 無 Windows 原生工程、EXE / MSI / MSIX、OS 安全儲存 adapter、系統匣 / 背景通知 / 啟動協調、安裝 / 更新 / 簽署產物 |
| 正式能力標示 | `party-api` 的 `releaseInfo` 明確回傳 `nativeApps:false` | 不應把 PWA 或 SQL contract 的存在列為原生 App 已交付 |

已搜尋目前 repo 及 `Documents/Codex` 內的 AndroidManifest、Gradle、Tauri、Capacitor、Electron、`.csproj`、APK / AAB / MSI；未找到可接續編譯的原生工程 / 安裝產物。此搜尋不包含私人磁碟或未連接的其他電腦。

## 可直接複用的既有契約

- `src/device-session.js`：平台注入 `transport / store / lock`；`deviceStart → deviceRefresh → deviceLogout`；access token 只在記憶體，refresh 輪替先安全落盤才啟用。無固定輪詢 / 背景 refresh 計時器；玩家與管理者槽分開；失敗儲存時撤銷新 session；身分與 Space 由伺服器核對。
- `src/web-device-login.js`、`src/web-credential-store.js`：現有 Web adapter；註解已明確原生應提供 OS secure-store。不可把目前瀏覽器加密儲存直接宣稱為 Android Keystore / Windows Credential Manager。
- `src/notification-rules.js` 的 `canonicalNoticeLink` 與 `src/notification-target.js`：跨平台目標版本 1，帶 `spaceId / streamerId / streamerSlug / section / entityType / entityId / notificationId`，本身不授予存取權。URL parser 限定來源 / mount、拒絕憑證參數、重複必要欄位與不合法內容。
- `sw.js`：既有 Web Push 以通知 ID 去重、限定站內 URL，點擊時只導覽；最終資料仍由一般登入 / 授權查核。這不是 Android FirebaseMessagingService 或 Windows OS 通知 adapter。
- `supabase/migrations/202610070005_device_push_contract.sql`：已有 registration / delivery 資料契約、裝置平台與 transport 對應、active Account / Membership / Space 查核、`unique(device_session_id,transport)` 與 `unique(notification_id,registration_id)`、RLS 封閉直接客戶端表存取。註解明確尚未接替原 Web Push enqueue。
- `202610070010_web_device_push_bridge.sql`：現有 Web 訂閱綁 durable device session，登出撤銷該裝置的推播路徑；沿用既有 Web job stream。

## 精確推播缺口

### FCM / desktop 裝置註冊

第一輪基準 `party-api` 只有 `pushSubscribe / pushUnsubscribe` 的 Web Push endpoint + p256dh / auth 格式。之後原生 registration SQL / Edge 路由已完成本機接線（見上方），正式環境尚未啟用；原生客戶端註冊 adapter 仍缺少。

最低新增方案應沿用現有表：

1. 經 `actor()` 核實當前 `device:` 身分，以伺服器得到的 session 綁定；若傳 expected session，必須完全相符。不接受前端指定 Account / recipient / Space 來借用別人的裝置。
2. Android 只能 `fcm`、desktop 只能現有允許的 `desktop_os / web_push`；token 更新應更新同一 binding，禁止更換其 session / transport 身分。登出、帳號停用、授權移除、切 Space 後，舊 binding 不再生效。
3. token 只存服務端 registration；UI、日誌、通知 URL、Audit 原文不回傳 token。需要合理大小驗證、原子重複註冊處理及精準停用，不能直接放寬 RLS。
4. Firebase `onNewToken`、權限變更、登出與重新登入的客戶端接線尚不存在。單有 destination 欄位不能完成推播。

### FCM sender / delivery

目前 `party-api/index.ts` 的 `deliverPush()` 只 claim `papa_claim_push`、讀 `papa_push_subscriptions`，以 `web-push@3.6.7` / VAPID 發送。搜尋未找到 Firebase HTTP v1 `messages:send`、Google OAuth service-account 換證、FCM sender 或 `papa_device_notification_deliveries` 的服務端 claim / ack / retry 消費者。

現有 Web Push 合法 endpoint 包含 `fcm.googleapis.com`，這是瀏覽器 Web Push transport，**不等於 Android 原生 FCM 已實作**。不可把 VAPID 金鑰當原生 FCM 權限使用。

最低需補既有 delivery contract 的有界 claim / lease / ack / retry、安全過期 lease recovery、送出前再次查身分 / Space / 訂閱 / 通知偏好、無效 FCM token 精準停用、相同通知 + binding 防重。應共用 canonical 通知，不建立第二份業務通知或廣播全主播。現有 Web job stream 先保留，避免雙送。哪些 SQL 可正式執行須另經非破壞性 migration 審核。

FCM 的 send 成功只是服務接收，不應直接宣稱手機顯示成功；仍須真機前景、背景、鎖屏、通知點擊、冷啟動與登出後不送達驗收。桌面原生 transport 亦需明確 OS dispatch / delivery 行為，目前沒有 consumer。

## 原生 deep-link / 安全邊界缺口

目前有可重用的 JS 目標與 Web 驗證測試，沒有 Android Intent / App Link、Windows protocol activation、冷 / 熱啟動及單一 instance 的 adapter。

原生實作最低需：

- 只接受配置的正式 HTTPS origin / path，及受控 canonical link 版本 / 欄位；拒絕外站、`javascript:` / `file:`、憑證參數及偽造 entity 目標。通知輸入一律視為不可信。
- 未登入時保留待處理目標，正常登入後再讀伺服器授權；管理者通知沿用管理者身分，不能強制改成玩家。不得把 target 裡的 Space / player 當授權。
- 登出或切 Space 時清除舊記憶體權限 / 待處理私密內容，且不能讓舊通知跨 Account / Space 開啟私人資料。開啟時沿用既有 `noticeTarget` 查核。
- 如果使用 WebView / IPC，原生 bridge 必須同源驗證、窄介面、禁止遠端任意執行與秘密回傳；refresh 保存在 OS 安全區、access 只在需要範圍內使用。不能透過 URL / localStorage / 任意網頁 bridge 傳長效憑證。

## 本機工具量測

| 工具 | 實際結果 |
| --- | --- |
| Node | 可用：`C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` |
| npm、Java / javac、Gradle、adb、dotnet、MSBuild、cargo / rustc | `Get-Command` 未找到 |
| 標準 Android SDK / JDK / .NET / Visual Studio 路徑與使用者 `.gradle / .cargo` | 未找到 |
| Edge WebView2 | `C:\Program Files (x86)\Microsoft\EdgeWebView` 存在；只證明 runtime，不能取代原生編譯工具 / 專案 |

未安裝、下載或變更任何工具。未搜尋或讀取憑證檔案 / 環境秘密。

## 可繼續本機完成與需要外部資料的分界

可在現有 Node / 隔離 DB 環境直接完成，無需正式寫入：

1. 裝置 registration 服務端契約 / RPC / Edge 及隔離測試已完成本機版本；下一步是原生 adapter 接線與真實多連線驗收，正式 migration / Edge 啟用須依部署 gate。
2. FCM sender 的純 adapter 與 fake transport contract tests；delivery claim / lease / retry 的隔離 DB 測試。不得把 mock 成功列為實際 FCM 送達。
3. 原生 host 與共享 session / notification-target 的窄 bridge 設計、惡意 deep-link / 身分切換 / lifecycle 測試。
4. 可重現建置 / 發布 gate 規格，列明 toolchain、版本、正式 API origin、簽署來源、安裝與更新路徑。無可編譯工程與工具前，不產生空殼宣稱 APK / Windows 完成。

實際原生建置 / 推播仍需要：

- 選定可編譯原生技術與 toolchain，安裝 JDK / Android SDK 等或提供受控 CI；Windows 則按既定 host 選 .NET / Windows SDK、Rust 或其他必要工具。現 repo 未有既定框架，不能把任一框架當成已確認方案。
- Android 的正式 applicationId、Firebase 專案 / Android App 註冊公開設定（例如 `google-services.json`），以及由帳戶擁有者在受控 secret 管道配置的 FCM 發送權限。**不要求在聊天貼 private key / password**，也不推測或自行建立付費專案。
- Android 既有 release signing 是否存在與安全簽署管道；若建立新發佈身分，須由擁有者確認，不能先生成臨時金鑰冒充正式版。App Links 若採用，需要正式 package + 簽章憑證雜湊及站點關聯檔。
- Windows 正式 app identity / 安裝與更新來源；若要求簽署 / SmartScreen 友善交付，需現有合法憑證或確定發佈管道，不能臆造簽章或付費購買。
- Android / Windows 真機驗收及實際背景 / 鎖屏 / 冷啟動 / 升級 / 登出隔離驗證；FCM / desktop transport 的正式啟用、必要 migration 與 Edge 部署另行核准。

## 第一輪唯讀稽核證據與限制

- 第一輪僅新增本文件，沒有修改產品源碼、RLS、正式資料、推播註冊或登入身分；沒有安裝 / 下載 / 部署。
- 第一輪閱讀既有 `tests/device-client.test.js`、`device-push-contract.test.js`、`device-space-switch.test.js`、`notification-target.test.js`、`notification-service-worker.test.js` 定位已有保障，未重跑測試；第二輪結果列於最上方。
- 本次完成的是可核對的原生交付缺口與安全實施順序；Android / Windows 原生 App 仍未完成，不能列為已上線。
