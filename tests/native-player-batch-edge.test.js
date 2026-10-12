import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {empty,TABLES,DEFAULTS,mutate,upgradePlatform,scopeState} from '../src/core.js';
import {stateChanges} from '../src/state-patch.js';
import {deriveNotices} from '../src/notification-rules.js';
import {isSuper,coreActor} from '../src/access-policy.js';
import {buildNativePlayerBindings} from '../src/native-player-bindings.js';

const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8'),lines=source.split(/\r?\n/);
function declaration(name){
 const start=lines.findIndex(line=>line.startsWith('async function '+name+'('));assert.ok(start>=0,name);
 const end=lines.findIndex((line,index)=>index>start&&line==='}');assert.ok(end>start,name+' closes');return lines.slice(start,end+1).join('\n');
}
const start=source.indexOf(" if(b.op==='nativePlayerEligibility'){"),end=source.indexOf(" if(b.op==='playerArchive'",start);
assert.ok(start>=0&&end>start);
const conflictHelpers=source.slice(source.indexOf('const revisionConflictMessage='),source.indexOf('async function api('));
const code=stripTypeScriptTypes(conflictHelpers+'\n'+lines.find(line=>line.startsWith('function snapshotState('))+'\n'+declaration('commit')+'\nasync function request(b,who){const t="2026-10-11T08:00:00Z";'+source.slice(start,end)+'}');
const space='native-batch-space',room='native-batch-room',uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const plain=value=>JSON.parse(JSON.stringify(value));
const rows=(count=100)=>Array.from({length:count},(_,index)=>({accountId:uuid(index+10),membershipId:uuid(index+1010),
 name:'  Player '+index+'  ',ids:'platform-'+index,names:'Previous '+index,certification:'Verified '+index,note:'Private note '+index}));
function edge(outcome='success'){
 const existing={playerId:'EXISTING',name:'Protected player',ids:['existing-platform'],names:[],note:'Existing note'};
 const snapshot={revision:7,canonicalRoom:room,canonicalSpace:{id:space},rows:[
  {kind:'settings',id:'1',data:structuredClone(DEFAULTS)},
  {kind:'meta',id:'1',data:{schemaVersion:3,streamers:[{id:room,slug:room,display_name:'Native Room',active:true,spaceId:space}],streamerSettings:{[room]:structuredClone(DEFAULTS)}}},
  {kind:'players',id:existing.playerId,data:existing},
  {kind:'songs',id:'S-KEEP',data:{songId:'S-KEEP',streamer_id:room,title:'Protected song',artist:'Artist',tags:['Keep']}},
  {kind:'queue',id:'Q-KEEP',data:{id:'Q-KEEP',streamer_id:room,playerId:existing.playerId,title:'Protected history',status:'completed',kind:'live',at:'2026-10-01T00:00:00Z'}},
  {kind:'ledger',id:'L-KEEP',data:{id:'L-KEEP',streamer_id:room,playerId:existing.playerId,amount:12,note:'Protected balance',at:'2026-10-01T00:00:00Z'}}
 ]};
 const before=structuredClone(snapshot),calls=[],who={role:'super_admin',accountId:uuid(1)},scheduled=[];
 const context=vm.createContext({empty,TABLES,mutate,upgradePlatform,scopeState,stateChanges,deriveNotices,isSuper,coreActor,buildNativePlayerBindings,
  respond:value=>value,schedulePush:(...args)=>scheduled.push(args),api:async(path,body)=>{
   calls.push({path,body:plain(body)});
   if(path.endsWith('papa_streamer_registry_snapshot'))return structuredClone(snapshot);
   if(path.endsWith('papa_native_player_eligibility_page'))return {revision:7,rows:[],total:83};
   if(path.endsWith('papa_room_admin_commit_with_player_bindings')){
    if(outcome==='reject')throw Object.assign(Error('VERSION_CONFLICT'),{rpcRejected:true});
    if(outcome==='transport')throw Error('Lost acknowledgment');
    return 8;
   }
   throw Error('Unexpected database operation: '+path);
  }});
 vm.runInContext(code,context);
 const invoke=async(extra={})=>{context.body={op:'nativePlayerProvision',streamer:room,spaceId:space,revision:7,rows:rows(),...extra};context.who=who;return vm.runInContext('request(body,who)',context);};
 return {invoke,calls,scheduled,snapshot,before,who};
}

test('100 explicit native profiles use one original transaction and return generated IDs in input order',async()=>{
 const f=edge(),input=rows(),result=plain(await f.invoke({rows:input}));
 assert.equal(result.revision,8);assert.equal(result.created.length,100);assert.equal(new Set(result.created.map(row=>row.playerId)).size,100);
 assert.deepEqual(result.created.map(row=>row.name),input.map(row=>row.name.trim()));assert.deepEqual(Object.keys(result),['revision','created']);
 const writes=f.calls.filter(call=>call.path.endsWith('papa_room_admin_commit_with_player_bindings'));
 assert.equal(f.calls.length,2);assert.equal(writes.length,1);assert.ok(f.calls[0].path.endsWith('papa_streamer_registry_snapshot'));
 const write=writes[0].body;assert.equal(write.expected,7);assert.equal(write.requested_room,room);assert.equal(write.actor_context.account_id,f.who.accountId);assert.equal(write.actor_context.space_id,space);
 assert.deepEqual(write.player_bindings,result.created.map((created,index)=>({player_id:created.playerId,account_id:input[index].accountId,membership_id:input[index].membershipId})));
 assert.equal(write.changes.length,100);assert.ok(write.changes.every(row=>row.kind==='players'));assert.deepEqual(write.removed,[]);assert.deepEqual(write.notices,[]);
 for(const [index,change] of write.changes.entries()){
  assert.equal(change.id,result.created[index].playerId);assert.equal(change.data.playerId,result.created[index].playerId);assert.equal(change.data.note,input[index].note);
  assert.equal(change.data.certification,input[index].certification);assert.deepEqual(change.data.ids,[input[index].ids]);
  for(const key of ['password','accountId','membershipId','spaceId'])assert.equal(Object.hasOwn(change.data,key),false);
 }
 assert.deepEqual(f.snapshot,f.before,'read source and all original songs/history/balances stay unchanged');assert.equal(f.scheduled.length,1);
});

test('a duplicate explicit identity in the 100th row rejects the whole batch before any commit',async()=>{
 for(const key of ['accountId','membershipId']){
  const f=edge(),input=rows();input.at(-1)[key]=input[0][key].toUpperCase();
  await assert.rejects(f.invoke({rows:input}),/綁定/);assert.equal(f.calls.length,1);assert.equal(f.scheduled.length,0);assert.deepEqual(f.snapshot,f.before);
 }
});

test('a Core platform ID conflict in the final row publishes no earlier profiles or business changes',async()=>{
 for(const duplicate of ['existing-platform','platform-0']){
  const f=edge(),input=rows();input.at(-1).ids=duplicate;
  await assert.rejects(f.invoke({rows:input}),/平台 ID 已綁定/);assert.equal(f.calls.length,1);assert.equal(f.scheduled.length,0);assert.deepEqual(f.snapshot,f.before);
 }
});

test('batch bounds and injected profile fields reject before even reading a registry',async()=>{
 for(const input of [[],rows(101),rows().map((row,index)=>index===99?{...row,balance:5}:row),rows().map((row,index)=>index===99?{...row,password:'secret'}:row)]){
  const f=edge();await assert.rejects(f.invoke({rows:input}),/資料不正確|欄位不正確/);assert.equal(f.calls.length,0);assert.equal(f.scheduled.length,0);
 }
});

test('a failed batch commit is attempted once and does not return generated success IDs or schedule notifications',async()=>{
 for(const outcome of ['reject','transport']){
  const f=edge(outcome);await assert.rejects(f.invoke(),/VERSION_CONFLICT|Lost acknowledgment/);
  assert.equal(f.calls.length,2);assert.equal(f.calls.filter(call=>call.path.endsWith('papa_room_admin_commit_with_player_bindings')).length,1);
  assert.equal(f.scheduled.length,0);assert.deepEqual(f.snapshot,f.before);
 }
});

test('eligibility page 4 asks for only20 rows at offset80 using verified President context',async()=>{
 const f=edge(),result=plain(await f.invoke({op:'nativePlayerEligibility',query:' verified ',page:4,management:true,actor_context:{account_id:uuid(999)}}));
 assert.deepEqual(result,{revision:7,rows:[],total:83});assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0].body,{requested_space:space,actor_context:{role:'super_admin',account_id:f.who.accountId,space_id:space,streamer_id:null},query_text:'verified',page_limit:20,page_offset:80});
});
