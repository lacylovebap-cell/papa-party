import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,savedQuota,balance,queueCrossedHour} from '../src/core.js';
const old='2026-10-12T12:50:00Z',next='2026-10-12T13:10:00Z',admin={role:'admin'};
const run=(s,type,data,actor=admin,t=next,room='papa')=>mutate(s,{type,data,streamer:room},actor,t);
function ready(kind='saved'){
 let s=run(empty(),'player',{name:'A',balance:10});s=run(s,'song',{title:'Song',artist:'Singer'});
 s=run(s,'request',{songId:s.songs[0].songId,kind,giftConfirmed:true},{role:'player',playerId:s.players[0].playerId},old);
 return run(s,'queue',{id:s.queue[0].id,operation:'acknowledge',preparationMinutes:0});
}
const quota=(s,t)=>savedQuota(scopeState(s),t,s.players[0].playerId);
test('explicit saved carry releases the old hour and charges the new hour with one debit',()=>{
 let s=ready(),row=structuredClone(s.queue[0]);s=run(s,'queue',{id:row.id,operation:'complete',effective_at:next,carryOver:true});
 assert.equal(quota(s,old).used,0);assert.equal(quota(s,next).used,1);assert.equal(balance(s,row.playerId),9);
 assert.equal(s.queue[0].at,row.at);assert.equal(s.queue[0].id,row.id);assert.equal(s.queue[0].quota_original_at,old);
 assert.equal(s.ledger.filter(l=>l.queueId===row.id).length,1);
 assert.throws(()=>run(s,'queue',{id:row.id,operation:'complete',carryOver:true}));assert.equal(balance(s,row.playerId),9);
});
test('declined carry and old clients retain the saved request hour across delayed completion',()=>{
 for(const carryOver of [false,undefined]){let s=ready();s=run(s,'queue',{id:s.queue[0].id,operation:'complete',effective_at:next,...(carryOver===undefined?{}:{carryOver})});assert.equal(quota(s,old).used,1);assert.equal(quota(s,next).used,0);}
});
test('live carry consumes capacity in its new hour without a second debit or changed gift fees',()=>{
 let s=ready('live'),row=structuredClone(s.queue[0]),ledger=structuredClone(s.ledger);
 s=run(s,'queue',{id:row.id,operation:'complete',effective_at:next,carryOver:true});
 assert.equal(quota(s,next).used,1);assert.equal(quota(s,old).used,0);assert.deepEqual(s.ledger,ledger);
 for(const key of ['id','songId','playerId','creditCost','price','double','at','kind'])assert.deepEqual(s.queue[0][key],row[key]);
 s=run(s,'recordTime',{table:'queue',id:row.id,times:{effective_at:old}});
 assert.equal(quota(s,next).used,0);assert.equal(quota(s,old).used,0);assert.equal(s.queue[0].quota_carried,false);assert.deepEqual(s.ledger,ledger);
 s=run(s,'recordTime',{table:'queue',id:row.id,times:{effective_at:next}});
 assert.equal(quota(s,next).used,1);assert.equal(s.queue[0].original_times.at,old);assert.deepEqual(s.ledger,ledger);
});
test('ordinary live completion remains exempt until a deliberate cross-hour correction',()=>{
 let s=ready('live');s=run(s,'queue',{id:s.queue[0].id,operation:'complete',effective_at:next});
 assert.equal(quota(s,next).used,0);assert.equal(quota(s,old).used,0);
 s=run(s,'recordTime',{table:'queue',id:s.queue[0].id,times:{effective_at:next}});assert.equal(quota(s,next).used,1);
});
test('carried requests fill common capacity before consuming personal capacity',()=>{
 let s=ready('live');s=run(s,'extraQuota',{player_id:s.players[0].playerId,extra_quota:1,enabled:true});
 s=run(s,'queue',{id:s.queue[0].id,operation:'complete',carryOver:true});
 const actor={role:'player',playerId:s.players[0].playerId};
 for(let i=0;i<2;i++)s=run(s,'request',{songId:s.songs[0].songId,kind:'saved'},actor);
 assert.equal(quota(s,next).used,1);assert.equal(quota(s,next).reserved,1);assert.equal(quota(s,next).personalUsed,1);
 assert.throws(()=>run(s,'request',{songId:s.songs[0].songId,kind:'saved'},actor),/額度不足/);
});
test('invalid carry decisions, same-hour carry and unauthorized/cross-room writes leave the source unchanged',()=>{
 const s=ready(),before=structuredClone(s),id=s.queue[0].id;
 for(const carryOver of ['yes',null,1])assert.throws(()=>run(s,'queue',{id,operation:'complete',carryOver}),/選擇是否過檔/);
 assert.throws(()=>run(s,'queue',{id,operation:'complete',effective_at:old,carryOver:true}),/跨小時/);
 assert.throws(()=>run(s,'queue',{id,operation:'complete',carryOver:true},{role:'player',playerId:s.players[0].playerId}),/登入管理/);
 assert.throws(()=>run(s,'queue',{id,operation:'complete',carryOver:true},admin,next,'foreign'),/主播/);
 assert.deepEqual(s,before);assert.equal(queueCrossedHour({at:'invalid'},next),false);
});

