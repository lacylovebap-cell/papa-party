import test from 'node:test';
import assert from 'node:assert/strict';
import {mutate,upgradePlatform,empty,scopeState,balance,publicView,songPlays,savedQuota} from '../src/core.js';
import {accountingStats} from '../src/accounting.js';

const admin={role:'admin'},T='2026-10-31T10:00:00.000Z',later='2026-10-31T10:30:00.000Z';
function room(credits=3){
 let s=upgradePlatform(empty());
 s=mutate(s,{type:'song',streamer:'papa',data:{title:'忘記你為做不到',artist:'張學友',cat:'華語'}},admin,T);
 s=mutate(s,{type:'player',streamer:'papa',data:{name:'JAY',ids:['jay']}},admin,T);
 const r=scopeState(s,'papa'),player=r.players[0].playerId,songId=r.songs[0].songId;
 if(credits)s=mutate(s,{type:'ledger',streamer:'papa',data:{playerId:player,amount:credits,note:'一般 '+credits+' 首'}},admin,T);
 return {s,player,songId};
}
const run=(s,data,t=later)=>mutate(s,{type:'queue',streamer:'papa',data},admin,t);
const raw=(s,id)=>scopeState(s,'papa').queue.find(x=>x.id===id);
const bal=(s,p)=>balance(scopeState(s,'papa'),p,'shengma');
function sung(s,player,songId,kind){
 s=mutate(s,{type:'request',streamer:'papa',data:{songId,kind,giftConfirmed:true}},{role:'player',playerId:player},T);
 const id=scopeState(s,'papa').queue.at(-1).id;
 s=run(s,{id,operation:kind==='live'?'approve':'acknowledge',preparationMinutes:0},T);
 s=run(s,{id,operation:'complete'},T);return {s,id};
}

test('deleting a completed 提歌 returns the stored song with one linked correction and keeps the original debit',()=>{
 let {s,player,songId}=room(3),id;({s,id}=sung(s,player,songId,'saved'));
 assert.equal(bal(s,player),2);
 s=run(s,{id,operation:'void',reason:'重複輸入'});
 const q=raw(s,id),ledger=scopeState(s,'papa').ledger.filter(l=>l.queueId===id);
 assert.equal(bal(s,player),3,'stored song comes back');
 assert.equal(q.status,'completed','accounting guard: status is never rewritten');
 assert.ok(q.voided_at);assert.equal(q.void_record.reason,'重複輸入');assert.equal(q.void_record.credits,1);
 assert.deepEqual(ledger.map(l=>[l.accounting_kind,l.amount,!!l.voided_at]),[['consumption',-1,false],['void_correction',1,false]],'original debit untouched; one correction row');
 assert.throws(()=>run(s,{id,operation:'void'}),/已刪除/);
});

test('deleting a 現點 writes no ledger row; plays, stats, quota and every view drop it',()=>{
 let {s,player,songId}=room(0),a,b;({s,id:a}=sung(s,player,songId,'live'));({s,id:b}=sung(s,player,songId,'live'));
 const r0=scopeState(s,'papa');
 assert.equal(songPlays(r0,songId),2);
 s=run(s,{id:b,operation:'void'});
 const r=scopeState(s,'papa');
 assert.equal(r.ledger.length,0,'live performance has nothing to return');
 assert.equal(songPlays(r,songId),1);
 assert.equal(accountingStats(r,later).sung,accountingStats(r0,later).sung-1,'唱歌數 drops by one');
 assert.equal(accountingStats(r,later).received,accountingStats(r0,later).received-1,'a mistaken 現點 is not a received gift');
 const manager=publicView(s,admin,later,'papa'),player_=publicView(s,{role:'player',playerId:player},later,'papa');
 assert.deepEqual(manager.queue.map(q=>q.id),[a],'manager history no longer shows it');
 assert.deepEqual(player_.queue.map(q=>q.id),[a],'player history no longer shows it');
 assert.equal(player_.songs.find(x=>x.songId===songId).plays,1);
});

test('a deleted 提歌 frees its hourly slot',()=>{
 let {s,player,songId}=room(5),id;({s,id}=sung(s,player,songId,'saved'));
 const before=savedQuota(scopeState(s,'papa'),T,player).commonRemaining;
 s=run(s,{id,operation:'void'});
 assert.equal(savedQuota(scopeState(s,'papa'),T,player).commonRemaining,before+1);
});

test('only completed, non-allocated rows can be deleted; players cannot',()=>{
 let {s,player,songId}=room(3);
 s=mutate(s,{type:'request',streamer:'papa',data:{songId,kind:'saved',giftConfirmed:true}},{role:'player',playerId:player},T);
 const id=scopeState(s,'papa').queue.at(-1).id;
 assert.throws(()=>run(s,{id,operation:'void'}),/只有已完成/);
 assert.throws(()=>mutate(s,{type:'queue',streamer:'papa',data:{id,operation:'void'}},{role:'player',playerId:player},later),/請先登入管理/);
});

test('history shows the songbook title after a 共同主資料 correction; stored snapshot is unchanged',()=>{
 let {s,player,songId}=room(0),id;({s,id}=sung(s,player,songId,'live'));
 s=mutate(s,{type:'song',streamer:'papa',data:{songId,title:'忘記你我做不到',artist:'張學友',cat:'華語'}},admin,later);
 for(const view of [publicView(s,admin,later,'papa'),publicView(s,{role:'player',playerId:player},later,'papa')]){
  const q=view.queue.find(x=>x.id===id);
  assert.equal(q.title,'忘記你我做不到');assert.equal(q.items[0].title,'忘記你我做不到');
 }
 assert.equal(raw(s,id).title,'忘記你為做不到','stored fact keeps the original snapshot');
});
