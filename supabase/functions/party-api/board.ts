import {boardActor,boardModerator,boardVisible,boardThreadVisible,boardProjection,boardContent,boardAudience,boardUuid} from '../../../src/board-policy.js';
async function boardOperation(b:any,who:any,s:any){
 const a=boardActor(who),room=scopeState(s,b.streamer||'papa').currentStreamer;
 if(!room.active&&a.role!=='super')throw Error('此主播暫未開放');
 const scope=b.scope==='global'?'global':'streamer',roomId=scope==='global'?'__global__':room.id;
 const nameOf=(key:string)=>key==='super'?'PA Party 總管理':key.startsWith('player:')?(s.players.find((p:any)=>'player:'+p.playerId===key)?.name||'玩家'):(s.streamers.find((r:any)=>'streamer:'+r.id===key)?.display_name||'主播');
 const validKey=(key:string)=>key.startsWith('player:')?s.players.some((p:any)=>'player:'+p.playerId===key):s.streamers.some((r:any)=>r.active&&'streamer:'+r.id===key);
 const blocks=(await api('/rest/v1/papa_board_blocks?owner_key=eq.'+encodeURIComponent(a.key))).map((r:any)=>r.target_key);
 const getPost=async(id:string)=>{const [p]=await api('/rest/v1/papa_board_posts?id=eq.'+boardUuid(id));if(!p||p.streamer_id!==roomId)throw Error('留言不存在或無權查看');return p;};
 const readable=async(p:any)=>{const root=p.root_id?await getPost(p.root_id):p;if(!boardThreadVisible(a,p,root,blocks))throw Error('留言不存在或無權查看');return root;};
 if(b.op==='boardDirectory'){
  const q=String(b.query||'').trim().toLowerCase();if(q.length<1||q.length>80)return {rows:[]};
  const players=s.players.filter((p:any)=>p.name.toLowerCase().includes(q)||(p.ids||[]).some((id:any)=>String(id).includes(q))).map((p:any)=>({key:'player:'+p.playerId,name:p.name,role:'玩家'}));
  const streamers=s.streamers.filter((r:any)=>r.active&&r.display_name.toLowerCase().includes(q)).map((r:any)=>({key:'streamer:'+r.id,name:r.display_name,role:'主播'}));
  return {rows:[...streamers,...players].slice(0,30)};
 }
 if(b.op==='boardBlocks')return {rows:blocks.map((key:string)=>({key,name:nameOf(key)}))};
 if(b.op==='boardUnblock'){if(typeof b.key!=='string'||!blocks.includes(b.key))throw Error('找不到屏蔽對象');await api('/rest/v1/papa_board_blocks?owner_key=eq.'+encodeURIComponent(a.key)+'&target_key=eq.'+encodeURIComponent(b.key),undefined,'DELETE');return {ok:true};}
 if(b.op==='boardBlock'){
  // Anonymous identities cannot be inferred from a block-list entry.
  const p=await getPost(b.id);await readable(p);if(p.anonymous)throw Error('無法由匿名留言辨識或屏蔽帳號');
  if(p.author_key===a.key)throw Error('不能屏蔽自己');
  const r=await fetch(SB_URL+'/rest/v1/papa_board_blocks?on_conflict=owner_key,target_key',{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({owner_key:a.key,target_key:p.author_key})});if(!r.ok)throw Error('屏蔽儲存失敗');return {ok:true};
 }
 if(b.op==='boardList'){
  const before=chatCursor(b.before),root=b.rootId?await getPost(b.rootId):null;if(root){if(root.root_id)throw Error('請開啟原始留言');await readable(root);}
  const rows=await api('/rest/v1/papa_board_posts?streamer_id=eq.'+encodeURIComponent(roomId)+(root?'&root_id=eq.'+root.id:'&root_id=is.null')+(before?'&seq=lt.'+before:'')+'&order=seq.desc&limit=101');
  const scanned=rows.slice(0,100),visible=scanned.filter((p:any)=>boardThreadVisible(a,p,root||p,blocks));
  return {rows:visible.map((p:any)=>boardProjection(a,p,nameOf(p.author_key))),root:root?boardProjection(a,root,nameOf(root.author_key)):null,next:rows.length>100?scanned.at(-1).seq:null};
 }
 if(b.op==='boardCreate'){
  let root=null,audience=boardAudience(b.visibility||'public',b.targets||[]);
  if(b.rootId){root=await getPost(b.rootId);if(root.root_id||root.deleted)throw Error('此留言暫時無法回覆');await readable(root);audience={visibility:root.visibility,targets:root.targets};}
  if(audience.targets.some((key:string)=>!validKey(key)))throw Error('名單含不存在或未開放的對象');
  const payload={scope,streamer_id:roomId,origin_room:root?.origin_room||room.id,root_id:root?.id||null,author_key:a.key,anonymous:b.anonymous===true,...audience,body:boardContent(b.body),client_id:boardUuid(b.clientId)};
  const candidates=new Set<string>(root?[root.author_key]:audience.visibility==='include'?audience.targets:[]);
  candidates.add(scope==='global'?'super':'streamer:'+room.id);
  const notices:any[]=[];
  for(const key of candidates){if(key===a.key)continue;
   const recipientActor=key==='super'?{key,role:'super',room:null}:key.startsWith('streamer:')?{key,role:'streamer',room:key.slice(9)}:{key,role:'player',room:null};
   const theirBlocks=(await api('/rest/v1/papa_board_blocks?owner_key=eq.'+encodeURIComponent(key))).map((v:any)=>v.target_key);
   if(!boardThreadVisible(recipientActor,payload,root||payload,theirBlocks))continue;
   const targetRoom=recipientActor.role==='streamer'?recipientActor.room:payload.origin_room,targetName=scope==='global'?'PA Party 全站留言':nameOf('streamer:'+room.id)+'留言板';
   notices.push({room:targetRoom,name:targetName,recipient:recipientActor.role==='super'?'__super__':recipientActor.role==='streamer'?'__admin__':key.slice(7),body:targetName+'｜'+(root?'留言收到新回覆':'有新的留言')});
  }
  const result=await api('/rest/v1/rpc/papa_board_create',{payload,notices});for(const n of notices)schedulePush(n.room,[n.recipient]);return result;
 }
 const p=await getPost(b.id);await readable(p);
 if(b.op==='boardChange'){
  if(a.key!==p.author_key&&!boardModerator(a,p)||b.action==='edit'&&a.key!==p.author_key)throw Error('無法修改此留言');
  if(!['edit','remove','restore'].includes(b.action))throw Error('操作不正確');
  if(!Number.isInteger(b.version)||b.version<1)throw Error('請重新整理留言');
  await api('/rest/v1/rpc/papa_board_change',{post_id:p.id,expected:b.version,actor_key:a.key,operation:b.action,content:b.action==='edit'?boardContent(b.body):null});return {ok:true};
 }
 throw Error('未知留言操作');
}
