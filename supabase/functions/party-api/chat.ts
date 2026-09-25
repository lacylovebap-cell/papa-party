import {chatAccess,cleanChatMessage,chatCursor} from '../../../src/chat-policy.js';
// Bundled with index.ts; uses its authenticated actor, api, scopeState and push worker.
async function chatOperation(b:any,who:any,s:any){
 const room=scopeState(s,b.streamer||'papa').currentStreamer,a=chatAccess(who,room,b.playerId);
 const player=a.player?s.players.find((p:any)=>p.playerId===a.player):null;
 if(a.player&&!player)throw Error('找不到玩家');
 if(b.op==='chatInbox'){
  const rows=await api('/rest/v1/rpc/papa_chat_inbox',{room:room.id,owner_player:a.manager?null:a.player,reader_key:a.reader,page_number:Math.max(0,Math.min(100000,Math.floor(Number(b.page)||0)))});
  return {rows:rows.slice(0,50).map((r:any)=>({...r,player_name:s.players.find((p:any)=>p.playerId===r.player_id)?.name||'玩家'})),hasMore:rows.length>50};
 }
 if(!player)throw Error('請選擇玩家');
 const filter='streamer_id=eq.'+encodeURIComponent(room.id)+'&player_id=eq.'+encodeURIComponent(a.player);
 if(b.op==='chatMessages'){
  const before=chatCursor(b.before),rows=await api('/rest/v1/papa_chat_messages?'+filter+(before?'&seq=lt.'+before:'')+'&select=id,seq,sender_side,body,created_at&order=seq.desc&limit=51');
  const receipts=await api('/rest/v1/papa_chat_reads?'+filter);
  const recipientRead=Math.max(0,...receipts.filter((r:any)=>a.manager?r.reader==='player':r.reader!=='player').map((r:any)=>Number(r.last_seq)));
  return {rows:rows.slice(0,50).reverse(),hasMore:rows.length>50,recipientRead,playerName:player.name,streamerName:room.display_name};
 }
 if(b.op==='chatRead'){await api('/rest/v1/rpc/papa_chat_read',{room:room.id,player:a.player,reader_key:a.reader,through_seq:chatCursor(b.through)});return {ok:true};}
 if(b.op==='chatSend'){
  const m=cleanChatMessage(b.body,b.clientId);
  const row=await api('/rest/v1/rpc/papa_chat_send',{room:room.id,player:a.player,side:a.side,sender:a.sender,content:m.body,request_id:m.clientId,room_name:room.display_name,player_name:player.name});
  schedulePush(room.id,[a.manager?a.player:'__admin__']);return {id:row.id,seq:row.seq};
 }
 throw Error('未知私訊操作');
}
