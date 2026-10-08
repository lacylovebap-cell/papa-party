import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,captureMutationIds,replayMutationIds,scopeState} from '../src/core.js';
import {createRoomDraft,recordRoomDraftAction,recordRoomDraftImport,replayRoomDraft} from '../src/room-draft.js';
import {stateChanges} from '../src/state-patch.js';

const admin={role:'admin'},at='2026-10-09T04:00:00.000Z';
function fixture(){
 let state=mutate(empty(),{type:'player',data:{name:'Existing',ids:['ID'],balance:10}},admin,at);
 state=mutate(state,{type:'song',data:{title:'Existing song',artist:'Artist',tags:[]}},admin,at);
 state=mutate(state,{type:'streamer',data:{slug:'other',display_name:'Other'}},admin,at);
 const other=state.streamers.find(row=>row.slug==='other');
 state=mutate(state,{streamer:other.id,type:'song',data:{title:'Foreign song',artist:'Foreign',lyrics:'private foreign'}},admin,at);
 state.revision=7;delete state.songs.find(row=>row.streamer_id==='papa').lyrics;return state;
}
function record(state,journal,type,data){return recordRoomDraftAction(state,journal,{type,data},admin,at);}

test('draft replays original Core actions with stable new row IDs and dependent cancellation/refund',()=>{
 const before=fixture(),snapshot=structuredClone(before);let state=before,journal=createRoomDraft(state,'papa');
 ({state,journal}=record(state,journal,'player',{name:'Created',balance:4}));
 const player=state.players.at(-1);
 ({state,journal}=record(state,journal,'song',{title:'Created song',artist:'Created artist',creditCost:2}));
 const song=state.songs.find(row=>row.title==='Created song');
 ({state,journal}=record(state,journal,'onBehalf',{playerId:player.playerId,songId:song.songId,kind:'saved'}));
 const queue=state.queue.at(-1);
 ({state,journal}=record(state,journal,'queue',{id:queue.id,operation:'cancel'}));
 const replayed=replayRoomDraft(before,journal,admin,at);
 assert.deepEqual(replayed,state);assert.equal(replayed.queue.at(-1).songId,song.songId);assert.equal(replayed.queue.at(-1).playerId,player.playerId);
 assert.equal(replayed.queue.at(-1).status,'cancelled');
 for(const kind of ['songs','queue','ledger'])assert.deepEqual(replayed[kind].filter(row=>row.streamer_id!=='papa'),before[kind].filter(row=>row.streamer_id!=='papa'));
 assert.deepEqual(before,snapshot);assert.equal(journal.baseRevision,7);assert.equal(new Set(journal.actions.flatMap(entry=>entry.ids)).size,journal.actions.flatMap(entry=>entry.ids).length);
});

test('allocation group IDs, initial ledger and queue settlement reuse the exact captured sequence',()=>{
 const before=fixture();let state=before,journal=createRoomDraft(before,'papa');
 const player=before.players[0],song=before.songs.find(row=>row.streamer_id==='papa');
 ({state,journal}=record(state,journal,'allocate',{playerId:player.playerId,total:3,stored:2,items:[{songId:song.songId}]}));
 const queued=state.queue.at(-1),group=queued.allocation_id;
 assert.ok(journal.actions[0].ids.includes(group));assert.ok(state.ledger.some(row=>row.allocation_id===group));
 ({state,journal}=record(state,journal,'queue',{id:queued.id,operation:'cancel'}));
 assert.deepEqual(replayRoomDraft(before,journal,admin,at),state);
 const colliding=structuredClone(journal);colliding.actions[0].ids[0]=before.ledger[0].id;
 assert.throws(()=>replayRoomDraft(before,colliding,admin,at),/重複/);
 const current=structuredClone(before);current.queue.push({...queued,id:crypto.randomUUID()});
 assert.throws(()=>replayRoomDraft(current,journal,admin,at),/重複/);
});

test('lean metadata edits and imports never synthesize erasure of unrequested lyrics',()=>{
 const before=fixture(),song=before.songs.find(row=>row.streamer_id==='papa');let state=before,journal=createRoomDraft(before,'papa');
 ({state,journal}=record(state,journal,'song',{...song,murmur:'only note'}));
 ({state,journal}=recordRoomDraftImport(state,journal,'songs','Existing song｜Artist｜日語｜男歌手｜New',['update'],admin,at));
 const replayed=replayRoomDraft(before,journal,admin,at),row=stateChanges(before,replayed,{preserveOrder:true}).changes.find(row=>row.kind==='songs'&&row.id===song.songId);
 assert.equal(Object.hasOwn(row.data,'lyrics'),false);assert.equal(({lyrics:'private source',...row.data}).lyrics,'private source');
 assert.equal(replayed.songs.find(row=>row.songId===song.songId).cat,'日語');
 const explicit=record(before,createRoomDraft(before,'papa'),'song',{...song,lyrics:''});
 assert.equal(replayRoomDraft(before,explicit.journal,admin,at).songs.find(row=>row.songId===song.songId).lyrics,'');
});

test('draft scope, stale revision, unsupported normalized writes and unvalidated replacements are rejected',()=>{
 const before=fixture(),journal=createRoomDraft(before,'papa');
 for(const patch of [{spaceId:'other-space'},{streamerId:'other'},{baseRevision:6},{formatVersion:0}])assert.throws(()=>replayRoomDraft(before,{...journal,...patch},admin,at));
 assert.throws(()=>replayRoomDraft(before,{state:before},admin,at));
 for(const type of ['streamer','extraQuota','unknown'])assert.throws(()=>record(before,journal,type,{}));
 assert.throws(()=>recordRoomDraftAction(before,journal,{type:'settings',streamer:'other',data:{}},admin,at),/主播草稿/);
 const good=record(before,journal,'song',{title:'New',artist:'Artist'}).journal;
 for(const bad of [[],[crypto.randomUUID(),crypto.randomUUID()],['not-a-uuid'],[before.songs[0].songId]]){
  const edited=structuredClone(good);edited.actions[0].ids=bad;assert.throws(()=>replayRoomDraft(before,edited,admin,at));
 }
 const future=structuredClone(good);future.actions[0].time='2026-10-09T05:00:00.000Z';assert.throws(()=>replayRoomDraft(before,future,admin,at),/時間/);
 assert.throws(()=>replayRoomDraft(before,good,{role:'player',playerId:before.players[0].playerId},at),/管理/);
 assert.throws(()=>replayRoomDraft(before,{...journal,actions:new Array(201).fill({})},admin,at));
});

test('captured UUID context restores on failure and does not affect ordinary Core mutations',()=>{
 assert.throws(()=>captureMutationIds(()=>{mutate(empty(),{type:'song',data:{title:'New'}},admin,at);throw Error('failed');}),/failed/);
 assert.throws(()=>replayMutationIds([crypto.randomUUID()],()=>mutate(empty(),{type:'player',data:{name:'New',balance:2}},admin,at)),/不足/);
 assert.throws(()=>captureMutationIds(()=>Promise.resolve(1)),/同步/);
 const a=mutate(empty(),{type:'song',data:{title:'A'}},admin,at),b=mutate(empty(),{type:'song',data:{title:'B'}},admin,at);
 assert.notEqual(a.songs[0].songId,b.songs[0].songId);
});

test('bounded legacy player import uses Core validation and preserves other-room business rows',()=>{
 const before=fixture(),journal=createRoomDraft(before,'papa');
 const recorded=recordRoomDraftImport(before,journal,'players','Created｜NEW-ID｜｜Alias｜2｜secret｜private note',['add'],admin,at);
 const after=replayRoomDraft(before,recorded.journal,admin,at);assert.deepEqual(after,recorded.state);
 assert.equal(after.players.at(-1).password,'secret');assert.equal(after.ledger.at(-1).amount,2);assert.equal(after.ledger.at(-1).streamer_id,'papa');
 assert.deepEqual(new Map(after.songs.map(row=>[row.songId,row])),new Map(before.songs.map(row=>[row.songId,row])));
 const native=structuredClone(before);native.streamers[0].spaceId='space-002';
 assert.throws(()=>recordRoomDraftImport(native,createRoomDraft(native,'papa'),'players','Created',['add'],admin,at),/帳號與成員資格/);
 assert.equal(scopeState(after,'papa').players.at(-1).name,'Created');
});
