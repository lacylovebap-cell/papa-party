import test from 'node:test';
import assert from 'node:assert/strict';
import {mutate,upgradePlatform,empty,scopeState,carryPendingQuota,publicView,CARRY_PENDING_MESSAGE} from '../src/core.js';

const admin={role:'admin'},H='2026-11-01T12:10:00.000Z',H1='2026-11-01T13:05:00.000Z',H1b='2026-11-01T13:20:00.000Z';
function room(){
 let s=upgradePlatform(empty());
 s=mutate(s,{type:'settings',streamer:'papa',data:{hourlyLimit:2}},admin,H);
 for(const t of ['A曲','B曲','C曲','D曲'])s=mutate(s,{type:'song',streamer:'papa',data:{title:t,artist:'怕怕',cat:'華語'}},admin,H);
 for(const n of ['甲','乙','丙'])s=mutate(s,{type:'player',streamer:'papa',data:{name:n,ids:[n]}},admin,H);
 const r=scopeState(s,'papa');for(const p of r.players)s=mutate(s,{type:'ledger',streamer:'papa',data:{playerId:p.playerId,amount:5,note:'一般 5 首'}},admin,H);
 return {s,players:r.players.map(p=>p.playerId),songs:r.songs.map(x=>x.songId)};
}
const ask=(s,player,songId,t)=>mutate(s,{type:'request',streamer:'papa',data:{songId,kind:'saved'}},{role:'player',playerId:player},t);
test('two unsung 提歌 from last hour hold this hour until 過檔 is decided; new 提歌 gets the 過檔 message',()=>{
 let {s,players,songs}=room();
 s=ask(s,players[0],songs[0],H);s=ask(s,players[1],songs[1],H);
 const [q1,q2]=scopeState(s,'papa').queue;
 for(const q of [q1,q2])s=mutate(s,{type:'queue',streamer:'papa',data:{id:q.id,operation:'acknowledge',preparationMinutes:0}},admin,H);
 const c=carryPendingQuota(scopeState(s,'papa'),H1);assert.equal(c.count,2);assert.equal(c.quota.totalRemaining,0);
 assert.throws(()=>ask(s,players[2],songs[2],H1),e=>e.message===CARRY_PENDING_MESSAGE);
 const view=publicView(s,{role:'player',playerId:players[2]},H1,'papa');assert.deepEqual(view.hourlyCarry,{count:2,cost:2,totalRemaining:0});
 // streamer decides: first song was NOT 過檔 → one slot frees up for this hour
 s=mutate(s,{type:'queue',streamer:'papa',data:{id:q1.id,operation:'complete',carryOver:false}},admin,H1b);
 assert.equal(carryPendingQuota(scopeState(s,'papa'),H1b).count,1);
 s=ask(s,players[2],songs[2],H1b);
 assert.throws(()=>ask(s,players[2],songs[3],H1b),e=>e.message===CARRY_PENDING_MESSAGE||/額度不足/.test(e.message));
 // second song decided as 過檔 → it really uses this hour; nothing pending any more
 s=mutate(s,{type:'queue',streamer:'papa',data:{id:q2.id,operation:'complete',carryOver:true}},admin,H1b);
 assert.equal(carryPendingQuota(scopeState(s,'papa'),H1b).count,0);
 assert.equal(publicView(s,{role:'player',playerId:players[2]},H1b,'papa').hourlyCarry,null);
});
test('nothing changes within the same hour or when the hour still has room',()=>{
 let {s,players,songs}=room();
 s=ask(s,players[0],songs[0],H);
 assert.equal(carryPendingQuota(scopeState(s,'papa'),H).count,0,'same hour: not 過檔');
 s=ask(s,players[1],songs[1],H1);
 assert.equal(carryPendingQuota(scopeState(s,'papa'),H1).count,1,'one pending, but one slot left: request allowed');
 assert.equal(scopeState(s,'papa').queue.length,2,'the pending one plus one new fills the hour exactly');
 assert.throws(()=>ask(s,players[2],songs[2],H1),e=>e.message===CARRY_PENDING_MESSAGE,'a third would overfill if the first turns out to be 過檔');
});
