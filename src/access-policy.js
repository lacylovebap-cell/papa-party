export const isSuper=who=>['admin','super_admin'].includes(who?.role);
export const isManager=who=>isSuper(who)||who?.role==='streamer_admin';
export const coreActor=who=>isManager(who)?{...who,role:'admin'}:who;
export function requireRoom(who,room){if(who?.role==='streamer_admin'&&who.streamer_id!==room)throw Error('只能管理自己的主播空間');}
export function authorizeManagerOperation(who,body,room){
 requireRoom(who,room);if(isSuper(who))return;
 if(who?.role!=='streamer_admin')throw Error('請先登入管理');
 if(['read','events','upload'].includes(body.op))return;
 if(body.op==='import'&&['songs','crowns'].includes(body.kind))return;
 if(body.op==='mutate'&&['song','songsBulk','restoreSongEdits','tag','crown','card','wishAdmin','ledger','allocate','allocateStored','queue','queueBulkDelete','onBehalf','settings','recordTime'].includes(body.action?.type)){
  if(body.action.type==='recordTime'&&body.action.data?.table==='players')throw Error('玩家共用資料由總管理修改');return;
 }
 throw Error('此操作僅限總管理');
}
export function managementView(view,who){
 if(who?.role!=='streamer_admin')return view;
 requireRoom(who,view.currentStreamer.id);
 return {...view,players:view.players.map(({playerId,name,ids,names,certification,test})=>({playerId,name,ids,names,certification,test})),streamers:[view.currentStreamer],migrationIssues:[],streamerSettings:undefined};
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
