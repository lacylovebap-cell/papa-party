import {roomBadgeChanges} from '../supabase/functions/party-api/badge-state.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {empty,mutate} from '../src/core.js';
import {applyPlayerRequestBatch,validateRequestBatch} from '../src/player-bulk-tools.js';
import {stateChanges} from '../src/state-patch.js';
import {deriveNotices} from '../src/notification-rules.js';
import {coreActor} from '../src/access-policy.js';

const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8'),lines=source.split(/\r?\n/);
function declaration(name){
 const start=lines.findIndex(line=>line.startsWith('async function '+name+'('));assert.ok(start>=0,name);
 const end=lines.findIndex((line,index)=>index>start&&line==='}');assert.ok(end>start,name+' closes');return lines.slice(start,end+1).join('\n');
}
const start=source.indexOf(" if(b.op==='requestsBatch'){"),end=source.indexOf(" if(b.op==='listeningHistoryPage'){",start);
assert.ok(start>=0&&end>start);
const conflictHelpers=source.slice(source.indexOf('const revisionConflictMessage='),source.indexOf('async function api('));
const code=stripTypeScriptTypes(conflictHelpers+'\n'+declaration('api')+'\n'+declaration('commit')+'\nasync function request(b,who){const t="2026-10-10T04:30:00Z";'+source.slice(start,end)+'}');
const now='2026-10-10T04:30:00Z',admin={role:'admin'};
const change=(state,type,data,streamer='papa')=>mutate(state,{type,data,streamer},admin,now);

function edge(outcome='success'){
 let state=change(empty(),'player',{name:'玩家',ids:['login-id'],balance:20});
 state=change(state,'settings',{hourlyLimit:20});state=change(state,'song',{title:'歌曲',artist:'演唱者'});state=change(state,'song',{title:'歌曲二',artist:'演唱者'});state.revision=7;
 const who={role:'player',accountId:'00000000-0000-4000-8000-000000000001',playerId:state.players[0].playerId,loginId:'login-id',spaceId:'space-001'},calls=[],reads=[];
 const fetch=async(url,options)=>{
  calls.push({url,body:JSON.parse(options.body)});
  if(outcome==='reject')return new Response(JSON.stringify({code:'40001',message:'VERSION_CONFLICT'}),{status:409});
  if(outcome==='forbidden')return new Response(JSON.stringify({code:'42501',message:'permission denied'}),{status:403});
  if(outcome==='gateway')return new Response('Gateway timeout',{status:504});
  const patch=calls.at(-1).body;assert.equal(patch.actor_context.player_id,who.playerId);assert.equal(patch.actor_context.account_id,who.accountId);assert.equal(patch.expected,state.revision);
  for(const row of patch.changes)if(row.kind==='queue')state.queue.push(structuredClone(row.data));
  state.revision++;
  if(outcome==='transport')throw Error('Lost commit acknowledgment');
  if(outcome==='body')return {ok:true,text:async()=>{throw Error('Lost response body');}};
  return new Response(JSON.stringify(state.revision));
 };
 const context=vm.createContext({roomBadgeChanges,Response,JSON,structuredClone,fetch,SB_URL:'https://example.test',headers:{},stateChanges,deriveNotices,coreActor,applyPlayerRequestBatch,validateRequestBatch,
  respond:value=>value,schedulePush:()=>{},catalogRoom:async(actor,slug)=>{if(!['papa','papa-alias'].includes(slug))throw Error('找不到主播');return {id:'papa',slug:'papa',spaceId:'space-001',active:true};},
  load:async(...args)=>{reads.push(args);return structuredClone(state);},
 });
 vm.runInContext(code,context);
 const invoke=async(extra={})=>{context.body={op:'requestsBatch',revision:7,jobs:[{streamer:'papa',rows:[{songId:state.songs[0].songId,kind:'saved'}]}],...extra};context.who=who;return vm.runInContext('request(body,who)',context);};
 return {invoke,calls,reads,who,get state(){return state;}};
}

test('real batch Edge handler uses one scoped quota read and one original atomic commit',async()=>{
 const f=edge(),ids=f.state.songs.map(song=>song.songId),result=await f.invoke({jobs:[{streamer:'papa',rows:ids.map(songId=>({songId,kind:'saved'}))}]});
 assert.equal(result.results[0].ok,true);assert.equal(result.results[0].count,2);assert.equal(result.results[0].revision,8);assert.equal(f.state.queue.length,2);assert.equal(f.calls.length,1);
 assert.ok(f.calls[0].url.endsWith('/rpc/papa_room_operational_commit'));assert.deepEqual(f.reads,[[true,'papa','space-001',null,f.who.playerId]]);assert.equal(f.calls[0].body.changes.filter(row=>row.kind==='queue').length,2);
});

test('lost commit acknowledgments and gateway responses are reported unknown without retries',async()=>{
 for(const outcome of ['transport','body','gateway']){
  const f=edge(outcome),result=await f.invoke();assert.equal(result.results[0].ok,false);assert.equal(result.results[0].unknown,true);assert.match(result.results[0].error,/結果待確認.*待播.*重複/);assert.equal(f.calls.length,1);assert.equal(f.reads.length,1);
  assert.equal(f.state.queue.length,outcome==='gateway'?0:1);
 }
});

test('explicit structured database transaction or permission rejections remain confirmed failures',async()=>{
 for(const outcome of ['reject','forbidden']){
  const f=edge(outcome),result=await f.invoke();assert.equal(result.results[0].ok,false);assert.equal(result.results[0].unknown,undefined);assert.equal(f.calls.length,1);assert.equal(f.state.queue.length,0);assert.equal(f.state.revision,7);
 }
});

test('stale revision or later-row Core validation fails before any commit or unknown outcome',async()=>{
 const stale=edge(),result=await stale.invoke({revision:6});assert.equal(result.results[0].ok,false);assert.equal(result.results[0].unknown,undefined);assert.equal(stale.calls.length,0);
 const f=edge(),failed=await f.invoke({jobs:[{streamer:'papa',rows:[{songId:f.state.songs[0].songId,kind:'saved'},{songId:'deleted-song',kind:'saved'}]}]});
 assert.equal(failed.results[0].ok,false);assert.equal(failed.results[0].unknown,undefined);assert.equal(f.calls.length,0);assert.equal(f.state.queue.length,0);
});

test('injected player authority and oversized jobs reject before room reads or writes',async()=>{
 const f=edge();await assert.rejects(f.invoke({jobs:[{streamer:'papa',rows:[{songId:f.state.songs[0].songId,kind:'saved',playerId:'foreign'}]}]}),/資料不正確/);
 await assert.rejects(f.invoke({jobs:Array.from({length:11},(_,i)=>({streamer:'r'+i,rows:[]}))}),/資料不正確/);assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
});

test('two aliases for one canonical room produce only one commit and an explicit second failure',async()=>{
 const f=edge(),songId=f.state.songs[0].songId,result=await f.invoke({jobs:[{streamer:'papa',rows:[{songId,kind:'saved'}]},{streamer:'papa-alias',rows:[{songId,kind:'saved'}]}]});
 assert.equal(result.results.length,2);assert.equal(result.results[0].streamer,'papa');assert.equal(result.results[0].ok,true);assert.equal(result.results[0].revision,8);
 assert.equal(result.results[1].streamer,'papa-alias');assert.equal(result.results[1].ok,false);assert.equal(result.results[1].unknown,undefined);assert.match(result.results[1].error,/重複指定同一位主播/);
 assert.equal(f.calls.length,1);assert.equal(f.reads.length,1);assert.equal(f.state.queue.length,1);assert.equal(f.state.revision,8);
});
