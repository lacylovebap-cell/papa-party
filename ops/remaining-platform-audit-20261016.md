# 尚未完成的 Space／Scoped Realtime 核對

核對基準：checkout `papa-party-remaining-1016`，`0aa7fd5`／10.16-WEB.6。僅讀取現行程式及既有測試；本次沒有重新執行舊測試、查正式資料、套用 migration 或部署。後續公開大廳新增檔另作靜態審查，不把它誤認為完整多 Space 啟用。

## 現況矩陣

| 領域 | 已有現行實作 | 真正未完成／限制 |
| --- | --- | --- |
| Space 入口 | `src/space-entry.js`、`web-space-entry.js`、既有 `spaceEntry`／`deviceSwitchSpace`；驗證權限後的 Home／Last、分頁選擇、正規網址、裝置切換及清除舊玩家操作 | 不代表第二個 Space 的業務頁已開放；舊瀏覽器憑證入口明確只容許 space-001 |
| 玩家與業務隔離 | `202610070013_space_player_profiles.sql`、`202610080013_native_room_transactions.sql`；Account／Membership profile、native 原子 commit、私有歌詞保存、參照及 Audit 防護 | Edge 仍明確封鎖非 space-001 的一般業務、managerRoom、通訊 metadata、songSearch、draft/publish 等入口 |
| 匯入／草稿／主播註冊 | 已有 `room-import.js`、`room-draft.js`、`papa_streamer_registry_snapshot/commit`，精準歌曲 hydration 與現有 scoped admin writes | 舊 checkpoint 將這些整項列為未做已過時；需要驗收既有路徑在 native Space 的全程接線，而不是重新開發 |
| 通訊隔離 | `tests/communication-space.test.js` 已有 native chat／board 名稱、歸屬、參數、回滾與 Audit 測例；`communication-context.js` 已分開同 ID 的快取 | Edge `loadCommunicationState` 在指定 native room 時仍拒絕；Push 的訂閱／派送亦須配合完整 native 過程驗收 |
| 操作回執 | `src/operation-recovery.js`、`202610130005_operation_receipts.sql`；既有space-001防重送流程 | `operationProof` 與 receipted commit 都明確只允許space-001；不可直接拿掉外層封鎖，否則native操作會在回執層失敗 |
| Scoped revision | `202610120001_room_live_sync_revisions.sql`：Room／Space／catalog counter；`roomSyncHead` Edge投影及對應測試 | 目前是manager限定、診斷用途；明確 `authoritative:false, delta:false, realtime:false`，不保證足以取代權威資料讀取 |
| Web既有同步 | `web-sync-recovery.js` 已有single-flight、有限退避、scope race淘汰、前景／上線恢復與編輯保留；`app.js` 現有30秒revision恢復、5分鐘強制讀取 | 尚未使用roomSyncHead驅動業務讀取；無完整業務變動通知／玩家私有scope／delta cursor及tombstone。`releaseInfo.scopedRealtimeV2` 仍false |
| 通知Realtime | `notifications.js` 已有現行notice WebSocket與備援；`signalNotices`只發空payload | 這是通知通道，不能宣稱為業務Scoped Realtime V2；也不可拿公開notice topic直接承載帳本／玩家私有revision或內容 |

## 建議實際執行順序

2026-10-17 整合註記：下列第 1 步已完成本機大廳；第 2 步的 native commit wrapper、專用 guarded lookup 與 Edge proof／lookup 分派已完成本機實作及針對性測試，見 `native-operation-receipts-20261017.md`。舊四參數 lookup 保持 legacy 用途，native 命中不能走它直接早返。第 3 步一般業務啟用仍未完成，主業務／managerRoom 等封鎖保留；下方較早稽核所述的 proof 與 lookup 缺口已由此增量接線處理，並非仍待移除 guard。

1. **先做可以獨立交付的公開大廳**：沿用現有公開目錄／共同歌本RPC，限制目前已公開的space-001，不建立帳務、玩家或原生Space。這與完整Space啟用互不綁定。
2. **native回執相容性**：沿用現有`papa_room_operational_commit`的Space分派，先在隔離fixture證明native receipted commit的相同operation ID、防重送、異payload拒絕、權限及Audit回滾。具體修改點是`operationProof`、`202610130005_operation_receipts.sql`的後續非破壞性extension，和既有`tests/native-room-transactions.test.js`／operation receipt測試。保留現行global CAS，不另建帳本。
3. **集中列出並驗證native入口**：以`index.ts`目前每處`space-001`拒絕點作清單，逐條測read、request／complete／cancel、ledger、quota、import／publish／registry、通知／私訊／留言、勳章與匯出，確認相同player ID在另一Space無法交叉引用。帳務摘要目前的test-player排除只查legacy `papa_v2_entities`，native profile邊界也須補測。測完才談顯式啟用，不以刪掉guard當完成。
4. **Scoped Realtime先完成授權與無內容失效通知契約**：每個業務寫入需在成功提交後產生正確scope的失效訊號；私人通道須由已驗證Account／Membership授權，登出／換Space／停權要撤銷。使用scope+domain+revision等最小內容，避免私訊／帳本／玩家活動洩漏。先在隔離環境測commit失敗不發訊、同值寫入安靜、跨room不廣播。
5. **再整合Web讀取與delta**：`app.js`／`web-sync-recovery.js`沿用single-flight與scope淘汰，處理快速連續訊號、掉線恢復、遺漏事件、刪除tombstone及時間邊界；每個query範圍需有可靠權威契約，不能用目前診斷head略過必要讀取。不要新增第二套固定輪詢或把全站資料推給所有玩家。
6. 正式環境的函式、migration/RLS、私有channel設定與可用容量需在最後部署審核核對。此文件不聲稱現行庫所有migration已套用，也不授權任何正式寫入。

## 現有測試可延伸，毋須重建

- Space／登入：`tests/space-entry.test.js`、`space-entry-client.test.js`、`web-space-entry.test.js`、`device-space-switch.test.js`、`device-space-identity.test.js`。
- 業務隔離：`tests/native-room-transactions.test.js`、`communication-space.test.js`、`space-player-profiles.test.js`、`quota-native-compatibility.test.js`、`phase1-migration-stack.test.js`。
- 同步：`tests/room-live-sync-revisions.test.js`、`room-sync-head-edge.test.js`、`web-sync-recovery.test.js`、`web-sync-ready-scope-regression.test.js`、`notification-realtime-fallback.test.js`。

## 公開大廳增量審查（2026-10-17）

審查`src/public-lobby.js`、`lobby-entry.js`、`lobby.html`、新增Edge publicLobbyRooms／publicLobbySongs及其沿用RPC。程式修改由父層處理；本審查沒有改動產品檔案。

- 已確認公開搜尋固定`space-001`，輸入token／streamer／spaceId不能擴張範圍；RPC只投影active主播、active共同作品／版本、source hash有效且非隱藏歌曲。搜尋不查歌詞，回應無歌詞、私人玩家、餘額或Audit。主播目錄僅id／slug／display_name，沒有呼叫業務snapshot或寫入。
- 路由只建同源`index.html`，驗證slug，保留原songId，現點／提歌仍進既有確認流程；所有顯示文字與href有HTML轉義。歌曲12個作品一頁，主播20位一頁；獨立分頁／搜尋、scope固定、late response generation淘汰、無新增polling／Realtime。
- **已由父層修復並增測：BFCache返回失效**。`public-lobby.js`的生命週期接線僅對非persisted的pagehide停止controller，pageshow處理快取恢復；保留返回後搜尋／換頁能力。
- **已由父層修復並增測：cache有效期被命中重新延長**。只有網路回應更新cache時間，命中沿用原時間；不再因來回換頁無限延長舊資料。父層本批52項針對性測試通過，本次唯讀複核未重跑。
- 這批僅是目前公開Space的主播目錄及已確認共同歌曲探索；不應標為完整多Space業務啟用或Scoped Realtime完成。此審查不代表正式部署／實機驗收已完成。

## Native 回執第二次窄範圍複核（2026-10-17）

- 新migration的native duplicate返回前確實呼叫現有actor guard，且檢查actor_key；既有7項新增PGlite測試已包含停用Membership／Account／Space及撤銷總裁權限後重送拒絕。未發現可經此新SQL wrapper的duplicate路徑跳過這項檢查。
- 另以隔離PGlite表達式對169組字串核對PostgreSQL compact array JSON及SHA256與Node JSON.stringify／SHA256，包含控制字元、引號、反斜線、Unicode正規形式、非BMP／組合Emoji、U+2028／2029及最高碼點，0差異。實際Edge actor還會拒絕控制字元、分隔符、首尾空白或超過200字元的ID；PostgreSQL既有text/jsonb不接受NUL或不合法代理字元。該額外檢查沒有讀寫任何正式資料。
- `operationProof`仍拒絕非space-001，且現有主業務guard未被修改；保持關閉是正確的。本批是SQL相容性，不能聲稱native已完成端到端啟用。
- 精確區分：`catalogRoom`沒有對已驗證native身分做全面啟用封鎖，它保留Room／Space權限檢查及匿名native拒絕。個別先於一般業務guard的catalog讀取可已有native支援；完整業務啟用仍由operationProof／主業務／managerRoom／通訊等guard阻擋，不能以catalogRoom回傳成功推論native mutation已開放。
- **後續啟用阻擋：回執查詢未自帶actor_context**。舊`papa_operation_receipt`僅service-role可執行，查正確Space／Room及actor_key，但本身不重驗Membership。現有`index.ts`的operationReceipt、批次操作、stale-revision mutate會先lookup命中後直接返回，避開新commit wrapper。當前native operationProof封鎖且每次入口先驗證session，因此沒有新增可公開利用路徑；但不能僅拔Space guard即宣稱「每一種native重送都原子重驗」。啟用前應給這些native lookup一個含已驗證actor_context的guarded RPC（沿用既有表與native actor guard），確保lookup與授權檢查同一次資料庫呼叫，並測入口actor解析後、lookup前撤銷Membership仍拒絕。保留legacy查詢signature及既有資料。
