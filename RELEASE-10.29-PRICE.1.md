# 10.29-PRICE.1｜新計價第一階段（聲瑪切換新算法）

使用者 2026-10-29 看過截圖後核准上線。規格：專案文件 `claude/pricing-integration-spec-20261027.md`；盤點與決定：Claude Docs「PA Party 新計價規格｜第一階段盤點與實作計畫」。

## 改了什麼
- 共用計價引擎 `src/pricing-engine.js`（前端試算與 Edge 送出驗證用同一份）：歌手、主持、廳主號三方都乘歌曲占的首數；占多首時自動挑三方合計最便宜的合法存歌方案組合；他人點已冠歌曲只有歌手改冠後價，主持、廳主號照一般每首；支援雙費／單費／無雙費與各廳自訂稱呼、單位（聲瑪＝歌手／2號位主持／聲瑪樂團、探鑽）。
- `core.js`：`requestFees` 改用引擎，`price`＝歌手、`double`＝主持，另存 `fees:{version,units,singer,host,hall,source,plans}`；單獨半首一律拒絕（點歌、代點、換歌、收藏、批次、分配都經 `quoteSong`）。既有紀錄不改；舊的 0.5 首紀錄照常取消、完成。
- 畫面（`src/pricing-ui.js`、`src/pricing-ui.css`，顏色跟主播主題）：確認現點的金額收在「🎁 查看禮物值」，點開才看到歌手／雙費與套用方案；半首未選演唱方式時送出鍵鎖住；點歌教學・價目表、如何冠歌改版、文字精簡；方案名稱拿掉「一般」。
- 全平台拿掉「我已確認禮物價格」類勾選（單首、收藏批次、換歌、跨主播），送出即確認，請求固定帶 `giftConfirmed:true`（伺服器檢查不變）。
- 所有價格附註「以上數值僅供參考，最終以實際狀況為主。」

## 版本
- 前端 `10.29-PRICE.1`（`app.js?v=10.29-PRICE.1`；core／pricing-engine／pricing-ui／pricing-ui.css 同版號）。
- Edge `10.29-PRICE.1`（`releaseInfo.pricingEngine:1`），發布檔 `ops/edge-release/party-api-10.29-PRICE.1.js`。與已部署 ADMIN.5 相比只多計價引擎、`requestFees`／`quoteSong` 變更，以及 main 上 QUEUE.1 已改的 `queuePreparation` 文字。
- 資料庫：不變。

## 驗證
- 測試：`tests/pricing-engine.test.js`（規格第 4／5／7／8 節案例）、`tests/pricing-ui.test.js`、`tests/pricing-edge-e2e.test.js`（真實 Edge＋完整 migration 資料庫：占 2 首存入 5,555／990／990＋方案名；單獨半首被伺服器拒絕；唱兩次 1 首 2,990／500／500）。全套與 main `6709ff6` 相比沒有新增失敗。
- 截圖：手機與電腦、怕怕主題與另一主題。

## 回復
- Edge：重新部署指向 commit `c937c0a` 的 `party-api-10.28-ADMIN.5.js`（v68）。
- 前端：main 還原到 `6709ff6`（QUEUE.2）。
- 新紀錄多出的 `fees` 欄位是附加資料，回復後舊程式會忽略。

## 尚未做（後續批次）
廳級設定資料表與建立廳時填稱呼／單位／換場時間的介面、換場時間改讀設定、VIP 與其他卡別、冠歌三規則、審核中心、待播顯示玩家身分與主播應收。
