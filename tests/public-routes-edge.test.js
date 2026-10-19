import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';

// Exercise the actual generated deployment bundle and its real actor()/API
// boundary. Only fetch is replaced; no auth or route handler is monkey-patched.
execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
const bundle=stripTypeScriptTypes(fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8')
 .replace(/^import webpush .*;\r?\n/m,'const webpush={};'));
const A='11111111-1111-4111-8111-111111111111';
const result=(extra={})=>({version:1,spaceId:'space-001',streamerId:'papa',streamerSlug:'papa',kind:'streamer',configured:true,
 layout:'flat',spaceCode:'sm',code:'pa',revision:0,canonicalPath:'/pa',...extra});

function fixture({role='streamer_admin',expired=false,space='space-001',room='papa',reply,error,readOnly}={}){
 let handler;const calls=[],background=[];
 const verified={role,accountId:A,spaceId:role==='super_admin'?null:space,
  playerId:role==='player'?'P1':null,streamerId:role==='streamer_admin'?room:null};
 const token=(role==='super_admin'?'admin:':role==='player'?'player:':'streamer:')+'fixture';
 const fetch=async(url,request={})=>{
  const path=new URL(url).pathname,body=request.body?JSON.parse(request.body):null;calls.push({path,body,method:request.method});
  if(path==='/rest/v1/rpc/papa_verified_session_actor')return Response.json(expired?null:verified);
  if(!path.startsWith('/rest/v1/rpc/papa_public_route_'))throw Error('Unexpected business/network access: '+path);
  if(error)return Response.json(error,{status:400});
  const kind=body.requested_kind??'streamer',hall=kind==='hall';
  const scoped=result({spaceId:body.requested_space??'space-001',streamerId:hall?null:body.requested_room??'papa',streamerSlug:hall?null:body.requested_room??'papa',kind,
   layout:body.requested_space&&body.requested_space!=='space-001'?'hall':'flat',canonicalPath:hall?'/sm':'/pa'});
  const value=path.endsWith('_resolve')?{...scoped,matchedPath:body.requested_path,isAlias:body.requested_path!=='/pa'}:
   path.endsWith('_check')?{...scoped,available:true,reason:null,proposedPath:'/NewPapa'}:
   path.endsWith('_save')?{...scoped,code:body.desired_code,canonicalPath:hall?'/'+body.desired_code:'/NewPapa',revision:body.expected_revision+1,changed:true}:scoped;
  return Response.json(reply===undefined?value:reply);
 };
 const context=vm.createContext({Error,URL,Response,Date,crypto,structuredClone,TextEncoder,Uint8Array,atob,console,fetch,
  EdgeRuntime:{waitUntil:work=>background.push(work)},Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://routes-fixture.invalid':key==='PUBLIC_ROUTES_READ_ONLY'?readOnly:'fixture-service'},serve:fn=>handler=fn}});
 vm.runInContext(bundle,context);
 const invoke=async(body={})=>{const r=await handler({method:'POST',json:async()=>({op:'publicRouteSettings',token,spaceId:space,streamerId:room,streamer:'incidental-slug',...body})});return {status:r.status,body:await r.json()};};
 const routeCalls=()=>calls.filter(c=>c.path.includes('/papa_public_route_'));
 return {invoke,calls,background,routeCalls,context};
}

test('full Edge bundle resolves and reads public URLs before authentication, native business guards, activity or snapshots',async()=>{
 for(const body of [{op:'publicRouteResolve',path:'/pa'},{op:'publicRouteInfo',spaceId:'space-001',streamerId:'papa'},
  {op:'publicRouteInfo',spaceId:'space-001',kind:'hall',streamerId:null,streamer:'papa'}]){
  const f=fixture(),r=await f.invoke({...body,token:'device:untrusted',actor_context:{role:'super_admin'},activityPage:'home',activityVisible:true});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(f.calls.length,1);assert.equal(f.routeCalls().length,1);assert.equal(f.background.length,0);
  assert.equal(f.calls[0].path.endsWith(body.op==='publicRouteResolve'?'_resolve':'_info'),true);
 }
});

test('full Edge management routes use only verified camel-case actor identity and explicit stable scope',async()=>{
 for(const op of ['publicRouteSettings','publicRouteCheck','publicRouteSave']){
  const f=fixture({space:'native-space',room:'native-room'}),r=await f.invoke({op,code:'NewPapa',revision:3,
   actor_context:{role:'super_admin',account_id:'spoofed'},accountId:'spoofed',role:'super_admin',subject:'spoofed',
   activityPage:'home',activityVisible:true,streamer:'papa'});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(f.calls.length,2);assert.equal(f.background.length,0);
  assert.equal(f.calls[0].path,'/rest/v1/rpc/papa_verified_session_actor');assert.equal(f.calls[0].body.requested_room,null);
  const request=f.routeCalls()[0];assert.equal(request.body.requested_space,'native-space');assert.equal(request.body.requested_room,'native-room');
  assert.deepEqual(request.body.actor_context,{role:'streamer_admin',account_id:A,space_id:'native-space',actor_streamer_id:'native-room'});
  assert.equal(JSON.stringify(f.calls).includes('spoofed'),false);
  if(op==='publicRouteSave')assert.equal(request.body.expected_revision,3);
 }
});

test('players, missing or expired credentials cannot perform URL management despite forged request roles',async()=>{
 for(const options of [{role:'player'},{expired:true}])for(const op of ['publicRouteSettings','publicRouteCheck','publicRouteSave']){
  const f=fixture(options),r=await f.invoke({op,code:'NewPapa',revision:0,role:'super_admin',actor_context:{role:'super_admin',account_id:A}});
  assert.equal(r.status,400);assert.equal(f.routeCalls().length,0);assert.equal(f.background.length,0);
 }
 const f=fixture(),r=await f.invoke({token:'',op:'publicRouteSave',code:'NewPapa',revision:0});assert.equal(r.status,400);assert.equal(f.calls.length,0);
});

test('president can target a hall without incidental streamer slug changing the stable target',async()=>{
 const f=fixture({role:'super_admin'}),r=await f.invoke({op:'publicRouteSave',kind:'hall',streamerId:null,spaceId:'space-002',code:'qq',layout:'hall',revision:0,streamer:'papa'});
 assert.equal(r.status,200,JSON.stringify(r.body));const request=f.routeCalls()[0];
 assert.equal(request.body.requested_room,null);assert.equal(request.body.requested_space,'space-002');assert.equal(request.body.requested_kind,'hall');
 assert.deepEqual(request.body.actor_context,{role:'super_admin',account_id:A,space_id:null,actor_streamer_id:null});assert.equal(f.background.length,0);
});

test('public route handler whitelists database replies, rejects cross-scope replies and carries unknown-path null without business work',async()=>{
 const f=fixture({reply:{...result(),password:'private',players:['private'],ledger:'private'}}),r=await f.invoke({op:'publicRouteInfo'});
 assert.equal(r.status,200);assert.doesNotMatch(JSON.stringify(r.body),/password|private|players|ledger/);assert.equal(f.calls.length,1);
 const wrong=fixture({reply:result({spaceId:'space-002',streamerId:'other'})});assert.equal((await wrong.invoke({op:'publicRouteInfo'})).status,400);assert.equal(wrong.calls.length,1);
 const missing=fixture({reply:null});assert.deepEqual(await missing.invoke({op:'publicRouteResolve',path:'/unknown'}),{status:200,body:null});assert.equal(missing.calls.length,1);
});

test('invalid inputs and database rejection do not fall through into native or business mutations',async()=>{
 for(const op of ['publicRouteCheck','publicRouteSave']){
  const f=fixture(),r=await f.invoke({op,code:'a'.repeat(41),revision:0});assert.equal(r.status,400);assert.equal(f.routeCalls().length,0);assert.equal(f.background.length,0);
 }
 const invalid=fixture(),r=await invalid.invoke({op:'publicRouteResolve',path:'/pa?token=secret'});assert.equal(r.status,200);assert.equal(r.body,null);assert.equal(invalid.calls.length,0);
 const f=fixture({error:{code:'40001',message:'PUBLIC_ROUTE_VERSION_CONFLICT'}});assert.equal((await f.invoke({op:'publicRouteSave',code:'NewPapa',revision:1})).status,400);
 assert.equal(f.calls.length,2);assert.equal(f.background.length,0);
 assert.ok(f.calls.every(c=>c.path.includes('/papa_public_route_')||c.path.endsWith('/papa_verified_session_actor')));
});

test('emergency read-only mode blocks every save before its RPC while keeping resolution, info and management reads compatible',async()=>{
 const f=fixture({readOnly:'true'});
 const save=await f.invoke({op:'publicRouteSave',code:'NewPapa',revision:0});assert.equal(save.status,400);
 assert.equal(f.calls.some(c=>c.path.endsWith('papa_public_route_save')),false);
 for(const body of [{op:'publicRouteResolve',path:'/pa'}, {op:'publicRouteInfo'}, {op:'publicRouteSettings'}, {op:'publicRouteCheck',code:'NewPapa'}]){
  const response=await f.invoke(body);assert.equal(response.status,200,JSON.stringify(response.body));
 }
 assert.equal(f.background.length,0);assert.equal(f.calls.some(c=>c.path.endsWith('papa_public_route_save')),false);
 assert.equal((await fixture({readOnly:'false'}).invoke({op:'publicRouteSave',code:'NewPapa',revision:0})).status,200);
});
