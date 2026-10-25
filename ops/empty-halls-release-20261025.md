# 10.25-ADMIN.2 已批准整合範圍

- 使用者明確批准更新 papa_manage_space、papa_management_detail 並驗證後部署。
- 正式已套用兩函式：建立空廳／獨立空間時負責人選填；管理詳情按 Account 分頁，每頁最多 20 個帳號，其職務不拆頁。
- 新空間保持停用，完整營運啟用仍須完成另外的租戶流程；此版未開放會員授權或跨主播登入。
- 未新增表、未搬移、未刪除或修改既有業務資料。更新前後 Space 1、職務 20、管理 Audit 10，無測試寫入正式資料。
- 正式唯讀驗證：聲瑪管理頁 4 個帳號、6 筆管理職務，page_unit=account；anon/authenticated 不能執行，service_role 可執行，兩函式固定空 search_path。
- 28 項本機隔離／前端權限測試與網站建置通過。沒有以正式帳號建立測試廳。
- 舊函式備份：empty-halls-rollback-20261025.sql；必要時還原函式與前端，保留所有建立後的資料及 Audit。
- 既存 advisor 警示：三個非本次函式 search_path 與 rls_auto_enable 執行授權；本次兩函式未列警示，未擅自修改範圍外設定。
