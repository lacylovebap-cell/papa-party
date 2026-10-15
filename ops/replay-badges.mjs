import fs from 'node:fs/promises';
import path from 'node:path';
import {badgeFactsFromState,stockBadgeCandidates} from '../supabase/functions/party-api/badge-state.js';
import {evaluateBadgeRules} from '../supabase/functions/party-api/badge-rules.js';

// Deployment worker only. No credentials are written to files or logged.
const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,apply=process.argv.includes('--apply');
if(!base||!key)throw Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the worker environment.');
const root=path.resolve('.badge-replay');await fs.mkdir(root,{recursive:true});
async function rpc(name,body={}){
 const response=await fetch(base.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',
  headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw Error(name+': '+(result.code||response.status)+' '+(result.message||'Request failed'));
 return result;
}
const rooms=await rpc('papa_badge_replay_rooms'),summary=[];
for(const {spaceId,streamerId} of rooms){
 const cacheFile=path.join(root,encodeURIComponent(spaceId+'_'+streamerId)+'.json');
 let cached;try{cached=JSON.parse(await fs.readFile(cacheFile,'utf8'));}catch{}
 if(!cached){
  cached={spaceId,streamerId,asOf:new Date().toISOString(),revision:null,queue:[],ledger:[],players:[],applied:[]};
  for(const kind of ['queue','ledger','players']){
   let cursor='';
   do{
    const page=await rpc('papa_badge_replay_page',{s:spaceId,r:streamerId,k:kind,cursor_id:cursor,expected_revision:cached.revision});
    if(cached.revision!==null&&cached.revision!==page.revision)throw Error('Source revision changed. Refresh the affected room cache before replay.');
    cached.revision=page.revision;cached[kind].push(...page.rows.map(row=>row.data));cursor=page.nextCursor;
   }while(cursor);
  }
  await fs.writeFile(cacheFile,JSON.stringify(cached));
 }
 const {facts,players}=badgeFactsFromState(cached,spaceId,streamerId),playerIds=[...players].sort(),room=spaceId+'/'+streamerId;
 const stock=stockBadgeCandidates(cached,spaceId,streamerId,cached.asOf);
 let count=0;
 for(let offset=0;offset<playerIds.length;offset+=25){
  const selected=playerIds.slice(offset,offset+25),changes=[];
  for(const player of selected){
   changes.push(...evaluateBadgeRules({facts,player,room,asOf:cached.asOf})
    .filter(row=>row.scope==='streamer'&&!row.id.startsWith('L')&&!['R05','R06','R07','R08'].includes(row.id))
    .map(row=>({...row,playerId:player})));
   changes.push(...stock.filter(row=>row.playerId===player));
  }
  count+=changes.filter(row=>row.active).length;
  if(apply&&!cached.applied.includes(offset)){
   const result=await rpc('papa_badge_replay_apply',{s:spaceId,r:streamerId,expected_revision:cached.revision,players:selected,changes});
   if(!result.ok||result.revision!==cached.revision)throw Error('Replay confirmation mismatch.');
   cached.applied.push(offset);await fs.writeFile(cacheFile,JSON.stringify(cached));
  }
 }
 summary.push({spaceId,streamerId,revision:cached.revision,players:playerIds.length,activeRoomCandidates:count,mode:apply?'applied':'review'});
 console.log(JSON.stringify(summary.at(-1)));
}
await fs.writeFile(path.join(root,'summary.json'),JSON.stringify(summary,null,2));
