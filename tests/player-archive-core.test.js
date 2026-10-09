import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,publicView,playerSearch,balance,reservedCredits,reservedHour,usedHour,songPlays,stats} from '../src/core.js';

const admin={role:'admin'},now='2026-10-09T12:30:00Z',past='2026-10-09T11:30:00Z';
const run=(s,type,data,who=admin,room='papa',at=now)=>mutate(s,{type,data,streamer:room},who,at);
const player=(s,index=0)=>({role:'player',playerId:s.players[index].playerId,loginId:s.players[index].ids[0]});
const room=(s,id='papa')=>scopeState(s,id);
const credit=(s,pool='shengma',id='papa')=>balance(room(s,id),player(s).playerId,pool);
const op=(s,id,operation,extra={},streamer='papa')=>run(s,'queue',{id,operation,...extra},admin,streamer);
function setup(){
 let s=run(empty(),'player',{name:'保留玩家',ids:['archive-id'],names:['舊名字'],balance:20,password:'private-password',note:'PRIVATE_NOTE'});
 s=run(s,'player',{name:'正常玩家',ids:['active-id'],balance:4});s=run(s,'settings',{hourlyLimit:20});
 for(const [title,creditCost] of [['一般歌',1],['兩首長歌',2],['半首歌',0.5]])s=run(s,'song',{title,artist:'歌手',creditCost,new:true});
 return s;
}
// The archive RPC persists this flag; Core continues receiving ordinary scoped rows.
function archive(s){const next=structuredClone(s);next.players[0].archived=true;return next;}
function request(s,index=0,kind='saved',streamer='papa'){
 return run(s,'request',{songId:room(s,streamer).songs[index].songId,kind,giftConfirmed:true},player(s),streamer);
}
function complete(s,id,streamer='papa'){
 const q=room(s,streamer).queue.find(row=>row.id===id);
 if(q.status==='pending')s=op(s,id,'approve',{preparationMinutes:0},streamer);
 else if(q.awaitingAcknowledgment)s=op(s,id,'acknowledge',{preparationMinutes:0},streamer);
 else if(q.awaitingPreparation)s=op(s,id,'stage',{preparationMinutes:0},streamer);
 return op(s,id,'complete',{},streamer);
}
function rejectsUnchanged(s,mutation,pattern=/玩家已封存/){
 const before=structuredClone(s);assert.throws(mutation,pattern);assert.deepEqual(s,before);
}

test('normal player search excludes archived IDs, names and aliases without removing source records',()=>{
 const s=archive(setup()),before=structuredClone(s),id=player(s).playerId;
 for(const q of ['',id,'保留玩家','archive-id','舊名字'])assert.equal(playerSearch(s,q).some(row=>row.playerId===id),false,q);
 for(const q of [id,'保留玩家','archive-id','舊名字'])assert.equal(playerSearch(s,q,true)[0].playerId,id,q);
 for(const flag of [false,undefined,'true',1])assert.equal(playerSearch(s,'archive-id',flag).length,0,'archive inclusion requires literal true');
 assert.deepEqual(playerSearch(s,'active-id').map(row=>row.playerId),[s.players[1].playerId]);
 assert.deepEqual(playerSearch(s,'正常玩家').map(row=>row.playerId),[s.players[1].playerId]);
 assert.equal(s.players.length,2);assert.deepEqual(s,before);
 s.players[0].archived=false;assert.equal(playerSearch(s,'archive-id')[0].playerId,id);
});

test('new player and manager-proxy requests reject archived targets atomically including completed backfills',()=>{
 const s=archive(setup()),id=player(s).playerId,songId=s.songs[0].songId;
 for(const kind of ['saved','live']){
  const data={songId,kind,giftConfirmed:true,archived:false,playerId:s.players[1].playerId};
  rejectsUnchanged(s,()=>run(s,'request',data,player(s)));
  rejectsUnchanged(s,()=>run(s,'request',data,{role:'admin',playerId:id}));
  for(const completed of [false,true])rejectsUnchanged(s,()=>run(s,'onBehalf',{...data,playerId:id,completed,effective_at:past}));
 }
 const active=run(s,'request',{songId,kind:'saved'},player(s,1));
 assert.equal(active.queue[0].playerId,s.players[1].playerId);assert.equal(credit(active),20);
});

test('archiving preserves credits, reservations, completed history and own private profile boundaries',()=>{
 let s=request(setup());s=complete(s,s.queue[0].id);s=request(s,1);s=request(s);
 const before={queue:structuredClone(s.queue),ledger:structuredClone(s.ledger),songs:structuredClone(s.songs),credit:credit(s),reserved:reservedCredits(room(s),player(s).playerId),used:usedHour(room(s),now),held:reservedHour(room(s),now)};
 s=archive(s);assert.deepEqual(s.queue,before.queue);assert.deepEqual(s.ledger,before.ledger);assert.deepEqual(s.songs,before.songs);
 assert.equal(credit(s),before.credit);assert.equal(reservedCredits(room(s),player(s).playerId),before.reserved);
 assert.equal(usedHour(room(s),now),before.used);assert.equal(reservedHour(room(s),now),before.held);
 const own=publicView(s,player(s),now),active=publicView(s,player(s,1),now),guest=publicView(s,null,now);
 assert.equal(own.players[0].archived,true);assert.equal(active.players[0].archived,false);
 assert.deepEqual(own.queue,before.queue);assert.equal(own.ledger.length,2);
 assert.equal(guest.players.length,0);assert.equal(guest.queue.length,0);assert.equal(guest.ledger.length,0);
 for(const secret of ['PRIVATE_NOTE','private-password'])assert.equal(JSON.stringify(own).includes(secret),false);
 assert.equal(own.players[0].hasPassword,true);assert.equal(songPlays(room(s),s.songs[0].songId),1);
});

test('existing saved queues may be edited, completed once and cancelled by an archived player',()=>{
 let s=request(request(setup(),1)),first=s.queue[0].id,second=s.queue[1].id;s=archive(s);
 s=op(s,first,'edit',{songId:s.songs[0].songId,note:'保留原玩家，修改既有待播'});
 assert.equal(reservedCredits(room(s),player(s).playerId),2);assert.equal(s.queue[0].playerId,player(s).playerId);
 s=complete(s,first);assert.equal(credit(s),19);assert.equal(usedHour(room(s),now),1);
 assert.equal(s.ledger.filter(row=>row.queueId===first&&row.amount<0).length,1);
 rejectsUnchanged(s,()=>complete(s,first),/先確認|已結束/);
 const ledger=structuredClone(s.ledger);s=run(s,'cancelOwn',{id:second},player(s));
 assert.equal(s.queue[1].status,'cancelled');assert.equal(reservedCredits(room(s),player(s).playerId),0);
 assert.equal(credit(s),19);assert.deepEqual(s.ledger,ledger);assert.equal(s.players[0].archived,true);
 s=run(s,'recordTime',{table:'queue',id:first,times:{completedAt:past}});
 assert.equal(s.queue[0].completedAt,new Date(past).toISOString());assert.equal(credit(s),19);
 assert.equal(s.ledger.find(row=>row.queueId===first).amount,-1);
});

test('existing live pending requests may still be approved and stored once for archived players',()=>{
 let s=archive(request(setup(),1,'live')),id=s.queue[0].id;
 s=op(s,id,'approve',{preparationMinutes:0});s=op(s,id,'store');
 assert.equal(s.queue[0].status,'stored');assert.equal(credit(s),22);
 assert.equal(s.ledger.filter(row=>row.queueId===id&&row.conversion).length,1);
 rejectsUnchanged(s,()=>op(s,id,'store'),/僅已確認/);
 assert.equal(s.players[0].archived,true);
});

test('archived targets reject all new queue allocations but keep manual ledger and stored-only allocations',()=>{
 let s=archive(setup()),id=player(s).playerId;
 for(const completed of [false,true]){
  rejectsUnchanged(s,()=>run(s,'allocate',{playerId:id,total:1,stored:0,items:[{songId:s.songs[0].songId,completed}]}));
 }
 s=run(s,'ledger',{playerId:id,amount:4,note:'仍可核對原存歌'});const receipt=s.ledger.at(-1).id;
 s=run(s,'ledger',{id:receipt,playerId:id,amount:3,at:now,note:'核對修正'});
 s=run(s,'recordTime',{table:'ledger',id:receipt,times:{at:past}});assert.equal(credit(s),23);
 s=run(s,'allocate',{playerId:id,ledgerId:receipt,total:3,stored:3,items:[],note:'只保留存歌'});
 assert.equal(credit(s),23);assert.equal(s.queue.length,0);
 s=run(s,'allocate',{playerId:id,total:2,stored:2,items:[]});assert.equal(credit(s),25);assert.equal(s.queue.length,0);
 const before=structuredClone(s);
 rejectsUnchanged(s,()=>run(s,'allocate',{playerId:id,ledgerId:receipt,total:3,stored:2,items:[{songId:s.songs[0].songId}]}));
 assert.deepEqual(s,before);
 s=run(s,'ledger',{id:receipt,playerId:id,remove:true});assert.equal(credit(s),22);
 s=run(s,'self',{name:'更新既有玩家名稱'},player(s));assert.equal(s.players[0].name,'更新既有玩家名稱');assert.equal(s.players[0].archived,true);
});

test('existing allocated queues retain edits, completion and idempotent refunds to their original pool',()=>{
 for(const terminal of ['cancel','store','complete']){
  let s=run(setup(),'settings',{radio_enabled:true,current_space:'radio'}),id=player(s).playerId;
  s=run(s,'ledger',{playerId:id,amount:5,storage_pool:'radio'});
  s=run(s,'allocate',{playerId:id,ledgerId:s.ledger.at(-1).id,total:5,stored:3,items:[{songId:s.songs[1].songId}]});
  const q=s.queue[0].id,received=stats(room(s),now).received;
  s=archive(s);s=run(s,'settings',{current_space:'shengma'});
  s=op(s,q,'edit',{songId:s.songs[0].songId,note:'封存後調整既有分配'});
  assert.equal(credit(s,'radio'),4);assert.equal(credit(s),20);
  assert.equal(s.queue[0].allocation_storage_pool,'radio');assert.equal(s.queue[0].receivedCreditCost,2);
  if(terminal==='complete')s=complete(s,q);
  else{if(terminal==='store')s=op(s,q,'stage',{preparationMinutes:0});s=op(s,q,terminal);}
  assert.equal(credit(s,'radio'),terminal==='complete'?4:5);assert.equal(credit(s),20);
  assert.equal(stats(room(s),now).received,received);
  const returns=s.ledger.filter(row=>row.queueId===q&&row.allocationSettlement==='return');
  assert.equal(returns.length,terminal==='complete'?0:1);
  if(returns.length){assert.equal(returns[0].storage_pool,'radio');assert.equal(returns[0].amount,1);}
  const history=structuredClone({queue:s.queue,ledger:s.ledger});
  s=op(s,q,'delete');s=run(s,'queueBulkDelete',{ids:[q]});assert.deepEqual({queue:s.queue,ledger:s.ledger},history);
  rejectsUnchanged(s,()=>op(s,q,terminal),/已結束|先確認|僅已確認/);
  for(const entry of s.ledger.filter(row=>row.allocationSettlement))rejectsUnchanged(s,()=>run(s,'ledger',{id:entry.id,playerId:id,remove:true}),/系統保留/);
 }
});

test('archived shared room players keep room isolation and independent scoped Space snapshots',()=>{
 let s=setup();s.streamers[0].spaceId='space-a';
 s=run(s,'streamer',{slug:'second',display_name:'第二位'});s=run(s,'settings',{hourlyLimit:20},admin,'second');
 s=run(s,'song',{title:'第二位歌曲',artist:'歌手'},admin,'second');
 s=run(s,'ledger',{playerId:player(s).playerId,amount:5},admin,'second');
 s=request(s);s=request(s,0,'saved','second');const a=room(s).queue[0].id,b=room(s,'second').queue[0].id;s=archive(s);
 for(const streamer of ['papa','second']){
  assert.equal(playerSearch(room(s,streamer),'archive-id').length,0);
  rejectsUnchanged(s,()=>request(s,0,'saved',streamer));
 }
 rejectsUnchanged(s,()=>run(s,'request',{songId:room(s).songs[0].songId,kind:'live',giftConfirmed:true},player(s,1),'second'),/找不到歌曲/);
 rejectsUnchanged(s,()=>op(s,a,'edit',{note:'跨主播'},'second'),/找不到紀錄/);
 s=complete(s,a);assert.equal(credit(s),19);assert.equal(credit(s,'shengma','second'),5);
 s=run(s,'cancelOwn',{id:b},player(s),'second');assert.equal(room(s,'second').queue[0].status,'cancelled');
 assert.equal(room(s).queue[0].status,'completed');assert.equal(reservedCredits(room(s,'second'),player(s).playerId),0);
 const firstSpace=structuredClone(s),secondSpace=structuredClone(s);secondSpace.streamers[0].spaceId='space-b';secondSpace.players[0].archived=false;
 const next=request(secondSpace);
 assert.equal(next.queue.length,secondSpace.queue.length+1);assert.equal(publicView(next,player(next),now).players[0].archived,false);
 assert.equal(publicView(s,player(s),now).players[0].archived,true);assert.deepEqual(s,firstSpace);
});
