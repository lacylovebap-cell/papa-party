# 2026-10-21 進度與正式狀態

## 已上線：10.21-WEB.2

- main commit b56e3472978e79d0aa61a4f335d0368b992c8c2d；GitHub Pages 39556546493 成功。
- party-api v55 ACTIVE；正式下載內容與已驗證本機 bundle 完全相同。
- 歌曲首數／現點給歌手金額連動；半首預設一次0.5，主動唱兩次或配對才1；原雙費規則保留。
- 玩家不可點隱藏歌／隱藏配對；管理員手動可選；骰子排除隱藏、刪除、停用及不提供歌曲。
- 單首及收藏確認拒絕背景更新後的舊報價；收藏即時更新金額；跨主播一次唯讀報價，結算前核對已確認首數／金額。
- 管理代點與分配摘要依半首／兩次／配對即時變更；修改既有重複半首的備註保留原1首及2次演唱。
- 精簡應用程式選單，四組、目前頁隱藏、44px操作、外點/Esc/導航/成功開彈窗關閉。
- 62 項針對性自動測試通過；三組實際 headless browser fixture 通過；7種選單寬度通過。
- 正式 GET 六檔一致；官網 index、樣式、登入、manifest、推播 worker保持原有內容。
- 無正式 migration、帳務補正、玩家資料寫入或測試通知。

## 本機已完成、尚未部署

- src/platform-management.js/css 五分頁管理中心：搜尋、總頁數／跳頁、編輯／停用／恢復、既有主播registry新增/編輯、管理授權及封存操作接線；登入設定按需讀單筆並保留原啟停狀態。失敗保留輸入，晚回應／離開頁面不重新載入私人清單。
- ops/platform-management-proposed.sql 與directory companion：租戶中繼資料、冪等原子RPC、append-only Audit、封存反重新啟用guard、依賴數量報告、新舊權限相容。
- Edge新增管理RPC接線與streamer_admin權限門禁；舊完整管理read要求all，窄權限無法下載整包私人資料。
- 管理SQL/UI相關13項測試通過；管理中心7寬度、表單失敗、晚回應競態的browser fixture通過。
- 所屬廳導航改用已部署publicAppHome唯讀查詢按需快取；不依spaceId猜廳名稱。
- 其他廳 /廳ID/主播ID 的SQL提案保留所有舊alias及Audit；3個隔離情境通過。APP來源adapter與子分頁新舊路徑5項通過。

## 仍未完成／不能宣稱整套平台完成

- space_admin管理登入橋接、窄權限模組讀取UI、個別管理帳號新增/登入方式/重綁/安全重設密碼、負責人交接與租戶重分類。
- 新租戶完整營運隔離及啟用；目前新增空間刻意保持suspended，不能以管理UI繞過既有資料頁門禁。
- 窄權限撤銷在舊商務commit內的同交易重驗與實際多連線Postgres並發驗證；目前中央Edge門禁不能取代原子SQL授權。
- 永久刪除；依賴報告一律safeToDelete=false，未完整查核關聯不宣稱可刪。
- 真實Android/iOS/PWA與無CloseWatcher的原生返回鍵完整驗收；headless fixture不代表實機驗收。
- 正式資料庫變更仍須另行核准，不能把一般「上線」視為migration批准。

## 正式唯讀查核

2026-10-21只查Space/公開路由中繼資料：現有唯一Space為space-001、slug papa-party、display_name PA Party、active；公開路由layout flat、code sm，共12個主播mapping。這證明目前聲瑪公開入口與相容Space對應；沒有自行重命名、重分類、搬移或指派owner。

## 下一步

先完成上述登入／原子授權缺口，依ops/platform-management-sql-contract.md整合驗證，再提交明確migration與風險供核准。新的hall slash aliases提案須一起確認後才套用。已上線歌曲／選單不重複部署。繼續開發分支已合併正式WEB.2，保留本機管理改動；此分支沒有推送正式main。
