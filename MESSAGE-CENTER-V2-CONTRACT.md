# 訊息中心 V2 整合契約

日期：2026-10-12。盤點基準：`release/notification-navigation-1011`，HEAD `62a025e` 加目前未提交工作。此文件保存最初盤點與設計；下面「最新實作狀態」優先於後文歷史缺口描述。沒有部署或執行 production migration。

## 最新實作狀態（本機，不是正式完成）

- 已有 `noticeTarget`：實際自有通知綁定 actor/Room/Space，授權後定位舊私訊、board root/reply；client 一次 bounded window，高亮目標，不逐頁回溯、不把最新訊息全讀完。不可見、匿名、block、已移除、scope/identity 變更有拒絕測試。實际 board client browser anchor 仍待驗收。
- `202610120002_message_center_categories.sql` 與 Edge `messageCenter/messageCenterCounts/messageCenterRead` 已本機驗證；分類在 SQL paging 前過濾。最多回 50 rows，page total、snapshotAt 與不可猜測的 snapshotId。初次僅掃所選 actor/Room/Space/category 的 UUID membership（最多 100,000 IDs，超過明確拒絕），後續頁按固定位置取 50 筆；不複製 body 或偏好。新通知、舊時間回填與較早交易延遲 commit 都不插入既有 snapshot。每次重新驗證 Account/Membership、scope/category/owner、偏好 fingerprint；15 分鐘到期或不適用時回單一 `NOTICE_SNAPSHOT_INVALID`，UI 應重讀第一頁、保留其他輸入。已讀狀態動態讀取；實體已移除／scope不再適用的 notice 不重新洩出內容。短期 cache 初次建立時最多清除 100 個過期 cache，永久通知一筆不刪。snapshot table RLS 且 service-role-only。分類讀取要明確 `all:true` 或最多 50 unique UUIDs；不改 chat read receipt。
- counts 分開傳 `unreadByCategory`（center=true）和 `badgeUnreadByCategory`（badge=true），muteAll 不會把伺服器已讀狀態改掉。未知 legacy type 依 system 偏好，列表只投影公開通知欄位。
- API recipient/actor_context 由 verified actor 建立；Room 預設，總裁顯式 `scopeMode:'space'` 僅限所選 Space。不存在的 migration 不 fallback 全平台 inbox；未開啟 native Space activation gate。
- targeted SQL/Edge/locator 已通過（包含延遲 commit、scope/偏好/expiry/cache資料保留）；三分類 UI、角色導覽、noticeCenterSettings 的完整 Space 偏好隔離、通訊讀取成本與實機驗收仍未完成。既有 dialog 尚未接新分類 API。UI 僅首次開啟／明確刷新建立 snapshot，不可在 idle timer／每次 badge refresh 建立新 cache。
- 正式唯讀核對見 `AUDIT-SUPABASE-LIVE-2026-10-12.md`：新 heads/categories RPC 尚未部署，Egress/Database 免費容量 gate 未通過。保留一次整合發布。

## 1. 現況矩陣

| 項目 | 本地現況 | 可以沿用 | 缺少或限制 |
| --- | --- | --- | --- |
| 通知紀錄 | 已有 `notifications`、`noticeRead`、preferences、Realtime、Push；獨立 `notification-dialog` | canonical notification ID/type、逐筆已讀、50 筆頁、既有提醒偏好及 topic | 尚無 system/message/board 三分類；分類後的 server pagination、total、按 Space/category 統計未讀未提供 |
| 私訊 | 獨立 `chat-dialog`；管理有 inbox，玩家開本人的目前主播對話 | `chatInbox`、`chatMessages`、`chatSend`、`chatRead`；50 筆游標頁及 read receipts | message UUID 不能直接解析對話；manager inbox 沒有 total/跳頁；跨主播列表沒有可用的單次授權 aggregate |
| 留言／回覆 | 獨立 `board-dialog`，有主播板與全站板、受眾／匿名／屏蔽／管理權限 | `boardList`、`boardDirectory`、`boardRooms`、`boardCreate`、`boardChange`；raw scan cursor + visibility projection | `rootId` 只接受原始留言；reply UUID 不能解析 root；沒有留言未讀狀態或分類 feed RPC |
| 單筆通知導向 | `notification-target.js` 驗證 URL；queue/credit 可由已授權資料定位；message/board 開相應 dialog | 同源 mount、Space/room 檢查、無 credential 連結、identity guard | 私訊與留言目前是列表 fallback，不能宣稱已定位原訊息／回覆 |
| 多 Space | DB 有 notice `space_id`，board 有 Space 隔離及 `_in_space` communication RPC | `papa_communication_context`、actor key namespace、Room→Space mapping | `loadCommunicationState` 目前明確封鎖非 Space 001 頁面；有 DB 基礎不代表 native communication 已開放 |

程式依據：`src/notifications.js`、`src/chat.js`、`src/board.js`、`src/communication-context.js`、`src/notification-target.js`、`src/notification-landing.js`；Edge `index.ts` 的 `notificationOperation` / `loadCommunicationState`，以及 `chat.ts` / `board.ts`。SQL 基礎見 `202609250001_roles_and_notification_scope.sql`、`202609250002_private_chat.sql`、`202609260001_board.sql`、`202610070007_notification_space_scope.sql`、`202610080012_communication_space.sql`。

## 2. 三分類的畫面與資料語意

訊息入口統一為「訊息中心」，第一層為「系統」「私訊」「留言」。三個分類列出送給目前 actor 的 **notification events**；私訊分類內有「對話列表／開啟對話」，留言分類內有「留言板／查看原文」。可以沿用既有 chat/board 操作，但第一層 notification read 不等同於實際對話 read。

| category | 包含 notice type | 預設查看行為 |
| --- | --- | --- |
| `system` | live、saved、cancel、ready、accepted、completed、credit、status、failed、achievement、system、delivery；未知類型安全歸入此類 | 已有 queue/credit 導向或相應列表 fallback |
| `message` | message | 授權解析 message UUID 後開指定對話；無法解析則開可用的本人對話／管理 inbox |
| `board` | comment、announcement | 授權解析 post/reply UUID，開正確板及 root；尚無可解析 entity 的公告開留言通知列表 |

分類規則在 shared domain/backend 定義一次，RPC 使用同一明確映射。不可在抓到的混合 50 筆通知上 client filter 當分類分頁，否則頁數、空頁、未讀與跳頁都會錯誤。既有 `center=false` 偏好須在 server 篩選頁資料之前套用；仍保留事件。未知類型沿用 system 偏好。

Mobile：分類列與標題固定在 dialog 上方，主列表捲動，頁碼／跳頁／已讀操作固定在下方。設定另開 settings panel，保留既有 `.notice-settings-fields` / `.notice-settings-footer`。不把全部表單、對話與留言列表一次載入；切到分類才讀該分類。搜尋若加入，只搜尋目前授權範圍，不回傳 lyric、credential 或匿名身份。

## 3. Scope 與 ID 不變量

伺服器先驗證 access/device identity 與 Account/Membership，再從 Room registry 解出 Space。`recipient`、`reader`、`actor_context`、owner/player 身分來自 server actor；表單與 deep link 只能要求目標，不能授予權限。預設保留目前的 native Space activation gate。

| actor | 通知列表／未讀範圍 | 私訊 | 留言 |
| --- | --- | --- | --- |
| 玩家 | selected Space + selected Room + 自己的 player recipient | 只可讀該 Space 中本人的指定 Room 對話 | 依板、root/reply visibility 與 block 規則；匿名身份不外洩 |
| 主播管理 | 自己的 Space + 自己的 Room + `__admin__` | 只可管理自己 Room 的玩家對話 | 自己主播板可管理；其他板只依一般 visibility，不給全站板匿名身份／管理權限 |
| 總裁 | 原有平台管理通知可保留 `__super__` 跨 Room inbox；明確標示「平台全部空間」，可另選 selected Space/Room | 選定 Room/Space 後授權讀取，平台通知 scope 不會自動轉為玩家的讀取權限 | 依既有總裁規則；指定板與 Space 仍由 server 解出 |

ID 是 domain ID，必須連同 scope：notice `(spaceId, streamerId, recipient, notificationId)`；conversation `(spaceId, streamerId, playerId)`；message `(conversation, messageId, seq)`；board `(spaceId, scope, boardRoomId, rootId, postId)`。playerId 相同或 Room slug 相同不表示同一 Space。不得用 notice 的 `entity_id` 當 playerId/rootId 或猜測名稱、作者、thread。

前端快取／待辦 read／selection key 至少包含 Account 或 sessionId、role、Space、Room、recipient、category；對话還包含 playerId，留言還包含板 scope/rootId。短 access token rotation 不必丟棄同一安全 device context，但 logout、replacement account、Space/Room/role 切換必須立即失效。每個 async response/write acknowledgement 均驗證 captured context + view generation，不能更新替換後畫面、快取、已讀或成功 toast。

總裁目前通知 scope 是平台 `__global__:__super__`，不是 selected Room；chat/board 是 selected Room。不可把三者未讀直接相加當作同一個「未讀訊息數」，也不可把平台 scope 當成不受限制的 URL Space authority。

## 4. 分頁與未讀契約（待新增）

建議 additive Edge op `messageCenter`，對應 service-role-only RPC `papa_notice_inbox_v2`。舊 `notifications` 留作相容入口，V2 不改舊記錄、不刪舊偏好。Edge 建立 actor_context，驗證 category、page、limit、scope 後才呼叫 RPC。

```js
// Browser request: owner/reader/account are deliberately absent.
{op:'messageCenter', category:'message', page:0, limit:50,
 scope:'room', streamer:'papa', snapshot:null}

// Server result, names illustrative until endpoint implementation.
{scope:{kind:'room',spaceId:'space-001',streamerId:'papa'},
 category:'message', page:0, pageSize:50, total:123, hasMore:true,
 snapshot:{createdAt:'...',id:'...'},
 rows:[{id:'...',space_id:'space-001',streamer_id:'papa',
        streamer_name:'怕怕',type:'message',level:2,body:'...',
        entity_id:'...',created_at:'...',read_at:null}],
 unreadByType:{message:3},
 unreadByCategory:{system:2,message:3,board:1},preferences:{/* existing */}}
```

RPC inputs：requested_space / requested_room 或明確 platform scope、server owner_id、category、page_limit、page_offset、snapshot、actor_context。非總裁不得請求 platform/all-space；總裁 selected-Space scope 必須 `space_id=...`，platform scope 則明確允許該 actor 的 `__super__` notices。每一 row 帶真實 Space/Room ID。

- 只 select 上述欄位，不用 `select *` / `to_jsonb(full_row)`；scope 與 category/center preference 在 LIMIT/OFFSET 前篩選。
- 每次僅回 50 筆或最多 51 筆探測下一頁；total 在同一 scope/category/filter/snapshot 下 server count。順序固定 `(created_at desc,id desc)`。
- snapshot 固定一輪分頁的上界，避免新通知插入造成跳頁重複／略過；refresh 可換 snapshot，保留可用頁碼。category/search/scope 改變重設第 1 頁。
- 跳頁直接讀指定頁，不走第 1 到 N 頁。known total 的 max 頁碼為 `max(1,ceil(total/limit))`，Enter 也可跳；不再用目前任意 `max=201`。
- unread aggregate 與 visible page 分開：計數是此 actor 授權 scope 的當前未讀，包含 snapshot 上界之後的新通知；category page total 是 snapshot 範圍。回傳 `unreadByType`，保留 `badge` 偏好；UI 可用 badge-enabled types 得到分類／入口顯示數。
- 停止 popup/sound/push 不刪紀錄，也不自動已讀。`center=false` 不改 receipt；明確「顯示已關閉項目」若加入，須由 server filter 參數決定，不能僅顯示／隱藏半頁。
- 不拉另外两個分類的 rows 為了算 badge；同一次 scoped aggregate 回三分類 count。不要為每個通知、玩家或 Room 建 websocket/subscription。

既有 `papa_notice_inbox` 可保留 prefs/topic 初始化與相容性，但現行 SQL 並未接受 category 或顯式 Space；總裁 global filter 也未限定 Space。不能當作 V2 的完成品。現行 `notifications.refresh` 在 page>0 再讀 page0 做提醒探測；V2 應把 lightweight head/change metadata 與使用者瀏覽頁分開，避免每次跳頁再拉另一頁完整 body/audio。

## 5. 已讀與數量：兩個來源不可混用

| 動作 | 通知 read_at | conversation receipt | 留言／回覆 |
| --- | --- | --- | --- |
| 標記通知已讀 | 只變更當前 actor、scope 內選定 notice IDs | 不推進 `papa_chat_reads.last_seq` | 不宣稱已閱讀原文 |
| 本頁全部已讀 | 只變更當前分類實際顯示的 IDs，最多 50 | 不影響其他分類或對話 receipt | 不把隱藏／其他頁 notices 一起處理 |
| 開啟訊息中心或切分類 | 不自動已讀 | 不自動已讀 | 不自動已讀 |
| 成功顯示對話訊息且前景可見 | existing `chatRead(through)` 可同步標記該對話已讀 messages 的 message notices | 單調 `greatest(old,capped)`，只能 through 已載入／顯示的範圍 | 無關 |
| 成功查看原留言／回覆 | 單筆 target notice 可由使用者標已讀；若產品採自動則只在授權原文成功顯示後執行 | 無關 | 現在沒有 board-read receipt table，不能捏造全板／thread 未讀 |

現在 `noticeRead` 只 PATCH notice；`papa_chat_read_in_space` → `papa_chat_read` 會 capped `through` 並標讀同一 conversation 中 `seq<=through` 的 message notices。這個不對稱行為要保留：讀過通知預覽不等於讀過私訊。對話列表 unread 用 chat receipt 計算；三分類 badge 用 notice read_at，兩者可以不同，要各自標示。

新增 `noticeReadV2` 或安全擴充舊 op：server-derived recipient + Space/Room filter + bounded UUID ids，不能接受 client recipient；回 acknowledgement + scope unread aggregate。可重複同一已讀請求，不把 `read_at` 改成未讀；不替全部主播／裝置／玩家標已讀。現行「本頁全部已讀」用 `rows` 而 UI 會 center-filter `visible`，V2 必須改為實際顯示 IDs。

## 6. 授權的 message/thread/reply targets（待新增）

單次 Edge op `communicationTarget` 或兩個明確 op `chatTarget` / `boardTarget`。以 exact UUID lookup + scope/actor policy 取回最少結果，不搜尋／掃描全部對話或留言。原 `notificationId` 若提供，先在當前 actor 的 notice scope 驗證它，type/entity/Space/Room 必須相符；持有 URL 或收到 Push 都不是 authority。

### Message target

`chatTarget(messageId, requested Room, server actor_context)` → 用 bounded service-role RPC `papa_chat_target_in_space`。

1. 先驗證 Room→Space 和 actor，玩家不能請求別人的 conversation，主播只能自己的 Room。
2. 以 id + Room equality 定位一筆 message，再驗證 conversation player 是否属于該 Space；不得先回傳 player/name/body 再補權限。
3. 回 `spaceId,streamerId,playerId,messageId,seq` 與最多一個 authorized bounded window（最多 50），或只回 locator 再沿用 `chatMessages(before/after)`。API 不接受 `seq` 當權限。
4. 開啟對話將 cursor 綁到 conversation，定位／高亮指定 message；target 很舊時直接 window，不能逐頁回溯到目標。
5. `chatRead` 只在 authorized messages 已顯示且 view/context 仍有效後呼叫。僅定位／未顯示不能把最新訊息全讀完。retired/deleted/not-authorized 回同一 unavailable result。

現有 `chatMessages` / `chatInbox` 沒有 message UUID locator；`chat.open()` 也沒有 peer/message 參數。player fallback 可開自己目前 Room 對話，manager fallback 僅開授權 inbox；禁止把 UUID 當 playerId，禁止猜 peer，禁止宣稱「已定位」。

### Board target

`boardTarget(postId, requested Space, server actor_context)` → bounded lookup 至多 target + root（2 rows），以及 actor scoped blocks／僅必要 metadata；先由 server 確定 streamer/global 板、origin Room、rootId。Space 不同、root/reply 不可見或 unknown ID 用一致 unavailable。

1. target 可能是原文或 reply。解析 reply.root_id，不把 reply UUID 塞給 `boardList(rootId)`；現行 op 對這種輸入會拒絕「請開啟原始留言」。
2. 同時套用 root 與 reply 的 `boardThreadVisible`，包含 include/exclude/streamers、block、root owner 特例及限定 moderation；新 endpoint 不得只驗證 reply 或只驗證 root。
3. 輸出只使用 `boardProjection` 欄位，加 `spaceId,scope,boardRoomId,originRoomId,rootId,targetId` 等定位 metadata。普通 reader 不得得到 author_key、targets、client_id、匿名 managedAuthor 或管理歷史。deleted body 為空，仍保留已授權 thread tombstone。
4. 沒有 SQL shared visibility helper 可直接沿用（目前主要是 `board-policy.js` + Edge）；最小安全方案是 bounded lookup RPC 只給 Edge，Edge 沿用既有 shared policy 後投影。不能繞過其結果向 browser 回 raw rows。若做全部 SQL visibility，需 policy parity matrix 測試，避免雙份規則漂移。
5. 開正確板並沿用 `boardList(rootId)`；要定位很舊的 reply，新增 bounded anchor/window 參數，不逐頁掃描。原文被刪／管理移除的可回覆規則仍由 existing write policy 判定。

`announcement` 目前有 notice type，但本次未找到可用公告 entity/read resolver；保留列表 fallback，不把它硬當 board post。若無法由 target 安全確定 scope，回分類列表並顯示「原內容目前無法查看」，不要輸出「不存在」與「無權限」的區別或身份提示。

## 7. 同步、UI 及低 Egress 整合順序

1. **Contract / characterization（此批）**：本文件、現有政策 boundary tests，確認 native gate 與已讀语意，不更改 schema 或正式資料。
2. **V2 notice query**：additive shared category function + scoped paginated RPC / Edge；actor、Space、category、total／snapshot、unread aggregates 的 DB + Edge tests。只開 server route，不新增 UI polling。
3. **三分類 shell**：抽出單個 message-center controller，沿用 notifications settings/Push health；有三分類空／loading／error／分頁狀態。每分類保留自己的 page/filter/selection，context 變化全部失效。舊入口轉進同一 shell，避免再開重複 dialogs。
4. **精準 communication targets**：上面的兩個 resolver + optional `chat.open({playerId,messageId,seq})` / `board.open({scope,room,rootId,targetId})`，保留無 entity 的 fallback；回覆／私訊表單在 deferred render 下不重建。
5. **未讀連動**：center notice read、conversation receipt、board notice read 各走對應 API；event 只 invalidate 受影響 controller。message notices→chat + message category；comment→board + board category；business types→room sync + system category。achievement/announcement/system 不觸發整個業務 snapshot。
6. **合併驗證**：角色／Space／target／stale async／批次已讀／頁碼／手機 QA + full regression/build + migration/data-preservation/Egress gate 後再由 root 決定部署；此準備批不單獨部署。

現況有 notifications 30s fallback、chat 4s fallback／healthy Realtime 時 60s receipt catch-up、board 8s 定時 refresh。這些是現存行為，不是 V2 建議；Phase 2 正在處理 lifecycle，不另建第二套 timer。V2 改用 existing lifecycle invalidation + 只在實際開啟分類/對話時 read，idle/hidden/background 不新增業務讀。不要用 generic notice refresh 拉 song/lyric snapshot，不按每 Room fan-out。board blocks/participants 現有 all-owner/all-thread rows 也需在後續 cost audit 記錄，不能稱全部 communication 查询已完全 bounded。

## 8. 驗證與發布前條件

新 `tests/message-center-v2-contract.test.js` 用實際 Edge helper，5 個本地 characterization 通過：cross-player／foreign-room／Space chat 在查詢前拒絕；manager 的 message UUID 未解析對話；restricted board root 不投影；reply UUID 不冒充 root；noticeRead 使用 actor-derived recipient 且不推進 chat receipt。這些確認現況邊界與缺口，沒有測試未實作 V2 的成功路徑。

Phase 3 完成前至少補上以下成功／拒絕 cases：

- 101+ 混合 types 的 system/message/board 各自 paging、total、unread，跳頁只一個指定頁；新通知不打亂既有 snapshot；center=false／badge=false／mute 狀態不交叉改已讀。
- same player ID in different Spaces、同名 Room slug、總裁 platform vs selected Space、主播跨 Room、revoked Membership；return/cache/read acknowledgement 都不能跨 context。
- old message / root / reply UUID 直接 authorized window；不可見／跨 Space／匿名／block／moderated／deleted；失敗不洩 body、author、playerId 或 root target metadata。
- notice read 保留 chat unread；chatRead capped+monotonic、只讀當前 conversation、聯動對應 message notices；page read 不碰其他分類或隱藏 row。
- close/reopen／replacement account／Space switch 期間 delayed read、send、mark read 不重建／清空替換後表單、也不顯示舊操作成功。
- 390px / 598px / desktop 下搜尋可見、分類與跳頁可操作、footer 不遮內容、textarea 不因 invalidate 重設。鍵盤 Enter、focus、loading/error、無資料第 1 頁均可用。
- 比對既有通知／訊息／留言 IDs、body、created_at、read_at、read receipts、受眾與匿名規則，確保 additive migration 保留正式資料；驗證幾種 idle/open-tab/event-burst 的 request 與 returned-byte 數。

目前可宣稱：既有三套功能與權限基礎已盤點，第三階段契約及 characterization 已完成。不能宣稱：三分類 UI 已完成、UUID 精準導向已完成、native communication 開放、V2 RPC 已部署或 Egress gate 已通過。
