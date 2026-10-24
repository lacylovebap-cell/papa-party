# PA Party｜Windows 本機事件備份追查與 Google Drive 接線指南

> 目的：查找 **2026-10-22～23** 後可能保留在 Windows 電腦的 256,876 筆備份；本指南無任何刪除指令。
> 本指南不是「已找到歷史檔」的證據。只有找到完整資料檔與原始核對報告才能確認備份存在。

## 1. 第一個搜索位置

舊工具 \`pa_party_local_archive_toolkit.zip\` **本身只是程式，不是 256,876 筆備份內容**。曾規劃將正式資料匯出到當時 Codex 使用者電腦的 **Downloads**。

在當時執行 Codex 的 Windows 電腦開 PowerShell，執行下列**唯讀**命令，列出常見資料夾內名稱含關鍵字的備份候選：

\`\`\`powershell
$roots = @("$env:USERPROFILE\Downloads","$env:USERPROFILE\Documents","$env:USERPROFILE\Desktop")
$terms = 'papa|archive|event|backup|256876|manifest|sha256'
Get-ChildItem -Path $roots -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match $terms } |
  Select-Object FullName,Length,LastWriteTime |
  Sort-Object LastWriteTime -Descending |
  Format-Table -AutoSize
\`\`\`

如當時以 \`Administrator\` 執行 Codex，也應先查核：

\`C:\Users\Administrator\Downloads\`

以及 \`C:\Users\Administrator\Documents\Codex\`

**不可以只找 ZIP。** 真正匯出資料可能是 \`.jsonl\`、\`.jsonl.gz\`、\`.ndjson\`、\`.csv\`、\`.sql\`、\`.dump\` 或帶有校驗 manifest 的分片資料夾。找到候選後，先記錄時間、位元組數及檔名，不要移動、覆蓋或刪除。

## 2. 資料格式與本機驗證

這個分支提供 \`tools/archive/inspect-jsonl.mjs\`，只支援標準一行一筆完整事件物件的 \`.jsonl\` 或 \`.jsonl.gz\`；它不是通用 SQL dump/ZIP 的讀取器。要先根據找到的真正備份格式選擇對應校驗方式。

\`\`\`powershell
node tools/archive/inspect-jsonl.mjs --file "C:\path\papa_events.jsonl.gz" --expected-rows 256876 --manifest-output "C:\path\papa_events.inspect-manifest.json"
\`\`\`

\`--expected-rows 256876\` 只適用於**原始 Codex 匯出報告確定是 256876 筆**的情況；PostgreSQL 的累計刪除計數本身不足以證明應有的匯出筆數。若有原始 SHA-256，再加 \`--expected-sha256 64位雜湊\`。

工具查核：完整 18 個原始欄位、每行有效 JSON、無重複事件 ID、檔案 SHA-256、事件 ID 順序摘要；會在 manifest 明確標記「是否已取得資料庫原始來源核對」及「是否已在隔離庫做完整還原測試」。只有通過這兩層核對才可宣稱無損備份。

## 3. 加密檔案

\`\`\`powershell
# 事先將很長的密碼從 Windows 安全密碼管理器設定為 PA_ARCHIVE_PASSPHRASE，
# 不要寫在腳本、命令列參數、GitHub、聊天或 Google Drive 備份資料夾。
node tools/archive/archive-crypt.mjs encrypt "C:\path\papa_events.jsonl.gz" "C:\path\papa_events.jsonl.gz.enc"

# 還原測試：把密文解密到另一個檔案，再重跑完整 JSONL 檢查。
node tools/archive/archive-crypt.mjs decrypt "C:\path\papa_events.jsonl.gz.enc" "C:\path\test-recovered.jsonl.gz"
\`\`\`

密碼必須另有安全備份；遺失密碼時，Google Drive 裡的加密檔也無法還原。至少保存另一份獨立加密副本。

## 4. Google Drive 自動上傳權限不是 ChatGPT OAuth

- ChatGPT Google Drive Plugin：使用者在 ChatGPT 設定內授權，用於對話中的搜尋、讀取。
- PA Party 自動備份：需要由使用者為網站端備份程式另設 Google OAuth 2.0（建議 \`drive.file\` 最小權限）、啟用 Google Drive API、取得可更新的 refresh token。
- Drive 目標必須是 **同一個 OAuth App 可存取的私人資料夾**（例如由同一 App 建立，或透過 Google Picker 明確開放）。不要將資料夾設為所有人可存取。
- \`GOOGLE_CLIENT_ID\`、\`GOOGLE_CLIENT_SECRET\`、\`GOOGLE_REFRESH_TOKEN\` 只能存於可信伺服器／執行環境 Secrets；不可存於前端 JavaScript、公開 GitHub、資料庫普通欄位或聊天。
- 使用者已有付費 Google Drive 空間，不代表 Google Drive API OAuth 會自動設定完成。

上傳前先執行不接觸網路的 dry run：

\`\`\`powershell
node tools/archive/upload-drive.mjs --file "C:\path\papa_events.jsonl.gz.enc" --folder-id "<Google私人資料夾ID>"
\`\`\`

設定 OAuth Secrets 後加上 \`--upload\` 才會嘗試真正上傳：

\`\`\`powershell
node tools/archive/upload-drive.mjs --file "C:\path\papa_events.jsonl.gz.enc" --folder-id "<Google私人資料夾ID>" --upload
\`\`\`

上傳程式避免覆蓋同名不同內容檔案；上傳後回讀 Drive 檔案長度與 MD5，並回報本機 SHA-256。**但它不能代替完整還原驗證，也不能把僅有壓縮工具的 ZIP 變出消失的舊資料。**

## 5. 自動封存與網站歷史查詢的下一個階段

使用者的目標是「原本官網不變、仍可看勳章與點歌歷史、不要增加月費」。因此目前僅提供**獨立校驗、加密、Drive 上傳**的基本能力。

仍需開發及以測試資料驗證：
- 事件增量讀取、固定 ID checkpoint、冪等分片、輪替月封存及自動排程。
- 專屬 Drive OAuth 授權回呼與安全 token 管理。
- 冷熱資料查詢服務，依 Space/Streamer/Player、總裁/廳主/玩家權限分離。
- 勳章 \`source_event_id\` 對應、\`papa_badge_progress\`、\`papa_medal_evidence_page\`、帳務與點歌歷史等回歸測試。
- 每月封存完整性檢查、Drive 恢復演練、80% 資料庫使用警報。

**正式資料移除預設永遠關閉，直到完成授權、備份、隔離還原與跨冷熱查詢測試，且逐筆 ID 範圍取得批准。**
