# PA Party 共同曲庫：已關聯歌曲誤回待審與低流量審核

檢查日期：2026-11-05（臺灣時間）。
狀態：僅調查與隔離分支 UI 小幅修正；**尚未部署正式網站，尚未修改正式 Supabase schema／資料**。

## 使用者確認的行為

- 主播「從共同曲庫選歌」後，正確行為為新增主播本地歌曲，並直接連到既有 `family / variant`。**不應重新經過疑似重複審核**。
- 主播自行輸入未知歌曲才進待審候選。
- 在「疑似重複」群組，移除群組上方重複的「關聯既有共同版本」；保留每個來源下方的「關聯既有共同歌曲／版本」。
- 群組中直接顯示對照。若要對照**已確認共同版本**，必須由原有權限受控的後端 API 一次批量回傳精簡建議，不可對每列獨立請求，也不能把待審來源誤稱為已確認歌曲。
- 「單筆待審」現有可選取後批次 `approve_new`，每次至多 50 筆，**不要重做**。
- 「疑似重複」建議預設加入安全且無歧義的審核操作；版本不明或不一致須保留人工確認。提交後只刷新一次清單，不要每一批都重抓。

## 唯讀查核的具體發現

1. `papa_catalog_batch_add` 先建立 `papa_v2_entities`，再插入 `papa_catalog_song_links` 及 `papa_catalog_lyric_selections`，隨後將候選 `status='approved'`。正常匯入直接關聯的邏輯已存在。
2. `papa_catalog_index_song` 是 `papa_v2_entities` 的 AFTER INSERT OR UPDATE trigger。當候選來源 hash 改變，會把既有候選狀態重設為 `pending`。
3. `papa_catalog_reconcile_songs` 也使用同一 `source_hash <> excluded.source_hash => pending` 規則；排查時不可只修其中一個。
4. `papa_catalog_source_hash` 包括 `streamer_id/songId/title/artist/cat/artistType/version`。不包括 `tags/lyrics/creditCost/murmur` 等主播私人欄位。
5. `papa_catalog_review_rows` 只過濾 `c.status='pending'`、與歌曲當前 hash 相同的候選，即使存在舊 `song_links` 仍可能出現在待審。
6. 2026-11-05 連續唯讀檢查曾見 5 筆 `pending` 且有 `song_links`，後續查詢為 3 筆，正式資料仍在動態變化。至少一筆可由 `papa_catalog_audit.action='batch_add'` 追溯來源，且現行歌手欄位與關聯版本的歌手不同。
7. 請求數與 JSON 大小不能直接視為 Supabase Egress 的精確節省幅度，須量測實際網路 bytes。

## 安全修復建議（待實作與回歸測試）

- 在「從共同曲庫選歌」路徑驗證：交易完成後即有精確 `variant_id` 連結，候選已通過、`source_hash` 對齊；重新整理／候選掃描都不會將未變更的歌列入待審。
- 已關聯且來源 hash 發生變動，應區分：
  - 只有私有欄位更新：不撤銷連結、不重送審（現行 hash 已排除這些欄位）。
  - 正規化後仍同作品同版本的格式／別名修正：評估在交易內保持來源 hash 與連結一致，且留下審計痕跡；必須有嚴格欄位驗證。
  - 真正變更作品／歌手／版本或無法確認：顯示「既有關聯內容變更，待確認保留原關聯／另建版本／取消關聯」，**不要當成未關聯的新歌直接合併**，也不能悄悄隱藏問題。
- 必須保護目前的 `source_hash`、原歌本、私有歌詞、修改權限、來源版本檢查、跨主播隔離、來源審計。
- 後端變更之前先補 PGlite 回歸：`batch_add` 後立即候選掃描、新增與更新私人欄位、多次導入幂等、核心欄位修改、跨主播與不同版本、舊 hash 連結、審核途中併發。
- 本次分支只有「移除多餘上方關聯按鈕」和「顯示群組**待審來源**的就地摘要」；**尚未**做「已確認共同歌曲候選預覽」、預設批次審核或上述後端修復。不得提前宣稱完成。

## 整合注意

主要前端檔案 `src/app.js` 可能與其他正在運行的 Cloud 工作衝突。此分支不得直接 merge／deploy；先以現行 main 為準完成衝突檢查、測試，再由單一部署者發布。
