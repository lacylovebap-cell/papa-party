import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as core from '../src/core.js';
import * as access from '../src/access-policy.js';
import * as patch from '../src/state-patch.js';
import * as rules from '../src/notification-rules.js';

// Shipping handler + actor + API error boundary. Only fetch is replaced; this
// fixture neither builds artifacts nor replaces the authorization implementation.
const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const defaultActor={role:'player',accountId:uuid(10),deviceSessionId:uuid(20),spaceId:'native-space',playerId:'P-NATIVE'};
const request={op:'nativePushRegister',token:'device:verified-native',expectedDeviceSessionId:uuid(20),transport:'fcm',destination:'fixture-native-private-token'};
const result={registrationId:uuid(30),permission:'granted',enabled:true,changed:true};

function fixture(options={}){
 let handler;const calls=[],background=[],state={actor:Object.hasOwn(options,'actor')?options.actor:defaultActor,...options};
 const fetch=async(url,init)=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;
  calls.push({path,body,method:init.method});
  if(path==='/rest/v1/rpc/papa_verified_session_actor'){
   if(state.actorError)return Response.json({code:'P0001',message:'private session server detail'},{status:500});
   return Response.json(state.actor);
  }
  if(['/rest/v1/rpc/papa_register_native_push','/rest/v1/rpc/papa_disable_native_push'].includes(path)){
   if(state.error)return Response.json(state.error,{status:state.errorStatus??500});
   const value=Object.hasOwn(state,'result')?state.result:path.endsWith('papa_disable_native_push')?{...result,enabled:false}:result;
   return Response.json(value);
  }
  throw Error('Unexpected database/network work: '+path);
 };
 const context=vm.createContext({...core,...access,...patch,...rules,Error,URL,Date,Response,TextEncoder,crypto,structuredClone,fetch,
  CATALOG_OPS:new Set(),Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://native-fixture.invalid':'fixture-service'},serve:fn=>handler=fn},
  EdgeRuntime:{waitUntil:work=>background.push(work)}});
 vm.runInContext(code,context);
 const invoke=async(extra={})=>{
  const response=await handler({method:'POST',json:async()=>({...request,...extra})});
  return {status:response.status,body:await response.json()};
 };
 return {calls,background,state,invoke,writes:()=>calls.filter(call=>/papa_(register|disable)_native_push$/.test(call.path))};
}

function noPrivateOutput(value){
 assert.doesNotMatch(JSON.stringify(value),/fixture-native-private|refresh:|device:verified|private session|private RPC|server_secret|destination|credentials|accountId|deviceSessionId|chosen_session/);
}

test('native push registration ignores forged scope and uses only the canonical device actor in one atomic RPC',async()=>{
 const f=fixture(),response=await f.invoke({streamer:'forged-room',spaceId:'forged-space',accountId:uuid(99),sessionId:uuid(98),
  installationId:uuid(97),playerId:'P-OTHER',role:'super_admin',recipient:'__super__',subject:uuid(96),
  actor_context:{role:'super_admin',account_id:uuid(95)},chosen_session:uuid(94),
  activityPage:'home',activityVisible:true});
 assert.equal(response.status,200,JSON.stringify(response.body));assert.deepEqual(response.body,result);
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].path,'/rest/v1/rpc/papa_verified_session_actor');
 assert.equal(f.calls[0].body.requested_room,null);assert.match(f.calls[0].body.session_hash,/^[a-f0-9]{64}$/);
 assert.deepEqual(f.writes(),[{path:'/rest/v1/rpc/papa_register_native_push',method:'POST',body:{
  subject:uuid(10),chosen_session:uuid(20),chosen_transport:'fcm',chosen_destination:request.destination,chosen_permission:'granted'}}]);
 assert.equal(JSON.stringify(f.calls).includes('forged'),false);assert.equal(f.background.length,0);noPrivateOutput(response.body);
});

test('native registration retains transport and permission choices while projecting only public result fields',async()=>{
 for(const permission of ['granted','prompt','denied','unsupported'])for(const transport of ['fcm','desktop_os']){
  const f=fixture({result:{...result,permission,enabled:permission==='granted',
   destination:request.destination,credentials:{refreshToken:'refresh:private'},server_secret:'private RPC',
   accountId:uuid(99),deviceSessionId:uuid(98)}});
  const response=await f.invoke({permission,transport});
  assert.equal(response.status,200);assert.deepEqual(response.body,{...result,permission,enabled:permission==='granted'});
  assert.equal(f.writes()[0].body.chosen_permission,permission);assert.equal(f.writes()[0].body.chosen_transport,transport);
  assert.equal(f.calls.length,2);assert.equal(f.background.length,0);noPrivateOutput(response.body);
 }
});

test('native disable binds exact registration to verified session without any destination or scope reads',async()=>{
 const actor={role:'streamer_admin',accountId:uuid(11),deviceSessionId:uuid(21),spaceId:'native-space',streamerId:'native-room'};
 const f=fixture({actor}),response=await f.invoke({op:'nativePushDisable',registrationId:uuid(30),expectedDeviceSessionId:uuid(21),
  transport:'desktop_os',streamer:'other-room',spaceId:'other-space',sessionId:uuid(99),accountId:uuid(98)});
 assert.equal(response.status,200);assert.deepEqual(response.body,{...result,enabled:false});
 assert.equal(f.calls[0].body.requested_room,null);
 assert.deepEqual(f.writes(),[{path:'/rest/v1/rpc/papa_disable_native_push',method:'POST',body:{
  subject:uuid(11),chosen_session:uuid(21),chosen_transport:'desktop_os',chosen_registration:uuid(30)}}]);
 assert.equal(f.calls.length,2);assert.equal(f.background.length,0);noPrivateOutput(response.body);
});

test('anonymous, expired, legacy or malformed device identities cannot reach native registration writes',async()=>{
 const identities=[null,{...defaultActor,accountId:null},{...defaultActor,accountId:'not-uuid'},
  {...defaultActor,deviceSessionId:undefined},{...defaultActor,deviceSessionId:'not-uuid'},
  {...defaultActor,spaceId:null},{...defaultActor,role:'space_admin'},
  {...defaultActor,role:'super_admin',spaceId:'borrowed-space'}];
 for(const actor of identities){
  const f=fixture({actor}),response=await f.invoke();assert.equal(response.status,400);
  assert.equal(f.writes().length,0);assert.equal(f.background.length,0);noPrivateOutput(response.body);
 }
 for(const token of ['',null,42,'not-a-device','player:legacy','streamer:legacy','admin:legacy']){
  const f=fixture(),response=await f.invoke({token});assert.equal(response.status,400);assert.equal(f.writes().length,0);noPrivateOutput(response.body);
 }
});

test('missing or swapped expected device IDs reject both operations before any native RPC',async()=>{
 for(const op of ['nativePushRegister','nativePushDisable'])for(const expectedDeviceSessionId of [undefined,null,'',uuid(99),'not-uuid']){
  const f=fixture(),response=await f.invoke({op,registrationId:uuid(30),expectedDeviceSessionId});
  assert.equal(response.status,400);assert.equal(f.writes().length,0);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].body.requested_room,null);assert.equal(f.background.length,0);noPrivateOutput(response.body);
 }
});

test('invalid native input never reaches a registration write or a fallback query',async()=>{
 const invalid=[...['web_push','apns','desktop','',null,{},12].map(transport=>({transport})),
  ...[null,undefined,'','short',' padded-token','padded-token ','tab\ttoken','line\ntoken','null\u0000token',
   'nonbreak\u00a0token','control\u0080token','x'.repeat(4097),{},12].map(destination=>({destination})),
  ...['','allowed',true,{},12].map(permission=>({permission})),
  ...[undefined,null,'',uuid(1)+'x',{},12].map(registrationId=>({op:'nativePushDisable',registrationId}))];
 for(const body of invalid){
  const f=fixture(),response=await f.invoke(body);assert.equal(response.status,400,JSON.stringify(body));
  assert.equal(f.writes().length,0);assert.equal(f.calls.length,1);assert.equal(f.background.length,0);noPrivateOutput(response.body);
 }
});

test('malformed native RPC success bodies fail closed and never leak extra server fields',async()=>{
 for(const value of [null,[],{},'unexpected',{...result,registrationId:'invalid'},
  {...result,permission:'allowed'},{...result,enabled:1},{...result,changed:'yes'},
  {registrationId:uuid(30),permission:'granted',enabled:true}]){
  const f=fixture({result:value}),response=await f.invoke();assert.equal(response.status,400);
  assert.equal(f.writes().length,1);assert.equal(f.calls.length,2);assert.equal(f.background.length,0);noPrivateOutput(response.body);
 }
});

test('native RPC failure and missing migration produce no legacy fallback, duplicate send or secret output',async()=>{
 for(const [error,errorStatus] of [
  [{code:'P0001',message:'NATIVE_PUSH_SESSION_INACTIVE private RPC '+request.destination},400],
  [{code:'PGRST202',message:'Could not find the function public.papa_register_native_push'},404],
  [{code:'XX000',message:'private RPC credentials refresh:private'},500]]){
  const f=fixture({error,errorStatus}),response=await f.invoke();assert.equal(response.status,400);
  assert.equal(f.writes().length,1);assert.equal(f.calls.length,2);assert.equal(f.background.length,0);noPrivateOutput(response.body);
 }
 const f=fixture({actorError:true}),response=await f.invoke();assert.equal(response.status,400);
 assert.equal(f.writes().length,0);assert.equal(f.calls.length,1);noPrivateOutput(response.body);
});

test('new native transport endpoints do not open the existing guarded native business path',async()=>{
 const f=fixture(),response=await f.invoke({op:'migrate',streamer:'native-room',destination:undefined});
 assert.equal(response.status,400);assert.match(response.body.error,/此 Space 的資料頁尚未開放/);
 assert.equal(f.calls.length,1);assert.equal(f.writes().length,0);assert.equal(f.background.length,0);
 assert.match(source,/if\(who\?\.spaceId&&who\.spaceId!=='space-001'\)\s*throw Error\('此 Space 的資料頁尚未開放'\)/);
});
