import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {createManagementProvision,validPassword,blankRoomSettings,MANAGEMENT_PROVISION_MESSAGES} from '../supabase/functions/party-api/management-provision.js';
import {DEFAULTS} from '../src/core.js';

const president={role:'super_admin',accountId:'0f4c1a52-6a1d-4d8e-9a4b-1b2c3d4e5f60'};
const op='11111111-2222-4333-8444-555555555555';
function harness(){
 const calls=[];
 const api=async(path,args)=>{calls.push({path,args});return {ok:true,exists:true,enabled:false};};
 const m=createManagementProvision({api,defaults:DEFAULTS,adminUser:'admin-user',uuid:()=>'room-uuid',now:()=>'2026-10-28T00:00:00.000Z'});
 return {m,calls};
}

test('every provisioning operation rejects non-presidents before any database call',async()=>{
 const {m,calls}=harness();
 const actors=[null,{role:'player',accountId:president.accountId},{role:'streamer_admin',accountId:president.accountId},{role:'super_admin'},{role:'super_admin',accountId:'forged'}];
 for(const who of actors)for(const [name,body] of [['accounts',{q:'',page:1}],['provision',{operationId:op,mode:'streamer'}],['login',{operationId:op}],
  ['loginStatus',{}],['readiness',{}],['deleteReview',{}],['remove',{operationId:op}]])
  await assert.rejects(m[name](body,who),/僅限平台總裁/);
 assert.equal(calls.length,0);
});

test('independent provisioning builds one atomic request with blank settings and keeps the password out of the payload',async()=>{
 const {m,calls}=harness();
 await m.provision({operationId:op,mode:'independent',spaceName:' 仙女 ',descriptor:{display_name:'仙女',slug:'fairy'},password:'fairy-pass-1',loginEnabled:true,accountId:'forged'},president);
 assert.equal(calls.length,1);const {path,args}=calls[0];
 assert.equal(path,'/rest/v1/rpc/papa_management_provision_streamer');
 assert.equal(args.subject,president.accountId);assert.equal(args.operation,op);assert.equal(args.password,'fairy-pass-1');assert.equal(args.auth_user,'admin-user');
 assert.equal(args.payload.spaceName,'仙女');assert.equal(args.payload.mode,'independent');assert.equal(args.payload.loginEnabled,true);
 assert.deepEqual(args.payload.room,{id:'room-uuid',slug:'fairy',display_name:'仙女',home_title:'仙女',subtitle:'',description:'',avatar_url:'',banner_url:'',active:true,created_at:'2026-10-28T00:00:00.000Z',updated_at:'2026-10-28T00:00:00.000Z'});
 assert.deepEqual(args.payload.settings,blankRoomSettings(),'a new Space starts blank, nothing copied from 聲瑪');
 assert.deepEqual([args.payload.settings.livePrice,args.payload.settings.tiers,args.payload.settings.plans,args.payload.settings.hourlyLimit],[0,[],[],0]);
 assert.ok(!JSON.stringify(args.payload).includes('fairy-pass-1'));assert.ok(!('spaceId' in args.payload));
 await assert.rejects(m.provision({operationId:op,mode:'independent',spaceName:'仙女',spaceId:'hall-1',descriptor:{display_name:'仙女',slug:'fairy'}},president),/不需要選擇所屬廳/);
 await assert.rejects(m.provision({operationId:op,mode:'independent',spaceName:'',descriptor:{display_name:'仙女',slug:'fairy'}},president),/空間名稱/);
 assert.equal(calls.length,1);
});

test('streamer creation, editing and validation: login code rules, password rules and no client-supplied private fields',async()=>{
 const {m,calls}=harness();
 await m.provision({operationId:op,mode:'streamer',spaceId:'hall-1',descriptor:{display_name:'星星',slug:'star',subtitle:'副標'},password:'star-pass',loginEnabled:true},president);
 assert.equal(calls[0].args.payload.spaceId,'hall-1');assert.deepEqual(calls[0].args.payload.settings,blankRoomSettings());
 await m.provision({operationId:op,mode:'streamer',spaceId:'space-001',descriptor:{display_name:'聲瑪新人',slug:'sm-new'}},president);
 assert.deepEqual(calls.at(-1).args.payload.settings,{...structuredClone(DEFAULTS),tags:[]},'聲瑪 keeps its current defaults');calls.pop();
 await m.provision({operationId:op,mode:'streamer',spaceId:'hall-1',descriptor:{id:'existing',display_name:'星星改',slug:'star',active:false},expectedRevision:7},president);
 assert.deepEqual(calls[1].args.payload,{mode:'streamer',room:{id:'existing',slug:'star',display_name:'星星改',home_title:'星星改',subtitle:'',active:false},spaceId:'hall-1',expectedRevision:7});
 assert.equal(calls[1].args.password,null);
 for(const [descriptor,pattern] of [[{display_name:'x',slug:'Bad Slug'},/登入代碼/],[{display_name:'x',slug:'-bad'},/登入代碼/],[{display_name:'',slug:'ok'},/主播名稱/],
  [{display_name:'x',slug:'ok',avatar_url:'javascript:alert(1)'},/格式/],[{display_name:'x',slug:'ok',active:'yes'},/格式/],[null,/格式/]])
  await assert.rejects(m.provision({operationId:op,mode:'streamer',spaceId:'hall-1',descriptor},president),pattern);
 for(const password of ['abc','x'.repeat(73),'密'.repeat(25),'bad\npass',12345])assert.throws(()=>validPassword(password),/4～72/);
 assert.equal(validPassword(''),null);assert.equal(validPassword(undefined),null);
 await assert.rejects(m.provision({operationId:op,mode:'streamer',spaceId:'hall-1',descriptor:{display_name:'x',slug:'ok'},password:'good-pass'},president),/是否允許/);
 await assert.rejects(m.provision({operationId:'not-a-uuid',mode:'streamer',spaceId:'hall-1',descriptor:{display_name:'x',slug:'ok'}},president),/格式/);
 await assert.rejects(m.provision({operationId:op,mode:'hall',spaceId:'hall-1',descriptor:{display_name:'x',slug:'ok'}},president),/格式/);
 assert.equal(calls.length,2);
});

test('login, status, readiness, review and delete pass only validated scope and confirmation fields',async()=>{
 const {m,calls}=harness();
 await m.login({operationId:op,spaceId:'hall-1',streamerId:'room-1',enabled:true,password:'new-pass-1',accountId:'forged'},president);
 assert.deepEqual(calls[0].args,{subject:president.accountId,operation:op,payload:{spaceId:'hall-1',streamerId:'room-1',enabled:true},password:'new-pass-1',auth_user:'admin-user'});
 await assert.rejects(m.login({operationId:op,spaceId:'hall-1',streamerId:'room-1',enabled:'true'},president),/格式/);
 assert.deepEqual(await m.loginStatus({spaceId:'hall-1',streamerId:'room-1'},president),{ok:true,exists:true,enabled:false});
 await m.readiness({spaceId:'hall-1'},president);assert.equal(calls.at(-1).path,'/rest/v1/rpc/papa_management_space_readiness');
 await m.deleteReview({spaceId:'hall-1'},president);assert.equal(calls.at(-1).args.requested_streamer,null);
 const token='0123456789abcdef0123456789abcdef';
 await m.remove({operationId:op,spaceId:'hall-1',streamerId:'room-1',confirmationToken:token,confirmedName:'主播'},president);
 assert.deepEqual(calls.at(-1).args,{subject:president.accountId,operation:op,payload:{spaceId:'hall-1',streamerId:'room-1',confirmationToken:token,confirmedName:'主播'}});
 await m.remove({operationId:op,spaceId:'hall-1',confirmationToken:token,confirmedName:'廳'},president);assert.ok(!('streamerId' in calls.at(-1).args.payload));
 const count=calls.length;
 for(const body of [{spaceId:'hall-1',confirmationToken:'short',confirmedName:'x'},{spaceId:'',confirmationToken:token,confirmedName:'x'},{spaceId:'h',confirmationToken:token,confirmedName:5}])
  await assert.rejects(m.remove({operationId:op,...body},president),/不正確/);
 await assert.rejects(m.accounts({q:'x'.repeat(101),page:1},president),/格式/);await assert.rejects(m.accounts({q:'',page:0},president),/格式/);
 assert.equal(calls.length,count);
});

test('bundled Edge dispatches provisioning ops only for verified presidents and maps database codes to plain messages',async()=>{
 const out=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'papa-edge-')),'bundle.txt');
 execFileSync(process.execPath,['build-edge.mjs'],{env:{...process.env,PAPA_EDGE_BUNDLE_OUT:out}});
 const source=fs.readFileSync(out,'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};');
 let handler;const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,TextDecoder,console,Date,Response,fetch:async()=>{throw Error('no network');},
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.supabase.co':k==='PAPA_ADMIN_USER_ID'?'admin-user':'test'},serve:h=>handler=h}});
 vm.runInContext(stripTypeScriptTypes(source),context);
 const calls=[];context.stubApi=async(path,body)=>{calls.push({path,body});return {rows:[],total:0,page:1,pages:1};};
 context.stubActor=async()=>context.currentActor;
 vm.runInContext('api=stubApi;actor=stubActor;',context);
 const call=async body=>{const r=await handler({method:'POST',json:async()=>body});return {status:r.status,body:await r.json()};};
 context.currentActor={role:'streamer_admin',accountId:president.accountId,streamer_id:'papa',spaceId:'space-001'};
 const denied=await call({op:'platformAccounts',q:'',page:1,token:'streamer:x'});
 assert.equal(denied.status,400);assert.match(denied.body.error,/總裁/);assert.equal(calls.length,0);
 context.currentActor={...president};
 const ok=await call({op:'platformAccounts',q:'',page:1,token:'admin:x'});
 assert.equal(ok.status,200);assert.equal(calls[0].path,'/rest/v1/rpc/papa_management_account_list');assert.equal(calls[0].body.subject,president.accountId);
 assert.equal((await call({op:'releaseInfo'})).body.managementProvision,1);
 const messages=vm.runInContext('MANAGEMENT_PROVISION_MESSAGES',context);
 assert.equal(messages.DELETE_PREVIEW_STALE,MANAGEMENT_PROVISION_MESSAGES.DELETE_PREVIEW_STALE);
 const edge=fs.readFileSync('supabase/functions/party-api/index.ts','utf8');
 assert.match(edge,/Object\.assign\(messages,MANAGEMENT_PROVISION_MESSAGES\)/);
});

test('streamer login in a new (suspended) Space explains that operations are not open yet; unknown, deleted and Space-less codes stay "not found"',async()=>{
 const out=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'papa-edge-')),'bundle.txt');
 execFileSync(process.execPath,['build-edge.mjs'],{env:{...process.env,PAPA_EDGE_BUNDLE_OUT:out}});
 const source=fs.readFileSync(out,'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};');
 let handler;const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,TextDecoder,console,Date,Response,fetch:async()=>{throw Error('no network');},
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.supabase.co':k==='PAPA_ADMIN_USER_ID'?'admin-user':'test'},serve:h=>handler=h}});
 vm.runInContext(stripTypeScriptTypes(source),context);
 const calls=[];
 context.stubApi=async(path,body)=>{
  calls.push(path);
  if(path.startsWith('/rest/v1/rpc/papa_streamer_directory'))return [];
  if(path.startsWith('/rest/v1/papa_v2_entities?kind=eq.meta'))return [{streamers:[{id:'room-new',slug:'new-star'},{id:'room-gone',slug:'gone-star'},{id:'room-orphan',slug:'orphan-star'},{id:'room-deleted-space',slug:'deleted-space-star'}]}];
  if(path.includes('papa_space_streamers?streamer_id=eq.room-new&'))return [{space_id:'space-new'}];
  if(path.includes('papa_space_streamers?streamer_id=eq.room-deleted-space&'))return [{space_id:'space-deleted'}];
  if(path.includes('papa_space_streamers?'))return [];
  if(path.startsWith('/rest/v1/papa_spaces?id=eq.space-new&')&&path.includes('deleted_at=is.null'))return [{id:'space-new'}];
  if(path.startsWith('/rest/v1/papa_spaces?'))return [];
  throw Error('unexpected '+path);
 };
 vm.runInContext('api=stubApi;',context);
 const call=async body=>{const r=await handler({method:'POST',json:async()=>body});return {status:r.status,body:await r.json()};};
 for(const code of ['new-star','room-new']){
  const r=await call({op:'streamerLogin',streamer:code,password:'whatever-1'});
  assert.equal(r.status,400);assert.match(r.body.error,/營運功能尚未開放/);
 }
 for(const code of ['nobody','gone-star','orphan-star','deleted-space-star','']){
  const r=await call({op:'streamerLogin',streamer:code,password:'whatever-1'});
  assert.equal(r.status,400);assert.doesNotMatch(r.body.error,/尚未開放/,code);
 }
 assert.ok(!calls.some(p=>p.includes('papa_manager_login')),'the credential check is never reached for a Space that is not open');
});
