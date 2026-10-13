import * as bulk from '../src/player-bulk-tools.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {accountingDay} from '../src/accounting.js';
import * as core from '../src/core.js';
import * as access from '../src/access-policy.js';
import * as patch from '../src/state-patch.js';
import * as rules from '../src/notification-rules.js';

const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
const catalog=fs.readFileSync(new URL('../supabase/functions/party-api/catalog.ts',import.meta.url),'utf8');
const roomStart=catalog.indexOf('async function catalogRoom('),roomEnd=catalog.indexOf('\n}',roomStart)+2;
const roomCode=stripTypeScriptTypes(catalog.slice(roomStart,roomEnd));
const operationId='11111111-1111-4111-8111-111111111111',at='2026-10-13T12:00:00Z';
const action={type:'queue',data:{id:'q1',operation:'complete'}};
function fixture(outcome='success'){
 let handler,attempts=0,writes=0,pushes=0,expired=false;const requests=[],receipts=new Map();
 let state=core.mutate(core.empty(),{streamer:'papa',type:'player',data:{name:'Seed'}},{role:'admin'},at);state.revision=7;
 state.players=[{playerId:'P1',name:'Isolated',ids:[],names:[],password:''}];
 state.songs=[{songId:'s1',streamer_id:'papa',title:'Song',artist:'Artist',tags:[],creditCost:1}];
 state.ledger=[{id:'l1',playerId:'P1',streamer_id:'papa',amount:3,at}];
 state.queue=[{id:'q1',playerId:'P1',streamer_id:'papa',songId:'s1',title:'Song',artist:'Artist',kind:'saved',status:'waiting',creditCost:1,at,acceptedAt:at,preparedAt:at}];
 const who={role:'streamer_admin',accountId:'00000000-0000-4000-8000-000000000001',spaceId:'space-001',streamerId:'papa',playerId:null};
 const fetch=async(url,request)=>{
  const path=new URL(url).pathname,b=request.body?JSON.parse(request.body):null;requests.push({path,body:b});
  if(path.endsWith('/papa_verified_session_actor'))return Response.json(expired?null:who);
  if(path.endsWith('/papa_streamer_directory'))return Response.json(state.streamers.map(r=>({...r,spaceId:'space-001'})));
  if(path.endsWith('/papa_operation_receipt')){
   const record=receipts.get(JSON.stringify([b.requested_room,b.requested_actor,b.requested_operation]));
   return Response.json(record?{committed:true,revision:record.revision,requestHash:record.hash}:{committed:false});
  }
  if(path.endsWith('/papa_room_operational_commit_receipted')){
   attempts++;assert.equal('receipt' in b.actor_context,false);assert.equal('attempt' in b.actor_context,false);
   const key=JSON.stringify([b.requested_room,b.actor_key,b.operation_id]),record=receipts.get(key);
   if(record)return Response.json({revision:record.revision,duplicate:true});
   assert.equal(b.expected,state.revision);
   for(const row of b.changes){assert.ok(['queue','ledger','wishes'].includes(row.kind),'only operational entities may change: '+row.kind);const index=state[row.kind].findIndex(item=>item.id===row.id);if(index<0)state[row.kind].push(row.data);else state[row.kind][index]=row.data;}
   for(const row of b.removed)state[row.kind]=state[row.kind].filter(item=>item.id!==row.id);
   state.revision++;writes++;receipts.set(key,{revision:state.revision,hash:b.request_hash});
   if(outcome==='ackLost')throw Error('Acknowledgment lost');
   return Response.json({revision:state.revision,duplicate:false});
  }
  if(path.endsWith('/papa_catalog_song_metadata_in_space')){
   if(outcome==='projectionLost')return Response.json({code:'XX000',message:'Projection unavailable'},{status:503});
   return Response.json([]);
  }
  if(path.endsWith('/papa_accounting_summary'))return Response.json({...core.stats(core.scopeState(state),at),
   scope:{spaceId:b.requested_space,roomId:b.requested_room},day:accountingDay(new Date().toISOString(),19),rolloverHour:19,timezone:'Asia/Taipei',revision:state.revision});
  throw Error('Unexpected fixture endpoint '+path);
 };
 const context=vm.createContext({accountingDay,...core,...access,...patch,...rules,...bulk,Error,URL,Response,TextEncoder,crypto,structuredClone,fetch,
  Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://db.example':'fixture-key'},serve:fn=>handler=fn},EdgeRuntime:{waitUntil(){}},
  CATALOG_OPS:new Set(),catalogMetadataView:view=>view,fixtureState:state});
 vm.runInContext(roomCode+'\n'+code,context);
 context.recordPush=()=>pushes++;
 vm.runInContext('load=async()=>structuredClone(fixtureState);schedulePush=()=>recordPush();',context);
 const invoke=async(body)=>{const response=await handler({method:'POST',json:async()=>({streamer:'papa',token:who.role==='player'?'player:fixture':'streamer:fixture',...body})});return {status:response.status,body:await response.json()};};
 return {state,requests,invoke,expire:()=>expired=true,player:()=>Object.assign(who,{role:'player',playerId:'P1',streamerId:null}),attempts:()=>attempts,writes:()=>writes,pushes:()=>pushes};
}

test('shipping handler replays the same intent from current authoritative state without another commit, debit or push',async()=>{
 const f=fixture(),body={op:'mutate',revision:7,operationId,action};
 const first=await f.invoke(body);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(f.writes(),1);
 const replay=await f.invoke(body);assert.equal(replay.status,200,JSON.stringify(replay.body));
 assert.equal(replay.body.state.revision,8);assert.equal(replay.body.state.queue[0].status,'completed');
 assert.equal(f.attempts(),1);assert.equal(f.writes(),1);assert.equal(f.pushes(),1);assert.equal(f.state.ledger.filter(l=>l.amount===-1).length,1);
 const status=await f.invoke({op:'operationReceipt',operationId,intent:{op:'mutate',action}});
 assert.deepEqual(status.body,{committed:true,revision:8});assert.equal('requestHash' in status.body,false);
});
for(const outcome of ['ackLost','projectionLost'])test('committed '+outcome+' outcome remains provable using a read-only receipt and is never resent',async()=>{
 const f=fixture(outcome),write=await f.invoke({op:'mutate',revision:7,operationId,action});
 assert.equal(write.body.outcome,'unknown');assert.equal(write.body.notCommitted,undefined);assert.equal(f.writes(),1);
 const found=await f.invoke({op:'operationReceipt',operationId,intent:{op:'mutate',action}});
 assert.deepEqual(found.body,{committed:true,revision:8});assert.equal(f.attempts(),1);
});
test('changed intent, expiry and wrong room never disclose or replay another receipt; pre-write validation remains editable',async()=>{
 const f=fixture();await f.invoke({op:'mutate',revision:7,operationId,action});
 const changed=await f.invoke({op:'operationReceipt',operationId,intent:{op:'mutate',action:{...action,data:{id:'q1',operation:'cancel'}}}});
 assert.equal(changed.status,400);assert.match(changed.body.error,/內容已變更/);assert.equal(f.attempts(),1);
 const foreign=await f.invoke({op:'operationReceipt',streamer:'missing',operationId,intent:{op:'mutate',action}});assert.equal(foreign.status,400);
 f.expire();const expired=await f.invoke({op:'operationReceipt',operationId,intent:{op:'mutate',action}});assert.equal(expired.status,400);
 const invalid=fixture(),rejected=await invalid.invoke({op:'mutate',revision:7,operationId,action:{type:'queue',data:{id:'missing',operation:'complete'}}});
 assert.equal(rejected.body.notCommitted,true);assert.equal('outcome' in rejected.body,false);assert.equal(invalid.attempts(),0);
});


for(const outcome of ['success','ackLost'])test('shipping player batch '+outcome+' uses the same per-room receipt and never reserves a song twice',async()=>{
 const f=fixture(outcome);f.player();const rows=[{songId:'s1',kind:'saved'}],body={op:'requestsBatch',revision:7,operationId,jobs:[{streamer:'papa',rows}]};
 const first=await f.invoke(body);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(f.writes(),1,JSON.stringify(first.body));
 assert.equal(f.state.queue.length,2);assert.equal(first.body.results[0].ok,outcome==='success');
 const status=await f.invoke({op:'operationReceipt',operationId,intent:{op:'requestsBatch',rows}});assert.deepEqual(status.body,{committed:true,revision:8});
 const replay=await f.invoke(body);assert.equal(replay.body.results[0].ok,true);assert.equal(f.attempts(),1);assert.equal(f.state.queue.length,2);
});
