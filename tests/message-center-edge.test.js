import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as core from '../src/core.js';
import * as access from '../src/access-policy.js';
import * as patch from '../src/state-patch.js';
import * as rules from '../src/notification-rules.js';
import * as chat from '../src/chat-policy.js';
import * as board from '../src/board-policy.js';

const code=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''));
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('deployment version probe is public, performs no database reads and labels completed center and unfinished transport/native features honestly',async()=>{
 const f=fixture({expired:true}),r=await f.invoke({op:'releaseInfo',token:'invalid'});
 assert.equal(r.status,200);assert.deepEqual(r.body,{version:JSON.parse(fs.readFileSync(new URL('../release.json',import.meta.url),'utf8')).version,messageCenterV2:true,scopedRealtimeV2:false,nativeApps:false});
 assert.equal(f.calls.length,0);
});
function fixture(options={}){
 let handler;const calls=[],role=options.role||'player';
 const actor={role,accountId:id(10),spaceId:role==='super_admin'?null:'space-001',playerId:role==='player'?'P1':null,streamerId:role==='streamer_admin'?'papa':null};
 const recipient=role==='player'?'P1':role==='super_admin'?'__super__':'__admin__';
 const fetch=async(url,request)=>{
  const path=new URL(url).pathname,body=request.body?JSON.parse(request.body):null;calls.push({path,body,method:request.method});
  if(path.endsWith('/papa_verified_session_actor'))return Response.json(options.expired?null:actor);
  if(path.endsWith('/papa_streamer_directory')||path.endsWith('/papa_streamer_directory_in_space'))return Response.json([
   {id:'papa',slug:'papa',display_name:'Room',active:true,spaceId:'space-001'},
   {id:'michelle',slug:'michelle',display_name:'Other',active:true,spaceId:'space-001'}]);
  assert.equal(body.requested_space,'space-001');assert.equal(body.requested_room,'papa');
  assert.equal(body.actor_context.account_id,id(10));assert.equal(body.actor_context.role,role);
  assert.equal(body.actor_context.player_id,role==='player'?'P1':null);
  assert.equal('recipient'in body,false);assert.equal('owner_id'in body,false);
  const scope={spaceId:'space-001',streamerId:body.scope_mode==='space'?null:'papa',mode:body.scope_mode};
  if(options.error)return Response.json(options.error,{status:options.errorStatus||500});
  if(path.endsWith('/papa_notice_category_page'))return Response.json({version:1,scope,category:body.category_filter,page:body.page_number,pageSize:50,total:76,snapshotAt:'2026-10-11T00:00:00Z',snapshotId:body.snapshot_id||id(99),hasMore:true,
   rows:[{id:id(1),space_id:'space-001',streamer_id:'papa',streamer_name:'怕怕',recipient,type:body.category_filter==='message'?'message':body.category_filter==='board'?'comment':'completed',level:2,body:'Selected own notice',entity_id:id(2),created_at:'2026-10-10T00:00:00Z',read_at:null,server_secret:'do not return'}],...options.result});
  if(path.endsWith('/papa_notice_category_counts'))return Response.json({version:1,scope,totalsByCategory:{system:76,message:5,board:2},unreadByCategory:{system:1,message:2,board:1},unreadByType:{completed:1,message:2,comment:1},badgeUnreadByCategory:{system:1,message:0,board:1},server_secret:'do not return',...options.result});
  if(path.endsWith('/papa_notice_center_preferences_set'))return Response.json({version:1,scope,settings:{types:Object.fromEntries(Object.keys(rules.NOTICE_TYPES).map(type=>[type,{center:body.display_settings?.types?.[type]?.center??true,badge:body.display_settings?.types?.[type]?.badge??true}]))},server_secret:'do not return',...options.result});
  if(path.endsWith('/papa_notice_category_read'))return Response.json({version:1,scope,category:body.category_filter,marked:body.notice_ids?.length??8,...options.result});
  throw Error('Unexpected endpoint '+path);
 };
 const context=vm.createContext({...core,...access,...patch,...rules,...chat,...board,Error,URL,Response,TextEncoder,crypto,structuredClone,fetch,
  CATALOG_OPS:new Set(),Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://db.example':'fixture-key'},serve:fn=>handler=fn},EdgeRuntime:{waitUntil(){throw Error('No background work');}}});
 vm.runInContext(code,context);
 const invoke=async(extra={})=>{const response=await handler({method:'POST',json:async()=>({op:'messageCenter',token:(role==='super_admin'?'admin:':role==='streamer_admin'?'streamer:':'player:')+'fixture',streamer:'papa',category:'system',...extra})});return {status:response.status,body:await response.json()};};
 return {calls,invoke,rpcs:()=>calls.filter(c=>c.path.includes('/papa_notice_category_'))};
}

test('category API derives recipient authority from the session and uses one selected page RPC',async()=>{
 for(const role of ['player','streamer_admin','super_admin']){
  const f=fixture({role}),r=await f.invoke({category:'message',page:1,snapshotAt:'2026-10-11T00:00:00Z',snapshotId:id(99),recipient:'P2',actor_context:{role:'super_admin'},playerId:'P2'});
  assert.equal(r.status,200);assert.equal(r.body.rows.length,1);assert.equal(r.body.total,76);assert.equal(r.body.page,1);assert.equal(r.body.snapshotAt,'2026-10-11T00:00:00Z');
  assert.equal(f.rpcs().length,1);assert.equal(f.rpcs()[0].body.snapshot_at,'2026-10-11T00:00:00Z');assert.equal(f.rpcs()[0].body.snapshot_id,id(99));assert.equal(r.body.snapshotId,id(99));
  assert.doesNotMatch(JSON.stringify(r.body),/server_secret|do not return|recipient|actor_context/);
  assert.equal(f.calls.some(c=>/snapshot|entities|chat_messages|board_posts|notice_preferences/.test(c.path)),false);
 }
});

test('default Room scope and explicit president Space scope remain separate',async()=>{
 const f=fixture({role:'super_admin'});
 assert.equal((await f.invoke()).body.scope.streamerId,'papa');
 assert.deepEqual((await f.invoke({scopeMode:'space'})).body.scope,{spaceId:'space-001',streamerId:null,mode:'space'});
 for(const role of ['player','streamer_admin']){const g=fixture({role});assert.equal((await g.invoke({scopeMode:'space'})).status,400);assert.equal(g.rpcs().length,0);}
});

test('malformed category, page, snapshot or wrong Space rejects before category storage access',async()=>{
 for(const extra of [{category:'all'},{category:null},{page:-1},{page:100001},{page:1.1},{snapshotAt:'bad'},{snapshotAt:45},{snapshotId:'bad'},{spaceId:'space-002'},{scopeMode:'global'}]){
  const f=fixture(),r=await f.invoke(extra);assert.equal(r.status,400);assert.equal(f.rpcs().length,0);
 }
 const expired=fixture({expired:true});assert.equal((await expired.invoke()).status,400);assert.equal(expired.rpcs().length,0);
});

test('counts return authoritative separate center and badge categories without conversation receipts or notice contents',async()=>{
 const f=fixture(),r=await f.invoke({op:'messageCenterCounts'});assert.equal(r.status,200);
 assert.deepEqual(r.body.unreadByCategory,{system:1,message:2,board:1});assert.deepEqual(r.body.badgeUnreadByCategory,{system:1,message:0,board:1});
 assert.equal(f.rpcs().length,1);assert.doesNotMatch(JSON.stringify(r.body),/server_secret|do not return|rows|body|recipient/);
});

test('mark read requires explicit category-all or a unique bounded UUID batch and never marks chat receipts',async()=>{
 const f=fixture(),one=await f.invoke({op:'messageCenterRead',category:'board',ids:[id(1)]});assert.equal(one.status,200);assert.equal(one.body.marked,1);
 const all=await f.invoke({op:'messageCenterRead',category:'message',all:true});assert.equal(all.status,200);assert.equal(all.body.marked,8);
 assert.equal(f.rpcs()[0].body.category_filter,'board');assert.equal(f.rpcs()[1].body.notice_ids,null);
 assert.equal(f.calls.some(c=>/chat_read|push|papa_notifications/.test(c.path)),false);
 for(const extra of [{},{ids:[id(1),id(1)]},{ids:['bad']},{ids:Array(51).fill(id(1))},{ids:[id(1)],all:true}]){
  const g=fixture();assert.equal((await g.invoke({op:'messageCenterRead',category:'board',...extra})).status,400);assert.equal(g.rpcs().length,0);
 }
});

test('unexpected RPC scope, foreign recipient or category rows fail closed without returning another actor data',async()=>{
 const rows=[{id:id(1),space_id:'space-001',streamer_id:'papa',recipient:'P2',type:'completed',level:2,body:'Foreign private body',created_at:'2026-10-10T00:00:00Z',read_at:null}];
 for(const result of [{scope:{spaceId:'space-002',streamerId:'papa',mode:'room'}},{rows},{rows:Array(51).fill(rows[0])},{total:-1}]){
  const f=fixture({result}),r=await f.invoke();assert.equal(r.status,400);assert.doesNotMatch(JSON.stringify(r.body),/Foreign private body|server_secret/);
 }
});

test('missing migrations and transient errors never fall back to old global inbox or replay read writes',async()=>{
 for(const op of ['messageCenter','messageCenterCounts','messageCenterRead']){
  const f=fixture({error:{code:'PGRST202',message:'Missing function'},errorStatus:404}),r=await f.invoke({op,all:true});
  assert.equal(r.status,400);assert.equal(f.rpcs().length,1);assert.equal(f.calls.some(c=>/papa_notice_inbox|snapshot|entities/.test(c.path)),false);
 }
});

test('expired, unknown or foreign snapshots return one safe read-restart code, never a global fallback',async()=>{
 const f=fixture({error:{code:'P0001',message:'NOTICE_SNAPSHOT_INVALID'},errorStatus:400});
 const r=await f.invoke({snapshotId:id(99)});assert.equal(r.status,400);assert.equal(r.body.code,'NOTICE_SNAPSHOT_INVALID');
 assert.match(r.body.error,/第一頁/);assert.equal(f.rpcs().length,1);assert.equal('notCommitted'in r.body,false);
 const temporary=fixture({error:{code:'P0001',message:'NOTICE_SNAPSHOT_INVALID'},errorStatus:500});
 assert.equal((await temporary.invoke()).body.code,undefined,'a server failure cannot masquerade as a definite stale snapshot');
});

test('display settings are selected-scope only, bound to actual authority and cannot change delivery/audio/private settings',async()=>{
 for(const role of ['player','streamer_admin','super_admin']){
  const f=fixture({role}),settings={types:{message:{center:false,badge:true}}},result=await f.invoke({op:'messageCenterPreferences',settings,scopeMode:role==='super_admin'?'space':'room',recipient:'P2',actor_context:{account_id:id(999)}});
  assert.equal(result.status,200);assert.deepEqual(result.body.settings.types.message,{center:false,badge:true});assert.doesNotMatch(JSON.stringify(result.body),/server_secret|do not return/);
  const writes=f.calls.filter(c=>c.path.endsWith('/papa_notice_center_preferences_set'));assert.equal(writes.length,1);assert.deepEqual(writes[0].body.display_settings,settings);assert.equal(writes[0].body.actor_context.account_id,id(10));assert.equal(f.calls.some(c=>c.path.includes('/papa_notice_preferences?')),false);
 }
 for(const settings of [{muteAll:true,types:{}},{types:{message:{center:true,badge:true,push:true}}},{types:{unknown:{center:true,badge:true}}},{types:{message:{center:'yes',badge:true}}},[]]){const f=fixture(),r=await f.invoke({op:'messageCenterPreferences',settings});assert.equal(r.status,400);assert.equal(f.calls.some(c=>c.path.endsWith('/papa_notice_center_preferences_set')),false);}
 const forged=fixture({result:{scope:{spaceId:'foreign',streamerId:'papa',mode:'room'}}});assert.equal((await forged.invoke({op:'messageCenterPreferences'})).status,400);
});
