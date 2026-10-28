import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,quoteSong,balance,reservedCredits,reservedHour,usedHour} from '../src/core.js';
const admin={role:'admin'},at='2026-10-21T12:00:00Z';
const run=(s,type,data,who=admin)=>mutate(s,{type,data},who,at);
function fixture(cost){let s=run(empty(),'player',{name:'Fixture',balance:10});s=run(s,'settings',{livePrice:1200,liveDouble:300});return run(s,'song',{title:'Fixture',artist:'Singer',creditCost:cost});}
for(const cost of [1,2,3])test('configured '+cost+' credits scale every live gift party without using saved quota',()=>{
 let s=fixture(cost);const who={role:'player',playerId:s.players[0].playerId};
 s=run(s,'request',{songId:s.songs[0].songId,kind:'live',giftConfirmed:true,price:1},who);
 // Singer, host and hall each multiply by the slots the song occupies (pricing spec 4).
 assert.equal(s.queue[0].creditCost,cost);assert.equal(s.queue[0].price,1200*cost);assert.equal(s.queue[0].double,300*cost);
 assert.deepEqual([s.queue[0].fees.singer,s.queue[0].fees.host,s.queue[0].fees.hall,s.queue[0].fees.units],[1200*cost,300*cost,300*cost,cost]);
 assert.equal(reservedHour(s,at),0);assert.equal(usedHour(s,at),0);
 const old=structuredClone(s.queue[0]);s=run(s,'song',{...s.songs[0],creditCost:1});assert.deepEqual(s.queue[0],old);
});
test('a lone half song is refused for live and saved requests; nothing is queued',()=>{
 const s=fixture(.5),who={role:'player',playerId:s.players[0].playerId};
 for(const kind of ['live','saved'])assert.throws(()=>run(s,'request',{songId:s.songs[0].songId,kind,giftConfirmed:true},who),/半首歌不能單獨點/);
 assert.equal(s.queue.length,0);
});
test('a half song needs a choice: self-pair repeats and an allowed paired half each cost one',()=>{
 let s=fixture(.5),a=s.songs[0];s=run(s,'song',{title:'Pair',artist:'Singer',creditCost:.5});const b=s.songs[1];s=run(s,'song',{...a,shortMode:'both',pairSongIds:[b.songId]});
 assert.throws(()=>quoteSong(s,a.songId,{},s.players[0].playerId,at),/半首歌不能單獨點/);
 for(const [payload,cost,count] of [[{pairSongId:a.songId},1,2],[{pairSongId:b.songId},1,2]]){const q=quoteSong(s,a.songId,payload,s.players[0].playerId,at);assert.equal(q.creditCost,cost);assert.equal(q.items.reduce((n,x)=>n+x.performances,0),count);}
});
test('an existing lone half saved record (made before the rule) still reserves, cancels and completes with a half debit',()=>{
 let s=fixture(1),playerId=s.players[0].playerId,who={role:'player',playerId};const data={songId:s.songs[0].songId,kind:'saved'};
 const legacy=state=>{const q=state.queue.at(-1);q.creditCost=.5;return state;};
 s=legacy(run(s,'request',data,who));assert.equal(reservedCredits(s,playerId),.5);assert.equal(reservedHour(s,at),.5);
 s=run(s,'cancelOwn',{id:s.queue[0].id},who);assert.equal(balance(s,playerId),10);assert.equal(reservedCredits(s,playerId),0);
 s=legacy(run(s,'request',data,who));const id=s.queue.at(-1).id;s=run(s,'queue',{id,operation:'acknowledge',preparationMinutes:0});s=run(s,'queue',{id,operation:'complete'});assert.equal(balance(s,playerId),9.5);assert.equal(usedHour(s,at),.5);
});

test('editing a repeated half-song note preserves two performances and one reserved credit',()=>{
 let s=fixture(.5),playerId=s.players[0].playerId,songId=s.songs[0].songId;
 s=run(s,'request',{songId,pairSongId:songId,kind:'saved'},{role:'player',playerId});
 const id=s.queue[0].id;s=run(s,'queue',{id,operation:'edit',note:'Updated note'});
 assert.equal(s.queue[0].creditCost,1);assert.equal(s.queue[0].items[0].performances,2);assert.equal(reservedCredits(s,playerId),1);
});
