import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,balance,scopeState,publicView,usedHour,reservedHour,reservedCredits,canRequestSaved} from '../src/core.js';

const admin={role:'admin'},now='2026-09-27T12:30:00Z',past='2026-09-27T11:59:00Z',later='2026-09-27T13:00:00Z';
const run=(s,type,data,actor=admin,t=now,streamer='papa')=>mutate(s,{type,data,streamer},actor,t);
const player=s=>({role:'player',playerId:s.players[0].playerId});
function setup(){let s=run(empty(),'player',{name:'額度玩家',ids:['quota'],balance:20});for(const [title,cost] of [['長歌',2],['一般歌',1],['半首甲',0.5],['半首乙',0.5]])s=run(s,'song',{title,artist:'歌手',creditCost:cost});return s;}
const request=(s,index=0,extra={},t=now)=>run(s,'request',{songId:s.songs[index].songId,kind:'saved',...extra},player(s),t);
const complete=(s,id=s.queue[0].id,t=now)=>{if(s.queue.find(q=>q.id===id).awaitingAcknowledgment)s=run(s,'queue',{id,operation:'acknowledge',preparationMinutes:0},admin,t);return run(s,'queue',{id,operation:'complete'},admin,t);};
const quota=(s,t=now)=>[usedHour(s,t),reservedHour(s,t)];

test('two-credit request reserves two slots and becomes two used slots without a second charge',()=>{
 let s=request(setup()),id=s.queue[0].id,p=player(s);
 assert.deepEqual(quota(s),[0,2]);assert.equal(reservedCredits(s,p.playerId),2);assert.equal(balance(s,p.playerId),20);
 const visible=publicView(s,p,now);assert.equal(visible.hourlyUsed,0);assert.equal(visible.hourlyReserved,2);
 assert.throws(()=>request(s,1),/額度不足/);
 s=complete(s,id);assert.deepEqual(quota(s),[2,0]);assert.equal(balance(s,p.playerId),18);
 assert.equal(s.ledger.filter(l=>l.queueId===id).length,1);
 assert.throws(()=>complete(s,id));assert.throws(()=>run(s,'cancelOwn',{id},p));
 assert.deepEqual(quota(s),[2,0]);assert.equal(s.ledger.filter(l=>l.queueId===id).length,1);
});

test('one remaining slot rejects two-credit request atomically before reserving or debiting',()=>{
 let s=request(setup(),1),before=structuredClone(s);
 assert.equal(canRequestSaved(s,now,2),false);assert.equal(canRequestSaved(s,now,1),true);
 assert.throws(()=>request(s,0),/額度不足/);assert.deepEqual(s,before);
 s=complete(s);before=structuredClone(s);
 assert.throws(()=>request(s,0),/額度不足/);assert.deepEqual(s,before);
 s=request(s,1);assert.deepEqual(quota(s),[1,1]);
});

test('player and manager cancellation release the full two-credit reservation while retaining history',()=>{
 for(const own of [true,false]){
  let s=request(setup()),id=s.queue[0].id,ledger=structuredClone(s.ledger);
  s=own?run(s,'cancelOwn',{id},player(s)):run(s,'queue',{id,operation:'cancel'});
  assert.deepEqual(quota(s),[0,0]);assert.equal(reservedCredits(s,player(s).playerId),0);
  assert.equal(s.queue[0].status,'cancelled');assert.equal(s.queue[0].creditCost,2);assert.deepEqual(s.ledger,ledger);
  s=request(s);assert.equal(s.queue.length,2);assert.deepEqual(quota(s),[0,2]);
 }
});

test('half song repeat and paired half songs each consume one hourly slot',()=>{
 let s=setup(),a=s.songs[2],b=s.songs[3];
 s=run(s,'song',{...a,shortMode:'both',pairSongIds:[b.songId]});
 s=request(s,2);assert.equal(s.queue[0].items[0].performances,2);assert.equal(s.queue[0].creditCost,1);
 s=request(s,2,{pairSongId:b.songId});assert.equal(s.queue[1].items.length,2);assert.equal(s.queue[1].creditCost,1);
 assert.deepEqual(quota(s),[0,2]);s=complete(s,s.queue[0].id);s=complete(s,s.queue[1].id);
 assert.deepEqual(quota(s),[2,0]);assert.equal(balance(s,player(s).playerId),18);
});

test('historical requests use snapshotted credit cost and missing legacy cost defaults to one',()=>{
 let s=request(setup()),id=s.queue[0].id;
 s=run(s,'song',{...s.songs[0],creditCost:1});assert.deepEqual(quota(s),[0,2]);
 s=complete(s,id);assert.deepEqual(quota(s),[2,0]);assert.equal(balance(s,player(s).playerId),18);
 s.queue.push({id:'legacy',kind:'saved',status:'waiting',at:now,playerId:player(s).playerId,streamer_id:'papa'});
 assert.deepEqual(quota(s),[2,1]);assert.equal(s.queue[0].creditCost,2);
});

test('live requests never consume saved quota across approval, completion or conversion',()=>{
 let s=request(setup());
 s=request(s,0,{kind:'live',giftConfirmed:true});let live=s.queue.at(-1).id;assert.deepEqual(quota(s),[0,2]);
 s=run(s,'queue',{id:live,operation:'approve',preparationMinutes:0});s=complete(s,live);assert.deepEqual(quota(s),[0,2]);
 s=request(s,0,{kind:'live',giftConfirmed:true});live=s.queue.at(-1).id;
 s=run(s,'queue',{id:live,operation:'approve',preparationMinutes:0});s=run(s,'queue',{id:live,operation:'store'});
 assert.deepEqual(quota(s),[0,2]);assert.equal(balance(s,player(s).playerId),22);
});

test('completion across an hour boundary keeps two credits in the request hour',()=>{
 let s=request(setup(),0,{},past);assert.deepEqual(quota(s,past),[0,2]);assert.deepEqual(quota(s,now),[0,0]);
 s=complete(s,s.queue[0].id,now);assert.deepEqual(quota(s,past),[2,0]);assert.deepEqual(quota(s,now),[0,0]);
 s=request(s,0,{},now);assert.deepEqual(quota(s,now),[0,2]);assert.deepEqual(quota(s,later),[0,0]);
});

test('backfill and explicit history corrections preserve created time and move quota',()=>{
 let s=setup();s=run(s,'onBehalf',{playerId:player(s).playerId,songId:s.songs[0].songId,kind:'saved',at:past,completed:true});
 const id=s.queue[0].id,created=s.queue[0].created_at;
 assert.deepEqual(quota(s,past),[2,0]);assert.deepEqual(quota(s,now),[0,0]);
 s=run(s,'recordTime',{table:'queue',id,times:{completedAt:now}});
 assert.deepEqual(quota(s,past),[0,0]);assert.deepEqual(quota(s,now),[2,0]);
 s=run(s,'recordTime',{table:'queue',id,times:{at:now}});
 assert.deepEqual(quota(s,past),[0,0]);assert.deepEqual(quota(s,now),[2,0]);assert.equal(s.queue[0].created_at,created);
 assert.equal(balance(s,player(s).playerId),18);assert.equal(s.ledger.filter(l=>l.queueId===id).length,1);
});

test('shared players have independent streamer quotas and stored balances',()=>{
 let s=request(setup()),p=player(s);s=run(s,'streamer',{slug:'second',display_name:'第二位'});
 s=run(s,'song',{title:'第二首長歌',artist:'歌手',creditCost:2},admin,now,'second');
 s=run(s,'ledger',{playerId:p.playerId,amount:5},admin,now,'second');
 let room=scopeState(s,'second');assert.equal(canRequestSaved(room,now,2),true);assert.deepEqual(quota(room),[0,0]);
 s=run(s,'request',{songId:room.songs[0].songId,kind:'saved'},p,now,'second');
 assert.deepEqual(quota(scopeState(s,'papa')),[0,2]);assert.deepEqual(quota(scopeState(s,'second')),[0,2]);
 assert.equal(publicView(s,p,now,'papa').hourlyReserved,2);assert.equal(publicView(s,p,now,'second').hourlyReserved,2);
});

test('manager override and test/self-provided requests retain existing quota semantics',()=>{
 let s=setup();s=run(s,'player',{...s.players[0],test:true});s=request(s,0,{selfProvided:true});
 assert.deepEqual(quota(s),[0,2]);assert.throws(()=>request(s),/額度不足/);
 s=run(s,'onBehalf',{playerId:player(s).playerId,songId:s.songs[0].songId,kind:'saved'});
 assert.deepEqual(quota(s),[0,4]);s=complete(s,s.queue[0].id);assert.deepEqual(quota(s),[2,2]);
 assert.equal(canRequestSaved(s,now,1),false);
});
