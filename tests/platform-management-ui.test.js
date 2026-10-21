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

test('explicit pending or revoked management capabilities cannot read or mutate the centre',async()=>{
 const calls=[];let capabilities={};const c=createPlatformManagement({api:async body=>{calls.push(body);return page();},identity:()=> 'verified',capabilities:()=>capabilities,escape,changed:()=>{}});
 await c.load({section:'halls'});await c.openDetail({id:'h'});assert.equal(await c.mutate('create',{name:'forged'}),false);assert.equal(calls.length,0);assert.ok(!c.html().includes('data-pm-action="section"'));
 capabilities={allowed:true,president:false,permissions:{reports:true},sections:['overview']};await c.load();assert.equal(calls.length,1);await c.load({section:'accounts'});assert.equal(calls.length,1);assert.ok(!c.html().includes('新增廳'));
 capabilities={allowed:false};c.sync();assert.equal(c.state().loaded,false);assert.deepEqual(c.state().rows,[]);
});
test('scoped membership admin sees verified grant tools without president-only actions',async()=>{
 const calls=[];const capabilities={allowed:true,president:false,permissions:{administrators:true},sections:['overview','halls','accounts']};
 const detail={space:{id:'h',name:'Hall',status:'active',revision:1},memberships:[],canManageMemberships:true,canEditSpace:false};
 const c=createPlatformManagement({api:async body=>{calls.push(body);return body.op==='platformManagementDetail'?detail:page([{id:'h',name:'Hall'}]);},identity:()=> 'verified',capabilities,escape,changed:()=>{}});
 await c.load({section:'halls'});await c.openDetail({id:'h'});const html=c.html();assert.match(html,/data-pm-form="membership"/);assert.ok(!html.includes('data-pm-form="edit-space"'));for(const action of ['create-space','create-streamer','suspend','credentials','dependencies'])assert.ok(!html.includes('data-pm-action="'+action+'"'));
 assert.equal(await c.mutate('suspend',{spaceId:'h'}),false);assert.equal(await c.mutate('edit',{spaceId:'h',name:'forged'}),false);assert.equal(calls.length,2);
 await c.load({section:'streamers'});assert.equal(calls.length,2);
});
test('detail results are discarded after navigation or a verified account change',async()=>{
 let resolve,actor='A';const c=createPlatformManagement({api:body=>body.op==='platformManagementDetail'?new Promise(r=>resolve=r):Promise.resolve(page()),identity:()=>actor,escape,changed:()=>{}});
 const detail=c.openDetail({id:'h'});await c.load({section:'accounts'});resolve({space:{id:'h',name:'private'},memberships:[]});await detail;assert.equal(c.state().editor,null);
 const next=c.openDetail({id:'h'});actor='B';c.sync();resolve({space:{id:'h',name:'private'},memberships:[]});await next;assert.equal(c.state().editor,null);
});
