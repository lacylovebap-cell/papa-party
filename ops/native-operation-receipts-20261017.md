# Native Space 操作回執相容性（本機完成）

擴充既有`papa_room_operational_commit_receipted`並新增native專用、帶身分驗證的回執讀取函式，沿用原`papa_operation_receipts`及`papa_room_operational_commit`的legacy/native分派。未新增資料表、欄位、索引或帳本；未修改原commit、native actor guard或既有四參數回執查詢函式；未回填或改寫現有資料。

## 變更

- `supabase/migrations/202610170001_native_operation_receipts.sql`：CREATE OR REPLACE原wrapper，保留相同signature、global CAS、同key advisory transaction lock及service-only ACL。
- native每次送達（包含重送）在讀回執前重新呼叫既有`papa_room_native_actor_guard`，驗證Account、Membership／玩家profile、Space／Room，以及總裁權限。
- native actor_key須等於既有Edge operationProof的`SHA256(JSON.stringify([Account,role,player,managedRoom]))`，防止另一個有效Account持同key探用舊回執。以PostgreSQL核心sha256與compact `array_to_json`實作，不依賴新增extension。
- 未找到回執才呼叫原業務交易；Audit、notice、push、revision及receipt insert同成同敗。legacy key／role／回執語義保持原樣。
- `papa_native_operation_receipt(requested_room,requested_space,requested_actor,requested_operation,actor_context)`：僅service-role可執行；命中與找不到都先驗canonical native Scope、既有actor guard及actor SHA256，再返回原lookup相同的committed／revision／requestHash。舊四參數lookup的定義、ACL及語義不變。

## 本機驗證

2026-10-17最新：`node --test tests/native-operation-receipt.test.js`共**9項通過、0失敗**。前一階段另執行現有`operation-receipt-rpc.test.js`帳務回歸1項已通過，本次只重跑本批變更的測試。

新測試9項涵蓋：重送只提交一次與舊revision回應；異request hash拒絕；跨Room／Space／Account／玩家；正常玩家、主播、總裁；停權Membership、disabled Account、Space停用、總裁權限撤銷後重送拒絕；參照／notice／Audit／receipt insert失敗全回滾；legacy既有回執與資料及原函式定義保存；Unicode／引號／反斜線／換行player ID與Edge hash相容。新增兩項專測native lookup的命中及未committed回應、先commit後停權、外Account同key、正確玩家綁定與總裁撤權、anon／authenticated不可呼叫、service可呼叫但無直接讀表／actor guard權限；證明舊lookup保持原語義，必須用新RPC才能獲得native重新驗證。

全部為本機PGlite假資料。Promise並列送達驗證重入防重送，但PGlite會序列化單一執行個體的query，不能冒稱正式PostgreSQL多連線鎖競爭、實機多裝置或正式環境已驗收。

## 接線與部署界線

- 父層已在`index.ts`為native operationProof附上已驗證actor_context，lookupOperation依Space分派至新native RPC，legacy RPC／payload維持。這是底層回執依賴接線；一般native業務、managerRoom／read／requests等啟用封鎖仍保留，沒有宣稱其他Space已端到端啟用。父層另負責Edge helper契約與native handler仍拒絕的測試；本文件9項數字只指SQL層。
- migration依賴已存在的回執表與native actor guard／分派commit。正式部署前須確認現行定義及對應migration已套用，保存原wrapper函式定義和ACL。
- migration只有函式定義與ACL更新，無表重整／index build／業務UPDATE；仍有短暫DDL鎖與少量系統目錄空間成本。建議既有部署程序的lock/statement timeout。
- 回復採還原事前保存的wrapper定義／ACL及Edge版本，保留所有合法回執與業務／Audit資料；新native lookup不會自行寫資料，可先停用呼叫入口而保留函式。若已有native回執，應先關閉native新送出入口，不能以刪除回執回復。
- 未連正式資料庫、未部署、未執行容量維護或匯出私人資料。
