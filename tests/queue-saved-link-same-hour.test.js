import test from 'node:test';
import assert from 'node:assert/strict';
import {mutate,upgradePlatform,empty,scopeState,balance,queueUsesQuota} from '../src/core.js';

const admin={role:'admin'},T='2026-11-20T06:17:00.000Z',T2='2026-11-20T06:19:00.000Z',T3='2026-11-20T06:21:00.000Z',NEXT='2026-11-20T07:05:00.000Z';
const run=(s,type,data,who=admin,t=T2)=>mutate(s,{type,streamer:'papa',data},who,t);
const room=s=>scopeState(s,'papa');
function setup(reqAt=T2){
 let s=upgradePlatform(empty());
 s=run(s,'song',{title:'記得捨不得',artist:'蔡佩軒',cat:'華語'},admin,T);
 s=run(s,'player',{name:'測試人員',ids:['t']},admin,T);
 const pid=room(s).players[0].playerId,songId=room(s).songs[0].songId;
 s=run(s,'ledger',{playerId:pid,amount:2,note:'2 首'},admin,T);
 const receiptId=room(s).ledger.at(-1).id;
 s=run(s,'request',{songId,kind:'saved'},{role:'player',playerId:pid},reqAt);
 return {s,pid,receiptId,qid:room(s).queue.at(-1).id};
}
test('same-hour 提歌 linked to receipt: deducts 1, does not use hourly quota',()=>{
 let {s,pid,receiptId,qid}=setup();
 assert.equal(queueUsesQuota(room(s).queue.find(q=>q.id===qid)),true);
 s=run(s,'queue',{id:qid,operation:'link',receiptId,ids:[qid]});
 let q=room(s).queue.find(x=>x.id===qid);
 assert.equal(q.kind,'saved');assert.equal(q.linked_receipt_id,receiptId);assert.ok(q.quota_exempt);
 assert.equal(queueUsesQuota(q),false);
 s=run(s,'queue',{id:qid,operation:'acknowledge',preparationMinutes:0},admin,T3);
 s=run(s,'queue',{id:qid,operation:'complete'},admin,T3);
 q=room(s).queue.find(x=>x.id===qid);
 assert.equal(q.status,'completed');assert.equal(queueUsesQuota(q),false);
 assert.equal(balance(room(s),pid,'shengma'),1);
 assert.throws(()=>run(s,'queue',{id:qid,operation:'changeKind',kind:'live'},admin,T3),/已連動/);
});
test('completed 提歌 can be linked afterwards in history',()=>{
 let {s,pid,receiptId,qid}=setup();
 s=run(s,'queue',{id:qid,operation:'acknowledge',preparationMinutes:0},admin,T3);
 s=run(s,'queue',{id:qid,operation:'complete'},admin,T3);
 s=run(s,'queue',{id:qid,operation:'link',receiptId,ids:[qid]},admin,T3);
 const q=room(s).queue.find(x=>x.id===qid);
 assert.equal(queueUsesQuota(q),false);assert.equal(balance(room(s),pid,'shengma'),1);
});
test('提歌 in a later hour cannot link to an earlier-hour receipt',()=>{
 const {s,receiptId,qid}=setup(NEXT);
 assert.throws(()=>run(s,'queue',{id:qid,operation:'link',receiptId,ids:[qid]},admin,NEXT),/同一個整點小時/);
});
