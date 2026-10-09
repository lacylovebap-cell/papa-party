import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,balance,reservedCredits,reservedHour,usedHour,upgradePlatform,publicView} from '../src/core.js';

const admin={role:'admin'},now='2026-10-08T12:30:00Z',past='2026-10-08T11:30:00Z';
const run=(s,type,data,who=admin,at=now,streamer='papa')=>mutate(s,{type,data,streamer},who,at);
const player=s=>({role:'player',playerId:s.players[0].playerId,loginId:'venue-player'});
const room=(s,streamer='papa')=>scopeState(s,streamer);
const credits=(s,pool='shengma',streamer='papa')=>balance(room(s,streamer),player(s).playerId,pool);
const held=(s,pool='shengma',streamer='papa')=>reservedCredits(room(s,streamer),player(s).playerId,pool);
const song=(s,cost,streamer='papa')=>room(s,streamer).songs.find(x=>x.creditCost===cost);
const op=(s,id,operation,extra={},at=now,streamer='papa')=>run(s,'queue',{id,operation,...extra},admin,at,streamer);
const deposit=(s,amount,storage_pool='shengma',streamer='papa')=>run(s,'ledger',{playerId:player(s).playerId,amount,storage_pool},admin,now,streamer);
const settings=(s,data,streamer='papa')=>run(s,'settings',data,admin,now,streamer);
const request=(s,cost=1,extra={},streamer='papa')=>run(s,'request',{songId:song(s,cost,streamer).songId,kind:'saved',...extra},player(s),now,streamer);
function setup(){
 let s=run(empty(),'player',{name:'場域玩家',ids:['venue-player']});
 s=settings(s,{hourlyLimit:20});
 for(const creditCost of [0.5,1,2,3])s=run(s,'song',{title:`${creditCost} 首歌`,artist:'歌手',creditCost});
 return s;
}
const radio=s=>settings(s,{radio_enabled:true,current_space:'radio'});
function complete(s,id,at=now,streamer='papa'){
 s=op(s,id,'acknowledge',{preparationMinutes:0},at,streamer);
 return op(s,id,'complete',{},at,streamer);
}

test('disabled radio preserves legacy ledger, reservations and unknown historical venue',()=>{
 let s=deposit(setup(),5),id=player(s).playerId;
 assert.equal(room(s).settings.radio_enabled,false);assert.equal(room(s).settings.current_space,'shengma');
 delete s.ledger[0].storage_pool;
 s=request(s,2);const q=s.queue[0];
 assert.equal(q.venue,'shengma');assert.equal(q.consumed_storage_pool,'shengma');
 delete q.venue;delete q.consumed_storage_pool;
 s=radio(s);s=deposit(s,8,'radio');
 assert.equal(balance(room(s),id,'shengma'),5);assert.equal(balance(room(s),id),8);assert.equal(held(s),2);assert.equal(held(s,'radio'),0);
 const upgraded=upgradePlatform(s),own=publicView(upgraded,player(s),now);
 assert.equal(upgraded.queue[0].venue,undefined);assert.equal(own.queue[0].venue,undefined);
 s=complete(s,q.id);
 assert.equal(credits(s),3);assert.equal(credits(s,'radio'),8);
 assert.equal(s.ledger.find(l=>l.queueId===q.id&&l.amount<0).storage_pool,'shengma');
 assert.equal(s.queue[0].venue,undefined);
});

test('weighted radio requests select a whole pool after subtracting its existing reservations',()=>{
 let s=deposit(radio(deposit(setup(),7)),3,'radio');
 s=request(s,2);const first=s.queue.at(-1);
 assert.equal(first.creditCost,2);assert.equal(first.venue,'radio');assert.equal(first.consumed_storage_pool,'radio');
 s=request(s,2);const fallback=s.queue.at(-1);
 assert.equal(fallback.venue,'radio');assert.equal(fallback.consumed_storage_pool,'shengma');
 assert.equal(held(s,'radio'),2);assert.equal(held(s),2);assert.equal(credits(s,'radio'),3);assert.equal(credits(s),7);
 s=complete(s,first.id);s=complete(s,fallback.id);
 assert.equal(credits(s,'radio'),1);assert.equal(credits(s),5);
 assert.deepEqual(s.ledger.filter(l=>l.amount<0).map(l=>[l.amount,l.storage_pool]),[[-2,'radio'],[-2,'shengma']]);
});

test('one insufficient radio pool and one insufficient shengma pool cannot be combined',()=>{
 const s=deposit(radio(deposit(setup(),1)),1,'radio'),before=structuredClone(s);
 assert.throws(()=>request(s,2),/存歌不足|存歌袋/);assert.deepEqual(s,before);
 let fallback=deposit(radio(deposit(setup(),3)),2,'radio');fallback=request(fallback,3);
 assert.equal(fallback.queue[0].creditCost,3);assert.equal(fallback.queue[0].consumed_storage_pool,'shengma');
});

test('completion cannot consume credits still reserved by another request in the original pool',()=>{
 let s=deposit(radio(setup()),3,'radio');s=request(s,2);const id=s.queue[0].id;s=request(s,1);const second=s.queue[1].id;
 const receipt=s.ledger[0];s=run(s,'ledger',{...receipt,amount:2,at:now});
 s=op(s,id,'acknowledge',{preparationMinutes:0});const before=structuredClone(s);
 assert.equal(held(s,'radio'),3);assert.throws(()=>op(s,id,'complete'),/存歌不足/);assert.deepEqual(s,before);
 s=run(s,'cancelOwn',{id:second},player(s));s=op(s,id,'complete');
 assert.equal(credits(s,'radio'),0);assert.equal(credits(s),0);assert.equal(s.ledger.filter(l=>l.queueId===id&&l.amount<0).length,1);
});

test('half-song repeats and pairs choose a pool using the complete one-credit quote',()=>{
 let s=deposit(radio(deposit(setup(),2)),0.5,'radio');
 s=request(s,0.5);assert.equal(s.queue[0].creditCost,1);assert.equal(s.queue[0].items[0].performances,2);
 assert.equal(s.queue[0].consumed_storage_pool,'shengma');assert.equal(held(s),1);assert.equal(held(s,'radio'),0);
 s=run(s,'song',{title:'搭配半首',artist:'歌手',creditCost:0.5});
 const a=song(s,0.5),b=s.songs.at(-1);s=run(s,'song',{...a,shortMode:'pair',pairSongIds:[b.songId]});
 s=request(s,0.5,{pairSongId:b.songId});
 assert.equal(s.queue.at(-1).items.length,2);assert.equal(s.queue.at(-1).consumed_storage_pool,'shengma');
 assert.equal(held(s),2);assert.throws(()=>request(s,0.5,{pairSongId:b.songId}),/存歌不足|存歌袋/);
});

test('players cannot choose a venue while on-behalf requests may explicitly select an enabled venue',()=>{
 let s=deposit(setup(),5),before=structuredClone(s);
 for(const venue of ['shengma','radio'])assert.throws(()=>request(s,1,{venue}),/玩家不能/);
 assert.deepEqual(s,before);
 assert.throws(()=>run(s,'onBehalf',{playerId:player(s).playerId,songId:song(s,1).songId,kind:'saved',venue:'radio'}),/尚未啟用/);
 s=settings(s,{radio_enabled:true,current_space:'shengma'});s=deposit(s,5,'radio');
 s=run(s,'onBehalf',{playerId:player(s).playerId,songId:song(s,1).songId,kind:'saved',venue:'radio'});
 assert.equal(s.queue[0].venue,'radio');assert.equal(s.queue[0].consumed_storage_pool,'radio');
 assert.equal(room(s).settings.current_space,'shengma');
});

test('saved song changes use their original pool even after disabling radio or adding another balance',()=>{
 let s=deposit(radio(deposit(setup(),100)),2,'radio');s=request(s,2);const id=s.queue[0].id;
 s=settings(s,{radio_enabled:false,current_space:'shengma'});const before=structuredClone(s);
 assert.throws(()=>op(s,id,'edit',{songId:song(s,3).songId}),/存歌不足/);assert.deepEqual(s,before);
 s=op(s,id,'edit',{songId:song(s,1).songId});
 assert.equal(s.queue[0].venue,'radio');assert.equal(s.queue[0].consumed_storage_pool,'radio');
 assert.equal(held(s,'radio'),1);assert.equal(held(s),0);
 for(const extra of [{venue:'shengma'},{consumed_storage_pool:'shengma'},{allocation_storage_pool:'shengma'}])
  assert.throws(()=>op(s,id,'edit',extra),/只能修改/);
 s=complete(s,id);assert.equal(credits(s,'radio'),1);assert.equal(credits(s),100);
 let fallback=deposit(radio(deposit(setup(),2)),1,'radio');fallback=request(fallback,2);const fallbackId=fallback.queue[0].id;
 fallback=deposit(fallback,10,'radio');const unchanged=structuredClone(fallback);
 assert.throws(()=>op(fallback,fallbackId,'edit',{songId:song(fallback,3).songId}),/存歌不足/);
 assert.deepEqual(fallback,unchanged);assert.equal(fallback.queue[0].consumed_storage_pool,'shengma');
});

test('switching or disabling venues keeps one weighted hourly quota for a streamer',()=>{
 let s=settings(deposit(setup(),10),{hourlyLimit:3,radio_enabled:true,current_space:'shengma'});s=deposit(s,10,'radio');s=request(s,1);const shengma=s.queue[0].id;
 s=radio(s);s=request(s,2);const radioId=s.queue[1].id;
 assert.equal(reservedHour(room(s),now),3);assert.throws(()=>request(s,1),/額度不足/);
 s=settings(s,{radio_enabled:false,current_space:'shengma'});
 assert.equal(reservedHour(room(s),now),3);assert.throws(()=>request(s,1),/額度不足/);
 s=complete(s,shengma);s=complete(s,radioId);
 assert.equal(usedHour(room(s),now),3);assert.equal(reservedHour(room(s),now),0);
 s=radio(s);assert.equal(usedHour(room(s),now),3);assert.throws(()=>request(s,1),/額度不足/);
});

test('saved cancellation releases only its original reservation and completed deletion reverses the original debit',()=>{
 let s=deposit(radio(deposit(setup(),7)),5,'radio');s=request(s,2);const cancelled=s.queue[0].id,ledger=structuredClone(s.ledger);
 s=settings(s,{current_space:'shengma'});s=run(s,'cancelOwn',{id:cancelled},player(s));
 assert.equal(held(s,'radio'),0);assert.equal(credits(s,'radio'),5);assert.equal(credits(s),7);assert.deepEqual(s.ledger,ledger);
 assert.throws(()=>run(s,'cancelOwn',{id:cancelled},player(s)),/已結束/);
 s=radio(s);s=request(s,2);const completed=s.queue.at(-1).id;s=settings(s,{current_space:'shengma'});s=complete(s,completed);
 assert.equal(credits(s,'radio'),3);s=op(s,completed,'delete');assert.equal(credits(s,'radio'),5);assert.equal(credits(s),7);
 assert.throws(()=>op(s,completed,'delete'),/找不到/);assert.equal(credits(s,'radio'),5);
});

test('allocated receipt edits, cancellation and storage always settle their original storage pool once',()=>{
 for(const operation of ['cancel','store']){
  let s=deposit(radio(deposit(setup(),20)),3,'radio'),ledgerId=s.ledger.at(-1).id;
  s=run(s,'allocate',{playerId:player(s).playerId,ledgerId,total:3,stored:1,items:[{songId:song(s,2).songId}]});const id=s.queue[0].id;
  assert.equal(s.queue[0].venue,'radio');assert.equal(s.queue[0].allocation_storage_pool,'radio');
  assert.equal(s.queue[0].consumed_storage_pool,undefined);assert.equal(credits(s,'radio'),1);assert.equal(credits(s),20);
  s=settings(s,{radio_enabled:false,current_space:'shengma'});s=op(s,id,'edit',{songId:song(s,1).songId});
  assert.equal(credits(s,'radio'),2);assert.equal(credits(s),20);
  assert.equal(s.ledger.find(l=>l.allocationSettlement==='adjustment').storage_pool,'radio');
  s=op(s,id,operation);assert.equal(credits(s,'radio'),3);assert.equal(credits(s),20);
  const returned=s.ledger.find(l=>l.allocationSettlement==='return');assert.equal(returned.amount,1);assert.equal(returned.storage_pool,'radio');
  const history=structuredClone({queue:s.queue,ledger:s.ledger});s=op(s,id,'delete');s=run(s,'queueBulkDelete',{ids:[id]});
  assert.deepEqual({queue:s.queue,ledger:s.ledger},history);assert.throws(()=>op(s,id,operation),/已結束|未演唱/);
 }
});

test('allocation cost increases cannot use another pool or credits reserved in the origin pool',()=>{
 let s=deposit(radio(deposit(setup(),50)),3,'radio'),ledgerId=s.ledger.at(-1).id;
 s=run(s,'allocate',{playerId:player(s).playerId,ledgerId,total:3,stored:1,items:[{songId:song(s,2).songId}]});const id=s.queue[0].id;
 s=request(s,1);const before=structuredClone(s);
 assert.equal(held(s,'radio'),1);assert.throws(()=>op(s,id,'edit',{songId:song(s,3).songId}),/可用存歌不足/);assert.deepEqual(s,before);
 s=run(s,'cancelOwn',{id:s.queue[1].id},player(s));s=op(s,id,'edit',{songId:song(s,3).songId});
 assert.equal(credits(s,'radio'),0);assert.equal(credits(s),50);
 s=op(s,id,'cancel');assert.equal(credits(s,'radio'),3);assert.equal(credits(s),50);
});

test('radio allocations made from a shengma receipt return to shengma and cannot relocate an existing receipt',()=>{
 let s=deposit(setup(),3),ledgerId=s.ledger[0].id;s=radio(s);s=deposit(s,5,'radio');
 s=run(s,'allocate',{playerId:player(s).playerId,ledgerId,total:3,stored:1,items:[{songId:song(s,2).songId}]});const id=s.queue[0].id;
 assert.equal(s.queue[0].venue,'radio');assert.equal(s.queue[0].allocation_storage_pool,'shengma');
 s=settings(s,{current_space:'shengma'});s=op(s,id,'cancel');
 assert.equal(credits(s),3);assert.equal(credits(s,'radio'),5);
 assert.equal(s.ledger.find(l=>l.allocationSettlement==='return').storage_pool,'shengma');
 const radioReceipt=s.ledger.find(l=>l.storage_pool==='radio'),before=structuredClone(s);
 assert.throws(()=>run(s,'allocate',{playerId:player(s).playerId,ledgerId:radioReceipt.id,total:5,stored:3,items:[{songId:song(s,2).songId}]}),/聲瑪不能/);
 assert.throws(()=>run(s,'ledger',{...radioReceipt,amount:5,at:now,storage_pool:'shengma'}),/不能移到/);
 assert.deepEqual(s,before);
});

test('live conversion uses its request venue after the streamer switches venues',()=>{
 let s=radio(setup());s=request(s,2,{kind:'live',giftConfirmed:true});const id=s.queue[0].id;
 assert.equal(s.queue[0].venue,'radio');assert.equal(s.queue[0].consumed_storage_pool,undefined);
 s=settings(s,{radio_enabled:false,current_space:'shengma'});s=op(s,id,'approve',{preparationMinutes:0});s=op(s,id,'store');
 assert.equal(credits(s,'radio'),2);assert.equal(credits(s),0);
 assert.equal(s.ledger.find(l=>l.queueId===id).storage_pool,'radio');
});

test('balances and venue settings remain isolated by streamer; time edits preserve queue and ledger origin',()=>{
 let s=deposit(radio(deposit(setup(),7)),5,'radio');
 s=run(s,'streamer',{slug:'second',display_name:'第二位'});const second=room(s,'second').currentStreamer.id;
 s=run(s,'song',{title:'第二位歌曲',artist:'歌手',creditCost:1},admin,now,second);
 assert.equal(room(s,second).settings.radio_enabled,undefined);
 s=settings(s,{radio_enabled:true,current_space:'radio'},second);s=deposit(s,4,'radio',second);s=settings(s,{radio_enabled:false,current_space:'shengma'},second);
 assert.equal(room(s,second).settings.radio_enabled,false);assert.equal(room(s,second).settings.current_space,'shengma');
 assert.equal(credits(s,'radio'),5);assert.equal(credits(s,'radio',second),4);assert.equal(credits(s,'shengma',second),0);
 assert.throws(()=>request(s,1,{},second),/存歌不足|存歌袋/);
 s=radio(s);s=request(s,2);const id=s.queue[0].id;s=complete(s,id);s=settings(s,{current_space:'shengma'});
 s=run(s,'recordTime',{table:'queue',id,times:{completedAt:past},note:'更正演唱時間'});
 const q=s.queue.find(x=>x.id===id),debit=s.ledger.find(l=>l.queueId===id&&l.amount<0);
 assert.equal(q.venue,'radio');assert.equal(q.consumed_storage_pool,'radio');assert.equal(debit.storage_pool,'radio');
 assert.equal(debit.at,past.replace('Z','.000Z'));assert.equal(credits(s,'radio'),3);assert.equal(credits(s),7);
 assert.equal(credits(s,'radio',second),4);assert.equal(usedHour(room(s),past),2);assert.equal(usedHour(room(s),now),0);
 s=run(s,'recordTime',{table:'ledger',id:debit.id,times:{at:now}});
 assert.equal(s.ledger.find(l=>l.id===debit.id).storage_pool,'radio');assert.equal(s.queue.find(x=>x.id===id).consumed_storage_pool,'radio');
 const immutable=structuredClone(s);assert.throws(()=>run(s,'ledger',{...debit,at:now,storage_pool:'shengma'}),/不能移到/);assert.deepEqual(s,immutable);
 assert.throws(()=>op(s,id,'edit',{venue:'shengma'},now,second),/找不到/);
});
