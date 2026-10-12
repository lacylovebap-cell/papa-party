# papa_events 寫入來源、倍數關係與容量方案

全部核對使用唯讀交易及8秒timeout。沒有清除、封存、更新正式事件，也沒有重放正式點歌、存歌或演唱。查詢只回彙總/系統目錄，沒有下載完整事件快照。

## 指定時段的直接證據

台灣2026-10-09 19:00–23:00：44,548筆events。696首同一組在ledger操作有2,088筆（3次）、queue:acknowledge有1,392筆（2次）、onBehalf/player/queue:store等各696筆（1次）。517首同一組有517/1,034/1,551/2,068等倍數。多筆不同Room的批次共享同一created_at：例如一次queue:delete有2,058筆、一次queue:acknowledge有2,249筆，涉及4個Room。這是單次業務操作觸發大量非目標資料UPDATE，而非696首真的被逐首演唱。

33,761筆songs事件中33,759筆（其餘2筆有hidden/tags/version等實際變更），排除_order及觸發器附加songSnapshot後before/after相等。其他相同條件：ledger6,529/6,545、queue4,008/4,055、cards158/158、wishes24/24。合計44,478筆僅有排序及衍生快照差異。兩個songs真實變更、47筆queue差異及16筆ledger差異等必須保留並按業務核對，不能套用倍數直接去重。

原始before/after欄位合計45,120,805 bytes，是事件payload取樣，不等於可釋放磁碟bytes；TOAST、索引及頁面膨脹須另量測。既有容量稽核papa_events约450MB，不能把本窗口當作全部325,779筆的安全封存證明。

## 根因程式鏈

1. src/core.js 的mutateBase以「其他Room陣列＋目前Room資料」重建ROOM_TABLES，單個待播/存歌操作也會改全平台陣列位置。
2. src/state-patch.js 的stateEntries按全陣列index產生_order；未啟用preserveOrder的全域寫入會把整組696/517等歌曲視為有變動。
3. Edge commit將changes送papa_release_b_commit / 原papa_v2_commit，全陣列位置變動成實際UPSERT。
4. papa_entity_event→papa_capture_event每次UPDATE寫一筆before/after完整紅遮罩JSON。它只排除完全相等JSON，_order變動不會被排除。
5. papa_event_song_snapshot又只在after（刪除時before）附加songSnapshot，因此直接比對before=after或單純移除_order會漏掉這些候選。

最新main已有selected Room operational/admin RPC及preserveOrder:true；既有測試確認queue完成只改queue/ledger、不改歌曲或其他Room。本次帳務修復沿用這些路徑，沒有再新增全平台寫入或第二套帳本。全域初始migration仍需super且空平台/核定來源；不能用它當日常操作。

## 寫入來源盤點

| 來源 | 正式來源/本機程式 | 核對結果 |
|---|---|---|
| 收歌、分配、存歌、待播、演唱、更正、歌本/玩家編輯、批量匯入與草稿發布 | Edge commit→既有原子RPC→entity event trigger | 主要倍數來源是全域_order差異；最新scoped path保留原排序。 |
| Entity Audit | papa_capture_event | UPDATE相等才跳過；保存before/after紅遮罩JSON。 |
| Space player profile Audit | papa_capture_space_profile_event | 另一個profile事件來源，不能與entity event按ID數量當重複刪除。 |
| 失敗提歌 | papa_record_failed_request | hour bucket記失敗；不能当完成演唱/扣款。 |
| 私訊 | papa_chat_send | 保存訊息事件及通知關聯。 |
| 曲庫審核/遷移 | papa_catalog_audit_to_event；202610050001歷史backfill | 匯入既有catalog Audit及後續trigger；不可再跑migration當重試。 |
| 管理帳戶 | papa_change_manager_password、papa_manage_streamer_login | 管理行為Audit，保留紅遮罩身份快照，不下載密碼。 |
| 專屬額度 | papa_manage_player_extra_quota、legacy_session版本 | 只記該權利變更，不會造成整組歌曲事件。 |
| 收藏/批量收藏 | papa_song_favorite_set、papa_song_favorites_set_batch | 每個有效異動保存Audit；重複設定由既有流程去重。 |
| 背景排程/Edge推播worker | 當前僅papa-notification-retry，每分鐘prepare_due＋pushWorker | cron command沒有直接papa_events INSERT；prepare_due只更新到期queue準備欄位，間接觸發Audit，不會重寫696首songs。 |
| Repository自動回歸 | tests/*.test.js、PGlite/mock API、本機demo fixtures | 目前回歸都隔離，不連正式庫；HTTP在Edge VM由mock接手。本次沒有正式測試商業資料寫入。 |

正式目錄確認11個直接INSERT writer、papa_v2_entities上的單一papa_entity_event（沒有兩份重複entity Audit trigger）。其他papa_events BEFORE triggers補身份/歌曲快照、失敗通知或玩家封存摘要；不是第二次同列INSERT。

沒有證據可把此窗口直接斷言為自動化測試：actor_role仍可能來自人類或瀏覽器自動化，現有事件缺少可驗證的測試execution ID；repository隔離測試不能證明所有外部/歷史測試都隔離。若需認定某次為測試，須核對當次部署/執行紀錄，而不能凭規律或「測試」字樣自動刪。

## 可安全封存的辨識及容量方案

封存候選限定事件created_at窗口、entity_kind/ID/Space/Room、原before及after都存在、移除_order及衍生songSnapshot後原JSON相等，並核對實際演唱/扣款/狀態/來源沒有改變。songSnapshot需驗證與當次保留歌名/歌手一致，不單憑欄位名稱忽略它。44,478是審查候選數，不是刪除許可。真實交易、演唱、勳章、來源/結算或跨scope異動不按相似歌名/倍數合併。

先停止未必要寫入：維持scoped patches＋preserveOrder；更換版本時以隔離回歸證明閒置及重複read不產生events。未來如簡化排序Audit，應單次保存原ID序列及新序列，不能讓每個歌曲保存兩份完整JSON；財務/演唱Audit保持必要完整事實與來源。這是待審方案，本次不改正式papa_capture_event或現存events。

封存先分批匯出完整原事件（含ID、身份、時區、before/after、歌曲快照）到使用者核定的保留位置，壓縮、校驗逐筆及批次checksum、數量/ID上下界，保留不可变manifest及可恢復查詢。驗證restore與歷史頁可查後，仍須另行核定是否/如何移出熱表；目前不執行delete/truncate/vacuum full、不删除或重寫事件JSON、不調整索引，也不聲稱已節省GB。大匯出排程需要Egress预算，不能一次下載全部歷史。

報表成本以server selected scope/date aggregation、小頁投影及on-demand細節控制；新帳務摘要不下載全帳本，不加高頻polling或每玩家Realtime。正式財務補正另見ACCOUNTING-P0-PHASE-0.md，與event容量優化分開核定。
