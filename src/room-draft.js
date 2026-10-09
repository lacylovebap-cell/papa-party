import {TABLES,scopeState,mutate,captureMutationIds,replayMutationIds,timeValue,stamp} from './core.js?v=10.10-WEB.1';
import {applyRoomImport} from './room-import.js?v=10.10-WEB.1';
import {scopedOperationalAction,scopedRoomMutationAction} from './state-patch.js?v=10.10-WEB.1';

const MAX_DRAFT_ACTIONS=200,MAX_DRAFT_IDS=2000,MAX_DRAFT_BYTES=6*1024*1024;
const draftObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function draftRoom(state,streamer){const room=scopeState(state,streamer).currentStreamer;return {spaceId:room.spaceId||'space-001',streamerId:room.id};}
function draftAction(action,room){
 if(!draftObject(action)||!draftObject(action.data)||typeof action.type!=='string'
  ||Object.keys(action).some(key=>!['type','data','streamer'].includes(key))
  ||action.streamer&&action.streamer!==room.streamerId
  ||!scopedOperationalAction(action)&&!scopedRoomMutationAction(action))throw Error('此操作不適用目前主播草稿');
 if(action.type==='extraQuota')throw Error('專屬提歌權請在正式管理頁設定，不能放入草稿');
 if(room.spaceId!=='space-001'&&['player','self'].includes(action.type)&&Object.keys(action.data).some(key=>/password|token|secret/i.test(key)))throw Error('登入資料由帳號管理，不能寫入玩家草稿');
 return {...structuredClone(action),streamer:room.streamerId};
}
function draftTime(time,now){if(typeof time!=='string'||!Number.isFinite(timeValue(time))||stamp(timeValue(time))!==time||timeValue(time)>timeValue(now)+60000)throw Error('草稿操作時間不正確');return time;}
function draftExistingTarget(state,action,room){
 const target={song:['songs','songId'],player:['players','playerId'],crown:['crowns','id'],card:['cards','id'],ledger:['ledger','id']}[action.type];
 if(!target)return action;const [kind,key]=target,id=action.data[key];
 if(id&&!state[kind].some(row=>row[key]===id&&(kind==='players'||row.streamer_id===room.streamerId)))throw Error('紀錄不屬於目前主播或已刪除');
 return action;
}
function protectDraftLyrics(before,after,action,room){
 if(action?.type!=='song'||Object.hasOwn(action.data,'lyrics'))return after;
 const source=before.songs.find(song=>song.songId===action.data.songId&&song.streamer_id===room.streamerId);
 if(source&&!Object.hasOwn(source,'lyrics')){const song=after.songs.find(song=>song.songId===source.songId);if(song&&song.lyrics==='')delete song.lyrics;}
 return after;
}
export function createRoomDraft(state,streamer){
 if(!Number.isSafeInteger(state.revision)||state.revision<0||state.schemaVersion!==3)throw Error('請先取得正式資料');
 return {formatVersion:1,...draftRoom(state,streamer),baseRevision:state.revision,actions:[]};
}
export function validateRoomDraft(journal,room,revision){
 if(!draftObject(journal)||journal.formatVersion!==1||journal.spaceId!==room.spaceId||journal.streamerId!==room.streamerId
  ||journal.baseRevision!==revision||!Array.isArray(journal.actions)||journal.actions.length>MAX_DRAFT_ACTIONS)throw Error('草稿已過期或不屬於目前主播，請先下載備份再重新建立');
 if(JSON.stringify(journal).length>MAX_DRAFT_BYTES)throw Error('草稿資料過多，請分批處理');
 return journal;
}
function appendDraftEntry(journal,state,entry,run){
 const room=draftRoom(state,journal.streamerId);validateRoomDraft(journal,room,journal.baseRevision);
 if(journal.actions.length>=MAX_DRAFT_ACTIONS)throw Error('一次草稿最多 200 項操作');
 const {value,ids}=captureMutationIds(run),next={...journal,actions:[...journal.actions,{...entry,ids}]};
 if(next.actions.reduce((n,item)=>n+(item.ids?.length||0),0)>MAX_DRAFT_IDS)throw Error('草稿資料過多，請分批處理');
 validateRoomDraft(next,room,journal.baseRevision);return {state:value,journal:next};
}
export function recordRoomDraftAction(state,journal,action,actor,time){
 const room=draftRoom(state,journal.streamerId),prepared=draftExistingTarget(state,draftAction(action,room),room);draftTime(time,time);
 return appendDraftEntry(journal,state,{kind:'mutate',action:prepared,time},()=>protectDraftLyrics(state,mutate(state,prepared,actor,time),prepared,room));
}
export function recordRoomDraftImport(state,journal,kind,text,choices,actor,time){
 const room=draftRoom(state,journal.streamerId);draftTime(time,time);
 if(room.spaceId!=='space-001'&&kind==='players')throw Error('此空間的玩家匯入須先指定帳號與成員資格');
 return appendDraftEntry(journal,state,{kind:'import',importKind:kind,text,choices:structuredClone(choices),time},()=>applyRoomImport(state,kind,text,choices,actor,time,room.streamerId));
}
export function replayRoomDraft(state,journal,actor,now,prepareAction=action=>action){
 const room=draftRoom(state,journal?.streamerId);validateRoomDraft(journal,room,state.revision);
 const occupied=new Set(TABLES.flatMap(kind=>state[kind].flatMap(row=>[String(kind==='players'?row.playerId:kind==='songs'?row.songId:row.id),row.allocation_id].filter(Boolean))));
 let next=state,generated=0;
 for(const entry of journal.actions){
  if(!draftObject(entry)||!Array.isArray(entry.ids))throw Error('草稿操作格式錯誤');
  generated+=entry.ids.length;if(generated>MAX_DRAFT_IDS)throw Error('草稿資料過多，請分批處理');
  for(const id of entry.ids){if(occupied.has(id))throw Error('草稿識別碼與正式資料重複');occupied.add(id);}
  const time=draftTime(entry.time,now);
  if(entry.kind==='mutate'){
   const action=prepareAction(draftExistingTarget(next,draftAction(entry.action,room),room),next,room.streamerId),before=next;
   next=replayMutationIds(entry.ids,()=>protectDraftLyrics(before,mutate(before,{...action,streamer:room.streamerId},actor,time),action,room));
  }else if(entry.kind==='import'){
   if(room.spaceId!=='space-001'&&entry.importKind==='players')throw Error('此空間的玩家匯入須先指定帳號與成員資格');
   next=replayMutationIds(entry.ids,()=>applyRoomImport(next,entry.importKind,entry.text,entry.choices,actor,time,room.streamerId));
  }else throw Error('草稿操作格式錯誤');
 }
 return next;
}
