# 10.13-EDGE.1

普通讀取仍重新驗證登入、Space、主播權限，讀取既有 scoped snapshot 及權威帳務摘要。歌曲資訊改用既有 metadata RPC 的唯讀包裝：同一資料庫快照計算完整內容的 SHA-256；只有內容完全相同時省略重複的 metadata rows。Edge 快取最多 8 個範圍／1 MiB，五分鐘到期，強制重新整理不帶舊簽章。歌曲、共用資料、歌詞可用性和候選狀態更新都依实际內容失效，不使用診斷同步計數作為資料權威。

新增 `202610130004_conditional_catalog_metadata.sql` 僅建立 service-role 可執行的唯讀函式。原 metadata、帳務摘要、原子交易與聯動檢查的函式內容及權限均保持。寫入後的 projection 保持原路徑；不快取帳務、餘額、玩家或待播資料，不增加輪詢或訂閱。舊環境缺少新函式時保留原讀取，其他權限／網路錯誤不偽裝成相容模式。

驗證：33 項 targeted tests 全數通過，包括真實 PostgreSQL 包裝函式、正式 Edge handler、更新／強制讀取、切換 Room／Space／管理與玩家身分、快取大小限制、缺少遷移及操作結果不明時禁止重送。Edge bundle 建置及語法檢查通過。

已安裝新唯讀函式並部署 Edge；正式 `releaseInfo` 為 `10.13-EDGE.1`。米雪 703 首歌曲的 metadata 首次回應 263,733 bytes，內容不變時 174 bytes；此數字只代表該 RPC 回應，並非整頁流量或帳號 Egress。SQL 仍計算原 metadata，未宣稱减少原查詢 CPU。匿名與一般 authenticated 角色不能直接執行新函式。正式寫入函式／帳務函式 hash 和 ACL 與部署前一致；阿欽已核准的兩筆沖銷及兩筆失效退回仍在，本次不重做或新增帳務補正。

Web 仍為已驗證的 `10.13-WEB.3`，本次不改前端排版。此批只完成歌曲資訊的條件式傳輸；完整 domain delta、scoped Realtime、寫入 receipt、Android／Windows 原生交付及實機背景／鎖屏驗收仍有未完成項，不能宣告 V2 全部完成。
