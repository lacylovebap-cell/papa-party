import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPlatformManagement} from '../src/platform-management.js';
const page=(rows=[],rest={})=>({rows,total:rows.length,page:1,pages:1,registryRevision:7,...rest});
const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('management keeps five sections, bounded paging, escaped metadata and rejects stale responses',async()=>{
 let actor={id:'president'};const pending=[],controller=createPlatformManagement({api:b=>new Promise(resolve=>pending.push({b,resolve})),identity:()=>actor,escape,changed:()=>{}});
 const old=controller.load({section:'halls',q:'old'}),latest=controller.load({section:'streamers',q:'new',page:2});
 pending[1].resolve(page([{id:'s',name:'<img src=x onerror=alert(1)>',spaceName:'Hall',spaceId:'h'}],{total:21,page:2,pages:2}));await latest;pending[0].resolve(page([{id:'stale'}]));await old;
 assert.equal(controller.state().section,'streamers');assert.equal(controller.state().rows[0].id,'s');assert.match(controller.html(),/共 2 頁/);assert.ok(!controller.html().includes('<img'));
 for(const section of ['總覽','廳管理','主播管理','帳號與權限','停用與清理'])assert.ok(controller.html().includes(section));
 const inflight=controller.load();controller.clear();pending[2].resolve(page([{id:'private'}]));await inflight;assert.deepEqual(controller.state().rows,[]);
 const another=controller.load();actor={};controller.sync();pending[3].resolve(page([{id:'different-account'}]));await another;assert.deepEqual(controller.state().rows,[]);
});
test('management mutations reuse request key after uncertain result and never auto-retry',async()=>{
 const calls=[];let fail=true;const c=createPlatformManagement({api:async b=>{calls.push(b);if(b.op==='platformManageSpace'){if(fail)throw Error('connection lost');return {ok:true};}return page();},identity:()=> 'president',escape,changed:()=>{},uuid:()=> 'fixed-operation'});
 const payload={spaceId:'h',revision:2,name:'Hall'};assert.equal(await c.mutate('edit',payload),false);assert.equal(calls.length,1);fail=false;assert.equal(await c.mutate('edit',payload),true);
 assert.equal(calls[0].operationId,calls[1].operationId);assert.equal(calls[2].op,'platformManagementDirectory');
});
test('leaving management during write prevents late response from loading private data again',async()=>{
 let resolve;const calls=[];const c=createPlatformManagement({api:b=>{calls.push(b);return new Promise(r=>resolve=r);},identity:()=> 'president',escape,changed:()=>{},uuid:()=> 'one'});
 const write=c.mutate('suspend',{spaceId:'h',revision:1});c.clear();resolve({ok:true});assert.equal(await write,false);assert.equal(calls.length,1);assert.deepEqual(c.state().rows,[]);
});
test('Edge management handlers use verified subject and validate scope before invoking RPC',async()=>{
 const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8');const start=source.indexOf(" if(b.op==='platformManagementDetail'){");const code=source.slice(start,source.indexOf(" if(b.op==='platformDirectory'){",start));
 const calls=[];const fn=new(Object.getPrototypeOf(async function(){}).constructor)('b','who','isSuper','api','respond','mutateStreamerRegistry','t',code);
 const api=async(path,args)=>{calls.push({path,args});return {ok:true};};const invoke=(b,who={accountId:'verified',role:'super_admin'})=>fn(b,who,w=>w?.role==='super_admin',api,x=>x,async()=>{throw Error('unexpected registry');},'now');
 await invoke({op:'platformManagementDetail',accountId:'forged',spaceId:'h',streamerId:'s',q:'',page:1});assert.equal(calls[0].args.subject,'verified');assert.equal(calls[0].args.requested_space,'h');
 await assert.rejects(invoke({op:'platformManagementDependencies',spaceId:'h',streamerId:'s'},{accountId:'other',role:'player'}),/總裁/);
 await assert.rejects(invoke({op:'platformManagementDetail',spaceId:'h',q:'',page:0}),/格式/);assert.equal(calls.length,1);
});
