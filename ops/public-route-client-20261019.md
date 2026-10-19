# 專屬網址：客戶端路由接線

本文件只說明本機完成的路由 helper 與測試；不表示正式網址、資料庫 migration 或網站已部署。

## 範圍

- 現行聲瑪 `/sm`、怕怕 `/pa`、其餘聲瑪主播 `/{自訂代碼}`。
- 其他廳主播 `/廳代碼.主播代碼`，獨立主播固定 `/pa.主播代碼`。
- 保留伺服器實際登記的舊 `/廳/主播` 別名解析，不能依文字猜測 Space ID 或主播 ID。
- 六個既有頁面 `home`、`book`、`common-book`、`center`、`gallery`、`admin`；首頁不附加 `/home`。
- 不更動原本登入權限、帳務、勳章及其他業務資料。

## `src/public-route-location.js`

`parsePublicRoutePath(href, { mountUrl } = {})`

回傳 `{eligible, candidates, reason}`。每個候選為 `{homepagePath, section}`，最多兩筆：

1. 路徑本身若符合一／二段的可能舊首頁，先查完整別名。
2. 尾段為既有子頁時，再查去掉尾段的首頁別名。

例如 `/old/book` 先檢查 `/old/book` 是否為已登記的舊首頁，再檢查 `/old` 的 `book` 子頁。伺服器沒有登記的內容不會由前端自動配對成主播。

大小寫原樣交給後端的不分大小寫索引。拒絕百分比編碼、路徑穿越、反斜線、空白、重複斜線、不合法字元、過長代碼、系統路徑。標準代碼只接受英數及內部連字號，最多 40 字元；點分隔只允許一個點。

`canonicalPublicHome(origin, homepagePath)`

回傳乾淨的公開首頁完整網址或 `null`。不攜帶任何原頁 query、hash、權限、玩家選擇及通知資訊。這是分享首頁的序列化；輸入的首頁必須來自後端已驗證資料。

`publicPageDestination(href, canonicalHome, pageLocation)`

回傳專屬首頁前綴加原子頁的新網址。沿用既有 `pageDestination` 的 `adminTab`、`tab`、`player`、`queue` 適用範圍；其他 query 全部移除。拒絕跨 origin 目的地。

## `src/public-route-bootstrap.js`

```js
const result = await resolvePublicPage(location.href, {
  mountUrl: new URL('/', location.href),
  resolve: homepagePath => transport({ op: 'publicRouteResolve', path: homepagePath })
});
if (result) await loadPublicTemplate(result, { mountUrl: new URL('/', location.href) });
```

`resolvePublicPage(href, { mountUrl, resolve })`

- 只對 parser 候選依序呼叫 `resolve(homepagePath)`，最多兩次；不掃全站主播。
- 找不到回傳 `null`；網路／後端錯誤會拋出，不會錯誤改登入其他主播。
- 驗證後端 `kind`、穩定 `spaceId`、`streamerId`、`streamerSlug`、已查詢 `matchedPath`、有效 `canonicalPath`。
- 回傳 `{metadata, section, view, destination}`。
- `metadata` 只保留明列的公開欄位；排除其他未預期欄位。
- 舊別名直接連到最新 `canonicalPath`，不形成多層轉址。原子頁／玩家明細／歷史模式保留。
- 曾使用 `#book`／`#admin` 的首頁連結保持原目的地；顯式 `/book` 等尾段優先。

`publicRouteDestination(href, metadata, view)`

- 為 browser fallback 與可選的 Worker 共用同一份 query 規則。
- 大廳透過原 `lobbyQuery`／`lobbyLocation` 保留有界搜尋、篩選、歌曲與主播頁碼。大廳沒有主播子頁。
- 大廳與主播均只保留單一合法 `portalLogin=player`／`portalLogin=admin`；它只是登入視窗意圖，沒有任何授權。
- 主播玩家明細 ID 限制 200 字、無空白或控制字元；無效 ID 只移除明細選擇。
- 帳密、token、Space hints、通知及其他不相關 query 全部移除。
- `resolvePublicPage` 與 `loadPublicTemplate` 的目的地驗證使用同一 helper，重新整理不會失去大廳搜尋／頁碼或登入意圖。

`loadPublicTemplate(result, options)`

- 大廳使用原 `lobby.html`；主播使用原 `v2.html`，不建立另一套頁面。
- 模板請求限定同 origin，`credentials: 'omit'`，不附帶目前頁 query。
- 檢查 HTML 型別、大小上限、模板 script origin；驗證完成前不更改畫面或網址。
- 插入固定 `<base href="/">`（有部署掛載點則使用該掛載目錄）。
- 注入 `<script type="application/json" id="public-route-data">`，資料形狀為 `{...metadata, section}`；不含登入憑證。
- `history.replaceState` 保留漂亮網址，採用最新版前綴；不改成模板檔名。
- 重新啟動原模板 scripts；同一 document 相同目的地只載入／執行一次，部分失敗後也不會再執行已啟動模組。
- 不含任何 Supabase 寫入、輪詢、Storage、Realtime 或正式部署。

## 本機驗證

`node --test tests/public-route-location.test.js tests/public-route-bootstrap.test.js`

22 項測試通過。涵蓋新舊格式、別名最長匹配、大小寫、子頁、原 hash、分頁查詢、stable ID 隔離、登入資訊剝除、非法 URL、同 origin 模板、安全腳本啟動、下載錯誤及重複啟動防護；含漂亮網址的大廳登入／搜尋／頁碼重整。

模板載入測試使用小型 DOM double 驗證瀏覽器 API 接線；整合後仍需在實際瀏覽器確認重新整理、返回與掃碼。靜態 GitHub Pages 的 fallback HTTP 狀態碼受主機限制，畫面由原 404 模板啟動既有 app；本 helper 不會修改 DNS／代管。

## 待主流程整合

- `404.html` 呼叫上述兩階段 helper。
- `app.js`／`lobby-entry.js` 讀取 `#public-route-data`，沿後端穩定 ID 套用 scope，並依 `section` 恢復原導覽。
- 連結設定、分享彈窗、官方 LOGO QR Code 與非破壞性 migration 由其他同批變更處理。
- 正式資料庫 migration 須另列影響與還原方案，取得本次使用者確認；本文件沒有執行授權。

## 同批設定與快取複核

已額外複核 `src/public-links.js`、`src/public-link-settings.js`，並新增 `tests/public-link-settings.test.js`：

- 設定只在開啟、按檢查／儲存／重新讀取時請求；複製與 QR 預覽重用已讀資料。
- 總裁可在尚未選主播時管理指定大廳；主播只設定自身範圍，後端仍是權限權威。
- 儲存附帶已讀 revision，重複提交鎖涵蓋後續非同步同步程序。
- 修改身分、切 scope、關閉視窗會阻止舊請求更新畫面；作廢 metadata 請求不會回流舊範圍，尚未真正送出時直接略過。
- 獨立主播命名空間固定 `pa`；切回大廳設定還原先前大廳代碼。
- 已配置 Space 的類型不可在 UI 改變；獨立 namespace 沒有大廳首頁，`canonicalPath: null` 不會誤判成壞資料，也不能產生空的分享網址。
- 總裁管理其他主播時，分享名稱不會誤用目前登入主播名稱。
- 儲存成功但本機畫面同步失敗時，訊息明確保留「網址已儲存」，避免誤認失敗而重試。
- metadata 快取只保留公開欄位，最多 32 個 scope，沒有輪詢。

執行四個 targeted files（location、bootstrap、public-links、settings）共 38 項測試通過；其中設定／快取新增 12 項。未執行正式資料庫寫入或部署。

## App 整合複核

新增 `tests/public-links-app.test.js`，從實際 app 擷取函式進行 9 項 VM 整合測試：漂亮路由啟動與本機快取分區、原玩家／管理登入槽保留、Back／Forward、切換主播前綴、總裁與主播管理差異、目前瀏覽主播的分享、過期 async 結果、登入後返回原公開頁、待點歌意圖只執行一次。

最小修正 `chooseLogin`：漂亮網址的玩家登入成功後，返回當前合法公開頁；`center` 原勳章等分頁保持。原 legacy 登入仍回首頁；玩家登入不會轉進 `admin`，既有待點歌意圖處理保持。

與既有同 Space 導覽、頁面位置、官網登入等回歸合計 29 項通過。舊 `tests/page-location.test.js` 僅補新整合函式所需 VM 依賴，原斷言未改。
