import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,balance,reservedCredits,reservedHour,savedQuota} from '../src/core.js';
import {applyPlayerRequestBatch,validateRequestBatch} from '../src/player-bulk-tools.js';

const admin={role:'admin'},now='2026-10-10T04:30:00Z';
const run=(s,type,data,actor=admin,streamer='papa')=>mutate(s,{type,data,streamer},actor,now);
const actor=s=>({role:'player',playerId:s.players[0].playerId,loginId:'batch-player'});
const room=(s,streamer='papa')=>scopeState(s,streamer);
const row=(s,index,extra={})=>({songId:s.songs[index].songId,kind:'saved',...extra});
const batch=(s,rows,streamer='papa')=>applyPlayerRequestBatch(s,rows,actor(s),now,streamer);
function setup({credits=20,limit=20,costs=[2,1,2]}={}){
 let s=run(empty(),'player',{name:'批次玩家',ids:['batch-player'],balance:credits});s=run(s,'settings',{hourlyLimit:limit});
 for(const [i,creditCost] of costs.entries())s=run(s,'song',{title:'歌曲 '+i,artist:'歌手',creditCost});return s;
}

test('batch reserves the actual weighted quotes without charging or mutating the original state',()=>{
 const source=setup({limit:3}),before=structuredClone(source),next=batch(source,[row(source,0),row(source,1)]),p=actor(source);
 assert.deepEqual(source,before);assert.equal(next.queue.length,2);assert.deepEqual(next.queue.map(q=>q.creditCost),[2,1]);assert.equal(reservedHour(room(next),now),3);assert.equal(reservedCredits(room(next),p.playerId),3);assert.equal(balance(room(next),p.playerId),20);assert.deepEqual(next.ledger,before.ledger);
});

test('a later row exceeding weighted hourly capacity rejects the whole batch atomically',()=>{
 const source=setup({limit:3}),before=structuredClone(source);assert.throws(()=>batch(source,[row(source,0),row(source,2)]),/額度不足/);assert.deepEqual(source,before);assert.equal(source.queue.length,0);
});

test('a later row exceeding available credits includes earlier reservations and leaves no partial queue',()=>{
 const source=setup({credits:2}),before=structuredClone(source);assert.throws(()=>batch(source,[row(source,1),row(source,0)]),/存歌袋|存歌不足/);assert.deepEqual(source,before);assert.equal(source.queue.length,0);
});

test('a later live gift or invalid request note failure cannot retain an earlier valid request',()=>{
 const source=setup(),before=structuredClone(source);
 assert.throws(()=>batch(source,[row(source,1),row(source,0,{kind:'live',giftConfirmed:false})]),/禮物/);assert.deepEqual(source,before);
 assert.throws(()=>batch(source,[row(source,1),row(source,0,{requestNote:'🎵'.repeat(31)})]),/資料不正確/);assert.deepEqual(source,before);
 const next=batch(source,[row(source,1),row(source,0,{kind:'live',giftConfirmed:true,requestNote:'🎵'.repeat(30)})]);assert.equal(reservedHour(room(next),now),1);assert.equal(next.queue[1].status,'pending');assert.equal([...next.queue[1].requestNote].length,30);
});

test('half repeat and paired halves each reserve their complete one-credit quote',()=>{
 let source=setup({costs:[.5,.5,.5],limit:2});source=run(source,'song',{...source.songs[1],shortMode:'pair',pairSongIds:[source.songs[2].songId]});
 const next=batch(source,[row(source,0,{pairSongId:source.songs[0].songId}),row(source,1,{pairSongId:source.songs[2].songId})]);assert.deepEqual(next.queue.map(q=>q.creditCost),[1,1]);assert.equal(next.queue[0].items[0].performances,2);assert.equal(next.queue[1].items.length,2);assert.equal(reservedHour(room(next),now),2);assert.equal(reservedCredits(room(next),actor(next).playerId),2);
});

test('batch fills common capacity before personal quota and validates subsequent rows against both',()=>{
 let source=setup({limit:1,costs:[1,1,1]});source=run(source,'extraQuota',{player_id:actor(source).playerId,extra_quota:1,enabled:true});
 const next=batch(source,[row(source,0),row(source,1)]),quota=savedQuota(room(next),now,actor(next).playerId);assert.equal(quota.personalUsed,1);assert.equal(quota.reserved,1);assert.equal(quota.totalRemaining,0);
 const before=structuredClone(next);assert.throws(()=>batch(next,[row(next,2)]),/額度不足/);assert.deepEqual(next,before);
});

test('cross-room batches use only that room songs, credits and quota',()=>{
 let source=setup({limit:1,costs:[1]});source=batch(source,[row(source,0)]);source=run(source,'streamer',{slug:'second',display_name:'第二位'});source=run(source,'settings',{hourlyLimit:1},admin,'second');source=run(source,'song',{title:'第二位的歌',artist:'別位歌手',creditCost:1},admin,'second');source=run(source,'ledger',{playerId:actor(source).playerId,amount:3},admin,'second');
 const secondSong=room(source,'second').songs[0],next=batch(source,[{songId:secondSong.songId,kind:'saved'}],'second');assert.equal(reservedHour(room(next),now),1);assert.equal(reservedHour(room(next,'second'),now),1);assert.equal(balance(room(next,'second'),actor(next).playerId),3);
 const before=structuredClone(source);assert.throws(()=>batch(source,[row(source,0)],'second'),/找不到歌曲/);assert.deepEqual(source,before);assert.equal(room(source,'second').queue.length,0);
});

test('each batch request selects one whole storage pool after earlier row reservations',()=>{
 let source=setup({credits:3,costs:[2,2]});source=run(source,'settings',{radio_enabled:true,current_space:'radio'});source=run(source,'ledger',{playerId:actor(source).playerId,amount:2,storage_pool:'radio'});
 const next=batch(source,[row(source,0),row(source,1)]);assert.deepEqual(next.queue.map(q=>q.consumed_storage_pool),['radio','shengma']);assert.equal(reservedCredits(room(next),actor(next).playerId,'radio'),2);assert.equal(reservedCredits(room(next),actor(next).playerId,'shengma'),2);
 let partial=setup({credits:1,costs:[2]});partial=run(partial,'settings',{radio_enabled:true,current_space:'radio'});partial=run(partial,'ledger',{playerId:actor(partial).playerId,amount:1,storage_pool:'radio'});const before=structuredClone(partial);assert.throws(()=>batch(partial,[row(partial,0)]),/存歌不足|存歌袋/);assert.deepEqual(partial,before);
});

test('batch rejects duplicate IDs, injected authority, invalid actors, archived players and hidden songs',()=>{
 const source=setup(),before=structuredClone(source),valid=row(source,1);
 for(const rows of [[],[valid,valid],[{...valid,playerId:'foreign'}],[{...valid,venue:'radio'}],[{...valid,streamer:'foreign'}],[{...valid,kind:'admin'}],Array.from({length:51},(_,i)=>({...valid,songId:'id'+i}))])assert.throws(()=>batch(source,rows));
 assert.throws(()=>applyPlayerRequestBatch(source,[valid],admin,now,'papa'),/登入玩家/);assert.deepEqual(source,before);
 const archived=structuredClone(source);archived.players[0].archived=true;assert.throws(()=>batch(archived,[valid]),/封存/);
 const hidden=structuredClone(source);hidden.songs[1].hidden=true;assert.throws(()=>batch(hidden,[valid]),/找不到歌曲/);
 const projected=validateRequestBatch([valid]);assert.notEqual(projected[0],valid);assert.deepEqual(projected,[valid]);
});
