export const isSuper=who=>['admin','super_admin'].includes(who?.role);
export const isManager=who=>isSuper(who)||who?.role==='streamer_admin';
export const coreActor=who=>isManager(who)?{...who,role:'admin'}:who;
export function requireRoom(who,room){if(who?.role==='streamer_admin'&&who.streamer_id!==room)throw Error('只能管理自己的主播空間');}
export function authorizeManagerOperation(who,body,room){
 requireRoom(who,room);if(isSuper(who))return;
 if(who?.role!=='streamer_admin')throw Error('請先登入管理');
 if(['read','events','upload'].includes(body.op))return;
 if(body.op==='import'&&['songs','crowns'].includes(body.kind))return;
 if(body.op==='mutate'&&['player','song','songsBulk','newPracticeOrder','restoreSongEdits','tag','crown','card','wishAdmin','ledger','allocate','allocateStored','queue','queueBulkDelete','onBehalf','streamerDraw','settings','recordTime','extraQuota'].includes(body.action?.type)){
  if(body.action.type==='recordTime'&&body.action.data?.table==='players')throw Error('玩家共用資料由PA Party總裁修改');return;
 }
 throw Error('此操作僅限PA Party總裁');
}
// The core uses the shared admin role, so protected fields must come from the
// full server snapshot rather than the manager's redacted player projection.
export function prepareManagerAction(who,action,state){
 if(who?.role!=='streamer_admin'||action?.type!=='player')return action;
 const input=action.data||{},allowed=['playerId','name','ids','names','certification'];
 if(typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw Error('主播只能修改玩家名稱、平台 ID、別名與認證');
 const old=input.playerId?state.players.find(p=>p.playerId===input.playerId):null;
 if(input.playerId&&!old)throw Error('找不到玩家，請重新整理後再試');
 const data={};
 for(const key of allowed)if(Object.hasOwn(input,key))data[key]=input[key];else if(old&&Object.hasOwn(old,key))data[key]=old[key];
 // New players have no opening balance. Existing secrets and private flags
 // stay intact when the core rebuilds its legacy player row.
 data.note=old?.note??'';data.password=old?.password??'';data.test=!!old?.test;data.balance=0;
 return {...action,data};
}
export function managementView(view,who){
 if(who?.role!=='streamer_admin')return view;
 requireRoom(who,view.currentStreamer.id);
 return {...view,players:view.players.map(({playerId,name,ids,names,certification,test,quotaRights,archived})=>({playerId,name,ids,names,certification,test,quotaRights,archived:!!archived})),streamers:[view.currentStreamer],migrationIssues:[],streamerSettings:undefined};
}
export function noticeIdentity(who,room){
 requireRoom(who,room);
 if(isSuper(who))return {room:'__global__',recipient:'__super__'};
 if(who?.role==='streamer_admin')return {room,recipient:'__admin__'};
 if(who?.role==='player'&&who.playerId)return {room,recipient:who.playerId};
 throw Error('請先登入');
}
export const canReplaceSound=who=>isManager(who);
export function validNoticeAudio(data){return typeof data==='string'&&/^data:audio\/(mp4|mpeg|wav|x-wav|ogg|webm);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)&&data.length<=350000;}
