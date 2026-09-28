import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,balance,stats,scopeState,reservedCredits,reservedHour,usedHour,songPlays} from '../src/core.js';

const admin={role:'admin'},now='2026-09-28T12:30:00Z',past='2026-09-28T11:30:00Z';
const run=(s,type,data,who=admin,at=now,streamer='papa')=>mutate(s,{type,data,streamer},who,at);
const player=s=>({role:'player',playerId:s.players[0].playerId});
const credit=s=>balance(scopeState(s,'papa'),player(s).playerId);
const op=(s,id,operation,extra={})=>run(s,'queue',{id,operation,...extra});
function setup(){let s=run(empty(),'player',{name:'分配玩家',ids:['allocation']});for(const [title,creditCost] of [['兩首長歌',2],['一般歌',1],['三首長歌',3],['半首甲',0.5],['半首乙',0.5]])s=run(s,'song',{title,artist:'歌手',creditCost});return s;}
function allocate(s=setup(),{existing=true,openingBalance=false,selfProvided=false,completed=false}={}){
 let ledgerId;
 if(existing){s=run(s,'ledger',{playerId:player(s).playerId,amount:3,openingBalance,note:'收到歌單'});ledgerId=s.ledger.at(-1).id;}
 return run(s,'allocate',{playerId:player(s).playerId,ledgerId,total:3,stored:1,effective_at:now,openingBalance,items:[{songId:s.songs[0].songId,selfProvided,completed}]});
}

test('allocated cancellation returns prepaid credits once without erasing the received total',()=>{
 for(const method of ['player','cancel','delete','bulk']){
  let s=allocate(),q=s.queue[0];assert.equal(credit(s),1);assert.equal(stats(s,now).received,3);
  if(method==='player')s=run(s,'cancelOwn',{id:q.id},player(s));
  else if(method==='bulk')s=run(s,'queueBulkDelete',{ids:[q.id]});else s=op(s,q.id,method);
  q=s.queue[0];assert.equal(q.status,'cancelled');assert.equal(credit(s),3);assert.equal(stats(s,now).received,3);
  assert.equal(q.allocationReturnedCredits,2);assert.equal(q.receivedCreditCost,2);
  const returned=s.ledger.find(l=>l.queueId===q.id);assert.equal(returned.amount,2);assert.equal(returned.conversion,true);assert.equal(returned.excludeStats,true);
  assert.equal(returned.allocationSettlement,'return');
  assert.throws(()=>op(s,q.id,'cancel'),/已結束/);assert.throws(()=>run(s,'cancelOwn',{id:q.id},player(s)),/已結束/);
  const history=structuredClone({queue:s.queue,ledger:s.ledger});s=op(s,q.id,'delete');s=run(s,'queueBulkDelete',{ids:[q.id]});
  assert.deepEqual({queue:s.queue,ledger:s.ledger},history);assert.equal(credit(s),3);
 }
});

test('allocation store then delete/bulk keeps one return and the original receipt history',()=>{
 let s=allocate(),id=s.queue[0].id;s=op(s,id,'store');assert.equal(credit(s),3);assert.equal(s.queue[0].status,'stored');
 const previous=structuredClone(s);s=op(s,id,'delete');s=run(s,'queueBulkDelete',{ids:[id]});
 assert.deepEqual(s.queue,previous.queue);assert.deepEqual(s.ledger,previous.ledger);assert.equal(stats(s,now).received,3);
 assert.throws(()=>op(s,id,'store'));assert.throws(()=>op(s,id,'edit',{songId:s.songs[1].songId}));
});

test('legacy allocated rows without snapshots return correctly and terminal legacy rows remain untouched',()=>{
 let s=allocate();delete s.queue[0].receivedCreditCost;delete s.ledger[0].allocation_id;
 s=op(s,s.queue[0].id,'cancel');assert.equal(credit(s),3);assert.equal(s.queue[0].receivedCreditCost,2);
 let legacy=allocate();const id=legacy.queue[0].id;legacy.queue[0].status='stored';delete legacy.queue[0].receivedCreditCost;
 legacy.ledger.push({id:'legacy-store',playerId:player(legacy).playerId,queueId:id,streamer_id:'papa',amount:2,conversion:true,at:now});
 const history=structuredClone(legacy);legacy=op(legacy,id,'delete');legacy=run(legacy,'queueBulkDelete',{ids:[id]});
 assert.deepEqual(legacy.queue,history.queue);assert.deepEqual(legacy.ledger,history.ledger);assert.equal(credit(legacy),3);
});

test('changing allocated cost 2 to 1 and back to 2 settles only the delta; cancel restores the remaining cost',()=>{
 let s=allocate(),q=s.queue[0],created=q.created_at;
 s=op(s,q.id,'edit',{songId:s.songs[1].songId,note:'改成一首',selfProvided:true});q=s.queue[0];
 assert.equal(q.creditCost,1);assert.equal(q.receivedCreditCost,2);assert.equal(credit(s),2);assert.equal(stats(s,now).received,3);
 assert.equal(q.created_at,created);assert.equal(q.status,'waiting');assert.equal(q.selfProvided,true);
 s=op(s,q.id,'edit',{songId:s.songs[0].songId});q=s.queue[0];assert.equal(q.creditCost,2);assert.equal(credit(s),1);
 assert.deepEqual(s.ledger.filter(l=>l.allocationSettlement==='adjustment').map(l=>l.amount),[1,-1]);
 s=op(s,q.id,'cancel');assert.equal(credit(s),3);assert.equal(stats(s,now).received,3);assert.equal(s.queue[0].allocationReturnedCredits,2);
});

test('allocation cost increase cannot consume stored credits reserved by another request',()=>{
 let s=allocate();s=run(s,'request',{songId:s.songs[1].songId,kind:'saved'},player(s));
 const previous=structuredClone(s);assert.equal(reservedCredits(s,player(s).playerId),1);
 assert.throws(()=>op(s,s.queue[0].id,'edit',{songId:s.songs[2].songId}),/可用存歌不足/);assert.deepEqual(s,previous);
});

test('metadata/time edits preserve old quote even after catalog price changes or song removal',()=>{
 let s=allocate(),q=s.queue[0];s=run(s,'song',{...s.songs[0],creditCost:3});
 s=op(s,q.id,'edit',{songId:q.songId,pairSongId:'',note:'只改備註',selfProvided:true,at:past});q=s.queue[0];
 assert.equal(q.creditCost,2);assert.equal(q.items[0].creditCost,2);assert.equal(q.at,past.replace('Z','.000Z'));
 assert.equal(q.acceptedAt,now.replace('Z','.000Z'));assert.equal(credit(s),1);assert.equal(q.created_at,now);
 s=run(s,'song',{songId:q.songId,remove:true});s=op(s,q.id,'edit',{songId:q.songId,pairSongId:'',note:'歌曲刪除後仍可註記'});
 assert.equal(s.queue[0].creditCost,2);assert.equal(s.queue[0].title,q.title);assert.equal(credit(s),1);
});

test('allocated replacement uses current half pairing rules and refunds only one combined credit',()=>{
 let s=allocate(),id=s.queue[0].id,a=s.songs[3],b=s.songs[4];
 s=run(s,'song',{...a,shortMode:'both',pairSongIds:[b.songId]});
 s=op(s,id,'edit',{songId:a.songId,pairSongId:b.songId});assert.equal(s.queue[0].creditCost,1);assert.equal(s.queue[0].items.length,2);assert.equal(credit(s),2);
 s=op(s,id,'edit',{songId:a.songId,pairSongId:''});assert.equal(s.queue[0].items[0].performances,2);assert.equal(credit(s),2);
 assert.throws(()=>op(s,id,'edit',{songId:a.songId,pairSongId:s.songs[1].songId}),/半首/);
 s=op(s,id,'cancel');assert.equal(credit(s),3);assert.equal(s.queue[0].allocationReturnedCredits,1);assert.equal(stats(s,now).received,3);
});

test('saved edits exclude their own reservation, retain admin override and never mint cancellation credits',()=>{
 let s=setup();s=run(s,'ledger',{playerId:player(s).playerId,amount:2});s=run(s,'request',{songId:s.songs[0].songId,kind:'saved'},player(s));
 const id=s.queue[0].id;s=op(s,id,'edit',{songId:s.songs[1].songId});assert.equal(reservedCredits(s,player(s).playerId),1);
 s=op(s,id,'edit',{songId:s.songs[0].songId});assert.equal(reservedCredits(s,player(s).playerId),2);assert.equal(reservedHour(s,now),2);
 assert.throws(()=>op(s,id,'edit',{songId:s.songs[2].songId}),/存歌不足/);
 const ledger=structuredClone(s.ledger);s=op(s,id,'delete');assert.equal(s.queue[0].status,'cancelled');assert.equal(credit(s),2);assert.deepEqual(s.ledger,ledger);
 s=run(s,'onBehalf',{playerId:player(s).playerId,songId:s.songs[0].songId,kind:'saved',at:past});
 const backfill=s.queue.at(-1).id;s=op(s,backfill,'edit',{songId:s.songs[1].songId,at:now});assert.equal(reservedHour(s,now),1);assert.equal(reservedHour(s,past),0);
});

test('completed allocations preserve consumed credits and cannot be refunded by deletion or editing',()=>{
 let s=allocate(undefined,{selfProvided:true,completed:true}),id=s.queue[0].id;
 assert.equal(credit(s),1);assert.equal(songPlays(s,s.songs[0].songId),0);assert.equal(stats(s,now).sung,1);
 assert.throws(()=>op(s,id,'cancel'));assert.throws(()=>op(s,id,'edit',{songId:s.songs[1].songId}));
 const previous=structuredClone(s);s=op(s,id,'delete');s=run(s,'queueBulkDelete',{ids:[id]});assert.deepEqual(s.queue,previous.queue);assert.deepEqual(s.ledger,previous.ledger);
 assert.equal(credit(s),1);assert.equal(stats(s,now).received,3);
});

test('settlement ledger cannot be manually edited, deleted, reallocated or time-edited',()=>{
 let s=allocate(),id=s.queue[0].id;s=op(s,id,'edit',{songId:s.songs[1].songId});s=op(s,id,'store');
 for(const l of s.ledger.filter(l=>l.queueId===id)){
  const before=structuredClone(s);
  for(const data of [{id:l.id,playerId:l.playerId,remove:true},{id:l.id,playerId:l.playerId,amount:100,at:past},{id:l.id,playerId:l.playerId,amount:l.amount,at:past}])assert.throws(()=>run(s,'ledger',data),/系統保留/);
  assert.throws(()=>run(s,'recordTime',{table:'ledger',id:l.id,times:{at:past}}),/系統保留/);
  assert.throws(()=>run(s,'allocate',{ledgerId:l.id,playerId:l.playerId,total:l.amount,stored:0,items:[{songId:s.songs[1].songId}]}));assert.deepEqual(s,before);
 }
 const ledger=structuredClone(s.ledger);s=run(s,'recordTime',{table:'queue',id,times:{storedAt:past}});assert.deepEqual(s.ledger,ledger);
});

test('opening/test allocations preserve received exclusions after refunds and edits',()=>{
 let opening=allocate(undefined,{openingBalance:true});opening=op(opening,opening.queue[0].id,'cancel');assert.equal(credit(opening),3);assert.equal(stats(opening,now).received,0);
 let s=setup();s=run(s,'player',{...s.players[0],test:true});s=allocate(s);s=op(s,s.queue[0].id,'edit',{songId:s.songs[1].songId});s=op(s,s.queue[0].id,'cancel');
 assert.equal(credit(s),3);assert.equal(stats(s,now).received,0);assert.ok(s.ledger.every(l=>l.test));
});

test('queue editing validates scope, role, crown and protected identity atomically',()=>{
 let s=allocate(),id=s.queue[0].id;const longId=s.songs[0].songId,oneId=s.songs[1].songId;s=run(s,'streamer',{slug:'other',display_name:'另一位'});
 s=run(s,'song',{title:'另一位歌曲',artist:'乙'},admin,now,'other');const other=scopeState(s,'other').songs[0];
 let previous=structuredClone(s);assert.throws(()=>run(s,'queue',{id,operation:'edit',songId:other.songId}),/目前主播/);
 assert.throws(()=>run(s,'queue',{id,operation:'edit',note:'跨主播'},admin,now,'other'),/找不到/);
 assert.throws(()=>run(s,'queue',{id,operation:'edit',note:'玩家'},player(s)),/管理/);
 for(const extra of [{playerId:'forged'},{status:'completed'},{kind:'saved'},{allocation_id:'changed'},{created_at:past}])assert.throws(()=>op(s,id,'edit',extra),/只能修改/);
 assert.deepEqual(s,previous);
 s=run(s,'player',{name:'冠歌主人'});s=run(s,'crown',{songId:oneId,playerId:s.players[1].playerId,tier:'金卡',activate:true,singerPaid:true,bandPaid:true,hostPaid:true});
 s=op(s,id,'edit',{songId:oneId});assert.equal(s.queue[0].price,4200);assert.equal(s.queue[0].double,500);assert.ok(s.queue[0].crownId);
 s=run(s,'ledger',{playerId:player(s).playerId,amount:2});s=run(s,'request',{songId:longId,kind:'saved'},player(s));const saved=s.queue.at(-1).id;
 previous=structuredClone(s);assert.throws(()=>op(s,saved,'edit',{songId:oneId}),/冠歌/);assert.deepEqual(s,previous);
});

test('bulk removal safely mixes active allocated, active saved, completed allocation and ordinary history',()=>{
 let s=allocate(),allocation=s.queue[0].id;s=run(s,'ledger',{playerId:player(s).playerId,amount:2});s=run(s,'request',{songId:s.songs[0].songId,kind:'saved'},player(s));const saved=s.queue.at(-1).id;
 s=allocate(s,{existing:false,completed:true});const completed=s.queue.at(-1).id;const beforeCredit=credit(s);
 s=run(s,'queueBulkDelete',{ids:[allocation,saved,completed]});assert.equal(credit(s),beforeCredit+2);
 assert.equal(s.queue.find(q=>q.id===allocation).status,'cancelled');assert.equal(s.queue.find(q=>q.id===saved).status,'cancelled');assert.equal(s.queue.find(q=>q.id===completed).status,'completed');
 assert.equal(reservedCredits(s,player(s).playerId),0);assert.equal(usedHour(s,now),0);
});
