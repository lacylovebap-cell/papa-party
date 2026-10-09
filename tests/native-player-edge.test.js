import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {DEFAULTS} from '../src/core.js';

execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
const code=stripTypeScriptTypes(fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};'));
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const space='new-space',room='new-room';
function edge(){
 const calls=[];let handler;
 const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://fixture.test':'fixture'},serve:h=>handler=h},EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('Unexpected network');}});
 vm.runInContext(code,context);
 context.testActor={role:'super_admin',accountId:uuid(1),spaceId:'space-001'};
 context.mockApi=async(path,body)=>{
  calls.push({path,body:structuredClone(body)});
  if(path.endsWith('papa_native_player_eligibility_page'))return {revision:7,rows:[{accountId:uuid(2),membershipId:uuid(102),spaceId:space,displayLabel:'已核對玩家'}],total:1};
  if(path.endsWith('papa_streamer_registry_snapshot'))return {revision:7,canonicalRoom:room,canonicalSpace:{id:space},rows:[{kind:'settings',id:'1',data:structuredClone(DEFAULTS)},{kind:'meta',id:'1',data:{schemaVersion:3,streamers:[{id:room,slug:'next',display_name:'新主播',active:true,spaceId:space}],streamerSettings:{[room]:structuredClone(DEFAULTS)}}}]};
  if(path.endsWith('papa_room_admin_commit_with_player_bindings'))return 8;
  throw Error('Unexpected database read: '+path);
 };
 vm.runInContext('actor=async()=>testActor;api=async(path,body)=>mockApi(path,body);schedulePush=()=>{};',context);
 return {context,calls,request:async body=>{const r=await handler({method:'POST',json:async()=>body});return {status:r.status,data:JSON.parse(await r.text())};}};
}
const provision={op:'nativePlayerProvision',streamer:room,spaceId:space,revision:7,rows:[{accountId:uuid(2),membershipId:uuid(102),name:'玩家',ids:'ID-A',names:'旧名',note:'個人註記'}]};

test('native eligibility uses one bounded identity-verified RPC without a song or history snapshot',async()=>{
 const e=edge(),r=await e.request({op:'nativePlayerEligibility',spaceId:space,query:' 玩家 ',page:2,limit:10,actor_context:{account_id:uuid(99)}});
 assert.equal(r.status,200);assert.equal(r.data.rows.length,1);assert.equal(e.calls.length,1);
 assert.deepEqual(e.calls[0].body,{requested_space:space,actor_context:{role:'super_admin',account_id:uuid(1),space_id:space,streamer_id:null},query_text:'玩家',page_limit:10,page_offset:20});
});

test('native provisioning uses explicit mappings and one original batch transaction without creating Accounts',async()=>{
 const e=edge(),r=await e.request({...provision,actor_context:{account_id:uuid(99)}});assert.equal(r.status,200);assert.equal(r.data.revision,8);assert.equal(r.data.created.length,1);
 assert.equal(e.calls.length,2);assert.ok(e.calls[0].path.endsWith('papa_streamer_registry_snapshot'));const write=e.calls[1];assert.ok(write.path.endsWith('papa_room_admin_commit_with_player_bindings'));
 assert.equal(write.body.actor_context.account_id,uuid(1));assert.equal(write.body.actor_context.space_id,space);assert.equal(write.body.requested_room,room);assert.equal(write.body.expected,7);
 assert.deepEqual(write.body.player_bindings,[{player_id:r.data.created[0].playerId,account_id:uuid(2),membership_id:uuid(102)}]);
 assert.equal(write.body.changes.filter(c=>c.kind==='players').length,1);const profile=write.body.changes.find(c=>c.kind==='players').data;assert.equal(profile.name,'玩家');assert.equal(profile.note,'個人註記');assert.equal(profile.password,undefined);assert.equal(profile.accountId,undefined);
 assert.deepEqual(write.body.removed,[]);assert.equal(e.calls.some(c=>/accounts|memberships|sessions/.test(c.path)),false);
});

test('native eligibility and provision reject unauthorized actors, legacy or wrong scopes and stale revisions',async()=>{
 for(const actor of [null,{role:'player',accountId:uuid(2)},{role:'streamer_admin',accountId:uuid(3),streamer_id:room},{role:'super_admin'}]){
  const e=edge();e.context.testActor=actor;for(const body of [provision,{op:'nativePlayerEligibility',spaceId:space}])assert.equal((await e.request(body)).status,400);assert.equal(e.calls.length,0);
 }
 for(const body of [{...provision,spaceId:'space-001'},{...provision,spaceId:'another-space'},{...provision,revision:6}]){const e=edge();assert.equal((await e.request(body)).status,400);assert.equal(e.calls.some(c=>c.path.endsWith('commit_with_player_bindings')),false);}
});

test('native provision rejects inferred, duplicate and credential-bearing identities before any write',async()=>{
 for(const rows of [[{name:'沒有選帳號'}],[{...provision.rows[0],password:'secret'}],[{...provision.rows[0],accountId:'not-a-uuid'}],[provision.rows[0],{...provision.rows[0],name:'同帳號另一人'}],Array(101).fill(provision.rows[0])]){
  const e=edge();assert.equal((await e.request({...provision,rows})).status,400);assert.equal(e.calls.some(c=>c.path.endsWith('commit_with_player_bindings')),false);
 }
 for(const body of [{op:'nativePlayerEligibility',spaceId:space,limit:51},{op:'nativePlayerEligibility',spaceId:space,page:-1},{op:'nativePlayerEligibility',spaceId:space,query:'x'.repeat(101)}]){const e=edge();assert.equal((await e.request(body)).status,400);assert.equal(e.calls.length,0);}
});
