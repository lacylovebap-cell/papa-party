# Supabase 正式環境唯讀核對 — 2026-10-12

本文件記錄已登入 Chrome 的正式 Dashboard 與四次成功的低負載 SELECT 系統目錄查詢。沒有套用 migration、修改商業資料、部署 Edge、清除事件或升級方案。SQL Editor 會自動保存查詢草稿；查詢不含金鑰、通知內容或玩家資料。

## 身份與現況

- 組織「怕怕PARTY」，Free；專案 `papa-party`、ref `zwhcgqwbtummydapuori`，main Production。與 `src/config.js` 的 URL 一致。
- Dashboard 當下 Healthy；Nano、CPU 3%、Disk 42%、RAM 64%、10/60 connections。近 60 分鐘 1,076 requests / 100% success；這是當下取樣，不代表背景推播實機成功。
- PostgreSQL 17.6。Dashboard 的 No migrations 是沒有 `supabase_migrations.schema_migrations` 紀錄表，不能解讀成未有正式 schema；既有 snapshot/commit/prepare 函式都存在。

## 實測容量與成本基線

用量週期 **2026-09-16 至 2026-10-16**，Dashboard 說明可能延遲一小時。組織總額與限定 papa-party 的數字一致：

| 項目 | 實測 | 額度 / 備註 |
| --- | ---: | --- |
| Egress | 10.406 GB | 5 GB，208%；不是新增本機程式測得的節省量 |
| Cached Egress | 0.077 GB | 5 GB |
| Database size | 0.526 GB / 顯示 501.81 MB | 0.5 GB；目錄即時總量 510,749,843 bytes，與快照時間不同 |
| Edge invocations | 117,077 | 500,000 |
| Realtime messages | 14,766 | 2,000,000 |
| Realtime peak connections | 11 | 200 |
| Log ingestion | 135.632 GB | Dashboard 標示 upcoming，不能與 Egress 混算 |
| Log query | 106.273 GB | Dashboard 標示 upcoming |

頁面明確提示前期 Egress 超額、寬限期到 **2026-11-01**。目前沒有看到 402 限制已實施。維持免費與完整資料保留的既有要求；正式更新的容量 gate 尚未通過。

最大的 public relation 來自 `pg_stat_user_tables` 與 relation size，沒有讀取實際事件或玩家內容：

| relation | bytes | estimated live rows |
| --- | ---: | ---: |
| papa_events | 450,379,776 | 325,779 |
| papa_v2_entities | 9,076,736 | 2,565 |
| papa_release_backups | 7,872,512 | 17 |
| papa_catalog_candidates | 2,080,768 | 1,790 |
| papa_catalog_variants | 1,613,824 | 1,252 |
| papa_notifications | 1,220,608 | 1,668 |
| papa_catalog_lyric_selections | 1,155,072 | 1,595 |
| papa_catalog_song_links | 663,552 | 1,595 |

`papa_events` 約佔即時 database bytes 的 88%；这是容量主要來源，不是已證明的 Egress 根因。沒有刪除、truncate、減少正式歷史或自動歸檔。後續須核對稽核寫入的必要性與讀取範圍，再提出可回復、保留全部歷史的方案。

進一步 metadata 核對：events heap 376,020,992 bytes、indexes 74,358,784 bytes。6 個 index 各有不同 key / predicate，未發現完全重複索引。`idx_scan=0` 不代表 index 可刪；actor-account 的 partial index很小、仍有權限查詢用途。沒有進行 drop/reindex/vacuum full。

`pg_stat_statements` 累計自 **2026-09-16 17:09:38 UTC**，只按 SQL 中已知函式名稱分類，沒有取出完整 query、參數或私人內容：

| family | calls | total execution ms |
| --- | ---: | ---: |
| full_snapshot | 75,766 | 7,616,193.77 |
| other_snapshot | 6,121 | 925,042.09 |
| directory | 37,139 | 75,802.51 |
| notice_inbox | 31,564 | 348,554.19 |
| commit | 3,225 | 510,193.25 |
| other_papa_sql | 230,458 | 1,890,209.20 |

這確認 full snapshot 是需優先改善的歷史讀取來源；累計涵蓋多個版本，不能直接歸因現在版本、不能用 returned rows 當 JSON entities 數，亦不能推算已達成的 GB 節省。Phase 2 仍需以 scoped domain counters/deltas、實測 request bytes 與同時在線使用情境驗收，不提高 polling 頻率。

## 函式與提醒排程

- 正式存在 `papa_v2_snapshot()`、`papa_release_b_commit(...)`、`papa_queue_prepare_due()`。
- 本機新 `papa_room_sync_head`、`papa_notice_category_page/counts/read` 尚不存在正式環境。不能開啟依賴這些 SQL 的前端功能再宣告完成。
- 正式 `papa_player_streamer_summary` definition hash `9dcd2ac4fa418e1429f173b49182c1a1`；新 common-first / waitingTitle migration 尚未部署。
- `papa-notification-retry` active，`* * * * *`，command 包含 prepare_due 與 pushWorker；沒有取出或顯示 command / worker secret。
- 最近 5 次 cron run 均 succeeded：2026-10-12 00:01–00:05 UTC（台北 08:01–08:05）。這證明排程 SQL 成功，**不證明 HTTP 回應成功、Push 到達或 Android 鎖屏顯示**。
- 每分鐘 cron 無法保證準備時間到期 3 秒內產生背景提醒。要滿足嚴格 latency 需可靠 deadline transport，不能靠縮短前端 polling。

## 發布狀態

最新整合回歸 1,051/1,051，Web / Edge build 成功。玩家初始最新排序的額外修正 targeted 27/27；之後仍需最終完整回歸。37 項與 V2 尚有實作、實機、成本與容量 gate 未完成；維持一次整合發布，沒有 push/main/deploy。
