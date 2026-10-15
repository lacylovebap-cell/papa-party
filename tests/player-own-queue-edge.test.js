import {roomBadgeChanges} from '../supabase/functions/party-api/badge-state.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {empty,mutate} from '../src/core.js';
import {applyOwnQueueBatch,validateOwnQueueBatch} from '../src/player-bulk-tools.js';
import {stateChanges} from '../src/state-patch.js';
import {deriveNotices} from '../src/notification-rules.js';
import {coreActor} from '../src/access-policy.js';

const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8'),lines=source.split(/\r?\n/);
function declaration(name){
 const start=lines.findIndex(line=>line.startsWith('async function '+name+'('));assert.ok(start>=0,name);
 const end=lines.findIndex((line,index)=>index>start&&line==='}');assert.ok(end>start,name+' closes');return lines.slice(start,end+1).join('\n');
}
const start=source.indexOf(" if(b.op==='ownQueueBatch'){"),end=source.indexOf(" if(b.op==='requestsBatch'){",start);
assert.ok(start>=0&&end>start);
const conflictHelpers=source.slice(source.indexOf('const revisionConflictMessage='),source.indexOf('async function api('));
const code=stripTypeScriptTypes(conflictHelpers+'\n'+declaration('api')+'\n'+declaration('commit')+'\nasync function request(b,who){const t="2026-10-10T04:30:00Z";'+source.slice(start,end)+'}');
const now='2026-10-10T04:30:00Z',admin={role:'admin'};
const change=(state,type,data,streamer='papa')=>mutate(state,{type,data,streamer},admin,now);

function edge(outcome='success'){
 let state=change(empty(),'player',{name:'玩家',ids:['login-id'],balance:20});
 state=change(state,'settings',{hourlyLimit:20});state=change(state,'song',{title:'歌曲',artist:'演唱者'});state=change(state,'song',{title:'歌曲二',artist:'演唱者'});const owner={role:'player',playerId:state.players[0].playerId};state=mutate(state,{type:'request',data:{songId:state.songs[0].songId,kind:'saved'}},owner,now);state.revision=7;
 const who={role:'player',accountId:'00000000-0000-4000-8000-000000000001',playerId:state.players[0].playerId,loginId:'login-id',spaceId:'space-001'},calls=[],reads=[];
 const fetch=async(url,options)=>{
  calls.push({url,body:JSON.parse(options.body)});
  if(outcome==='reject')return new Response(JSON.stringify({code:'40001',message:'VERSION_CONFLICT'}),{status:409});
  if(outcome==='forbidden')return new Response(JSON.stringify({code:'42501',message:'permission denied'}),{status:403});
  if(outcome==='gateway')return new Response('Gateway timeout',{status:504});
  const patch=calls.at(-1).body;assert.equal(patch.actor_context.player_id,who.playerId);assert.equal(patch.actor_context.account_id,who.accountId);assert.equal(patch.expected,state.revision);
  for(const row of patch.changes)if(row.kind==='queue'){const index=state.queue.findIndex(q=>q.id===row.id);if(index<0)state.queue.push(structuredClone(row.data));else state.queue[index]=structuredClone(row.data);}
  state.revision++;
  if(outcome==='transport')throw Error('Lost commit acknowledgment');
  if(outcome==='body')return {ok:true,text:async()=>{throw Error('Lost response body');}};
  return new Response(JSON.stringify(state.revision));
 };
 const context=vm.createContext({roomBadgeChanges,Response,JSON,structuredClone,fetch,SB_URL:'https://example.test',headers:{},stateChanges,deriveNotices,coreActor,applyOwnQueueBatch,validateOwnQueueBatch,
  respond:value=>value,schedulePush:()=>{},catalogRoom:async(actor,slug)=>{if(!['papa','papa-alias'].includes(slug))throw Error('找不到主播');return {id:'papa',slug:'papa',spaceId:'space-001',active:true};},
  load:async(...args)=>{reads.push(args);return structuredClone(state);},
 });
 vm.runInContext(code,context);
 const invoke=async(extra={})=>{context.body={op:'ownQueueBatch',revision:7,jobs:[{streamer:'papa',rows:[{id:state.queue[0].id,operation:'cancel'}]}],...extra};context.who=who;return vm.runInContext('request(body,who)',context);};
 return {invoke,calls,reads,who,get state(){return state;}};
}


test('own queue handler commits exactly one room patch and preserves cancelled history',async()=>{
 const f=edge(),result=await f.invoke();assert.equal(result.results[0].ok,true);assert.equal(f.state.queue.length,1);assert.equal(f.state.queue[0].status,'cancelled');assert.equal(f.calls.length,1);
 assert.ok(f.calls[0].url.endsWith('/rpc/papa_room_operational_commit'));assert.deepEqual(f.reads,[[true,'papa','space-001',null,f.who.playerId]]);assert.equal(f.calls[0].body.changes.length,1);
});
test('uncertain writes never retry and explicit transaction rejections remain confirmed failures',async()=>{
 for(const outcome of ['transport','body','gateway','reject','forbidden']){const f=edge(outcome),r=await f.invoke();assert.equal(r.results[0].ok,false);assert.equal(r.results[0].unknown,['transport','body','gateway'].includes(outcome)?true:undefined);assert.equal(f.calls.length,1);}
});
test('stale versions, foreign owner, invalid later rows and injected authority fail without commits',async()=>{
 const f=edge();assert.equal((await f.invoke({revision:6})).results[0].ok,false);assert.equal(f.calls.length,0);
 const rows=[{id:f.state.queue[0].id,operation:'cancel'},{id:'missing',operation:'cancel'}];assert.equal((await f.invoke({jobs:[{streamer:'papa',rows}]})).results[0].ok,false);assert.equal(f.calls.length,0);assert.equal(f.state.queue[0].status,'waiting');
 await assert.rejects(f.invoke({jobs:[{streamer:'papa',rows:[{id:f.state.queue[0].id,operation:'cancel',playerId:'forged'}]}]}),/資料不正確/);assert.equal(f.calls.length,0);
 f.who.playerId='foreign';assert.equal((await f.invoke()).results[0].ok,false);assert.equal(f.calls.length,0);
});
test('cross-room failures and canonical aliases do not repeat successful commits',async()=>{
 const f=edge(),rows=[{id:f.state.queue[0].id,operation:'cancel'}],r=await f.invoke({jobs:[{streamer:'papa',rows},{streamer:'papa-alias',rows},{streamer:'missing',rows}]});
 assert.deepEqual(Array.from(r.results,x=>x.ok),[true,false,false]);assert.equal(f.calls.length,1);assert.match(r.results[1].error,/同一位主播/);
});
