import {TABLES} from './core.js';
const stateRecordId=(kind,data)=>String(kind==='players'?data.playerId:kind==='songs'?data.songId:data.id);
const operational=new Set(['request','queue','queueBulkDelete','cancelOwn','onBehalf','streamerDraw','ledger','allocate','allocateStored','wish','wishAdmin']);
export function scopedOperationalAction(action){return !!action&&!(action.type==='wishAdmin'&&action.data?.addSong)&&(operational.has(action.type)||action.type==='recordTime'&&['queue','ledger','wishes'].includes(action.data?.table));}
const roomMutations=new Set(['song','songsBulk','newPracticeOrder','restoreSongEdits','tag','crown','card','settings','wishAdmin','player','self','extraQuota']);
export function scopedRoomMutationAction(action){return !!action&&(roomMutations.has(action.type)||action.type==='recordTime'&&TABLES.includes(action.data?.table));}
const stateMetaEntries=state=>[{kind:'settings',id:'1',data:state.settings},{kind:'meta',id:'1',data:{schemaVersion:3,streamers:state.streamers,streamerSettings:state.streamerSettings,migrationIssues:state.migrationIssues||[]}}];
export function stateEntries(state){return [...TABLES.flatMap(kind=>state[kind].map((data,index)=>({kind,id:stateRecordId(kind,data),data:{...data,_order:index}}))),
 ...stateMetaEntries(state)];}
function orderedEntries(before,after){
 const rows=[];
 for(const kind of TABLES){
  const old=new Map(before[kind].map((data,index)=>[stateRecordId(kind,data),Number.isFinite(Number(data._order))?Number(data._order):index]));
  const ids=after[kind].map(data=>stateRecordId(kind,data)),present=new Set(ids);
  const previous=before[kind].map(data=>stateRecordId(kind,data)).filter(id=>present.has(id));
  const retained=ids.filter(id=>old.has(id)),reordered=previous.some((id,index)=>id!==retained[index]);
  const weights=previous.map(id=>old.get(id));let slot=0,next=[...old.values()].reduce((max,value)=>Math.max(max,value),-1)+1;
  for(const data of after[kind]){const id=stateRecordId(kind,data),weight=old.has(id)?(reordered?weights[slot++]:old.get(id)):next++;
   rows.push({kind,id,data:{...data,_order:weight}});
  }
 }
 return [...rows,...stateMetaEntries(after)];
}
export function stateChanges(before,after,{preserveOrder=false}={}){
 const previous=preserveOrder?orderedEntries(before,before):stateEntries(before),next=preserveOrder?orderedEntries(before,after):stateEntries(after);
 const old=new Map(previous.map(row=>[row.kind+':'+row.id,row])),keys=new Set(next.map(row=>row.kind+':'+row.id));
 return {changes:next.filter(row=>JSON.stringify(old.get(row.kind+':'+row.id)?.data)!==JSON.stringify(row.data)),removed:previous.filter(row=>!keys.has(row.kind+':'+row.id)).map(({kind,id})=>({kind,id}))};
}
