import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as core from '../src/core.js';
import * as access from '../src/access-policy.js';
import * as patch from '../src/state-patch.js';
import * as rules from '../src/notification-rules.js';

// Run the shipping handler and actor verification. Stub only the service-role
// RPC transport; any directory/business snapshot/table read is a fixture error.
const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
const capabilities={scopedRevision:true,authoritative:false,delta:false,realtime:false};
const accountId='00000000-0000-4000-8000-000000000001';
function fixture(options={}){
 let handler;const calls=[];
 const role=options.role||'streamer_admin',spaceId=options.actorSpace||'space-001',roomId=options.actorRoom||'papa';
 const who={role,accountId,spaceId:role==='super_admin'?null:spaceId,
  streamerId:role==='streamer_admin'?roomId:null,playerId:role==='player'?'P1':null};
 const token=role==='super_admin'?'admin:fixture':role==='player'?'player:fixture':'streamer:fixture';
 const fetch=async(url,request)=>{
  const path=new URL(url).pathname,body=JSON.parse(request.body);
  assert.equal(request.method,'POST');calls.push({path,body});
  if(path==='/rest/v1/rpc/papa_verified_session_actor'){
   assert.match(body.session_hash,/^[a-f0-9]{64}$/);
   if(options.authRejected)return Response.json(options.authRejected.detail,{status:options.authRejected.status});
   return Response.json(options.expired?null:who);
  }
  assert.equal(path,'/rest/v1/rpc/papa_room_sync_head','only the tiny head RPC may follow actor verification');
  if(options.transport)throw Error('Network unavailable');
  if(options.rejected)return Response.json(options.rejected.detail,{status:options.rejected.status});
  const head={version:1,spaceId:body.requested_space,streamerId:body.requested_room,
   room:{queue:4,ledger:2,privateRecord:'must not be projected'},space:{players:3},
   catalog:{shared_catalog:7},globalRevision:42,capabilities};
  return Response.json(options.head?options.head(head):head);
 };
 const context=vm.createContext({...core,...access,...patch,...rules,Error,URL,Response,TextEncoder,crypto,structuredClone,fetch,
  Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://db.example':'fixture-key'},serve:fn=>handler=fn},
  EdgeRuntime:{waitUntil(){throw Error('A read head must not enqueue work');}}});
 vm.runInContext(code,context);
 const invoke=async(extra={})=>{
  const request={op:'roomSyncHead',token,streamer:roomId,spaceId,...extra};
  const response=await handler({method:'POST',json:async()=>request});
  return {status:response.status,body:await response.json()};
 };
 return {calls,invoke};
}
const noHead=f=>assert.equal(f.calls.filter(call=>call.path.endsWith('/papa_room_sync_head')).length,0);
const rejected=result=>{assert.equal(result.status,400);assert.equal('supported'in result.body,false);assert.equal('head'in result.body,false);};

test('verified manager receives only canonical bounded nonauthoritative counters',async()=>{
 const f=fixture(),result=await f.invoke();
 assert.equal(result.status,200);assert.equal(result.body.supported,true);
 assert.deepEqual(f.calls.map(call=>call.path),['/rest/v1/rpc/papa_verified_session_actor','/rest/v1/rpc/papa_room_sync_head']);
 assert.equal(f.calls[0].body.requested_room,'papa');
 assert.deepEqual(f.calls[1].body,{requested_room:'papa',requested_space:'space-001'});
 assert.deepEqual(result.body.head,{version:1,spaceId:'space-001',streamerId:'papa',
  room:{songs:0,queue:4,ledger:2,crowns:0,cards:0,wishes:0,settings:0},
  space:{players:3,settings:0,directory:0,metadata:0,catalog_relations:0},catalog:{shared_catalog:7},globalRevision:42,capabilities});
 assert.equal('state'in result.body,false);assert.equal('revision'in result.body,false);
 assert.equal(JSON.stringify(result.body).includes('must not be projected'),false);
});

test('verified native manager head does not activate or load the native business snapshot',async()=>{
 const f=fixture({actorSpace:'space-002',actorRoom:'native-room'}),result=await f.invoke();
 assert.equal(result.status,200);assert.equal(result.body.head.spaceId,'space-002');assert.equal(result.body.head.streamerId,'native-room');
 assert.equal(f.calls.length,2);
});

test('verified president can request an exact canonical native Room–Space pair',async()=>{
 const f=fixture({role:'super_admin'}),result=await f.invoke({streamer:'native-room',spaceId:'space-002'});
 assert.equal(result.status,200);assert.deepEqual(f.calls[1].body,{requested_room:'native-room',requested_space:'space-002'});
});

test('anonymous, expired or suspended identities never read heads or receive unsupported fallback',async()=>{
 for(const options of [{},{expired:true}]){
  const f=fixture(options),result=await f.invoke(options.expired?{}:{token:''});rejected(result);noHead(f);
 }
});

test('aggregate private-domain counters are unavailable to player actors',async()=>{
 const f=fixture({role:'player'}),result=await f.invoke();rejected(result);noHead(f);assert.equal(result.body.error,'請先登入管理');
});

test('manager wrong Room, wrong Space and slug aliases reject before tiny head RPC',async()=>{
 for(const input of [{streamer:'other-room'},{spaceId:'space-002'},{streamer:'papa-alias'}]){
  const f=fixture(),result=await f.invoke(input);rejected(result);noHead(f);
 }
});

test('canonical head input is explicit, bounded and cannot fall back to papa',async()=>{
 for(const input of [{streamer:''},{streamer:null},{streamer:' papa'},
  {streamer:'papa\n'},{streamer:'x'.repeat(201)},{spaceId:null},{spaceId:''},
  {spaceId:[]},{spaceId:'space-001\u2028'},{spaceId:'x'.repeat(201)}]){
  const f=fixture({role:'super_admin'}),result=await f.invoke(input);rejected(result);noHead(f);
 }
});

const absent={code:'PGRST202',message:'Could not find the function public.papa_room_sync_head(requested_room, requested_space) in the schema cache',details:'No matching function',hint:null};
test('actor verification errors are never interpreted as a missing head capability',async()=>{
 for(const status of [401,403,404,500]){
  const f=fixture({authRejected:{status,detail:absent}}),result=await f.invoke();rejected(result);noHead(f);
 }
});
test('exact absent head RPC returns unsupported without a global revision or legacy snapshot fallback',async()=>{
 const f=fixture({rejected:{status:404,detail:absent}}),result=await f.invoke();
 assert.equal(result.status,200);assert.deepEqual(result.body,{supported:false,reason:'migration_unavailable',
  capabilities:{scopedRevision:false,authoritative:false,delta:false,realtime:false}});
 assert.equal(f.calls.length,2);assert.equal('globalRevision'in result.body,false);
});

test('head scope rejection, denied access and unrelated server errors cannot masquerade as unsupported',async()=>{
 for(const rejection of [
  {status:400,detail:{code:'P0001',message:'ROOM_SYNC_SCOPE_INVALID'}},
  {status:403,detail:{code:'42501',message:'permission denied'}},
  {status:401,detail:absent},{status:403,detail:absent},{status:500,detail:absent},
  {status:404,detail:{...absent,message:'Could not find the function public.papa_other(requested_room) in the schema cache'}},
  {status:404,detail:{...absent,message:'permission denied for public.papa_room_sync_head'}},
  {status:404,detail:{...absent,message:'Could not find the function public.papa_room_sync_head_other in the schema cache'}},
 ]){
  const f=fixture({rejected:rejection}),result=await f.invoke();rejected(result);assert.equal(f.calls.length,2);
 }
 const f=fixture({transport:true}),result=await f.invoke();rejected(result);assert.equal(f.calls.length,2);
});

test('invalid/mismatched RPC response or claims of implemented live capabilities fail closed',async()=>{
 for(const replace of [
  head=>({...head,spaceId:'space-other'}),head=>({...head,streamerId:'other-room'}),
  head=>({...head,version:2}),head=>({...head,globalRevision:-1}),
  head=>({...head,globalRevision:Number.MAX_SAFE_INTEGER+1}),head=>({...head,room:[]}),
  head=>({...head,room:{queue:-1}}),head=>({...head,space:{players:'2'}}),
  head=>({...head,catalog:{shared_catalog:0.5}}),
  ...['authoritative','delta','realtime'].map(key=>head=>({...head,capabilities:{...capabilities,[key]:true}})),
 ]){
  const f=fixture({head:replace}),result=await f.invoke();rejected(result);assert.equal(result.body.error,'同步摘要資料不正確');
 }
});
