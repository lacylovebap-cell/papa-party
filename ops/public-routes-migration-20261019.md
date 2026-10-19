# 專屬網址資料庫候選更新：2026-10-19

狀態：僅本機候選，未連線、未執行正式資料庫更新，未部署 Edge Functions。必須由使用者明確確認這份新增 metadata migration 後，才能套用正式環境。

## 變更內容與實際作用

精確 SQL 位於 `supabase/migrations/202610190001_public_routes.sql`，以單一 `BEGIN / COMMIT` 交易執行：

- 新增四張小型網址 metadata 表：`papa_public_route_spaces`、`papa_public_route_streamers`、`papa_public_route_aliases`、`papa_public_route_audit`。
- 新增兩個唯一／查詢索引及歷史 code 查詢索引；既有業務資料表、索引、觸發器和帳務公式均無更動。
- RLS 全部啟用，無公開讀寫 policy。`anon`、`authenticated`、`service_role` 都不可直接讀寫新表；Edge service 僅透過指定 RPC。
- 新增服務專用 RPC：`resolve`、`info`、`settings`、`check`、`save`。其他私有 helper 連 service role 都不可直接呼叫。
- 新增不可變更 alias／網址 Audit 觸發器；每次真正改碼只記錄來源 Account、Space、主播、前後網址及 scoped revision。不複製 JSON 業務快照、不寫 `papa_events`。
- 只新增使用者確認的現有 stable-ID 綁定：`space-001` → 聲瑪 `/sm`，該 Space 既有 `papa` → `/pa`。缺少這組已確認映射時整個 migration 中止，不留下部分登記。沒有新增帳號、Space、主播、玩家或任何帳務。
- 未設定的主播維持既有舊網址。未設定的其他 Space 必須先由總裁指定命名空間；不從名稱推測身分或自動建立其他大廳。

網址規則：聲瑪為 flat，`/sm` 是大廳，主播為 `/{code}`；其他廳為 `/{hallCode}`、`/{hallCode}.{code}`；獨立主播為 `/pa.{code}`。code 最長 40 個英數／中間連字號，首尾必須英數。系統保留名稱不可使用；`sm`、`pa` 僅保留已確認的特殊用途。

## 權限、關聯與永久舊連結

- Edge 僅讀取驗證後 `who.accountId / role / spaceId / streamer_id`，忽略 request body 的角色、Account、actor context 及通用導航用 `streamer` slug。
- SQL 再查 Account 啟用、管理帳號既有綁定、有效會員角色、主播啟用及 canonical Space 映射。總裁另須有 `president` platform role 及既有管理綁定。
- 主播只能設定自己的 code；大廳／Space code 只限總裁。不能藉參數改成其他主播。
- 所有 alias 以不分大小寫 path 作主鍵，指向 stable Space ID／streamer ID。resolve 一次直接取得目前 canonical path，沒有鏈式轉址、沒有循環。
- 歷史 code 也依 stable Space 保留，改廳碼後不能把舊主播 code 重新配給其他主播。
- 改廳碼在同一交易啟用所有既有主播的新 canonical paths，舊 hall／home aliases 全留存。任何 child 路徑或 Audit 失敗，整組回復。
- 極少量網址寫入使用專用 advisory lock；CAS revision 只屬於網址 Space，不改既有業務 revision，不新增輪詢或 Realtime。
- 表格外鍵會禁止移除仍被網址歷史引用的 stable Space／主播 mapping。既有正常停用流程仍由原本 active/status 控制；若日後要永久刪除 mapping，須先制定永久 URL 歸屬保存方案，不可把 URL 分配給其他人。

## 查詢、流量及容量

- resolve 只查一個 path primary key；public info 只查指定 Space／主播，不下載整份主播資料給前端。
- 公開回應只含已公開的 stable IDs、slug、code、canonical path、layout、revision；不含密碼、玩家資料、額度或 Audit 原文。
- 啟用／有效性沿用現有 metadata row 內的特定主播描述及索引 Space mapping；查詢過程不讀整份業務 snapshot、歌曲或演唱歷史。
- 每次 code 變更才新增極小 alias／Audit 紀錄；大廳改碼新增最多該廳目前已設定主播數量的 alias。新建 metadata 容量不等於回收容量；目前回收 0 MB，不能聲稱解決既有 Supabase 超額。
- QR Code 不使用 Storage，相關前端另行驗證。

## 套用前唯讀檢查

以下只查 schema／權限／數量及指定公開 stable mapping，不匯出私人玩家或原始 Audit：

```sql
select current_setting('server_version') as version;
select to_regclass('public.papa_public_route_spaces') as existing_registry;
select id,status from public.papa_spaces where id='space-001';
select streamer_id,space_id from public.papa_space_streamers
 where streamer_id='papa' and space_id='space-001';
select count(*) as active_accounts from public.papa_accounts where disabled_at is null;
```

若 registry 已存在，停止重跑 migration，先比對正式 migration history／DDL；不可用 `DROP`、`TRUNCATE` 或重新 seed 覆蓋。

本機 Supabase CLI 不存在，故尚未生成正式 migration history，也沒有執行遠端 apply／advisors。此固定檔名是專案指定的候選 SQL；正式套用由專案既有已核准發行機制登記版本，不直接猜測 CLI 參數。

## 備份與回復

1. 套用前保存目前部署 commit、Edge 版本及 schema-only DDL；使用使用者核准、由業主管控的現有加密備份方式，不自動匯出玩家或 Audit 原文。
2. migration 中途失敗：PostgreSQL 交易全部回復，不留半套 seed／函式／索引。
3. 已成功套用但前端或新 Edge 有問題：使用**保留新 URL 相容能力的回復版本**，不可把 Edge 或 UI 完整退回尚無 URL registry 的舊版。相容版必須保留 `publicRouteResolve`／`publicRouteInfo`、路徑 bootstrap、公開主播身分 context、子分頁導航與舊網址解析；否則已分享的 pretty URL 可能失效，甚至掉回預設主播。既有 `?streamer=...` 網址也繼續運作。
4. 緊急停止改碼時，Edge 設定非機密環境旗標 `PUBLIC_ROUTES_READ_ONLY=true`，攔阻 `publicRouteSave`，且不送出 save RPC；Resolve／Info／Settings／Check 持續可用。此旗標本身不修改任何資料。平常未設定或值為 `false` 才允許既有驗權後的寫入；重新開啟時仍須維持最新相容解析程式。
5. 一旦任何新網址正式分享，不可刪除新表、aliases 或 Audit 作為 rollback。將修正以 additive migration／相容解析器發行，永久保留既有 URL 歸屬；必要時回復 canonical code 也透過相同受稽核 save RPC。
6. 本項不需要、不包含正式玩家餘額、演唱紀錄、勳章或既有 Audit 補正。

## 已完成的本機驗證

`tests/public-routes-rpc.test.js` 使用隔離 PGlite 和假 Account／Room fixture，9 項通過：

- 已確認 seeds、public info、service-only execute、RLS／table/helper revoke。
- 自有主播改碼、多次改碼、大小寫、舊 alias 與歷史 code 不可轉讓、沒有轉址鏈。
- 非法字元、保留路徑、超長 code、同廳重複 code。
- 其他廳 dot URL、獨立 `/pa.code`、改廳碼與舊首頁完整保留。
- 偽造總裁、停權會員／Account／主播、跨 Space／主播、擅改 layout 拒絕。
- 注入 Audit／child alias 失敗，code、alias、revision、Audit 全部 atomic rollback。
- 相同值重送不新增寫入；舊 revision 的兩個不同請求僅一筆成功。
- migration 及全部網址變更前後，既有 business/auth/Audit/revision fixture 完整相同。

`tests/public-routes-edge.test.js` 建置完整 `build-edge.mjs` 發行 bundle，以原始 handler／actor／API 邊界、僅置換 fetch 的假資料庫再驗證：公開 Resolve／Info 不查登入、不觸發 activity；三種管理操作採真實 verified actor；玩家／過期登入／偽造權限拒絕；hall 的 null target 不受導航 slug 影響；scope 不一致回應拒絕；失敗不落入業務操作。另新增緊急 read-only 旗標測試，驗證 save RPC 不執行且解析／管理讀取仍正常。最新版 Edge 7 項通過，加上未變更的 SQL 9 項，共 16 項通過。

PGlite 的同資料庫 Promise 競爭驗證的是序列化後 CAS，不冒充真正多 PostgreSQL connection 的實機鎖競爭測試。本機檢查未找到 `psql`、`postgres`、`pg_ctl`、`initdb` 或 Docker runtime；正式確認前仍需在隔離 PostgreSQL 專案以兩個連線驗證 advisory lock，不得對正式資料庫做有副作用測試。

文件依據：[Supabase Database Functions](https://supabase.com/docs/guides/database/functions)、[Data API security](https://supabase.com/docs/guides/api/securing-your-api)。只使用 PostgreSQL 既有機制，不增加新的 Supabase 套件或付費功能。
