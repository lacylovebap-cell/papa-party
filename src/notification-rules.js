export const NOTICE_TYPES={
 live:['玩家現點',2],saved:['玩家提歌',2],cancel:['取消點歌／提歌',2],ready:['準備好了／即將演唱',2],accepted:['提歌成功／禮物已確認',2],completed:['完成演唱',1],credit:['存歌異動',1],status:['操作狀態修改',1],failed:['提歌額度已滿',1],message:['私人訊息',2],comment:['公開留言／回覆',1],announcement:['公告',1],achievement:['取得勳章',1],system:['系統異常',2],delivery:['推播傳送失敗',1]
};
export function cleanNoticePrefs(input={}){const v={muteAll:input.muteAll===true,muteSound:input.muteSound===true,pushEnabled:input.pushEnabled===true,types:{}};for(const [type,[,level]] of Object.entries(NOTICE_TYPES)){const src=input.types?.[type]||{};v.types[type]=Object.fromEntries(['center','popup','sound','push','badge'].map(k=>[k,typeof src[k]==='boolean'?src[k]:['center','badge'].includes(k)||level===2]));}return v;}
export function noticeChannels(prefs,type){const p=cleanNoticePrefs(prefs),v={...(p.types[type]||p.types.system)};v.sound=v.sound&&!p.muteSound&&!p.muteAll;v.popup=v.popup&&!p.muteAll;v.push=v.push&&p.pushEnabled&&!p.muteAll;return v;}
// Only business differences produce notifications. Ordering, timestamps and migration
// backfills cannot replay old requests. Personal operation feedback remains a toast.
export function deriveNotices(before,after,context,t=new Date().toISOString()){
 const roomId=context.streamer_id,room=after.streamers?.find(x=>x.id===roomId);if(!room)return [];
 const name=room.display_name||room.home_title||'主播',rows=[];
 const add=(recipient,type,text,entityId)=>{if(!recipient)return;rows.push({id:crypto.randomUUID(),streamer_id:roomId,streamer_name:name,recipient,type,level:NOTICE_TYPES[type][1],body:`${name}｜${text}`,entity_id:entityId,created_at:t});};
 const prior=new Map(before.queue.filter(q=>q.streamer_id===roomId).map(q=>[q.id,q]));
 for(const q of after.queue.filter(q=>q.streamer_id===roomId)){
  const old=prior.get(q.id),title=`《${q.title||'歌曲'}》`,player=after.players.find(p=>p.playerId===q.playerId)?.name||'玩家';
  if(!old){if(context.role==='player')add('__admin__',q.kind==='saved'?'saved':'live',`${player}${q.kind==='saved'?'提出存歌':'現點'}${title}`,q.id);if(q.kind==='saved'&&q.status==='waiting')add(q.playerId,'accepted',`${title}提歌成功，已加入待播`,q.id);continue;}
  if(old.status!==q.status){
   if(q.status==='cancelled'){add(context.role==='player'?'__admin__':q.playerId,'cancel',`${player}的${title}已取消`,q.id);}
   else if(q.status==='completed')add(q.playerId,'completed',`${title}已完成演唱`,q.id);
   else if(q.status==='stored')add(q.playerId,'status',`${title}已轉為存歌`,q.id);
   else if(q.status==='waiting')add(q.playerId,'accepted',`${title}已確認，加入待播`,q.id);
  }
  if(q.status==='waiting'&&(old.stage!==q.stage||old.preparationMinutes!==q.preparationMinutes))add(q.playerId,q.preparationMinutes===0||q.stage==='✨ 準備上台'?'ready':'status',q.preparationMinutes===0?`${title}準備好了，即將演唱`:`${title}：${q.stage}，準備約 ${q.preparationMinutes??5} 分鐘`,q.id);
 }
 const oldLedger=new Map(before.ledger.filter(x=>x.streamer_id===roomId).map(x=>[x.id,x]));
 for(const x of after.ledger.filter(x=>x.streamer_id===roomId)){const old=oldLedger.get(x.id);if(!old||old.amount!==x.amount){const delta=Number(x.amount)-Number(old?.amount||0);add(x.playerId,'credit',`${delta>=0?'新增':'扣除'} ${Math.abs(delta)} 首存歌${x.openingBalance?'（初始存歌）':''}`,x.id);}else if(old.note!==x.note||old.at!==x.at)add(x.playerId,'credit','存歌紀錄已修改',x.id);oldLedger.delete(x.id);}
 for(const x of oldLedger.values())add(x.playerId,'credit','存歌明細已移除，請查看最新餘額',x.id);
 return rows;
}
export function validPushSubscription(s){try{const u=new URL(s?.endpoint);return u.protocol==='https:'&&u.port===''&&!u.username&&!u.password&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))&&/^[A-Za-z0-9_-]{87}$/.test(s.keys?.p256dh||'')&&/^[A-Za-z0-9_-]{22}$/.test(s.keys?.auth||'');}catch{return false;}}
