import {chatAccess,cleanChatMessage,chatCursor} from '../../../src/chat-policy.js';
// Bundled with index.ts; uses its authenticated actor, api, scopeState and push worker.
// Only the requested player (or the visible inbox page) is needed here. In
// particular, a four-second chat refresh must never load every song/lyric via
// papa_v2_snapshot merely to resolve player names.
async function chatPlayers(ids:string[]){
 const unique=[...new Set(ids.filter(id=>/^[A-Za-z0-9_-]{1,100}$/.test(id)))];
 if(!unique.length)return new Map();
 const rows=await api('/rest/v1/papa_v2_entities?kind=eq.players&id=in.('+unique.join(',')+')&select=id,name:data->>name');
 return new Map(rows.map((row:any)=>[row.id,{name:row.name}]));
}
async function chatOperation(b:any,who:any,s:any){
 const room=scopeState(s,b.streamer||'papa').currentStreamer,a=chatAccess(who,room,b.playerId);
 if(b.op==='chatInbox'){
  const rows=await api('/rest/v1/rpc/papa_chat_inbox',{room:room.id,owner_player:a.manager?null:a.player,reader_key:a.reader,page_number:Math.max(0,Math.min(100000,Math.floor(Number(b.page)||0)))});
  const visible=rows.slice(0,50),players=await chatPlayers([...visible.map((r:any)=>r.player_id),...(a.player?[a.player]:[])]);
  if(a.player&&!players.has(a.player))throw Error('找不到玩家');
  return {rows:visible.map((r:any)=>({...r,player_name:players.get(r.player_id)?.name||'玩家'})),hasMore:rows.length>50};
 }
 const player=a.player?(await chatPlayers([a.player])).get(a.player):null;
 if(a.player&&!player)throw Error('找不到玩家');
 if(!player)throw Error('請選擇玩家');
 const filter='streamer_id=eq.'+encodeURIComponent(room.id)+'&player_id=eq.'+encodeURIComponent(a.player);
 if(b.op==='chatMessages'){
  const before=chatCursor(b.before),after=b.after===0?0:chatCursor(b.after);
  if(before!==null&&after!==null)throw Error('請選擇單一訊息讀取方向');
  const incremental=after!==null,rows=await api('/rest/v1/papa_chat_messages?'+filter+(incremental?'&seq=gt.'+after:before?'&seq=lt.'+before:'')+'&select=id,seq,sender_side,body,created_at&order=seq.'+(incremental?'asc':'desc')+'&limit=51');
  const receipts=await api('/rest/v1/papa_chat_reads?'+filter+'&select=reader,last_seq');
  const recipientRead=Math.max(0,...receipts.filter((r:any)=>a.manager?r.reader==='player':r.reader!=='player').map((r:any)=>Number(r.last_seq)));
  const visible=rows.slice(0,50);
  return {rows:incremental?visible:visible.reverse(),hasMore:rows.length>50,recipientRead,playerName:player.name,streamerName:room.display_name};
 }
 if(b.op==='chatRead'){await api('/rest/v1/rpc/papa_chat_read',{room:room.id,player:a.player,reader_key:a.reader,through_seq:chatCursor(b.through)});return {ok:true};}
 if(b.op==='chatSend'){
  const m=cleanChatMessage(b.body,b.clientId);
  const row=await api('/rest/v1/rpc/papa_chat_send',{room:room.id,player:a.player,side:a.side,sender:a.sender,content:m.body,request_id:m.clientId,room_name:room.display_name,player_name:player.name});
  schedulePush(room.id,[a.manager?a.player:'__admin__']);return {id:row.id,seq:row.seq};
 }
 throw Error('未知私訊操作');
}
