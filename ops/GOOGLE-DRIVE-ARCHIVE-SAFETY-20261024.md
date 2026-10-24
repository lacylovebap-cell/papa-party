# PA Party｜Google Drive 無損封存與還原：實作設計（2026-10-24）

> **現況：僅建立安全開發分支與文件。未部署、未修改官網、未讀寫 Google Drive、未清除事件。**
> **目的：Google Drive 作為私人雲端長期儲存；Supabase 繼續作為即時交易與權限資料庫。**

## 一、已核對的舊事件與現況

- 正式 Supabase 專案 `zwhcgqwbtummydapuori`，目前 `papa_events` 約 **70,900 筆**，累積刪除計數約 **256,876**。統計計數器不等於一份已確認匯出檔案的筆數。
- `storage.buckets` 私人封存桶 `papa-audit-archive` 存在，但 `storage.objects` **0 個檔案／0 bytes**。
- `papa_release_backups` 有 **17 份版本快照**，內容為版本、表格與設定片段；**不能視為 `papa_events` 全量歷史**。
- 過去曾交付 `pa_party_local_archive_toolkit.zip`，這是匯出、驗證工具而不是歷史事件；原設定為先下載到 **Windows 本機 Downloads**，再校驗筆數與 SHA-256，最後才允許刪除。**目前尚未取得 Codex 執行證據或本機封存檔。**
- GitHub Repository 不存放任何含玩家姓名、帳務、帳號憑證、金鑰或事件原文的封存。
- **舊事件追查**：由 Windows 電腦搜尋檔名 `pa_party`, `archive`, `papa_events`, `256876`, `manifest`, `sha256`，以及當時 Codex 工作目錄與下載資料夾。若找到檔案，先確認格式、筆數、SHA-256、可解壓、具原 18 欄；不能只靠壓縮檔存在就推定可用。
- 如果本機／外部備份都沒有保存被刪除的原始事件，事後重整過的 PostgreSQL **無法從 `papa_events` 直接恢復已刪的內容**。須另尋刪除前獨立備份；不得偽造或補寫事件。

## 二、Google Drive 連線需要兩種不同授權

1. **ChatGPT ↔ Google Drive**：使用者自行透過 ChatGPT Plugins 完成 Google 帳號 OAuth；可在聊天中搜尋、讀取已授權檔案，但是否能原樣處理加密 ZIP/JSONL 取決於可用檔案讀取工具，並非登入後自動能查完整封存。
2. **PA Party 伺服器 ↔ Google Drive API**：由使用者授權的 Google OAuth client、離線 refresh token（或經確認的替代模式）讓備份程式在使用者不在線時上傳；token **只能保存在執行環境 Secrets**，不得貼到前端、GitHub 公開檔案、聊天或 SQL。OAuth scope 最小化，專用備份資料夾私人、不可公開分享。

**本分支不能代替使用者安裝 Plugin 或授權 Google Drive，也不會在連線尚未完成前宣稱備份已上傳。**

## 三、封存規格與目錄

私人 Google Drive 資料夾：`PA Party Archives`

- `/recovery/2026-10-deleted-events/`：如從本機找回的歷史事件，完整校驗後原樣封存，**不得先回寫正式事件表**。
- `/events/<space_id>/<streamer_id>/YYYY-MM/`：依已核對的歷史歸屬與月份做加密、壓縮的資料分片。
- `/manifests/`：記錄 schema、原始 event ID、時間範圍、列數、檔案長度、SHA-256、加密版本／key id、歸屬及可還原的測試結果，不放玩家秘密。
- `/verification/`：定期還原抽驗報告（只含彙總與雜湊，不含個資）。

建議 `JSONL`（原始欄位、PostgreSQL timestamp 精度、所有 JSONB 與 NULL）→ `gzip` → 加密（例如 AES-256-GCM 並妥善管理獨立金鑰）；不可只做 ZIP 壓縮就宣稱加密。

**完整匯出必須保留 `papa_events` 所有 18 欄以及原始 ID；各分片必須能整份還原並逐列比對。** 對含 `NULL space_id` 的舊資料不能依目前主播廳籍臆測歷史歸屬；需明確核對。

## 四、資料保留與查詢的硬限制

| 類型 | 封存前需保障的功能 | 原則 |
|---|---|---|
| `queue`、`ledger`、演唱／提歌紀錄 | 歷史歌名、主播與玩家、時間、存歌、取消／退款、日帳務 | **暫不移出**；保留權威業務狀態、最近與長期查詢索引 |
| 勳章／成就 | 勳章進度、取得時間、來源事件、提歌失敗、補發／撤銷 | **暫不移出來源事件**；`papa_badge_progress`、`papa_medal_evidence_page` 等直接讀 `papa_events` |
| `papa_achievement_awards` | `source_event_id`、`revocation_event_id` 的可追溯性 | 保留源 ID 和可查證據；任何移轉前測試 100% 還能查來源 |
| 管理與帳務 Audit | 全平台／各廳身份隔離、復原與爭議證據 | 不縮短必要保留期；不得抹掉原始稽核 |
| 僅供技術除錯且經認證非業務依賴的事件 | 有界查詢、授權、還原 | 完成下面全部驗證後才「候選」移出 |
| `cron.job_run_details` | 排程成功、失敗、重試與告警 | 可另評估成功紀錄留 7–14 天、失敗留更久；不停止排程 |

**重要：目前已有資料庫函式直接依賴 `papa_events`：`papa_accounting_summary`、`papa_badge_progress`、`papa_badge_recorded_candidates`、`papa_medal_evidence_page`、`papa_event_page_v2` 等。修改前不可直接移出相依事件。**

### 冷熱統一查詢的後續實作

- Supabase 僅保存精簡、可授權的歸屬與查詢索引、必需的業務狀態與可核實勳章證據；舊原文存在 Drive。
- PA Party 的歷史頁仍先由後端驗證 Account、Space、Streamer、Player 權限，再按照索引選擇讀即時資料或 Drive 封存，結果合併且有界分頁、排序、去重。
- 不可用 Google Drive 公開分享網址供玩家下載私人事件；不能讓其他廳讀到該廳資料。
- 所有「重新還原」先落入隔離環境、逐列 hash 驗證、按 ID 比對，禁止直接觸發業務寫入、帳務扣款、推播或覆蓋正式紀錄。

## 五、自動化：分階段開通，預設只複製不刪除

**Phase A：恢復舊檔證據**
1. 在當時的 Windows Codex 電腦找到實際封存檔、manifest、原始 SHA-256 校驗紀錄；無證據標記 `NOT_FOUND`。
2. 用獨立校驗工具確認檔案可解析、筆數、事件 ID 與預期摘要；比對 256,876 是累計刪除計數還是實際備份數。
3. Google OAuth 完成後上傳 **加密副本** 到私人 Drive，下載同一檔再驗證 SHA-256。保留另一份離線獨立備份。

**Phase B：建立日常保全（無損）**
1. 後端專用排程使用唯讀憑證按已提交的 event ID checkpoint 匯出，重試應冪等，不重複封存。
2. 匯出至私人 Drive，產生 manifest、加密、SHA-256 校驗及落地查驗。
3. 用每日校驗及告警監控不完整分片、OAuth 過期、Drive 額度、Supabase 容量／Egress。
4. **首階段僅複製備份，不啟用自動 DELETE、TRUNCATE、表重寫、VACUUM FULL、讀寫函式改寫。**

**Phase C：安全冷資料移轉（要另外驗收）**
1. 建立跨冷熱資料的有權限歷史查詢 API 與必要勳章／帳務投影；跑雙讀比對。
2. 測試舊事件查詢、勳章進度、來源證據、歷史帳務、失敗提歌、各廳隔離及帳本一致性。
3. 在隔離資料庫用實際分片還原：筆數、原 18 欄、微秒時間、NULL、JSONB、ID 全對。
4. 以上通過且有獨立備份後，**針對明確核准的 event ID manifest** 個別批准移出；不得按年齡大範圍刪帳務、演唱或 Audit。
5. 刪除事件後普通 VACUUM 不保證縮小檔案；表本體實體重整需要另審鎖表、磁碟餘量與可回復方式。

## 六、零費用目標與限制

- 用使用者既有**付費 Google Drive 空間**存封存檔，不增加 Supabase 資料庫的 500 MB 使用量。
- Drive API 呼叫、OAuth、執行備份腳本的設備與頻寬並非毫無限制；Google Drive 不等同即時 SQL 資料庫。
- 避免完整快照頻繁上傳、重複查詢、無界回傳，減少 Supabase Egress；可每日本機/伺服器差異備份及每月完整備份。
- **不保證永久使用 Supabase Free**：容量、Egress、連線及用戶規模仍受服務商額度限制；需要設 80%／90% 警戒值。

## 七、驗收與現階段封鎖項

- [ ] 使用者完成 ChatGPT Google Drive 連接。
- [ ] 設定網站端獨立 OAuth、專用私人資料夾與執行環境 Secrets。
- [ ] 找到舊事件檔及 256,876 筆來源的前後清單、manifest、SHA-256；未找回時必須清楚標記。
- [ ] 成功將 **可驗證的舊事件備份** 以加密形式上傳 Drive，下載驗證，留下至少另一份獨立副本。
- [ ] 每日新事件無損增量備份已測通（但仍不清除線上）。
- [ ] 月封存、查詢、授權、限流、勳章與帳務歷史測試通過。
- [ ] 任何正式移出前先審計、備份、驗收，再取得個別核准。

**不得因為「使用者希望免費」就修改官網、關閉通知、改帳務、硬刪事件或宣稱備份已成功。**
