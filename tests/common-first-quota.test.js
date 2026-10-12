import test from 'node:test';import assert from 'node:assert/strict';
import {empty,mutate,scopeState,savedQuota} from '../src/core.js';
const now='2026-10-12T12:15:00Z',admin={role:'admin'},run=(s,type,data,actor=admin,time=now,room='papa')=>mutate(s,{type,data,streamer:room},actor,time);
function fixture(){let s=empty();for(const name of ['A','B'])s=run(s,'player',{name,balance:10});s=run(s,'song',{title:'Song',artist:'Singer'});return run(s,'extraQuota',{player_id:s.players[0].playerId,extra_quota:1,enabled:true});}
const quota=(s,id,time=now)=>savedQuota(scopeState(s),time,id),request=(s,index=0)=>run(s,'request',{songId:s.songs[0].songId,kind:'saved'},{role:'player',playerId:s.players[index].playerId});
test('the privileged first song uses public capacity; only the third song can consume the exclusive unit',()=>{
 let s=fixture(),id=s.players[0].playerId;s=request(s);assert.equal(quota(s,id).commonRemaining,1);assert.equal(quota(s,id).personalUsed,0);
 s=request(s,1);assert.equal(quota(s,id).commonRemaining,0);assert.equal(quota(s,id).extraRemaining,1);
 s=request(s);assert.equal(quota(s,id).personalUsed,1);assert.equal(quota(s,id).reserved,2);assert.equal(quota(s,id).totalRemaining,0);
 assert.throws(()=>request(s,1),/額度不足/);assert.equal(s.queue.length,3);
});
test('cancellation frees public capacity before consuming anyone exclusive right and preserves original queue records',()=>{
 let s=request(request(request(fixture()),1)),id=s.players[0].playerId,other=s.players[1].playerId,queueId=s.queue[1].id;
 const before=structuredClone(s.queue);s=run(s,'cancelOwn',{id:queueId},{role:'player',playerId:other});
 assert.equal(quota(s,id).personalUsed,0);assert.equal(quota(s,id).extraRemaining,1);assert.equal(quota(s,id).commonRemaining,0);
 assert.equal(s.queue.length,3);assert.equal(s.queue[1].status,'cancelled');assert.equal(s.queue[0].id,before[0].id);assert.equal(s.queue[2].id,before[2].id);
 assert.equal(quota(s,id,'2026-10-12T13:15:00Z').commonRemaining,2);assert.equal(quota(s,id,'2026-10-12T13:15:00Z').personalUsed,0);
});
