// The legacy server has no structured conflict code yet. Only recognize its
// exact revision rejection, never a timeout or a generic database failure.
export function revisionConflictFailure(status,data){
 if(!Number.isInteger(status)||status<400||!data||typeof data!=='object')return false;
 if(data.notCommitted===false||data.outcome==='unknown')return false;
 return data.code==='VERSION_CONFLICT'||data.error==='資料剛更新了，請重新整理後再試一次';
}
export function webApiFailure(status,data){
 const staleRevision=revisionConflictFailure(status,data);
 return Object.assign(Error(staleRevision?'資料剛更新，系統會自動補同步；原本內容已保留，請確認最新紀錄後再送出':data?.error||'連線失敗'),{status,code:typeof data?.code==='string'?data.code:null,staleRevision});
}
