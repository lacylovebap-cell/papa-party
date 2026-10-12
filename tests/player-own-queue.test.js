import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,balance,savedQuota,ownQueueReplacementQuote} from '../src/core.js';
import {applyOwnQueueBatch,validateOwnQueueBatch} from '../src/player-bulk-tools.js';
import {deriveNotices} from '../src/notification-rules.js';
import {stateChanges} from '../src/state-patch.js';
import {createOwnQueue,ownQueueCancelJobs} from '../src/player-own-queue.js';
const at='2026-10-12T12:20:00Z',now='2026-10-12T13:10:00Z',admin={role:'admin'};
const run=(s,type,data,actor=admin,time=at,streamer='papa')=>mutate(s,{type,data,streamer},actor,time);
function fixture(kind='saved'){
 let s=run(empty(),'player',{name:'Owner',balance:10});s=run(s,'player',{name:'Other',balance:10});
 s=run(s,'song',{title:'Original',artist:'Singer'});s=run(s,'song',{title:'Replacement',artist:'Singer'});
 s=run(s,'song',{title:'Half',artist:'Singer',creditCost:.5,shortMode:'repeat'});
 const actor={role:'player',playerId:s.players[0].playerId};
 s=run(s,'request',{songId:s.songs[0].songId,kind,giftConfirmed:true,selfProvided:true,source:'draw'},actor);
 s=run(s,'queue',{id:s.queue[0].id,operation:'approve',preparationMinutes:5});
 return {s,actor,id:s.queue[0].id,songId:s.songs[1].songId};
}
test('saved replacement preserves original identity, time, provenance and history without an early debit; requires renewed acknowledgment',()=>{
 const {s,actor,id,songId}=fixture(),before=structuredClone(s),original=s.queue[0];
 assert.equal(ownQueueReplacementQuote(scopeState(s),{id,songId},actor,now).creditCost,1);assert.deepEqual(s,before);
 const next=run(s,'replaceOwn',{id,songId},actor,now),q=next.queue[0];
 for(const k of ['id','playerId','at','venue','source','selfProvided','test','acceptedAt'])assert.deepEqual(q[k],original[k]);
 assert.deepEqual(next.ledger,s.ledger);assert.deepEqual(next.crowns,s.crowns);assert.deepEqual(next.cards,s.cards);
 assert.equal(q.songId,songId);assert.equal(q.awaitingAcknowledgment,true);assert.equal(q.awaitingPreparation,true);
 for(const k of ['readyAt','preparationEndsAt','preparationStartedAt'])assert.equal(q[k],null);
 assert.equal(savedQuota(scopeState(next),at,actor.playerId).reserved,1);
 assert.throws(()=>run(next,'queue',{id,operation:'complete'},admin,now),/確認收到/);
 const notices=deriveNotices(s,next,{streamer_id:'papa',role:'player',action:'ownQueueBatch'},now);
 assert.deepEqual(notices.map(x=>x.type),['saved','accepted']);assert.ok(notices.every(x=>!x.body.includes('準備約')));
 const patch=stateChanges(s,next,{roomScoped:true,streamer_id:'papa'});assert.equal(patch.changes.length,1);assert.equal(patch.changes[0].kind,'queue');
 const acknowledged=run(next,'queue',{id,operation:'acknowledge',preparationMinutes:0},admin,now);
 const done=run(acknowledged,'queue',{id,operation:'complete'},admin,now);assert.equal(balance(scopeState(done),actor.playerId),9);assert.equal(done.queue[0].id,id);
});
test('live replacement rechecks current crown fee and requires gift confirmation without changing stored credits',()=>{
 let {s,actor,id,songId}=fixture('live');s.crowns.push({id:'new-crown',streamer_id:'papa',songId,playerId:s.players[1].playerId,price:55599,activatedAt:now});
 assert.equal(ownQueueReplacementQuote(scopeState(s),{id,songId},actor,now).price,55599);
 assert.throws(()=>run(s,'replaceOwn',{id,songId},actor,now),/禮物价格|禮物價格/);
 const next=run(s,'replaceOwn',{id,songId,giftConfirmed:true},actor,now);assert.equal(next.queue[0].price,55599);assert.equal(next.queue[0].status,'pending');assert.deepEqual(next.ledger,s.ledger);
});
test('owner batch is atomic for a room, rejects foreign/finished/hidden/noop/injected rows and never mutates its source',()=>{
 const {s,actor,id,songId}=fixture(),before=structuredClone(s);
 for(const data of [{id,songId:s.queue[0].songId},{id,songId,playerId:'forged'},{id,songId,note:'changed'},{id,songId,source:'manual'}])assert.throws(()=>run(s,'replaceOwn',data,actor,now));
 assert.throws(()=>run(s,'replaceOwn',{id,songId},{role:'player',playerId:s.players[1].playerId},now),/自己/);
 const hidden=structuredClone(s);hidden.songs[1].hidden=true;assert.throws(()=>run(hidden,'replaceOwn',{id,songId},actor,now),/未開放/);
 const finished=structuredClone(s);finished.queue[0].status='completed';assert.throws(()=>run(finished,'replaceOwn',{id,songId},actor,now),/尚未演唱/);
 assert.throws(()=>applyOwnQueueBatch(s,[{id,operation:'cancel'},{id:'missing',operation:'cancel'}],actor,now,'papa'),/自己/);assert.deepEqual(s,before);
 for(const rows of [[],[{id,operation:'cancel',songId}],[{id,operation:'cancel'},{id,operation:'cancel'}],[{id,operation:'replace',songId,giftConfirmed:'yes'}]])assert.throws(()=>validateOwnQueueBatch(rows));
 const next=applyOwnQueueBatch(s,[{id,operation:'cancel'}],actor,now,'papa');assert.equal(next.queue[0].status,'cancelled');assert.equal(next.queue.length,s.queue.length);assert.deepEqual(next.ledger,s.ledger);
});
test('half-song replacement releases reservations and blocks increases that exceed the original hour',()=>{
 const {s,actor,id}=fixture(),half=s.songs[2].songId;s.songs[0].creditCost=2;s.queue[0].creditCost=2;s.queue[0].items[0].creditCost=2;
 const next=run(s,'replaceOwn',{id,songId:half},actor,now);assert.equal(next.queue[0].creditCost,1);assert.equal(savedQuota(scopeState(next),at,actor.playerId).reserved,1);
 const full=structuredClone(next);full.streamerSettings.papa.hourlyLimit=1;
 assert.throws(()=>run(full,'replaceOwn',{id,songId:s.songs[0].songId},actor,now),/原小時/);
 const insufficient=structuredClone(s);insufficient.ledger=[];assert.throws(()=>run(insufficient,'replaceOwn',{id,songId:s.songs[1].songId},actor,now),/存歌不足/);
});
test('allocated live replacements and cancellation conserve received credits through linked adjustments and one refund',()=>{
 let {s,actor}=fixture('live');s.queue=[];s.songs[0].creditCost=2;
 s=run(s,'allocate',{playerId:actor.playerId,total:3,stored:0,items:[{songId:s.songs[0].songId},{songId:s.songs[1].songId}]},admin,at);
 const id=s.queue[0].id,half=s.songs[2].songId,oldBalance=balance(scopeState(s),actor.playerId);
 const next=run(s,'replaceOwn',{id,songId:half,giftConfirmed:true},actor,now);assert.equal(balance(scopeState(next),actor.playerId),oldBalance+1);assert.equal(next.queue[0].receivedCreditCost,2);
 const cancelled=run(next,'cancelOwn',{id},actor,now);assert.equal(balance(scopeState(cancelled),actor.playerId),oldBalance+2);
 assert.equal(cancelled.ledger.filter(x=>x.queueId===id&&x.allocationSettlement==='return').length,1);
 assert.throws(()=>run(cancelled,'cancelOwn',{id},actor,now),/已結束/);
});
const row=(id,slug='papa')=>({id,streamerId:slug,slug,name:slug,title:id,artist:'Singer',kind:'saved',status:'waiting',active:true});
const result=(rows,total=rows.length,revision=1)=>({rows,total,revision});
test('selected server pages preserve cross-page selection and clamp pages without fetching whole tables',async()=>{
 const calls=[],c=createOwnQueue({identity:()=>'',read:async b=>{calls.push(b);return b.page===0?result([row('a')],21):result([row('b')],21);}});
 await c.load();c.selectPage();await c.load(1);c.selectPage();assert.deepEqual([...c.snapshot().selected.keys()],['a','b']);assert.ok(calls.every(x=>x.limit===20));
 await c.setSort('oldest');assert.equal(c.snapshot().page,0);assert.equal(c.snapshot().selected.size,2);assert.equal(calls.at(-1).sort,'oldest');
 const clampCalls=[],d=createOwnQueue({identity:()=> 'scope',read:async b=>{clampCalls.push(b.page);return result([]);}});await d.load(99);assert.deepEqual(clampCalls,[99,0]);assert.equal(d.snapshot().page,0);
});
test('late responses from old account or earlier page cannot restore rows or selections',async()=>{
 let scope='one';const pending=[],c=createOwnQueue({identity:()=>scope,read:b=>new Promise(resolve=>pending.push(resolve))});
 const first=c.load();scope='two';const second=c.load();pending[1](result([row('current')]));await second;c.selectPage();pending[0](result([row('private-old')]));await first;
 assert.deepEqual(c.snapshot().rows.map(x=>x.id),['current']);assert.deepEqual([...c.snapshot().selected.keys()],['current']);scope='three';assert.equal(c.snapshot().selected.size,0);assert.equal(c.snapshot().rows.length,0);
});
test('partial and uncertain outcomes clear confirmed/unknown selections, preserve rejected selections and reject malformed acknowledgments',async()=>{
 const rows=[row('a','a'),row('b','b'),row('c','c')],c=createOwnQueue({identity:()=> 'scope',read:async()=>result(rows)});await c.load();c.selectPage();const jobs=ownQueueCancelJobs(rows);
 assert.throws(()=>c.settle(jobs,{results:[{streamer:'a',ok:true,count:1,revision:2}]}),/未確認/);
 c.settle(jobs,{results:[{streamer:'a',ok:true,count:1,revision:2},{streamer:'b',ok:false,unknown:true},{streamer:'c',ok:false,error:'Rejected'}]});assert.deepEqual([...c.snapshot().selected.keys()],['c']);
});
