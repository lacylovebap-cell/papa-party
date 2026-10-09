// These pure projections accept an already scoped room. Core owns ledger writes,
// quota checks and the atomic commit; a venue is never a canonical Space ID.
function venuePolicyPool(value){
 if(!['shengma','radio'].includes(value))throw Error('場域或存歌來源不正確');
 return value;
}
function venuePolicyQuotedCost(value){
 if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(value*2)||value<0.5||value>=1000000)throw Error('提歌首數請用 0.5 的倍數');
 return value;
}
export function venuePolicySettings(settings={}){
 if(settings.radio_enabled!==undefined&&typeof settings.radio_enabled!=='boolean')throw Error('電台啟用設定不正確');
 if(settings.current_space!==undefined)venuePolicyPool(settings.current_space);
 const radio_enabled=settings.radio_enabled===true;
 return Object.freeze({radio_enabled,current_space:radio_enabled?(settings.current_space??'shengma'):'shengma'});
}
export function venuePolicyRequestVenue(room,{venue,allowOverride=false}={}){
 const settings=venuePolicySettings(room.settings);
 if(venue===undefined)return settings.current_space;
 if(allowOverride!==true)throw Error('玩家不能自行選擇場域');
 venuePolicyPool(venue);
 if(venue==='radio'&&!settings.radio_enabled)throw Error('主播尚未啟用電台');
 return venue;
}
// Unknown historical venues remain unknown, even after a streamer switches venues.
export function venuePolicyHistoryVenue(row){return row?.venue==null?null:venuePolicyPool(row.venue);}
export function venuePolicyLedgerPool(row){return venuePolicyPool(row?.storage_pool??'shengma');}
export function venuePolicyConsumedPool(queue){return venuePolicyPool(queue?.consumed_storage_pool??'shengma');}
export function venuePolicyQueueSnapshot(queue){
 const venue=venuePolicyHistoryVenue(queue),consumed_storage_pool=queue?.consumed_storage_pool==null?(queue?.kind==='saved'?'shengma':null):venuePolicyConsumedPool(queue);
 if(venue==='shengma'&&consumed_storage_pool==='radio')throw Error('聲瑪提歌不能使用電台存歌');
 return Object.freeze({venue,consumed_storage_pool});
}
export function venuePolicyBalance(room,playerId,pool='shengma'){
 venuePolicyPool(pool);
 return (room.ledger||[]).filter(row=>row.playerId===playerId&&venuePolicyLedgerPool(row)===pool).reduce((total,row)=>{
  const amount=Number(row.amount);
  if(!Number.isFinite(amount))throw Error('存歌帳目首數不正確');
  return total+amount;
 },0);
}
export function venuePolicyReservedCredits(room,playerId,pool='shengma',{excludeQueueId}={}){
 venuePolicyPool(pool);
 return (room.queue||[]).filter(queue=>queue.playerId===playerId&&queue.kind==='saved'&&['pending','waiting'].includes(queue.status)&&(excludeQueueId===undefined||queue.id!==excludeQueueId)&&venuePolicyConsumedPool(queue)===pool)
  .reduce((total,queue)=>total+venuePolicyQuotedCost(queue.creditCost??1),0);
}
export function venuePolicyAvailableCredits(room,playerId,pool='shengma',options={}){
 return venuePolicyBalance(room,playerId,pool)-venuePolicyReservedCredits(room,playerId,pool,options);
}
export function venuePolicySavedSnapshot(room,playerId,quotedCost,options={}){
 const cost=venuePolicyQuotedCost(quotedCost),venue=venuePolicyRequestVenue(room,options);
 // One request always consumes one pool; never combine two insufficient pools.
 const pools=venue==='radio'?['radio','shengma']:['shengma'];
 const consumed_storage_pool=pools.find(pool=>venuePolicyAvailableCredits(room,playerId,pool,options)>=cost);
 if(!consumed_storage_pool)throw Error('可用存歌不足，請先核對玩家餘額');
 return Object.freeze({venue,consumed_storage_pool});
}
