# 選單及廳網址補齊（僅本機）

- src/hall-navigation.js 沿用已部署 publicAppHome 單筆唯讀來源，按 Space ID 查權威廳名及 canonicalPath，不根據 space-001 或主播名稱猜分類。沒有公開、啟用且已設定專屬網址的廳時不產生連結。
- 首次展開選單才查；5 分鐘快取、最多 16 個 Space、合併重複請求、失效後忽略舊回應。沒有輪詢／Realtime／全量目錄下載。
- src/compact-menu.js 接受 hallNavigation 與 spaceId；成功打開彈窗或選取連結後收起選單，修正開關 aria-label、重裝同一 header 的分組，以及 CloseWatcher 初始化失敗的備援。
- app.js 由整合負責者接線，並移除原有寫死的聲瑪大廳連結。官網檔案未改動。
- tests/hall-navigation.test.js：4 項通過。
- ops/check-compact-menu.mjs：320、375、390、430、768、1024、1440 寬度，檢查可視範圍、44px 按鈕、內外點擊、Esc、彈窗開啟後收起、同 header 重裝及零額外 history 均通過。合成瀏覽器 fixture，非實機／登入環境驗收。

## 其他廳 /廳ID/主播ID：待批准 SQL

ops/public-route-hall-path-proposed.sql 不在 migrations 目錄，不會自動套用。正式操作仍需明確批准。

- 只替換既有 papa_public_route_home 函式的 hall 輸出 `/qq.Artist` → `/qq/Artist`；flat `/pa`、`/主播ID` 與 independent `/pa.ID` 原規則維持。
- 同一交易內使用既有 registry advisory lock，為所有已設定 hall 主播新增新路徑 alias；所有舊 aliases 與 Audit 保留，Space／主播穩定 ID 不變。
- 使用實際且啟用的總裁帳號記錄前後網址 Audit；範本不填入猜測身分，缺少或停用身分即拒絕。
- 舊 alias 解析時直接依穩定 ID 取得最新 canonicalPath，不會增加轉址鏈。後續主播／廳改名仍沿用原 RPC 保留全部舊網址。
- 所有碰撞整組回滾，包括函式替換、revision、aliases 及 Audit。沒有業務資料修改或私人 Audit 匯出。
- 本機 tests/public-route-hall-path-proposal.test.js：3 項綜合測試，驗證舊資料／歷史保留、舊子分頁維持目的地、重跑冪等、主播／廳多次改名、ACL、衝突回滾及未批准身分拒絕。

正式執行前需唯讀確認 hall 設定與主播筆數、新路徑衝突及執行身分。資料量取決於已設定的 hall 主播數；新增一個 alias 與一筆 Audit／主播，修改有主播之 hall revision 一次。此處未查正式資料庫，因此不宣稱實際影響筆數。

會短暫鎖定網址編輯 registry 與相關 Space URL 設定列；不鎖帳務歌曲交易。若同時出現 RPC 啟動等待，先等待該短交易完成。錯誤自動整組回滾。

回復：停止新網址編輯入口，將函式 hall 分支恢復 `'/ '||hall_code||'.'||room_code`（實際字串不含空白），保留新增 slash aliases／Audit。所有已印出 QR 仍藉穩定 ID 解析；不可 DELETE aliases 或 Audit。回復前另需準備與測試正式 rollback SQL，不應直接從此文字拼裝執行。

沒有部署，沒有正式資料庫操作。
