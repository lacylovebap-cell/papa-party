export const NOTICE_TYPES={
 live:['玩家現點',2],saved:['玩家提歌',2],cancel:['取消點歌／提歌',2],ready:['準備好了／即將演唱',2],accepted:['提歌成功／已收到／準備時間',2],completed:['完成演唱',1],credit:['存歌異動',1],status:['操作狀態修改',1],failed:['提歌額度已滿',1],message:['私人訊息',2],comment:['公開留言／回覆',1],announcement:['公告',1],achievement:['取得勳章',1],wish:['許願收到／處理結果',2],system:['系統異常',2],delivery:['推播傳送失敗',1]
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
  if(!old){if(context.role==='player')add('__admin__',q.kind==='saved'?'saved':'live',`${player}${q.kind==='saved'?'提出存歌':'現點'}${title}`,q.id);if(q.kind==='saved'&&q.status==='waiting')add(q.playerId,'accepted',q.awaitingAcknowledgment?`${title}已收到你的提歌囉，正在等待主播回應`:`${title}提歌成功，已加入待播`,q.id);continue;}
  const preparationChanged=old.preparationStartedAt!==q.preparationStartedAt||old.stage!==q.stage||old.preparationMinutes!==q.preparationMinutes;
  if(context.role==='player'&&['ownQueueBatch','replaceOwn'].includes(context.action)&&(old.songId!==q.songId||JSON.stringify(old.items)!==JSON.stringify(q.items))){add('__admin__',q.kind==='saved'?'saved':'live',`${player}把《${old.title||'歌曲'}》更換為${title}，請重新確認`,q.id);add(q.playerId,'accepted',`${title}換歌已送出，等待主播重新確認`,q.id);}
  if(old.status!==q.status){
   if(q.status==='cancelled'){add(context.role==='player'?'__admin__':q.playerId,'cancel',`${player}的${title}已取消`,q.id);}
   else if(q.status==='completed')add(q.playerId,'completed',`${title}已完成演唱`,q.id);
   else if(q.status==='stored')add(q.playerId,'status',`${title}已轉為存歌`,q.id);
   else if(q.status==='waiting'&&!preparationChanged)add(q.playerId,'accepted',`${title}已確認，加入待播`,q.id);
  }
  if(q.status==='waiting'&&q.awaitingPreparation!==true&&preparationChanged)add(q.playerId,q.preparationMinutes===0?'ready':'accepted',q.preparationMinutes===0?`${title}準備好了，即將演唱`:`${title}已確認收到，準備約 ${q.preparationMinutes??5} 分鐘`,q.id);
 }
 const oldLedger=new Map(before.ledger.filter(x=>x.streamer_id===roomId).map(x=>[x.id,x]));
 for(const x of after.ledger.filter(x=>x.streamer_id===roomId)){const old=oldLedger.get(x.id);if(!old||old.amount!==x.amount){const delta=Number(x.amount)-Number(old?.amount||0);add(x.playerId,'credit',`${delta>=0?'新增':'扣除'} ${Math.abs(delta)} 首存歌${x.openingBalance?'（初始存歌）':''}`,x.id);}else if(old.note!==x.note||old.at!==x.at)add(x.playerId,'credit','存歌紀錄已修改',x.id);oldLedger.delete(x.id);}
 for(const x of oldLedger.values())add(x.playerId,'credit','存歌明細已移除，請查看最新餘額',x.id);
 const oldWishes=new Map((before.wishes||[]).filter(row=>row.streamer_id===roomId).map(row=>[row.id,row]));
 for(const wish of (after.wishes||[]).filter(row=>row.streamer_id===roomId)){
  const old=oldWishes.get(wish.id),title=`《${wish.title||'歌曲'}》`;
  if(!old&&context.role==='player'){add('__admin__','wish','收到玩家許願 '+title,wish.id);add(wish.playerId,'wish',title+'許願已收到，等待主播回覆',wish.id);}
  else if(old&&old.status!==wish.status)add(wish.playerId,'wish',title+'許願回覆：'+(wish.status||'收到'),wish.id);
 }
 return rows;
}
export function validPushSubscription(s){try{const u=new URL(s?.endpoint);return u.protocol==='https:'&&u.port===''&&!u.username&&!u.password&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))&&/^[A-Za-z0-9_-]{87}$/.test(s.keys?.p256dh||'')&&/^[A-Za-z0-9_-]{22}$/.test(s.keys?.auth||'');}catch{return false;}}
// Platform-neutral target. Web, Android, Desktop, and future iOS adapters may
// open the same notification without embedding a browser URL in its identity.
export function canonicalNoticeLink(notice,streamerSlug){return {
 version:1,spaceId:notice.space_id||null,streamerId:notice.streamer_id,
 streamerSlug:streamerSlug||'papa',section:['admin','center'].includes(notice.section)?notice.section:['__admin__','__super__'].includes(notice.recipient)?'admin':'center',
 entityType:notice.type||null,entityId:notice.entity_id||null,notificationId:notice.id
};}
export function webNoticePath(link){
 const pairs=[['streamer',link.streamerSlug],['streamerId',link.streamerId],['spaceId',link.spaceId],['entityType',link.entityType],['entityId',link.entityId],['notificationId',link.notificationId]];
 return './?'+pairs.filter(([,value])=>value!=null).map(([key,value])=>key+'='+encodeURIComponent(value)).join('&')+'#'+link.section;
}
