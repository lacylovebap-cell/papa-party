import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
import * as core from '../src/core.js';import * as bulk from '../src/player-bulk-tools.js';import {stateChanges} from '../src/state-patch.js';import {deriveNotices} from '../src/notification-rules.js';
const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8'),helpers=stripTypeScriptTypes(source.slice(source.indexOf('// Use verified display metadata'),source.indexOf('async function mutateStreamerRegistry(')));
const at='2026-10-18T14:40:00Z',admin={role:'admin'},actor={role:'player',playerId:'P1'};
function fixture(options={}){
 let state=core.upgradePlatform(core.empty());state.settings.hourlyLimit=state.streamerSettings.papa.hourlyLimit=100;state.players=[{playerId:'P1',name:'測試玩家',ids:[],names:[]}];state.ledger=[{id:'L1',streamer_id:'papa',playerId:'P1',amount:10,at}];
 state.songs=[{songId:'S1',streamer_id:'papa',title:'聽見',artist:'原歌手',creditCost:1,tags:['原標籤'],hidden:false},{songId:'S2',streamer_id:'papa',title:'原搭配',artist:'原歌手二',creditCost:1,tags:[],hidden:false}];state.revision=5;
 const requests=[],metadata=[{songId:'S1',title:'遇見',artist:'孫燕姿'},{songId:'S2',title:'搭配歌曲',artist:'新歌手'}];
 const ctx=vm.createContext({...core,Error,Map,Set,api:async(path,body)=>{requests.push({path,body});return options.result||{version:1,scope:{spaceId:'space-001',roomId:'papa'},revision:state.revision,songs:metadata.filter(r=>body.selected_song_ids.includes(r.songId))};},revisionConflictError:()=>Error('VERSION_CONFLICT')});
 vm.runInContext(helpers,ctx);const select=actions=>ctx.catalogSelectionContext(state,'papa',actions);
 return {state,requests,metadata,select};
}
test('遇見 stays 遇見 from selected request through queue, notification, current song and completion without persisting display metadata into source',async()=>{
 const f=fixture(),before=structuredClone(f.state),action={type:'request',data:{songId:'S1',expectedSong:{title:'遇見',artist:'孫燕姿'},kind:'saved'}};
 const selection=await f.select([action]);let next=selection.finish(core.mutate(selection.state,{...action,streamer:'papa'},actor,at));const q=next.queue[0];assert.equal(q.title,'遇見');assert.equal(q.artist,'孫燕姿');assert.equal(q.items[0].title,'遇見');assert.deepEqual(next.songs,before.songs);assert.deepEqual(f.state,before);
 assert.ok(stateChanges(before,next).changes.every(r=>r.kind!=='songs'));const notices=deriveNotices(before,next,{role:'player',streamer_id:'papa'},at);assert.match(notices.find(n=>n.recipient==='__admin__').body,/遇見/);assert.doesNotMatch(notices.find(n=>n.recipient==='__admin__').body,/聽見/);
 next=core.mutate(next,{type:'queue',streamer:'papa',data:{id:q.id,operation:'acknowledge',preparationMinutes:0}},admin,at);assert.equal(core.publicView(next,actor,at).nowPlaying.title,'遇見');
 next=core.mutate(next,{type:'queue',streamer:'papa',data:{id:q.id,operation:'complete'}},admin,at);assert.equal(next.queue[0].title,'遇見');assert.equal(core.balance(core.scopeState(next),'P1'),9);assert.deepEqual(next.queue[0].items[0].achievement_performers,['孫燕姿']);assert.deepEqual(next.songs,before.songs);
 assert.equal(f.requests.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].body.selected_song_ids)),['S1']);
});
test('half-song pairs, batch requests, on-behalf requests, streamer dice and allocation all resolve selected names with original charges and IDs',async()=>{
 const f=fixture();f.state.songs.forEach(s=>{s.creditCost=.5;s.shortMode='pair';s.pairSongIds=[s.songId==='S1'?'S2':'S1'];});
 const data={songId:'S1',pairSongId:'S2',expectedSong:{title:'遇見',artist:'孫燕姿'},expectedPair:{title:'搭配歌曲',artist:'新歌手'},kind:'saved',giftConfirmed:true};
 for(const action of [{type:'request',data},{type:'onBehalf',data:{...data,playerId:'P1'}},{type:'allocate',data:{playerId:'P1',total:3,stored:2,items:[data]}}]){
  const selection=await f.select([action]),next=selection.finish(core.mutate(selection.state,{...action,streamer:'papa'},action.type==='request'?actor:admin,at));assert.equal(next.queue[0].title,'遇見');assert.deepEqual(next.queue[0].items.map(i=>i.title),['遇見','搭配歌曲']);assert.equal(next.queue[0].creditCost,1);assert.deepEqual(next.songs,f.state.songs);
 }
 const dice={type:'streamerDraw',data:{songId:'S1'}},selection=await f.select([dice]),next=selection.finish(core.mutate(selection.state,{...dice,streamer:'papa'},admin,at));assert.equal(next.queue[0].title,'遇見');assert.equal(next.queue[0].creditCost,0);
});
test('stale or forged expected identity and a missing second batch song reject before any state escapes; cancel/completion makes no new metadata read',async()=>{
 const f=fixture(),before=structuredClone(f.state),action={type:'request',data:{songId:'S1',kind:'saved',expectedSong:{title:'其他歌',artist:'孫燕姿'}}},selection=await f.select([action]);assert.throws(()=>core.mutate(selection.state,{...action,streamer:'papa'},actor,at),/歌曲資料已更新/);assert.deepEqual(f.state,before);
 assert.throws(()=>bulk.applyPlayerRequestBatch(selection.state,[{songId:'S1',kind:'saved'},{songId:'S2',kind:'saved',expectedSong:{title:'舊名稱',artist:'歌手'}}],actor,at,'papa'),/歌曲資料已更新/);assert.deepEqual(f.state,before);
 const oldCount=f.requests.length;await f.select([{type:'queue',data:{id:'old',operation:'complete'}},{type:'cancelOwn',data:{id:'old'}}]);assert.equal(f.requests.length,oldCount);
 for(const expectedSong of [null,{},'title',{title:'遇見',artist:'孫燕姿',privateNotes:'bad'}])assert.throws(()=>bulk.validateRequestBatch([{songId:'S1',kind:'live',expectedSong}]),/不正確/);
});
test('foreign room/Space, mixed IDs, duplicate response IDs and outdated revision cannot enter the Core operation',async()=>{
 const base={version:1,scope:{spaceId:'space-001',roomId:'papa'},revision:5,songs:[{songId:'S1',title:'遇見',artist:'孫燕姿'}]};
 for(const result of [{...base,scope:{spaceId:'space-002',roomId:'papa'}},{...base,songs:[{songId:'FOREIGN',title:'遇見',artist:'孫燕姿'}]},{...base,revision:4},{...base,songs:[]},{...base,songs:[...base.songs,...base.songs]}]){
  const f=fixture({result});await assert.rejects(f.select([{type:'request',data:{songId:'S1'}}]),/歌曲資料已更新|VERSION_CONFLICT/);assert.equal(f.state.queue.length,0);
 }
});
