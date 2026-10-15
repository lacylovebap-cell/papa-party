import fs from 'node:fs/promises';
import path from 'node:path';
import {badgeFactsFromState,stockBadgeCandidates} from '../supabase/functions/party-api/badge-state.js';
import {evaluateBadgeRules} from '../supabase/functions/party-api/badge-rules.js';

// Converts an authorized SQL Editor export into a reviewable, revision-guarded
// replay. No API key is needed and no private source facts are printed.
const input=process.argv[2];if(!input)throw Error('Pass the badge snapshot JSON/CSV export path.');
const text=await fs.readFile(input,'utf8');
function csv(source){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<source.length;i++){const c=source[i];
  if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(cell);cell='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 row.push(cell);if(row.some(Boolean))rows.push(row);return rows;
}
let payload;try{payload=JSON.parse(text);}catch{const rows=csv(text);payload=JSON.parse(rows[1][0]);}
if(Array.isArray(payload))payload=payload[0]?.payload??payload[0]?.snapshot??payload[0];
if(payload.payload)payload=typeof payload.payload==='string'?JSON.parse(payload.payload):payload.payload;
if(!Array.isArray(payload.rooms))throw Error('Snapshot rooms are missing.');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'",sql=[],summary=[];
for(const roomState of payload.rooms){
 const {spaceId,streamerId,revision,asOf}=roomState;
 if(!spaceId||!streamerId||!Number.isSafeInteger(revision)||revision<0||!Number.isFinite(Date.parse(asOf)))throw Error('Snapshot metadata is invalid.');
 const {facts,players}=badgeFactsFromState(roomState,spaceId,streamerId),selected=[...players].sort(),stock=stockBadgeCandidates(roomState,spaceId,streamerId,asOf);
 let active=0;
 for(let offset=0;offset<selected.length;offset+=25){
  const batch=selected.slice(offset,offset+25),changes=[];
  for(const player of batch){
   changes.push(...evaluateBadgeRules({facts,player,room:spaceId+'/'+streamerId,asOf})
    .filter(row=>row.scope==='streamer'&&!row.id.startsWith('L')&&!['R05','R06','R07','R08'].includes(row.id)).map(row=>({...row,playerId:player})),
    ...stock.filter(row=>row.playerId===player));
  }
  active+=changes.filter(row=>row.active).length;
  sql.push("begin;\nset local lock_timeout='3s';\nset local statement_timeout='15s';\nselect public.papa_badge_replay_apply("+
   [quote(spaceId),quote(streamerId),String(revision),quote(JSON.stringify(batch))+'::jsonb',quote(JSON.stringify(changes))+'::jsonb'].join(',')+");\ncommit;");
 }
 summary.push({spaceId,streamerId,revision,players:selected.length,activeRoomCandidates:active,
  completedWithoutTitle:roomState.queue.filter(q=>q.status==='completed'&&!q.title&&!q.items?.some(i=>i.title)).length,
  completedWithoutTagSnapshot:roomState.queue.filter(q=>q.status==='completed'&&!q.achievement_tags&&!q.items?.some(i=>i.achievement_tags)).length});
}
await fs.mkdir('.badge-replay',{recursive:true});
await fs.writeFile(path.resolve('.badge-replay/replay-plan.sql'),sql.join('\n\n')+'\n');
await fs.writeFile(path.resolve('.badge-replay/replay-summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({rooms:summary.length,batches:sql.length,players:summary.reduce((n,r)=>n+r.players,0),activeRoomCandidates:summary.reduce((n,r)=>n+r.activeRoomCandidates,0)}));
