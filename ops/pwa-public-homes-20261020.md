# APP 首頁公開查詢：待核准的最小唯讀 RPC

狀態：本機完成，尚未部署；SQL 只存在 review candidate，未執行正式 DB、未建立正式 migration history。

## 為何需要一個 RPC

目前 `publicLobbyRooms` 會從完整 `papa_streamer_directory_in_space` 取出 meta 主播名單後在 Edge 篩頁，不適合擴充成 APP 每次啟動的全站查詢。既有網址 metadata 表也刻意撤銷 service_role 直接查表權限；逐位呼叫 `publicRouteInfo` 會變成 N+1。

草案 `ops/pwa-public-homes-rpc-20261020.sql` 僅新增一個 `STABLE` SQL/PLpgSQL 函式 `papa_public_app_homes`。利用既有 `papa_v2_entities` 的 meta.streamers、`papa_space_streamers`、active `papa_spaces` 及既有專屬網址設定，在資料庫內完成搜尋、篩選、count、分頁，一次回最多 12 筆。不存在第二套帳號、主播、廳或偏好資料模型。

沒有新資料表、索引、觸發器、定時排程、資料補正、歌曲或 Audit 寫入，也不下載歌詞、帳本、玩家私人欄位或完整 business snapshot。

## 公開 API

`publicAppHomes({q:'',kind:'all'|'hall'|'streamer',page:1,pageSize:12})` 回 `{items,page,pageSize,total,totalPages}`。q 長度 <=100，page 1..500，pageSize 1..12；空清單 page=1、totalPages=1；越界頁在同一查詢夾回合法最後頁，不另發讀取。SQL 搜尋是 literal substring，不將 `%`、SQL 片段當成 wildcard 或動態 SQL。頁序固定 kind/name/Space ID/streamer ID。

`publicAppHome({v:1,kind:'hall'|'streamer',spaceId,streamerId:null|ID})` 或 `{source:{...}}` 精確查單筆 stable identity，回公開 row 或 null。v 必須是 1。名稱、homePath、登入中的 streamer slug、角色或 token 不能覆蓋查詢目標。找不到或已停用回 null；網路 timeout/DB 錯誤拋錯，不能被誤判為停用。

row 只有 `kind,spaceId,streamerId,name,spaceName,streamerSlug,canonicalPath,homePath,active:true`。已設專屬網址使用 canonicalPath；尚未設代碼但公開有效的主播，使用安全的 `/v2.html?streamer=slug#home`，不靠顯示名稱猜 stable ID。未配置 pretty hall 時可沿既有 `/lobby.html`。來源不含登入憑證。

兩個 Edge handler 位於 actor/activity/native business snapshot 之前，無登入需求，只有一個唯讀 RPC。沒有高頻 polling、Realtime、查詢 fan-out 或長期 server cache；來源停用會在下一次精確查詢立即生效。

## 現有能力限制

此版 SQL 的 `business_spaces` 沿用目前公開業務資料頁的 `space-001` capability guard，不依主播名字或網頁名稱判斷。其他 Native Space 的既有公開業務頁仍有「尚未開放」限制，所以不把它們列為可用 APP 首頁。未來開放新的 Space/租戶時，需隨同既有業務 capability 同步擴大這個範圍。沒有為了讓 chooser 看起來完整而繞過權限/隔離 guard。

## 權限與風險

- 固定 `search_path=pg_catalog,public`，所有來源表與 URL helper 指定 `public.`。
- 函式為 `STABLE SECURITY DEFINER`，用意是讓內部 service 查詢既有受保護 URL metadata；並非公開 Data API 接口。
- 撤銷 PUBLIC / anon / authenticated EXECUTE，只授予 service_role EXECUTE；不給任何新查表權限。
- 前端仍只呼叫已存在的 Edge API，service key 不會進入瀏覽器。
- DDL 只新增一個獨立函式和 PostgREST schema reload notification。資料量與來源內容不變，沒有資料掃描維護或付費升級。
- 部署順序：核准後先建立 RPC，驗證 service 權限/有限公開結果，再部署 Edge/UI。未核准前不部署依賴此函式的 APP 啟動流程。
- 回復：尚未有新 APP 安裝使用前才可退回前一版本。啟用後須保留 `app.html`、來源／偏好啟動模組、API resolve 與唯讀 RPC，相容修正優先；不可整套退回缺少 APP 入口的舊版，避免已安裝 APP 失效。不刪原資料／偏好，新唯讀函式可保留。

## 本機驗證

`tests/pwa-homes.test.js` 使用隔離 PGlite 套草案 SQL；確認來源資料前後相同、server-side 搜尋分頁、未知/停用/未開放來源、米雪未設 pretty URL fallback、service-only EXECUTE、不能直接查原始表、錯誤與 null 分離。

`tests/pwa-homes-edge.test.js` 使用真實產出的完整 Edge bundle，只替換 fetch；確認 public handler 不觸發 actor/activity/snapshot，單一 RPC、query/source 欄位白名單、錯誤 fail closed。

執行指令：`node --test tests/pwa-homes.test.js tests/pwa-homes-edge.test.js`。完整整合與正式部署狀態由根任務交付記錄為準。
