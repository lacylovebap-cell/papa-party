// Display planning uses only the room data already authorized and loaded by Web.
export function noticeTargetMatchesRoom(target,{spaceId,roomId,streamerSlug}){
 return !!target&&target.streamerSlug===streamerSlug&&(!target.spaceId||target.spaceId===spaceId)&&(!target.streamerId||target.streamerId===roomId);
}
export function planNotificationLanding(target,{kind,queue=[],ledger=[],wishes=[],playerId,management=false,roomId,currentPool,ledgerPool=()=>currentPool,timeValue=Date.parse,historyOrder='newest',pageSize=10}){
 const visible=row=>(!row.streamer_id||row.streamer_id===roomId)&&(management||!!playerId&&row.playerId===playerId);
 if(kind==='queue'){
  const rows=queue.filter(visible),row=rows.find(item=>item.id===target.entityId);
  if(!row)return {kind,found:false,history:true,pageKey:'queue-history',page:1};
  const history=!['waiting','pending'].includes(row.status);
  const shown=rows.filter(item=>(!['waiting','pending'].includes(item.status))===history);
  if(history)shown.sort((a,b)=>(historyOrder==='oldest'?1:-1)*(timeValue(a.effective_at||a.completedAt||a.at)-timeValue(b.effective_at||b.completedAt||b.at)));
  return {kind,found:true,id:row.id,history,pageKey:history?'queue-history':'queue',page:Math.floor(shown.indexOf(row)/pageSize)+1};
 }
 if(kind==='credit'){
  const rows=ledger.filter(visible),row=rows.find(item=>item.id===target.entityId);
  if(!row)return {kind,found:false,pageKey:'ledger',page:1};
  const shown=rows.filter(item=>ledgerPool(item)===currentPool).sort((a,b)=>(timeValue(b.at)||0)-(timeValue(a.at)||0));
  const index=shown.indexOf(row);
  return {kind,found:true,id:row.id,pageKey:'ledger',page:index<0?1:Math.floor(index/pageSize)+1,detail:index<0,row};
 }
 if(kind==='wish'){
  const rows=wishes.filter(visible),row=rows.find(item=>item.id===target.entityId);
  return {kind,found:!!row,...(row?{id:row.id}:{}),pageKey:'wishes',page:row?Math.floor(rows.indexOf(row)/pageSize)+1:1};
 }
 return {kind:kind||'generic',found:false};
}
