# 全站通知可靠性 — 2026-10-31 本機驗證與發布前提

基底 origin/main dcf9381；正式 Edge 查核為 party-api v74 ACTIVE。本批未部署，未修改正式資料。

## 已實作
- 新舊已授權 Web Push 訂閱共用既有綁定流程，舊 session 不再因沒有 deviceSessionId 而跳過。尊重使用者關閉及系統拒絕。
- 通知讀取中的多個 wakeup 合併為一次尾端補讀，避免讀取中遺失更新。
- 新增服務端限定、51 筆 keyset 增量讀取函式；前端每輪最多四頁，仍有資料才繼續，不新增固定輪詢或 Realtime。
- 延續現有未讀與通知中心資料，不將推播期限套用到站內歷史。
- 推播期限：ready 5 分鐘；accepted/live/saved/status/failed 15 分鐘；cancel/completed 1 小時；其餘 24 小時。重試以原建立時間計算剩餘 TTL，SW 拒絕過期新格式 payload；舊格式仍相容。
- 推播 payload 攜帶既有 job ID；系統通知仍以通知 ID tag 去重。此措施不能保證裝置關閉通知後不再顯示重送，尚無持久裝置收據。
- 404/410 改為失敗狀態，不刪訂閱及其 CASCADE 派送紀錄。失敗/跳過原因寫入既有 last_error。
- 路由遺失時不再猜測怕怕為目的地。
- 演唱歷史通知定位改為現有合併時間線分頁。

## 驗證
- 132/132 自動化測試通過；輸出 notification-reliability-tests-20261031.txt。
- 前端及 Edge build 通過；git diff --check 通過。
- 隔離 PostgreSQL：121 筆合成紀錄，跨三頁補讀 120 筆、同時間游標不漏不重、其他主播/收件者不可混讀、anon/authenticated 不可執行、原紀錄筆數保留。
- 正式唯讀彙總：11 訂閱（5 legacy，6 device）；jobs 467 sent、366 skipped。sent 僅代表既有派送狀態，不證明裝置顯示。
- 本批推播服務接受：未測；Android 真機背景/鎖屏：未測；iOS：未測。

## 已批准、待完整驗證的正式變更
檔案 supabase/migrations/20261031002615_notification_incremental_sync.sql。
只新增 papa_notice_delta(text,text,timestamptz,uuid) stable 唯讀函式。
固定 search_path；撤銷 public/anon/authenticated 執行，僅 service_role 可用。呼叫者以既有登入解析的 room/recipient 傳入，前端不能自選 owner。
無新表、欄位、索引、Cron、資料回填或刪除。交易內 3 秒 lock_timeout，無法取得鎖則失敗回滾。
回復：先回復前端與 Edge 到本批前版本，停止宣告 deltaSupported；保留未使用唯讀函式及全部資料，不需 DROP 或資料回寫。
發布前保存當前 Edge 來源與前端 commit，並比對遠端 main 防止覆蓋同時發布。

## 尚未完成／限制
- 全通知類型逐一的實際業務成功→通知原子持久化端到端驗收，不能以 transport 測試替代。
- 瀏覽器完整整合驗收與 Android 設備實收；使用者確認 Android，測試身分為總裁。
- 建立時間游標不等於提交順序：長交易晚提交或人工補登較早 created_at 的事件仍可能落在游標之前。站內紀錄仍完整，但強一致補同步需要另行驗證或改善。
- 重連目前保留既有 inbox/未讀讀取，再加必要 delta；尚未宣稱 Egress 降低百分比。增量每輪上限 204 筆，沒有新事件時不呼叫 delta。
- 失效訂閱保留可能產生後續 failed 工作；全面失效隔離/新綁定後清理需非破壞性設計並獨立批准，未自行清理。
- 未進行全設備測試推播，避免打擾真實玩家；不能把訂閱存在視為有效收件證據。

## 2026-10-31 接續
- 使用者已批准上述唯讀函式及完整驗證後部署，不需再次請求同一批准。
- 修正增量補讀第二頁失敗時游標已前進、第一頁尚未交付的漏通知風險：失敗恢復本輪起點，身分已失效則不回填游標。新增網路失敗重試測試；notification-delta 三項通過。
- 正式資料庫與部署仍未修改；完整瀏覽器及 Android 實收尚待驗證。
- 排程已改為優先接續本通知任務，保留原管理中心工作樹。

## 本輪新增驗證（批准後）
- 增量游標改為整輪成功才提交；reset 版本隔離，舊請求無法覆寫新身分。
- timestamp 比較保留 PostgreSQL 微秒與時區語意，新增兩項回歸。
- 通知組合測試 135/135 通過；另新增實際 deliverPush 函式隔離測試 3/3，涵蓋 16 類 payload/TTL、legacy/device、授權/收件者/已讀/過期、404/410 保留、重試上限與 lease。
- 實際 IAB 點擊 ops/notification-reliability-browser.html：16 類、120 筆補同步、重讀不重複、切換空間隔離 PASS。API 為合成隔離回應，不能代替正式 DB 或真機收件。
- 使用者再次確認批准完整驗證後部署，Android 使用總裁身分。
- 尚未套用正式 migration、尚未部署。正式端到端持久化與 Android 鎖屏驗收仍未完成；下一步應補齊這些驗證及發布前來源比對，勿把本機合成結果當正式成功。
