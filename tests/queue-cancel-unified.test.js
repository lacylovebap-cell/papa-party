import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,balance,reservedCredits,savedQuota,cancelRecovery} from '../src/core.js';
import {deriveNotices} from '../src/notification-rules.js';

const admin={role:'admin'},now='2026-10-28T12:15:00Z',later='2026-10-28T12:40:00Z';
const run=(s,type,data,who=admin,at=now)=>mutate(s,{type,data,streamer:'papa'},who,at);
const player=(s,i=0)=>({role:'player',playerId:s.players[i].playerId});
const room=s=>scopeState(s,'papa');
const credit=s=>balance(room(s),s.players[0].playerId);
const reserved=s=>reservedCredits(room(s),s.players[0].playerId);
const op=(s,id,operation,extra={})=>run(s,'queue',{id,operation,...extra});
const ledgerOf=(s,id)=>s.ledger.filter(l=>l.queueId===id);

function setup({extra=0}={}){
 let s=run(empty(),'player',{name:'玩家甲',ids:['a'],balance:10});s=run(s,'player',{name:'玩家乙',ids:['b'],balance:10});
 for(const [title,creditCost] of [['一般歌',1],['兩首長歌',2],['半首歌',0.5]])s=run(s,'song',{title,artist:'歌手',creditCost});
 if(extra)s=run(s,'extraQuota',{player_id:s.players[0].playerId,extra_quota:extra,enabled:true});
 return s;
}
const request=(s,songIndex=0,kind='saved',who=0)=>run(s,'request',{songId:s.songs[songIndex].songId,kind,giftConfirmed:true},player(s,who));
const cancelBy=(s,id,method)=>method==='player'?run(s,'cancelOwn',{id},player(s)):method==='bulk'?run(s,'queueBulkDelete',{ids:[id]}):op(s,id,method);

test('every cancel entry point uses one settlement for 1, 2 and 0.5 song saved requests',()=>{
 for(const [index,cost] of [[0,1],[1,2],[2,0.5]])for(const method of ['cancel','delete','bulk','player']){
  // A lone half can no longer be requested; 0.5 covers a record made before that rule.
  let s=request(setup(),cost===0.5?0:index);const q=s.queue.at(-1);if(cost===0.5)q.creditCost=0.5;
  assert.equal(reserved(s),cost);assert.equal(credit(s),10);
  s=cancelBy(s,q.id,method);const row=s.queue.find(x=>x.id===q.id);
  assert.equal(row.status,'cancelled');assert.equal(reserved(s),0);assert.equal(credit(s),10,'saved credits are never debited before completion');
  assert.deepEqual(ledgerOf(s,q.id),[]);
  assert.equal(row.cancel_settlement.kind,'saved-reservation');assert.equal(row.cancel_settlement.credits,cost);
  assert.equal(row.cancel_settlement.via,{cancel:'cancel',delete:'delete',bulk:'bulk',player:'own'}[method]);
  assert.equal(row.cancel_settlement.available_before,10-cost);assert.equal(row.cancel_settlement.available_after,10);
  assert.deepEqual(cancelRecovery(room(s),row).state,'restored');assert.equal(cancelRecovery(room(s),row).credits,cost);
 }
});

test('repeated cancel, delete or bulk on a cancelled row never settles twice',()=>{
 let s=request(setup());const id=s.queue[0].id;s=op(s,id,'cancel');
 const snapshot=structuredClone({queue:s.queue,ledger:s.ledger});
 assert.throws(()=>op(s,id,'cancel'),/已結束/);assert.throws(()=>run(s,'cancelOwn',{id},player(s)),/已結束/);
 s=op(s,id,'delete');s=run(s,'queueBulkDelete',{ids:[id]});
 assert.deepEqual(s.ledger,snapshot.ledger);
 assert.deepEqual(s.queue[0].cancel_settlement,snapshot.queue[0].cancel_settlement);assert.equal(credit(s),10);
 // A forged second settlement attempt is rejected even if status were reopened.
 const forged=structuredClone(s);forged.queue[0].status='waiting';assert.throws(()=>op(forged,id,'cancel'),/已取消/);
});

test('exclusive hourly quota records which source was released',()=>{
 let s=setup({extra:1});s=request(s);s=request(s,0,'saved',1);s=request(s);
 const id=s.queue[2].id;s=op(s,id,'cancel');const st=s.queue[2].cancel_settlement;
 assert.equal(st.quota_personal,1);assert.equal(st.quota_common,0);
 const q=savedQuota(room(s),now,s.players[0].playerId);assert.equal(q.personalUsed,0);assert.equal(q.extraRemaining,1);
});

test('live without an allocation shows no credit change and never adds hourly capacity',()=>{
 let s=request(setup(),0,'live');const id=s.queue[0].id,before=savedQuota(room(s),now,s.players[0].playerId);
 s=op(s,id,'cancel');const row=s.queue[0];
 assert.equal(row.cancel_settlement.kind,'none');assert.equal(row.cancel_settlement.credits,0);
 assert.deepEqual(savedQuota(room(s),now,s.players[0].playerId),before);assert.equal(credit(s),10);
 assert.equal(cancelRecovery(room(s),row).state,'none');
});

test('new reservation allocations release the reserved credits without a ledger row',()=>{
 let s=setup();s=run(s,'ledger',{playerId:s.players[0].playerId,amount:3,note:'收到歌單'});
 const ledgerId=s.ledger.at(-1).id;
 s=run(s,'allocate',{playerId:s.players[0].playerId,ledgerId,total:3,stored:1,effective_at:now,items:[{songId:s.songs[1].songId}]});
 const q=s.queue.at(-1);assert.equal(q.allocation_model,'reservation-v1');
 const balanceBefore=credit(s),ledgerBefore=structuredClone(s.ledger);assert.equal(reserved(s),2);
 s=run(s,'queueBulkDelete',{ids:[q.id]});const row=s.queue.at(-1);
 assert.equal(reserved(s),0);assert.equal(credit(s),balanceBefore);assert.deepEqual(s.ledger,ledgerBefore);
 assert.equal(row.cancel_settlement.kind,'allocation-reservation');assert.equal(row.cancel_settlement.credits,2);
 assert.equal(cancelRecovery(room(s),row).state,'restored');
});

test('completed songs cannot be cancelled and archiving never touches settlement facts',()=>{
 let s=request(setup());const id=s.queue[0].id;
 s=op(s,id,'acknowledge',{preparationMinutes:0});s=run(s,'queue',{id,operation:'complete',effective_at:later},admin,later);
 assert.equal(credit(s),9);const ledger=structuredClone(s.ledger);
 assert.throws(()=>op(s,id,'cancel'),/已結束/);assert.throws(()=>run(s,'cancelOwn',{id},player(s)),/已結束/);
 s=op(s,id,'archive');assert.ok(s.queue[0].archived_at);assert.equal(s.queue[0].status,'completed');
 assert.deepEqual(s.ledger,ledger);assert.equal(credit(s),9);
 s=run(s,'queueBulkArchive',{ids:[id]});assert.deepEqual(s.ledger,ledger);
});

test('archive refuses unsung songs; bulk archive is all-or-nothing',()=>{
 let s=request(request(setup()));const [a,b]=s.queue.map(q=>q.id);
 assert.throws(()=>op(s,a,'archive'),/取消歌曲/);
 s=op(s,a,'cancel');
 assert.throws(()=>run(s,'queueBulkArchive',{ids:[a,b]}),/取消歌曲/);
 s=run(s,'queueBulkArchive',{ids:[a]});assert.ok(s.queue[0].archived_at);assert.equal(s.queue[1].status,'waiting');
 assert.equal(cancelRecovery(room(s),s.queue[0]).state,'restored');
});

test('legacy history is only marked restored when facts prove it',()=>{
 const s={ledger:[{id:'r1',queueId:'alloc-ok',allocationSettlement:'return',amount:2,storage_pool:'shengma'},{id:'r2',queueId:'alloc-dup',allocationSettlement:'return',amount:1},{id:'r3',queueId:'alloc-dup',allocationSettlement:'return',amount:1},{id:'d1',queueId:'saved-debited',amount:-1}]};
 const legacy=(id,extra)=>({id,status:'cancelled',creditCost:1,...extra});
 assert.deepEqual(cancelRecovery(s,legacy('saved-ok',{kind:'saved'})),{state:'restored',credits:1,kind:'saved-reservation',storage_pool:'shengma',legacy:true});
 assert.equal(cancelRecovery(s,legacy('saved-debited',{kind:'saved'})).state,'review');
 assert.equal(cancelRecovery(s,legacy('live',{kind:'live'})).state,'none');
 assert.equal(cancelRecovery(s,legacy('alloc-ok',{kind:'live',allocation_id:'x',allocationReturnedAt:now,allocationReturnedCredits:2,creditCost:2})).credits,2);
 assert.equal(cancelRecovery(s,legacy('alloc-missing',{kind:'live',allocation_id:'y'})).state,'review');
 assert.equal(cancelRecovery(s,legacy('alloc-dup',{kind:'live',allocation_id:'z',allocationReturnedAt:now})).state,'review');
 assert.equal(cancelRecovery(s,legacy('alloc-ok',{kind:'live',allocation_id:'x',allocationReturnedAt:now,allocationReturnedCredits:1})).state,'review');
 assert.equal(cancelRecovery(s,{id:'w',status:'waiting',kind:'saved'}),null);
});

test('one cancellation notifies the player and the streamer once with the settled amount',()=>{
 let s=request(setup(),1);const before=s,id=s.queue[0].id;
 for(const [who,action] of [[admin,{type:'queue',data:{id,operation:'cancel'}}],[player(s),{type:'cancelOwn',data:{id}}]]){
  const after=mutate(before,{...action,streamer:'papa'},who,now);
  const notices=deriveNotices(before,after,{role:who.role,streamer_id:'papa'},now).filter(n=>n.type==='cancel');
  assert.deepEqual(notices.map(n=>n.recipient).sort(),['__admin__',s.players[0].playerId].sort());
  assert.match(notices.find(n=>n.recipient!=='__admin__').body,/點歌已取消｜額度已回補.*已補回 2 首歌單額度，目前可用 10 首/);
  assert.match(notices.find(n=>n.recipient==='__admin__').body,/玩家《玩家甲》的《兩首長歌》已取消，歌單額度 2 首已返還/);
  assert.deepEqual(deriveNotices(after,after,{role:who.role,streamer_id:'papa'},now),[]);
 }
 let live=request(setup(),0,'live');const liveAfter=op(live,live.queue[0].id,'cancel');
 const liveNotices=deriveNotices(live,liveAfter,{role:'admin',streamer_id:'papa'},now).filter(n=>n.type==='cancel');
 assert.ok(liveNotices.every(n=>/無額度變動/.test(n.body))&&liveNotices.length===2);
});
