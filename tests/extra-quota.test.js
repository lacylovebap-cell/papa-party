import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,publicView,savedQuota,canRequestSaved,balance,reservedCredits,extraQuotaRights} from '../src/core.js';
import {stateChanges} from '../src/state-patch.js';
import {authorizeManagerOperation} from '../src/access-policy.js';

const now='2026-10-09T14:30:00Z',old='2026-10-09T12:50:00.000Z',nextHour='2026-10-09T13:10:00.000Z';
const manager={role:'admin',accountId:'verified-account',streamer_id:'papa'};
const run=(s,type,data,actor=manager,t=now,streamer='papa')=>mutate(s,{type,data,streamer},actor,t);
function setup(){let s=empty();for(const name of ['A','B'])s=run(s,'player',{name,balance:10,ids:[name]});for(const cost of [1,2])s=run(s,'song',{title:'Song '+cost,artist:'Singer',creditCost:cost});return s;}
const who=(s,i=0)=>({role:'player',playerId:s.players[i].playerId});
const grant=(s,amount=2,enabled=true)=>run(s,'extraQuota',{player_id:s.players[0].playerId,extra_quota:amount,enabled});
const request=(s,cost=1,i=0,t=now)=>run(s,'request',{songId:s.songs.find(x=>x.creditCost===cost).songId,kind:'saved'},who(s,i),t);
const done=(s,id,t=now)=>run(run(s,'queue',{id,operation:'acknowledge',preparationMinutes:0},manager,t),'queue',{id,operation:'complete'},manager,t);

test('shared remainder plus configurable personal quota is isolated by player and room',()=>{
 let s=grant(request(setup(),1,1));const a=who(s),b=who(s,1),room=scopeState(s);
 assert.deepEqual(savedQuota(room,now,a.playerId),{used:0,reserved:1,commonRemaining:1,extraQuota:2,personalUsed:0,extraRemaining:2,totalRemaining:3});
 assert.equal(savedQuota(room,now,b.playerId).totalRemaining,1);
 assert.equal(publicView(s,a,now).hourlyPersonal.totalRemaining,3);assert.equal(publicView(s,b,now).hourlyPersonal.totalRemaining,1);
 s=run(s,'streamer',{slug:'second',display_name:'主播B'});assert.equal(savedQuota(scopeState(s,'second'),now,a.playerId).extraQuota,0);
 s=run(s,'extraQuota',{player_id:a.playerId,extra_quota:3,enabled:true},manager,now,'second');
 assert.equal(extraQuotaRights(s,a.playerId).length,2);assert.deepEqual(publicView(s,a,now).players[0].quotaRights.map(x=>x.extra_quota),[2,3]);
 assert.equal(publicView(s,b,now).players[0].quotaRights.length,0);
});
test('two-credit requests consume two personal units first and retain credit and cancellation rules',()=>{
 let s=grant(request(setup(),1,1));s=request(s,2);const a=who(s),id=s.queue.at(-1).id;
 assert.equal(savedQuota(scopeState(s),now,a.playerId).commonRemaining,1);assert.equal(savedQuota(scopeState(s),now,a.playerId).extraRemaining,0);
 assert.equal(reservedCredits(s,a.playerId),2);assert.equal(balance(s,a.playerId),10);
 s=run(s,'cancelOwn',{id},a);assert.equal(savedQuota(scopeState(s),now,a.playerId).totalRemaining,3);assert.equal(balance(s,a.playerId),10);
 assert.throws(()=>run(s,'cancelOwn',{id},a),/已結束/);assert.equal(s.ledger.filter(x=>x.queueId===id).length,0);
 s=request(s,2);s=done(s,s.queue.at(-1).id);assert.equal(balance(s,a.playerId),8);assert.equal(savedQuota(scopeState(s),now,a.playerId).extraRemaining,0);
 s=request(s);assert.throws(()=>request(s),/額度不足/);
});
test('extra quota never bypasses stored credits, pause, grant validation or manager room authority',()=>{
 let s=grant(setup(),3);const a=who(s);s.ledger=[];assert.throws(()=>request(s),/存歌袋空空/);
 s=grant(setup());s=run(s,'settings',{status:'暫停點歌'});assert.throws(()=>request(s),/休息/);
 for(const value of [-1,0.5,NaN,100001])assert.throws(()=>grant(setup(),value));
 assert.throws(()=>run(setup(),'extraQuota',{player_id:'unknown',extra_quota:2,enabled:true}),/找不到玩家/);
 assert.throws(()=>run(setup(),'extraQuota',{player_id:a.playerId,extra_quota:2,enabled:true},a),/登入管理/);
 assert.throws(()=>authorizeManagerOperation({role:'streamer_admin',streamer_id:'other'},{op:'mutate',action:{type:'extraQuota'}},'papa'),/只能管理/);
 assert.doesNotThrow(()=>authorizeManagerOperation({role:'streamer_admin',streamer_id:'papa'},{op:'mutate',action:{type:'extraQuota'}},'papa'));
});
test('disabling or canceling a right retains queued requests and never grants capacity to another player',()=>{
 let s=request(grant(setup()),2),id=s.queue[0].id,a=who(s);s=grant(s,2,false);
 assert.equal(savedQuota(scopeState(s),now,a.playerId).totalRemaining,0);assert.equal(extraQuotaRights(s,a.playerId).length,0);assert.equal(s.queue[0].id,id);assert.equal(balance(s,a.playerId),10);
 s=grant(s,3,true);assert.equal(savedQuota(scopeState(s),now,a.playerId).extraRemaining,1);assert.equal(savedQuota(scopeState(s),now,who(s,1).playerId).extraRemaining,0);
 s=grant(s,0,true);assert.equal(s.extraQuotas[0].enabled,false);
});
test('history correction relocates common and personal usage without changing song, player, creation time or credit amount',()=>{
 let s=grant(setup(),1);s=request(s,2,0,old);s=done(s,s.queue[0].id,'2026-10-09T12:55:00Z');
 const before=structuredClone(s),row=s.queue[0],a=who(s),amount=balance(s,a.playerId);
 assert.equal(savedQuota(scopeState(s),old,a.playerId).used,1);assert.equal(savedQuota(scopeState(s),old,a.playerId).extraRemaining,0);
 s=run(s,'recordTime',{table:'queue',id:row.id,times:{effective_at:nextHour}});
 assert.equal(savedQuota(scopeState(s),old,a.playerId).used,0);assert.equal(savedQuota(scopeState(s),old,a.playerId).extraRemaining,1);
 assert.equal(savedQuota(scopeState(s),nextHour,a.playerId).used,1);assert.equal(savedQuota(scopeState(s),nextHour,a.playerId).extraRemaining,0);
 assert.equal(s.queue[0].effective_at,nextHour);assert.equal(s.queue[0].completedAt,nextHour);assert.equal(s.queue[0].quota_effective_at,nextHour);
 for(const key of ['id','songId','title','artist','playerId','creditCost','created_at','at','status'])assert.deepEqual(s.queue[0][key],row[key],key);
 assert.equal(balance(s,a.playerId),amount);assert.equal(s.ledger.length,before.ledger.length);assert.deepEqual(s.ledger.map(x=>[x.id,x.amount]),before.ledger.map(x=>[x.id,x.amount]));
 assert.equal(s.ledger.at(-1).at,nextHour);assert.equal(s.queue[0].original_times.at,old);assert.equal(s.queue[0].time_corrected_by.account_id,'verified-account');
 const original=s.queue[0].original_times;s=run(s,'recordTime',{table:'queue',id:row.id,times:{effective_at:old}});assert.deepEqual(s.queue[0].original_times,original);
 assert.equal(savedQuota(scopeState(s),nextHour,a.playerId).used,0);assert.equal(savedQuota(scopeState(s),old,a.playerId).used,1);
 assert.throws(()=>run(s,'recordTime',{table:'queue',id:row.id,times:{effective_at:nextHour}},a),/登入管理/);
 assert.throws(()=>run(s,'recordTime',{table:'queue',id:row.id,times:{effective_at:nextHour}},manager,now,'unknown'),/主播/);
});
test('ordinary completion retains the request hour; only explicit correction overrides attribution',()=>{
 let s=grant(setup(),2);s=request(s,2,0,old);s=done(s,s.queue[0].id,nextHour);
 assert.equal(savedQuota(scopeState(s),old,who(s).playerId).extraRemaining,0);assert.equal(savedQuota(scopeState(s),nextHour,who(s).playerId).extraRemaining,2);
 assert.equal(canRequestSaved(scopeState(s),old,3,who(s).playerId),false);
 const patch=stateChanges(s,grant(s,3));assert.equal(patch.changes.length,0,'quota metadata is never persisted as a legacy entity');
});
test('editing the linked debit time after a history correction keeps display, quota and ledger time aligned',()=>{
 let s=grant(setup(),1);s=request(s,2,0,old);s=done(s,s.queue[0].id,old);const id=s.queue[0].id,a=who(s);
 s=run(s,'recordTime',{table:'queue',id,times:{effective_at:nextHour}});const original=s.queue[0].original_times,ledger=s.ledger.find(l=>l.queueId===id);
 s=run(s,'ledger',{...ledger,at:old});assert.equal(s.queue[0].effective_at,old);assert.equal(s.queue[0].quota_effective_at,old);assert.equal(savedQuota(scopeState(s),nextHour,a.playerId).personalUsed,0);assert.deepEqual(s.queue[0].original_times,original);
 s=run(s,'recordTime',{table:'ledger',id:ledger.id,times:{at:nextHour}});assert.equal(s.queue[0].quota_effective_at,nextHour);assert.equal(s.queue[0].effective_at,nextHour);assert.equal(balance(s,a.playerId),8);
});
