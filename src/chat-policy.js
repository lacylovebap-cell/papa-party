// Actor and room are verified on the server, never accepted from the form.
export function chatAccess(who,room,requestedPlayer){
 if(!who)throw Error('請先登入');
 if(who.role==='streamer_admin'&&who.streamer_id!==room.id)throw Error('只能查看自己的主播私訊');
 const manager=['admin','super_admin','streamer_admin'].includes(who.role);
 if(!manager&&who.role!=='player')throw Error('請先登入');
 if(!manager&&(!room.active||requestedPlayer&&requestedPlayer!==who.playerId))throw Error('無法查看此私訊');
 const player=manager?requestedPlayer:who.playerId;
 if(player!==undefined&&player!==null&&!/^[A-Za-z0-9_-]{1,100}$/.test(player))throw Error('玩家格式不正確');
 return {player:player||null,manager,side:manager?'manager':'player',reader:manager?(who.role==='streamer_admin'?'streamer':'super'):'player',sender:manager?(who.role==='streamer_admin'?'streamer:'+room.id:'super'):who.playerId};
}
export function cleanChatMessage(body,clientId){
 if(typeof body!=='string'||!body.trim()||body.trim().length>2000)throw Error('請輸入 1～2,000 字的訊息');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clientId||''))throw Error('訊息編號不正確，請重新開啟私訊');
 return {body:body.trim(),clientId};
}
export function chatCursor(value){if(value===undefined||value===null)return null;if(!/^\d{1,15}$/.test(String(value))||Number(value)<1)throw Error('訊息頁碼不正確');return Number(value);}
