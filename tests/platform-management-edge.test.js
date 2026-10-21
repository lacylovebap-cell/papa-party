import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const segment=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const president={role:'super_admin',accountId:'verified-president'};
const isSuper=who=>who?.role==='super_admin';
const credentialHandler=new AsyncFunction('b','who','isSuper','managerRoom','api','respond',segment(" if(b.op==='platformStreamerCredentials'){"," if(b.op==='streamerAccounts')"));

test('credential lookup rejects unauthorized actors before reading room or credentials',async()=>{
 for(const who of [null,{role:'player',accountId:'p'},{role:'streamer_admin',accountId:'s'}, {role:'super_admin'}]){
  let reads=0;
  await assert.rejects(credentialHandler({op:'platformStreamerCredentials',spaceId:'h',streamerId:'s'},who,isSuper,async()=>{reads++;},async()=>{reads++;},x=>x),/總裁/);
  assert.equal(reads,0);
 }
});

test('credential lookup validates canonical hall and never exposes password fields',async()=>{
 let reads=0;
 const invoke=(spaceId,result)=>credentialHandler({op:'platformStreamerCredentials',spaceId,streamerId:'requested'},president,isSuper,async()=>({id:'canonical',spaceId:'hall'}),async path=>{reads++;assert.equal(path,'/rest/v1/papa_streamer_accounts?select=enabled&streamer_id=eq.canonical&limit=1');return result;},x=>x);
 await assert.rejects(invoke('other',[]),/不屬於/);assert.equal(reads,0);
 assert.deepEqual(await invoke('hall',[{enabled:false,password:'must-not-escape'}]),{exists:true,enabled:false});
 assert.deepEqual(await invoke('hall',[]),{exists:false,enabled:false});
 await assert.rejects(invoke('hall',[{enabled:'true'}]),/尚未確認/);
 await assert.rejects(invoke('hall',[{enabled:true},{enabled:false}]),/尚未確認/);
});

test('management write uses verified actor and rejects malformed operations without RPC',async()=>{
 const handler=new AsyncFunction('b','who','api','respond',segment(" if(b.op==='platformManageSpace'){"," if(b.op==='platformManagementDetail'){"));
 const calls=[];const api=async(path,args)=>{calls.push({path,args});return {ok:true};};
 const body={op:'platformManageSpace',operationId:'12345678-1234-1234-1234-123456789abc',action:'edit',payload:{spaceId:'h',revision:2,name:'Hall'},accountId:'forged'};
 await handler(body,president,api,x=>x);
 assert.equal(calls[0].args.subject,president.accountId);assert.deepEqual(calls[0].args.payload,body.payload);
 for(const patch of [{operationId:'bad'},{action:'delete'},{payload:[]},{payload:null}])await assert.rejects(handler({...body,...patch},president,api,x=>x),/格式/);
 await assert.rejects(handler(body,null,api,x=>x),/登入/);assert.equal(calls.length,1);
});
