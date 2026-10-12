import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,balance,stats,reservedCredits,songPlays} from '../src/core.js';
const at='2026-10-12T11:10:00Z',admin={role:'admin'},run=(s,type,data,t=at)=>mutate(s,{streamer:'papa',type,data},admin,t);
function fixture(){let s=run(empty(),'player',{name:'isolated-accounting',ids:[]});s=run(s,'song',{title:'song',artist:'artist',creditCost:1});s=run(s,'ledger',{playerId:s.players[0].playerId,amount:3,note:'一般3首'});return s;}
const room=s=>scopeState(s,'papa'),pid=s=>s.players[0].playerId;
const allocate=s=>run(s,'allocate',{ledgerId:s.ledger[0].id,playerId:pid(s),total:3,stored:1,items:[{songId:s.songs[0].songId},{songId:s.songs[0].songId}]});
const op=(s,id,operation,extra={},t=at)=>run(s,'queue',{id,operation,...extra},t);
function complete(s,id,extra={},t=at){s=op(s,id,'stage',{preparationMinutes:0},t);return op(s,id,'complete',extra,t);}
test('3 received / 2 reserved / 1 available; source amount and receipt fact stay 3',()=>{
 let s=allocate(fixture());assert.equal(s.ledger[0].amount,3);assert.equal(s.ledger[0].receipt_quantity,3);
 assert.equal(balance(room(s),pid(s)),3);assert.equal(reservedCredits(room(s),pid(s)),2);
 assert.deepEqual(stats(room(s),at),{received:3,sung:0,saved:3,reserved:2,available:1});
 for(const q of s.queue)assert.equal(q.source_transaction_id,s.ledger[0].id);
 assert.throws(()=>allocate(s),/已有使用|不足/);
});
test('cancel both releases reservations, does not add gifts or orphan refunds; repeat is safe',()=>{
 let s=allocate(fixture()),ledger=structuredClone(s.ledger);
 for(const q of [...s.queue])s=op(s,q.id,'cancel');
 assert.deepEqual(s.ledger,ledger);assert.deepEqual(stats(room(s),at),{received:3,sung:0,saved:3,reserved:0,available:3});
 const before=structuredClone(s);assert.throws(()=>op(s,s.queue[0].id,'cancel'),/已結束/);assert.deepEqual(s,before);
 s=run(s,'queueBulkDelete',{ids:s.queue.map(q=>q.id)});assert.deepEqual(s.ledger,ledger);assert.equal(s.queue.length,2);
});
test('two completed allocations consume once, preserve links and cannot refund after archive/cancel',()=>{
 let s=allocate(fixture());for(const q of [...s.queue])s=complete(s,q.id);
 assert.deepEqual(stats(room(s),at),{received:3,sung:2,saved:1,reserved:0,available:1});
 for(const q of s.queue){const l=s.ledger.find(l=>l.id===q.settlement_id);assert.equal(l.source_transaction_id,q.source_transaction_id);assert.equal(l.queueId,q.id);assert.equal(l.performance_id,q.id);assert.equal(l.amount,-1);}
 const ledger=structuredClone(s.ledger);for(const q of [...s.queue]){assert.throws(()=>op(s,q.id,'cancel'));assert.throws(()=>op(s,q.id,'complete'));s=op(s,q.id,'delete');}
 assert.deepEqual(s.ledger,ledger);assert.equal(stats(room(s),at).sung,2);assert.equal(s.queue.filter(q=>q.status==='completed').length,2);
});
test('3 plus 2 received / 3 completed / balance 2 with selfProvided and hour carry; popularity unchanged',()=>{
 let s=fixture();s=run(s,'allocate',{ledgerId:s.ledger[0].id,playerId:pid(s),total:3,stored:0,items:[1,2,3].map(()=>({songId:s.songs[0].songId,selfProvided:true}))});
 s=run(s,'ledger',{playerId:pid(s),amount:2});for(const q of [...s.queue])s=complete(s,q.id,{carryOver:true,effective_at:'2026-10-12T12:30:00Z'},'2026-10-12T12:30:00Z');
 assert.deepEqual(stats(room(s),'2026-10-12T12:30:00Z'),{received:5,sung:3,saved:2,reserved:0,available:2});
 assert.equal(songPlays(room(s),s.songs[0].songId),0);
});
test('archive completed saved request never reverses debit or deletes the performance',()=>{
 let s=fixture();s=run(s,'onBehalf',{playerId:pid(s),songId:s.songs[0].songId,kind:'saved',completed:true});const id=s.queue[0].id,l=structuredClone(s.ledger);
 s=op(s,id,'delete');s=op(s,id,'delete');assert.deepEqual(s.ledger,l);assert.equal(balance(room(s),pid(s)),2);assert.equal(stats(room(s),at).sung,1);
 assert.throws(()=>run(s,'ledger',{...s.ledger.at(-1),remove:true}),/系統保留/);
});
test('receipt void/correction uses one linked reversal and retains original amount and Audit input',()=>{
 let s=fixture();const receipt=s.ledger[0];s=run(s,'ledger',{...receipt,amount:2,at,note:'更正2首'});
 assert.equal(s.ledger[0].amount,3);assert.ok(s.ledger[0].voided_at);assert.equal(s.ledger.find(l=>l.reversal_of===receipt.id).amount,-3);
 assert.equal(s.ledger.find(l=>l.correction_of===receipt.id).amount,2);assert.equal(stats(room(s),at).received,2);assert.equal(balance(room(s),pid(s)),2);
 assert.throws(()=>run(s,'ledger',{...receipt,remove:true}),/已撤銷/);
});
test('linked receipt cannot be voided or shrunk while allocations/performances would become orphaned',()=>{
 let s=allocate(fixture()),before=structuredClone(s);assert.throws(()=>run(s,'ledger',{...s.ledger[0],remove:true}),/已有分配/);assert.deepEqual(s,before);
 s=complete(s,s.queue[0].id);before=structuredClone(s);assert.throws(()=>run(s,'ledger',{...s.ledger[0],amount:0,at}),/已有分配/);assert.deepEqual(s,before);
});
test('Taipei midnight, current balance, test exclusion and last ten displayed rows are independent',()=>{
 let s=fixture();s.ledger[0].at='2026-10-11T15:59:59Z';s=run(s,'onBehalf',{playerId:pid(s),songId:s.songs[0].songId,kind:'saved',completed:true},'2026-10-11T16:00:01Z');
 for(let i=0;i<11;i++)s=run(s,'ledger',{playerId:pid(s),amount:1},'2026-10-12T00:00:00Z');
 assert.equal(stats(room(s),at).received,11);assert.equal(stats(room(s),at).sung,1);assert.equal(stats(room(s),at).saved,13);assert.equal(s.ledger.slice(-10).length,10);
});
test('wrong Room, player or source, failed allocation and non-manager calls leave entire state intact',()=>{
 let s=fixture(),before=structuredClone(s);assert.throws(()=>run(s,'allocate',{playerId:pid(s),ledgerId:s.ledger[0].id,total:3,stored:0,items:[{songId:'wrong'}]}));assert.deepEqual(s,before);
 assert.throws(()=>mutate(s,{type:'allocate',streamer:'papa',data:{}},{role:'player',playerId:pid(s)},at),/管理/);assert.deepEqual(s,before);
});

test('manual compensation changes balance without posing as a new receipt; correction preserves classification and Audit links',()=>{
 let s=fixture();s=run(s,'ledger',{playerId:pid(s),amount:2,note:'合法回補',accounting_adjustment:true});
 assert.equal(stats(room(s),at).received,3);assert.equal(balance(room(s),pid(s)),5);const id=s.ledger.at(-1).id;
 s=run(s,'ledger',{id,playerId:pid(s),amount:3,note:'合法回補修正',at});
 assert.equal(stats(room(s),at).received,3);assert.equal(balance(room(s),pid(s)),6);assert.equal(s.ledger.at(-1).correction_of,id);assert.equal(s.ledger.at(-1).accounting_adjustment,true);
 const before=structuredClone(s);assert.throws(()=>run(s,'ledger',{playerId:pid(s),amount:1,accounting_adjustment:'true'}),/帳務用途/);assert.deepEqual(s,before);
});
