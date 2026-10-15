import {roomBadgeChanges} from '../supabase/functions/party-api/badge-state.js';
import {accountingDay} from '../src/accounting.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as core from '../src/core.js';
import * as access from '../src/access-policy.js';
import * as patch from '../src/state-patch.js';
import * as rules from '../src/notification-rules.js';

// Evaluate the actual Edge handler in memory. Only network/auth/data loading
// are fixtures; revision prechecks, mutation, commit, projection and error
// response construction run the shipping code. No deployment files are made.
const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
const conflictText='資料剛更新了，請重新整理後再試一次';
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(outcome='success'){
 let handler,attempts=0,writes=0,projectionReads=0;
 const state=core.upgradePlatform(core.empty());state.revision=7;
 state.players=[{playerId:'P1',name:'Player',ids:[],names:[],password:''}];
 state.songs=[{songId:'s1',streamer_id:'papa',title:'Song',artist:'Artist',tags:[],creditCost:1}];
 state.ledger=[{id:'l1',streamer_id:'papa',playerId:'P1',amount:20,note:'Initial',at:'2026-10-11T00:00:00Z'}];
 state.queue=[{id:'q1',streamer_id:'papa',playerId:'P1',songId:'s1',title:'Song',artist:'Artist',kind:'saved',status:'waiting',creditCost:1,at:'2026-10-11T00:00:00Z',acceptedAt:'2026-10-11T00:00:00Z',preparationMinutes:0}];
 const who={role:'streamer_admin',streamer_id:'papa',accountId:'00000000-0000-4000-8000-000000000001',spaceId:'space-001'};
 const fetch=async(url,options)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/papa_room_operational_commit')){
   attempts++;
   if(outcome==='rejected')return new Response(JSON.stringify({code:'PT409',message:'VERSION_CONFLICT'}),{status:409});
   const body=JSON.parse(options.body);assert.equal(body.expected,state.revision);
   for(const row of body.changes){const list=state[row.kind];if(!Array.isArray(list))continue;const index=list.findIndex(item=>(item.id||item.songId||item.playerId)===row.id);if(index>=0)list[index]=structuredClone(row.data);else list.push(structuredClone(row.data));}
   state.revision++;writes++;
   if(outcome==='transport')throw Error('Commit acknowledgment lost');
   if(outcome==='body')return {ok:true,text:async()=>{throw Error('Response body lost');}};
   if(outcome==='gateway')return new Response(JSON.stringify({code:'PT409',message:'VERSION_CONFLICT'}),{status:503});
   return new Response(JSON.stringify(state.revision));
  }
  if(path.endsWith('/papa_catalog_song_metadata_in_space')){
   projectionReads++;
   if(outcome==='projection')return new Response('Projection unavailable',{status:503});
   if(outcome==='projectionConflict')return new Response(JSON.stringify({code:'PT409',message:'VERSION_CONFLICT'}),{status:409});
   return new Response('[]');
  }
  if(path.endsWith('/papa_accounting_summary')){const b=JSON.parse(options.body);return new Response(JSON.stringify({day:b.requested_day||accountingDay(new Date().toISOString(),19),rolloverHour:19,timezone:'Asia/Taipei',scope:{spaceId:b.requested_space,roomId:b.requested_room},...core.stats(core.scopeState(state),new Date().toISOString()),revision:state.revision}));}
  throw Error('Unexpected fixture endpoint');
 };
 const context=vm.createContext({roomBadgeChanges,accountingDay,...core,...access,...patch,...rules,Error,URL,Response,TextEncoder,crypto,structuredClone,fetch,
  Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://db.example':'fixture-key'},serve:fn=>handler=fn},EdgeRuntime:{waitUntil(){}},
  CATALOG_OPS:new Set(),catalogMetadataView:view=>view,fixtureState:state,fixtureWho:who});
 vm.runInContext(code,context);
 vm.runInContext('actor=async()=>fixtureWho;load=async()=>structuredClone(fixtureState);schedulePush=()=>{};',context);
 const invoke=async(revision=7)=>{
  const response=await handler({method:'POST',json:async()=>({op:'mutate',streamer:'papa',token:'fixture-token',revision,action:{type:'queue',data:{id:'q1',operation:'complete'}}})});
  return {status:response.status,body:await response.json()};
 };
 return {context,state,invoke,attempts:()=>attempts,writes:()=>writes,projectionReads:()=>projectionReads};
}
test('local stale revision produces definite structured rejection without any write RPC',async()=>{
 const f=fixture(),result=await f.invoke(6);
 assert.equal(result.status,400);assert.deepEqual(result.body,{error:conflictText,code:'VERSION_CONFLICT',notCommitted:true});
 assert.equal(f.attempts(),0);assert.equal(f.writes(),0);assert.equal(f.state.queue[0].status,'waiting');
});
test('actual rejected atomic write RPC produces proof and does not retry the mutation',async()=>{
 const f=fixture('rejected'),result=await f.invoke();
 assert.equal(result.status,400);assert.deepEqual(result.body,{error:conflictText,code:'VERSION_CONFLICT',notCommitted:true});
 assert.equal(f.attempts(),1);assert.equal(f.writes(),0);assert.equal(f.projectionReads(),0);assert.equal(f.state.queue[0].status,'waiting');
});
for(const outcome of ['transport','body','gateway','projection','projectionConflict'])test('successful commit with '+outcome+' failure remains unknown and cannot offer a safe resend',async()=>{
 const f=fixture(outcome),result=await f.invoke();
 assert.equal(result.status,400);assert.equal(result.body.outcome,'unknown');assert.equal('notCommitted'in result.body,false);assert.equal('code'in result.body,false);
 assert.equal(f.attempts(),1);assert.equal(f.writes(),1);assert.equal(f.state.queue[0].status,'completed');
 assert.equal(f.state.ledger.filter(row=>row.amount===-1).length,1);
 if(outcome==='projectionConflict')assert.equal(result.body.error,conflictText,'legacy wording alone cannot overrule unknown outcome');
});
test('downstream typed conflict cannot erase evidence that the business commit already succeeded',async()=>{
 const f=fixture();vm.runInContext('catalogMetadataView=()=>{throw revisionConflictError();};',f.context);
 const result=await f.invoke();assert.equal(result.body.error,conflictText);assert.equal(result.body.outcome,'unknown');assert.equal('notCommitted'in result.body,false);assert.equal(f.writes(),1);
});
test('valid mutation keeps its original successful response and exactly one credit deduction',async()=>{
 const f=fixture(),result=await f.invoke();assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.state.revision,8);assert.equal(f.writes(),1);
 assert.equal(f.state.ledger.filter(row=>row.amount===-1).length,1);
 const repeated=await f.invoke();assert.equal(repeated.body.notCommitted,true);assert.equal(f.writes(),1);
});
test('SQL proof accepts only supported atomic RPCs and exact rejected SQL response metadata',async()=>{
 const f=fixture();
 for(const sqlCode of ['PT409','P0001','40001'])for(const status of [400,409]){
  const result=f.context.rejectedRevisionConflict('/rest/v1/rpc/papa_room_admin_commit',status,{code:sqlCode,message:'VERSION_CONFLICT'});assert.equal(result,true);
 }
 for(const [path,status,detail]of [
  ['/rest/v1/rpc/papa_room_admin_commit',500,{code:'PT409',message:'VERSION_CONFLICT'}],
  ['/rest/v1/rpc/papa_room_admin_commit',409,{code:'PGRST999',message:'VERSION_CONFLICT'}],
  ['/rest/v1/rpc/papa_room_admin_commit',409,{code:'PT409',message:'another error mentions VERSION_CONFLICT'}],
  ['/rest/v1/rpc/papa_catalog_song_metadata_in_space',409,{code:'PT409',message:'VERSION_CONFLICT'}],
  ['/rest/v1/papa_v2_entities',409,{code:'PT409',message:'VERSION_CONFLICT'}],
 ])assert.equal(f.context.rejectedRevisionConflict(path,status,detail),false);
 assert.deepEqual(plain(f.context.operationErrorResponse(Error(conflictText))),{error:conflictText,outcome:'unknown'});
});
