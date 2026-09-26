// Service-side identity and visibility rules; anonymous projections never contain actor keys.
export function boardActor(who){
 if(who?.role==='player'&&who.playerId)return {key:'player:'+who.playerId,role:'player',room:null};
 if(who?.role==='streamer_admin'&&who.streamer_id)return {key:'streamer:'+who.streamer_id,role:'streamer',room:who.streamer_id};
 if(['admin','super_admin'].includes(who?.role))return {key:'super',role:'super',room:null};
 throw Error('請先登入後使用留言板');
}
export const boardModerator=(a,p)=>a.role==='super'||a.role==='streamer'&&p.scope==='streamer'&&a.room===p.streamer_id;
export function boardVisible(a,p,blocks=[]){
 if(!p)return false;
 if(boardModerator(a,p)||p.author_key===a.key)return true;
 if(blocks.includes(p.author_key))return false;
 if(p.visibility==='public')return true;
 if(p.visibility==='include')return p.targets.includes(a.key);
 if(p.visibility==='exclude')return !p.targets.includes(a.key);
 if(p.visibility==='streamers')return a.role==='streamer';
 return false;
}
export function boardThreadVisible(a,p,root,blocks=[]){return !!root&&boardVisible(a,root,blocks)&&(boardVisible(a,p,blocks)||root.author_key===a.key&&!blocks.includes(p.author_key));}
export function boardProjection(a,p,authorName){
 const owner=a.key===p.author_key,moderator=boardModerator(a,p),reveal=moderator;
 return {id:p.id,seq:p.seq,root_id:p.root_id,body:p.deleted?'':p.body,anonymous:p.anonymous,author:p.anonymous?'匿名使用者':authorName,
  ...(p.anonymous&&reveal?{managedAuthor:authorName}:{}),created_at:p.created_at,updated_at:p.updated_at,version:p.version,deleted:p.deleted,
  visibility:p.visibility,canEdit:owner,canManage:owner||moderator,canBlock:!owner&&!moderator};
}
export function boardContent(value){if(typeof value!=='string'||!value.trim()||value.trim().length>2000)throw Error('請輸入 1～2,000 字的留言');return value.trim();}
export function boardAudience(visibility,targets){
 if(!['public','include','exclude','streamers'].includes(visibility))throw Error('請選擇可見範圍');
 if(!Array.isArray(targets)||targets.length>50||targets.some(k=>typeof k!=='string'||!(/^(player|streamer):[A-Za-z0-9_-]{1,100}$/.test(k))))throw Error('對象名單格式不正確');
 const list=[...new Set(targets)];if(visibility==='include'&&!list.length)throw Error('請至少選擇一位可見對象');
 return {visibility,targets:['include','exclude'].includes(visibility)?list:[]};
}
export function boardUuid(id){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||''))throw Error('留言編號不正確');return id;}
