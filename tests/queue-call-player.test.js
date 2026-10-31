import test from 'node:test';
import assert from 'node:assert/strict';
import {mutate,upgradePlatform,empty,scopeState} from '../src/core.js';
import {deriveNotices,queueNoticeCurrent} from '../src/notification-rules.js';

const admin={role:'admin'},T='2026-10-31T13:00:00.000Z';
function room(prep=0){
 let s=upgradePlatform(empty());
 s=mutate(s,{type:'song',streamer:'papa',data:{title:'告白氣球',artist:'怕怕',cat:'華語'}},admin,T);
 s=mutate(s,{type:'player',streamer:'papa',data:{name:'不不',ids:['bu']}},admin,T);
 const r=scopeState(s,'papa');
 s=mutate(s,{type:'request',streamer:'papa',data:{songId:r.songs[0].songId,kind:'live',giftConfirmed:true}},{role:'player',playerId:r.players[0].playerId},T);
 return {s,id:s.queue.at(-1).id,player:r.players[0].playerId,room:r.currentStreamer.id};
}
const call=(s,id,t)=>mutate(s,{type:'queue',streamer:'papa',data:{id,operation:'call'}},admin,t);
test('呼叫玩家 notifies the requesting player once per tap with the streamer name',()=>{
 let {s,id,player,room:roomId}=room();
 assert.throws(()=>call(s,id,T),/還不能呼叫/);
 s=mutate(s,{type:'queue',streamer:'papa',data:{id,operation:'approve',preparationMinutes:0}},admin,T);
 const before=s,after=call(s,id,'2026-10-31T13:01:00.000Z');
 const notices=deriveNotices(scopeState(before,'papa'),scopeState(after,'papa'),{streamer_id:roomId,role:'admin',action:'queue'},'2026-10-31T13:01:00.100Z');
 assert.equal(notices.length,1);assert.equal(notices[0].recipient,player);assert.equal(notices[0].type,'ready');
 assert.match(notices[0].body,/｜📣 呼叫中！《告白氣球》要開唱囉，速速回來～$/);
 assert.throws(()=>call(after,id,'2026-10-31T13:01:10.000Z'),/30 秒/);
 const again=call(after,id,'2026-10-31T13:01:40.000Z');assert.equal(scopeState(again,'papa').queue[0].callCount,2);
 const q=scopeState(after,'papa').queue[0];
 assert.equal(queueNoticeCurrent({...notices[0],space_id:'space-001'},{space_id:'space-001',data:q}),true);
});
test('a call during a preparation countdown is still delivered by delayed push retries',()=>{
 let {s,id,player}=room();
 s=mutate(s,{type:'queue',streamer:'papa',data:{id,operation:'approve',preparationMinutes:10}},admin,T);
 s=call(s,id,'2026-10-31T13:02:00.000Z');const q=scopeState(s,'papa').queue[0];
 assert.equal(q.readyAt,null);
 const notice={type:'ready',entity_id:id,space_id:'space-001',streamer_id:q.streamer_id,recipient:player,created_at:'2026-10-31T13:02:00.050Z'};
 assert.equal(queueNoticeCurrent(notice,{space_id:'space-001',data:q}),true);
 assert.equal(queueNoticeCurrent({...notice,created_at:'2026-10-31T12:50:00.000Z'},{space_id:'space-001',data:q}),false);
});
