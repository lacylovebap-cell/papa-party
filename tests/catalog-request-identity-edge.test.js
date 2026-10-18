import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
import * as core from '../src/core.js';import * as bulk from '../src/player-bulk-tools.js';import * as access from '../src/access-policy.js';import * as patch from '../src/state-patch.js';import * as notices from '../src/notification-rules.js';import {accountingDay} from '../src/accounting.js';import {roomBadgeChanges} from '../supabase/functions/party-api/badge-state.js';
const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8'),catalog=fs.readFileSync('supabase/functions/party-api/catalog.ts','utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,'')),roomStart=catalog.indexOf('async function catalogRoom('),roomEnd=catalog.indexOf('\n}',roomStart)+2;
const catalogCode=stripTypeScriptTypes(catalog.slice(catalog.indexOf('const CATALOG_COMMON_FIELDS'),catalog.indexOf('// A local tag/note edit'))+'\n'+catalog.slice(roomStart,roomEnd));
function fixture({manager=false,badMetadata=null}={}){
 let handler;const calls=[],commits=[];let state=core.upgradePlatform(core.empty());state.revision=7;
 state.players=[{playerId:'P1',name:'測試玩家',ids:[],names:[],password:''}];state.settings.hourlyLimit=state.streamerSettings.papa.hourlyLimit=20;
 state.ledger=[{id:'L1',streamer_id:'papa',playerId:'P1',amount:10,at:'2026-10-01T10:00:00Z'}];
 state.songs=[{songId:'S1',streamer_id:'papa',title:'聽見',artist:'原歌手',hidden:false,tags:['原標籤'],creditCost:1,lyrics:'PRIVATE LYRICS'},
  {songId:'S2',streamer_id:'papa',title:'另一首舊名稱',artist:'原歌手二',hidden:false,tags:[],creditCost:1}];
 const metadata=[{songId:'S1',title:'遇見',artist:'孫燕姿'},{songId:'S2',title:'新歌名二',artist:'新歌手'}];
 const who={role:manager?'streamer_admin':'player',accountId:'11111111-1111-4111-8111-111111111111',spaceId:'space-001',streamer_id:manager?'papa':null,playerId:manager?null:'P1'};
 const fetch=async(url,request)=>{const path=new URL(url).pathname,b=request.body?JSON.parse(request.body):null;calls.push({path,b});
  if(path.endsWith('/papa_streamer_directory'))return Response.json(state.streamers.map(r=>({...r,spaceId:'space-001'})));
  if(path.endsWith('/papa_catalog_request_metadata'))return Response.json(badMetadata||{version:1,scope:{spaceId:b.requested_space,roomId:b.requested_room},revision:state.revision,songs:metadata.filter(r=>b.selected_song_ids.includes(r.songId))});
  if(path.endsWith('/papa_room_operational_commit')){
   assert.equal(b.expected,state.revision);assert.ok(b.changes.every(r=>r.kind!=='songs'),'display metadata must never be written into original songs');commits.push(b);
   for(const r of b.changes){const id=core.TABLES.includes(r.kind)?r.kind:null;if(!id)continue;const key=r.kind==='songs'?'songId':'id',index=state[id].findIndex(x=>x[key]===r.id);if(index<0)state[id].push(r.data);else state[id][index]=r.data;}
   for(const r of b.removed){const key=r.kind==='songs'?'songId':'id';state[r.kind]=state[r.kind].filter(x=>x[key]!==r.id);}return Response.json(++state.revision);
  }
  if(path.endsWith('/papa_catalog_song_metadata_in_space'))return Response.json(metadata);
  if(path.endsWith('/papa_accounting_summary'))return Response.json({...core.stats(core.scopeState(state),new Date().toISOString()),day:accountingDay(new Date().toISOString(),19),rolloverHour:19,timezone:'Asia/Taipei',revision:state.revision,scope:{spaceId:b.requested_space,roomId:b.requested_room}});
  throw Error('Unexpected endpoint '+path);
 };
 const ctx=vm.createContext({...core,...bulk,...access,...patch,...notices,accountingDay,roomBadgeChanges,Error,URL,Response,TextEncoder,crypto,structuredClone,fetch,CATALOG_OPS:new Set(),Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://db.example':'fixture'},serve:fn=>handler=fn},fixtureWho:who,fixtureState:()=>structuredClone(state)});
 vm.runInContext(catalogCode+'\n'+code,ctx);vm.runInContext('actor=async()=>fixtureWho;load=async()=>fixtureState();schedulePush=()=>{};',ctx);
 const invoke=async body=>{const response=await handler({method:'POST',json:async()=>({streamer:'papa',token:'fixture',revision:state.revision,...body})});return {status:response.status,body:await response.json()};};
 return {invoke,calls,commits,get state(){return state;},metadata};
}
const expectedSong={title:'遇見',artist:'孫燕姿'};
test('actual single Edge request persists canonical queue/items/notices, with no song write and no caller title override',async()=>{
 const f=fixture(),original=structuredClone(f.state.songs),result=await f.invoke({op:'mutate',action:{type:'request',data:{songId:'S1',kind:'live',giftConfirmed:true,expectedSong,title:'FORGED'}}});
 assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(f.commits.length,1);assert.equal(f.state.queue[0].title,'遇見');assert.equal(f.state.queue[0].items[0].title,'遇見');assert.equal(f.state.queue[0].artist,'孫燕姿');assert.match(f.commits[0].notices.find(n=>n.recipient==='__admin__').body,/遇見/);assert.deepEqual(f.state.songs,original);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/papa_catalog_request_metadata')).length,1);assert.deepEqual(f.calls.find(c=>c.path.endsWith('/papa_catalog_request_metadata')).b.selected_song_ids,['S1']);
});
test('actual batch Edge uses one bounded identity lookup per room and one atomic business commit for all rows',async()=>{
 const f=fixture(),r=await f.invoke({op:'requestsBatch',jobs:[{streamer:'papa',rows:[{songId:'S1',kind:'saved',expectedSong},{songId:'S2',kind:'saved',expectedSong:{title:'新歌名二',artist:'新歌手'}}]}]});assert.equal(r.status,200);assert.equal(r.body.results[0].ok,true,JSON.stringify(r.body));assert.equal(f.commits.length,1);assert.deepEqual(f.state.queue.map(q=>q.title),['遇見','新歌名二']);assert.equal(f.calls.filter(c=>c.path.endsWith('/papa_catalog_request_metadata')).length,1);
});
test('own replacement quote and replacement mutation use the same selected names and preserve existing song IDs/history',async()=>{
 const f=fixture();f.state.queue=[{id:'Q1',streamer_id:'papa',playerId:'P1',songId:'S2',title:'歷史原名二',artist:'原歌手二',kind:'saved',status:'waiting',creditCost:1,at:'2026-10-01T10:00:00Z'}];
 const choice={id:'Q1',songId:'S1',expectedSong};const quote=await f.invoke({op:'ownQueueQuote',choice});assert.equal(quote.status,200,JSON.stringify(quote.body));assert.equal(quote.body.quote.title,'遇見');assert.equal(f.commits.length,0);
 const r=await f.invoke({op:'ownQueueBatch',jobs:[{streamer:'papa',rows:[{...choice,operation:'replace'}]}]});assert.equal(r.body.results[0].ok,true,JSON.stringify(r.body));assert.equal(f.state.queue[0].id,'Q1');assert.equal(f.state.queue[0].title,'遇見');assert.equal(f.commits.length,1);
});
test('manager on-behalf and allocation enter canonical names without touching source metadata or shared catalog',async()=>{
 for(const action of [{type:'onBehalf',data:{songId:'S1',expectedSong,playerId:'P1',kind:'live',giftConfirmed:true}},{type:'allocate',data:{playerId:'P1',total:3,stored:2,items:[{songId:'S1',expectedSong}]}}]){
  const f=fixture({manager:true}),r=await f.invoke({op:'mutate',action});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(f.state.queue[0].title,'遇見');assert.equal(f.state.songs[0].title,'聽見');assert.equal(f.commits.length,1);
 }
});
test('stale/foreign metadata, changed title and a later invalid batch row fail before any queue or accounting commit',async()=>{
 const invalid=[{version:1,scope:{spaceId:'space-002',roomId:'papa'},revision:7,songs:[{songId:'S1',...expectedSong}]},{version:1,scope:{spaceId:'space-001',roomId:'papa'},revision:8,songs:[{songId:'S1',...expectedSong}]}];
 for(const badMetadata of invalid){const f=fixture({badMetadata}),r=await f.invoke({op:'mutate',action:{type:'request',data:{songId:'S1',kind:'saved',expectedSong}}});assert.equal(r.status,400);assert.equal(f.commits.length,0);assert.equal(f.state.queue.length,0);}
 const f=fixture(),r=await f.invoke({op:'requestsBatch',jobs:[{streamer:'papa',rows:[{songId:'S1',kind:'saved',expectedSong},{songId:'S2',kind:'saved',expectedSong:{title:'原名稱',artist:'不同人'}}]}]});assert.equal(r.body.results[0].ok,false);assert.equal(f.commits.length,0);assert.equal(f.state.queue.length,0);
});
