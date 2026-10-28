# 漸層與原勳章動畫｜本機驗收

範圍依使用者最新指示為 30 種配色，不是先前指令的 40 種。沒有歌曲小卡相關修改。

## 版本與並行工作
- 基準：e66e6ce（10.29-PRICE.1）。獨立工作目錄 papa-party-theme-medal，分支 feature/gradient-medal-20261029。
- 已核對遠端 feature/homepage-themes（788deb3）為主分支祖先；主分支較新的 Logo 透明底修正完整保留。
- 完成前再次 fetch，origin/main 仍為 e66e6ce。無法觀察其他 Cloud 尚未提交或推送的內容。
- 未 push、未部署、未存取或修改正式資料庫。合併前須再次核對遠端相同檔案是否變動；有衝突先停止該部分整合。

## 增量實作
- theme-engine.js：增加 30 組背景漸層白名單；選擇後僅在現有主題 JSON 加入可選 gradient ID。舊資料不補欄位、不遷移。
- theme-studio.js：原設定畫面內新增選用區；原有色票、快速配色、權限、草稿／發布流程保留。關閉漸層還原原背景圖片及配色；選原色票／範本亦移除漸層。漸層啟用時暫時替代背景圖片顯示，圖片設定未刪除。
- 漸層依原背景色柔和混色，必要時降低強度保護文字對比；不覆寫文字、Logo、卡片、按鈕、圖片或裝飾設定。
- achievements-view.js / medal-animation.js / theme.css：原勳章 DOM 圖案保留，加入短暫翻牌、光暈與四顆 CSS 星光，結束清除裝飾與動畫 class。
- app.js：只新增動畫安裝及現有勳章載入結果的解鎖回呼。沿用原圖鑑判定；不變更取得規則或查詢。
- 自動動畫限同一身分及主播範圍的既有查詢結果從未取得變成取得；首次讀取不把歷史勳章當新解鎖。未開啟圖鑑時不新增背景查詢。
- 重播按鈕只操作 DOM；未取得／隱藏／已摘除與管理目錄不提供重播。尊重 prefers-reduced-motion。

## 流量與儲存
- 無新增資料表、API、輪詢、Realtime、雲端動畫素材。
- 點選漸層預覽及重播不寫資料。按原本儲存／發布時，沿用既有一次操作保存可選 ID（約數十 bytes）；不是完全不儲存使用者的選擇。
- 新增 JS/CSS 首次載入仍有少量靜態檔案流量；不能宣稱總流量零增加。
- 未更動正式 release.json 或快取版本。未來核准部署時，需同時發布支援 gradient ID 的既有 Edge bundle 與前端，並更新資源快取版本，否則舊後端會移除新欄位。

## 驗收
- 38 項測試通過：tests/gradient-medal.test.js、homepage-theme.test.js、achievements-client.test.js、medal-progress-certification.test.js、medal-collection-audience.test.js。
- 原主題 normalization、CSS variables、背景輸出與基準版本逐項比較；30 組切換、恢復、深淺配色對比與既有 reducer 保存通過。
- 本機 Edge 瀏覽器 1280px / 390px：30 組選項逐一點選、恢復原背景、原目錄 Emoji 完整、動畫清除、重播零網路請求、鍵盤操作與減少動態效果通過。
- 瀏覽器 fixture 使用 repo 正式 BADGE_CATALOG 圖案，取得狀態為合成資料；所有外部網路請求均攔截，未登入正式帳號。這不是實體手機或正式環境驗收。
- node build.mjs、node build-edge.mjs 與 git diff --check 通過。
- 本機 UI 重現入口 qa-theme-medal.html，驗收腳本 qa-theme-medal.mjs（均為 ignored 本機測試檔）；截圖位於專案 outputs/theme-medal。
