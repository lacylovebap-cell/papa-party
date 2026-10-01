import {boardActor,boardModerator,boardVisible,boardThreadVisible,boardProjection,boardContent,boardAudience,boardUuid,boardCanChange} from '../../../src/board-policy.js';
const BOARD_FIELDS='id,seq,scope,streamer_id,origin_room,root_id,author_key,anonymous,visibility,targets,body,deleted,version,created_at,updated_at,moderated';
async function boardOperation(b:any,who:any,s:any){
 const a=boardActor(who),room=scopeState(s,b.streamer||'papa').currentStreamer;
 if(!room.active&&a.role!=='super')throw Error('此主播暫未開放');
 if(b.op==='boardRooms')return {rooms:s.streamers.filter((r:any)=>r.active).map((r:any)=>({slug:r.slug,name:r.display_name}))};
 const scope=b.scope==='global'?'global':'streamer',roomId=scope==='global'?'__global__':room.id;
 // Most board calls are the eight-second feed refresh. Resolve only the
 // player IDs on that page; an explicit directory search is handled below.
 const players=new Map<string,any>();
 const loadPlayers=async(keys:string[])=>{
  const ids=[...new Set(keys.filter((key:string)=>key.startsWith('player:')).map((key:string)=>key.slice(7)).filter((id:string)=>/^[A-Za-z0-9_-]{1,100}$/.test(id)&&!players.has(id)))];
  if(!ids.length)return;
  const rows=await api('/rest/v1/papa_v2_entities?kind=eq.players&id=in.('+ids.join(',')+')&select=id,data');
  for(const id of ids)players.set(id,null);
  for(const row of rows)players.set(row.id,row.data);
 };
 const nameOf=(key:string)=>key==='super'?'PA Party總裁':key.startsWith('player:')?(players.get(key.slice(7))?.name||'玩家'):(s.streamers.find((r:any)=>'streamer:'+r.id===key)?.display_name||'主播');
 const validKey=(key:string)=>key.startsWith('player:')?!!players.get(key.slice(7)):s.streamers.some((r:any)=>r.active&&'streamer:'+r.id===key);
 const blocks=(await api('/rest/v1/papa_board_blocks?owner_key=eq.'+encodeURIComponent(a.key))).map((r:any)=>r.target_key);
 const getPost=async(id:string)=>{const [p]=await api('/rest/v1/papa_board_posts?id=eq.'+boardUuid(id)+'&select='+BOARD_FIELDS);if(!p||p.streamer_id!==roomId)throw Error('留言不存在或無權查看');return p;};
 const readable=async(p:any)=>{const root=p.root_id?await getPost(p.root_id):p;if(!boardThreadVisible(a,p,root,blocks))throw Error('留言不存在或無權查看');return root;};
 if(b.op==='boardDirectory'){
  const q=String(b.query||'').trim().toLowerCase();if(q.length<1||q.length>80)return {rows:[]};
  // Database-side substring search returns at most 30 names, not full player
  // profiles or the global song/lyric snapshot.
  const matches=(await api('/rest/v1/rpc/papa_board_directory',{search_text:q})).map((r:any)=>({key:'player:'+r.player_id,name:r.player_name,role:'玩家'}));
  const streamers=s.streamers.filter((r:any)=>r.active&&r.display_name.toLowerCase().includes(q)).map((r:any)=>({key:'streamer:'+r.id,name:r.display_name,role:'主播'}));
  return {rows:[...streamers,...matches].slice(0,30)};
 }
 if(b.op==='boardBlocks'){await loadPlayers(blocks);return {rows:blocks.map((key:string)=>({key,name:nameOf(key)}))};}
 if(b.op==='boardUnblock'){if(typeof b.key!=='string'||!blocks.includes(b.key))throw Error('找不到屏蔽對象');await api('/rest/v1/papa_board_blocks?owner_key=eq.'+encodeURIComponent(a.key)+'&target_key=eq.'+encodeURIComponent(b.key),undefined,'DELETE');return {ok:true};}
 if(b.op==='boardBlock'){
  // Anonymous identities cannot be inferred from a block-list entry.
  const p=await getPost(b.id);await readable(p);if(p.anonymous)throw Error('無法由匿名留言辨識或屏蔽帳號');
  if(p.author_key===a.key)throw Error('不能屏蔽自己');
  const r=await fetch(SB_URL+'/rest/v1/papa_board_blocks?on_conflict=owner_key,target_key',{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({owner_key:a.key,target_key:p.author_key})});if(!r.ok)throw Error('屏蔽儲存失敗');return {ok:true};
 }
 if(b.op==='boardList'){
  const before=chatCursor(b.before),root=b.rootId?await getPost(b.rootId):null;if(root){if(root.root_id)throw Error('請開啟原始留言');await readable(root);}
  const rows=await api('/rest/v1/papa_board_posts?streamer_id=eq.'+encodeURIComponent(roomId)+(root?'&root_id=eq.'+root.id:'&root_id=is.null')+(before?'&seq=lt.'+before:'')+'&select='+BOARD_FIELDS+'&order=seq.desc&limit=101');
  const scanned=rows.slice(0,100),visible=scanned.filter((p:any)=>boardThreadVisible(a,p,root||p,blocks));
  await loadPlayers([...visible,...(root?[root]:[])].filter((p:any)=>!p.anonymous||boardModerator(a,p)).map((p:any)=>p.author_key));
  return {rows:visible.map((p:any)=>boardProjection(a,p,nameOf(p.author_key))),root:root?boardProjection(a,root,nameOf(root.author_key)):null,next:rows.length>100?scanned.at(-1).seq:null,scannedThrough:scanned.at(-1)?.seq||null};
 }
 if(b.op==='boardCreate'){
  let root=null,audience=boardAudience(b.visibility||'public',b.targets||[]);
  if(b.rootId){root=await getPost(b.rootId);if(root.root_id||root.deleted)throw Error('此留言暫時無法回覆');await readable(root);audience={visibility:root.visibility,targets:root.targets};}
  await loadPlayers(audience.targets);
  if(audience.targets.some((key:string)=>!validKey(key)))throw Error('名單含不存在或未開放的對象');
  const payload={scope,streamer_id:roomId,origin_room:root?.origin_room||room.id,root_id:root?.id||null,author_key:a.key,anonymous:b.anonymous===true,...audience,body:boardContent(b.body),client_id:boardUuid(b.clientId)};
  const participants=root?await api('/rest/v1/rpc/papa_board_participants',{post_id:root.id}):[];
  const candidates=new Set<string>([...participants,...(audience.visibility==='include'?audience.targets:[])]);
  candidates.add(scope==='global'?'super':'streamer:'+room.id);
  const recipientBlocks=await api('/rest/v1/rpc/papa_board_recipient_blocks',{owner_keys:[...candidates]});
  const notices:any[]=[];
  for(const key of candidates){if(key===a.key)continue;
   const recipientActor=key==='super'?{key,role:'super',room:null}:key.startsWith('streamer:')?{key,role:'streamer',room:key.slice(9)}:{key,role:'player',room:null};
   const theirBlocks=recipientBlocks.filter((v:any)=>v.owner===key).map((v:any)=>v.target);
   if(!boardThreadVisible(recipientActor,payload,root||payload,theirBlocks))continue;
   const targetRoom=recipientActor.role==='streamer'?recipientActor.room:payload.origin_room,targetName=scope==='global'?'PA Party 全站留言':nameOf('streamer:'+room.id)+'留言板';
   notices.push({room:targetRoom,name:targetName,recipient:recipientActor.role==='super'?'__super__':recipientActor.role==='streamer'?'__admin__':key.slice(7),body:targetName+'｜'+(root?'留言收到新回覆':'有新的留言')});
  }
  const result=await api('/rest/v1/rpc/papa_board_create',{payload,notices});for(const n of notices)schedulePush(n.room,[n.recipient]);return result;
 }
 const p=await getPost(b.id);await readable(p);
 if(b.op==='boardChange'){
  if(!boardCanChange(a,p,b.action))throw Error(p.moderated?'此留言由管理者隱藏，請聯絡管理者恢復':'無法修改此留言');
  if(!['edit','remove','restore'].includes(b.action))throw Error('操作不正確');
  if(!Number.isInteger(b.version)||b.version<1)throw Error('請重新整理留言');
  await api('/rest/v1/rpc/papa_board_change',{post_id:p.id,expected:b.version,actor_key:a.key,operation:b.action,content:b.action==='edit'?boardContent(b.body):null});return {ok:true};
 }
 throw Error('未知留言操作');
}
