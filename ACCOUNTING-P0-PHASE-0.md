# 帳務 P0 Phase 0 稽核（2026-10-12）

基線：最新 origin/main `d2ccd408b3abd1cc19388348705dd9cab009c2d9`。先前訊息中心 WEB.5 的未提交成果保留在原 checkout，本修復以獨立工作目錄進行，整合前不得遺失。已讀 Issue #11/#17 及 #1/#13/#15/#16 相關補充。正式資料查詢全部使用 read-only transaction / 8 秒 timeout；無正式寫入、清除、補正。

## 根因與現況矩陣

| 項目 | 狀態 | 證據及影響 |
|---|---|---|
| 權威 Core、Room scope、revision lock 與原子 RPC | 已有 | Edge 執行 Core，stateChanges 送現有 commit；RPC鎖 revision，全部實體/Audit/通知同交易成功或回滾。沿用，不另造帳本。 |
| 原始收歌不可變 | 缺失 | `core.js` allocate 將原 ledger.amount 改為 stored；備註仍為一般3首，實際異動可以+0/+1/+2。existing source 未補 allocation_id，因此仍可刪除/再次分配。 |
| 分配與來源關聯 | 部分 | queue/新 ledger 有 allocation_id；queueId 連結 return/adjustment，但 allocation_id 是群組 UUID，缺少原 ledger ID；部分所有額度都分配時不建立來源 ledger。 |
| 未唱取消防重複 | 已有但模型需修 | returnAllocation 檢查 queue marker/ledger；prepaid 分配先降低原存歌，取消才+cost。不是每個 +1 都是重複退款。改為保留原收入＋保留額度，取消只釋放保留，新分配不再產生退款。舊 prepaid 不得直接改算法而多出餘額。 |
| 演唱事實不可硬刪 | 缺失 | deleteQueue 對 allocated terminal 保留，但一般 saved/live terminal 硬刪 queue 及 queueId ledger，真的移除演唱/扣款與統計。改為保留事實的 archive。 |
| 帳務交易撤銷 | 缺失 | ledger remove 硬刪；completed saved debit可被單獨刪除。改為可追溯 reversal/void，系統 debit/settlement 禁止獨立變更。 |
| 已唱統計 | 缺失 | stats 排除所有 selfProvided；該旗標的產品文案只表示不計熱門/常聽，正式有費演唱被誤排除。過檔 quota_carried 本身沒有排除 completed；硬刪及 selfProvided 才是直接原因。 |
| 剩餘存歌 | 缺失 | stats.saved=max(0,received-spent)，不是 ledger 餘額，也未顯示保留與可用。 |
| 時區 | 部分 | timeValue 支援台灣時間；liveDay 是19:00切直播場次，與「今日」曆日不同。帳務今日改用 Asia/Taipei 00:00；直播場次/quota規則保留。 |
| 最近10筆 | 顯示分頁已有 | UI ledger每頁10筆，現stats使用整個已載入state，沒有直接slice(0,10)；仍應以伺服器聚合統一摘要，禁止新增下載完整歷史算總額。 |
| 多裝置/並發 | 部分 | 現有 stale revision 拒絕且不自動重送；須新增真實RPC回滾/重送測試與明確結算ID。 |

## 正式資料核對（不是補正指令）

正式庫共412筆 ledger、300筆 queue（revision3893讀取時）。在回報時段找到同一玩家/主播的完整來源、分配與演唱事件；敏感識別碼及選定欄位證據另存工作目錄之外，不提交公開repo。

- 原始一般3首由+3被 allocate 改成+0；同組實際建立3首分配，不是2首。原來源之後被修改、再分配及硬刪，Audit仍保存操作。
- 星晴/Genie的+1 return 各對應第一組仍保留、status=stored且沒有completedAt的 queue。後來-1完成扣款對應新建的 saved queue，queue ID不同；目前沒有證據可把它們視為「同一 queue 完成後又退款」。
- 同一組的第三首確有完成；另有後續重新分配的同名completed紀錄，使用者已於2026-10-12確認三筆「以妳為榮」是同一次演唱的重登，兩筆應列為重複登記更正候選，原始事件與Audit仍完整保留。
- 當前選定玩家保留6筆 ledger、7筆 queue，其中5筆completed均selfProvided=true；現stats因旗標把已唱全排除。ledger實際總額4，包括第一組+1/+1、最新+2/+2、兩筆-1/-1。最新一般3首+2因分配1首，並非收歌原本只有2。
- Audit另顯示兩筆20:12已完成saved queue及-1明細曾被queue:delete硬刪。後續20:30另建完成；能否視為重登替代必須核對，不能憑歌名判斷。
- 使用者預期5/3/2可描述最新3首收歌＋2首新增－3首演唱，但現保留資料還含 earlier allocation/return/completion。正式庫不能靠改顯示或硬編5/3/2掩蓋；另列來源缺失、疑似重登與歷史刪除差異，確認後才補正。

## 執行順序與保護措施

1. 沿用既有 ledger/entity table，以版本化 reservation model 建立不可改写原始收入、source_transaction_id、逐queue結算及reversal；舊prepaid只走原模型，來源不完整則阻擋再次分配並列差異。
2. 所有刪除/修改收歌變成 Audit 可追溯更正；完成演唱只封存，不移除扣款/事實。伺服器交易防護拒絕硬刪正式帳務及完成queue；不更改既有正式rows。
3. 新增選定Space/Room、日期的server aggregation，同一摘要供UI，分開received/sung/balance/reserved/available；常聽熱門仍遵守selfProvided排除。
4. 自動回歸測試覆蓋12組需求、半首、舊模型、退款與消耗互斥、stale revision、RPC整組回滾、跨日及範圍。
5. 統整先前修復，最後一次全量驗證。正式部署前提供具體方案與資料保護確認。正式補正獨立提案：不遷移既有玩家餘額、不刪Audit、不自動重建缺失來源或合併同名演唱。

目前修改：src/core.js、src/venue-policy.js、src/app.js、src/state-patch.js、Edge party-api；新增小型聚合/交易保護migration及Core/RPC/Edge/UI回歸測試。無第二套ledger、無新輪詢或每玩家Realtime。

## 影響範圍與核實界線

revision3899取樣：未找到缺失queue的allocationSettlement、同queue有效return+completed或同queue重複完成扣款。11組舊allocation沒有可辨識的group source，不代表11組都是錯帳；來源缺失的操作採拒絕再次分配/任意撤銷並列人工檢查。後續取樣98笔非row-test、kind=live/saved且selfProvided的完成會受到原統計排除；未核對每筆玩家test標記及重登，不能宣稱98筆全是實際正式演唱。

已核實：新未唱分配保留額度、取消不增加餘額、完成只扣一次、completed archive保留、void/reversal保存原量、來源範圍和餘額保護、Asia/Taipei曆日。正式舊資料修復仍未執行；現存重登或已刪來源不會因新版公式自動恢復成5/3/2。

## 正式差異補正候選（需要另行確認）

使用者確認的同次重登：保留目前三筆completed及全部Audit，選20:29登記/有效19:10者為建議主紀錄，前兩筆標示為重登更正關聯，不能以直接delete或改status抹掉。星晴/Genie的20:12已刪兩筆與20:30後建兩筆也須從原Audit建立替代關係，不能再重扣或再退。

建議核定有效收歌為最新一般3首及後續2首；有效演唱為上述同一次以妳為榮、星晴、Genie各一次。較早兩筆+1退回各有原未唱queue，可能被後續重建同次收歌流程重複留在帳務鏈（這點仍須核定來源），列為兩筆待撤銷帳務效果的候選（各-1追溯更正）；當前餘額4，若此完整來源鏈獲確認，預估4→2。最新+2「一般3首」需由來源更正關聯呈現原收歌3/當次已消耗1，不能直接把amount2改3而多送1。

此為提案，不是執行指令。執行前須重新抓取選定玩家/Room revision，列出精確原紀錄ID、canonical/reversal關聯、預期每筆差額及前後總數；一次交易建立更正Audit，校驗歷史及餘額，取得使用者確認後才可改正式資料。今日統計5/3/餘額2必須由這組核實結果自然產生，不以歌名或畫面預期硬編。

## 本機回歸

帳務隔離分支全套1105/1105通過；追加來源/原收歌數/結算ID的資料庫防護測試通過。測試全部使用記憶體PostgreSQL或隔離本機UI，沒有寫入Supabase正式資料。最後仍須與訊息中心WEB.5整合後做完整回歸/build及部署保護確認。

整合最終驗證：1,117/1,117通過，Web/Edge build成功；新002/007/008在隔離PostgreSQL同時安裝後仍通過原子RPC、rollback及統計測試。合法正向人工回補有獨立用途、不算新增收歌，更正沿用用途及原來源。390px實際本機UI六個按鈕同top、document無水平溢出，More選單留在視窗內。

一般存歌混合額度沿用既有存歌池ledger及queue/performance/settlement連結；新分配有精確原receipt ID。沒有為歷史混合池扣款臆測FIFO來源或新增第二套帳本。詳細事件來源/容量與封存辨識另見AUDIT-EVENT-SOURCES-2026-10-12.md。


2026-10-13使用者再次確認既有台灣時間19:00換場規則必須保留。上述午夜換日假設由10.13-WEB.1及202610130001取代：帳務日期為場次開始日期，跨午夜仍屬同場，19:00才換場。只改查詢與顯示邊界，不改任何既有正式帳務紀錄。
