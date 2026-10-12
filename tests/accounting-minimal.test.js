import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,stats,balance} from '../src/core.js';
const at='2026-10-12T11:10:00Z',actor={role:'admin'};
const run=(s,type,data)=>mutate(s,{streamer:'papa',type,data},actor,at);
function fixture(){let s=run(empty(),'player',{name:'isolated'});s=run(s,'song',{title:'song',artist:'artist'});s=run(s,'ledger',{playerId:s.players[0].playerId,amount:3});return s;}
function allocate(s){return run(s,'allocate',{ledgerId:s.ledger[0].id,playerId:s.players[0].playerId,total:3,stored:1,items:[{songId:s.songs[0].songId},{songId:s.songs[0].songId}]});}
const totals=s=>stats(scopeState(s,'papa'),at);
test('3 received -> 2 allocated -> stored1; cancel restores3 without extra credit',()=>{
 let s=allocate(fixture());assert.equal(totals(s).stored,1);
 for(const q of [...s.queue])s=run(s,'queue',{id:q.id,operation:'cancel'});
 assert.equal(totals(s).stored,3);assert.equal(totals(s).received,3);assert.equal(balance(scopeState(s,'papa'),s.players[0].playerId),3);
});
test('void original unperformed receipt cancels linked queues and preserves all audit facts',()=>{
 let s=allocate(fixture());s=run(s,'ledger',{...s.ledger[0],remove:true});
 assert.equal(totals(s).received,0);assert.equal(totals(s).stored,0);assert.equal(totals(s).sung,0);
 assert.equal(balance(scopeState(s,'papa'),s.players[0].playerId),0);
 assert.equal(s.queue.length,2);assert.ok(s.queue.every(q=>q.status==='cancelled'));assert.ok(s.ledger[0].voided_at);
 const before=structuredClone(s);assert.throws(()=>run(s,'ledger',{...s.ledger[0],remove:true}));assert.deepEqual(s,before);
});
test('completion consumes once and archive preserves sung; completed source cannot be silently voided',()=>{
 let s=allocate(fixture());for(const q of [...s.queue]){s=run(s,'queue',{id:q.id,operation:'stage',preparationMinutes:0});s=run(s,'queue',{id:q.id,operation:'complete'});}
 assert.equal(totals(s).stored,1);assert.equal(totals(s).sung,2);
 for(const q of [...s.queue])s=run(s,'queue',{id:q.id,operation:'delete'});
 assert.equal(totals(s).stored,1);assert.equal(totals(s).sung,2);
 assert.throws(()=>run(s,'ledger',{...s.ledger[0],remove:true}),/完成|演唱/);
});
test('old prepaid source cancellation and void reverse its linked returns atomically',()=>{
 let s=allocate(fixture());const source=s.ledger[0];source.amount=1;delete source.receipt_quantity;source.allocation_id=s.queue[0].allocation_id;
 for(const q of s.queue){delete q.allocation_model;delete q.source_transaction_id;}
 for(const q of [...s.queue])s=run(s,'queue',{id:q.id,operation:'cancel'});
 assert.equal(totals(s).received,3);assert.equal(totals(s).stored,3);
 s=run(s,'ledger',{...s.ledger[0],remove:true});assert.equal(totals(s).received,0);assert.equal(totals(s).stored,0);
 assert.equal(balance(scopeState(s,'papa'),s.players[0].playerId),0);
 assert.ok(s.ledger.filter(l=>l.allocationSettlement==='return').every(l=>l.voided_at));
});
test('show5/stored2/sung5 includes another player singing previous-show credits without adding their old balance',()=>{
 let s=fixture();s=run(s,'allocate',{ledgerId:s.ledger[0].id,playerId:s.players[0].playerId,total:3,stored:0,items:Array.from({length:3},()=>({songId:s.songs[0].songId,completed:true}))});
 s=run(s,'ledger',{playerId:s.players[0].playerId,amount:2});s=run(s,'player',{name:'old-credit-player'});
 s=run(s,'ledger',{playerId:s.players[1].playerId,amount:374,at:'2026-10-11T11:00:00Z',openingBalance:true});
 for(let i=0;i<2;i++)s=run(s,'onBehalf',{playerId:s.players[1].playerId,songId:s.songs[0].songId,kind:'saved',completed:true});
 assert.equal(totals(s).received,5);assert.equal(totals(s).stored,2);assert.equal(totals(s).sung,5);assert.equal(totals(s).saved,374);
});
test('a stored unperformed reservation can be revoked with its original receipt',()=>{
 let s=allocate(fixture());for(const q of [...s.queue])s=run(s,'queue',{id:q.id,operation:'store'});
 s=run(s,'ledger',{...s.ledger[0],remove:true});assert.equal(totals(s).stored,0);assert.equal(totals(s).received,0);
});
test('one half-song repeated twice remains one completed song in the headline',()=>{
 let s=fixture();s.songs[0].creditCost=0.5;
 s=run(s,'onBehalf',{playerId:s.players[0].playerId,songId:s.songs[0].songId,kind:'saved',completed:true});
 assert.equal(s.queue[0].items[0].performances,2);assert.equal(totals(s).sung,1);
});
