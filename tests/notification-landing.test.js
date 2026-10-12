import test from 'node:test';import assert from 'node:assert/strict';
import {noticeTargetMatchesRoom,planNotificationLanding} from '../src/notification-landing.js';
const target={spaceId:'space-001',streamerId:'room1',streamerSlug:'papa',entityId:'q15'};
const context={kind:'queue',playerId:'player1',roomId:'room1',currentPool:'shengma',ledgerPool:row=>row.pool||'shengma'};
const queues=()=>Array.from({length:26},(_,index)=>({id:'q'+index,playerId:'player1',streamer_id:'room1',status:index<5?'waiting':'completed',at:new Date(2026,0,index+1).toISOString()}));

test('wish notices select the authorized wish page and never expose another owner or room',()=>{
 const wishes=Array.from({length:25},(_,index)=>({id:'w'+index,streamer_id:'room1',playerId:'player1'})),before=structuredClone(wishes);
 const plan=planNotificationLanding({...target,entityId:'w21'},{...context,kind:'wish',wishes});assert.equal(plan.found,true);assert.equal(plan.page,3);assert.equal(plan.pageKey,'wishes');
 assert.equal(planNotificationLanding({...target,entityId:'w21'},{...context,kind:'wish',wishes,playerId:'other'}).found,false);
 assert.equal(planNotificationLanding({...target,entityId:'w21'},{...context,kind:'wish',wishes,roomId:'room2',management:true}).found,false);
 assert.equal(planNotificationLanding({...target,entityId:'w21'},{...context,kind:'wish',wishes,management:true}).found,true);assert.deepEqual(wishes,before);
});
test('notification room hints cannot move the landing plan across a Space or streamer',()=>{
 const room={spaceId:'space-001',roomId:'room1',streamerSlug:'papa'};assert.equal(noticeTargetMatchesRoom(target,room),true);
 for(const change of [{spaceId:'space2'},{streamerId:'room2'},{streamerSlug:'other'}])assert.equal(noticeTargetMatchesRoom({...target,...change},room),false);
});
test('queue target chooses the actual current or sorted history page without altering rows',()=>{
 const rows=queues(),before=structuredClone(rows);
 assert.deepEqual(planNotificationLanding(target,{...context,queue:rows}),{kind:'queue',found:true,id:'q15',history:true,pageKey:'queue-history',page:2});
 assert.equal(planNotificationLanding(target,{...context,queue:rows,historyOrder:'oldest'}).page,2);
 assert.deepEqual(planNotificationLanding({...target,entityId:'q1'},{...context,queue:rows}),{kind:'queue',found:true,id:'q1',history:false,pageKey:'queue',page:1});
 assert.deepEqual(rows,before);
});

test('current notice lands on the page matching the player sort and preserves the manager manual order',()=>{
 const rows=Array.from({length:25},(_,index)=>({id:'c'+index,playerId:'player1',streamer_id:'room1',status:'waiting',at:new Date(2026,0,index+1).toISOString()}));
 const notice={...target,entityId:'c0'},before=structuredClone(rows);
 assert.equal(planNotificationLanding(notice,{...context,queue:rows}).page,3);
 assert.equal(planNotificationLanding(notice,{...context,queue:rows,currentOrder:'oldest'}).page,1);
 assert.equal(planNotificationLanding(notice,{...context,queue:rows,management:true,currentOrder:'newest'}).page,1);
 assert.deepEqual(rows,before);
});
test('player target cannot locate another player or room and missing rows use a finite first page',()=>{
 const rows=queues();rows[15].playerId='other';assert.equal(planNotificationLanding(target,{...context,queue:rows}).found,false);
 rows[15].playerId='player1';rows[15].streamer_id='room2';assert.equal(planNotificationLanding(target,{...context,queue:rows,management:true}).found,false);
 assert.equal(planNotificationLanding(target,{...context,queue:rows,playerId:null}).found,false);
 assert.deepEqual(planNotificationLanding(target,{...context,queue:[]}),{kind:'queue',found:false,history:true,pageKey:'queue-history',page:1});
});
test('credit target follows visible pool paging and opens an exact read-only detail for another pool',()=>{
 const ledger=queues().map((row,index)=>({...row,pool:index===15?'radio':'shengma'}));
 const plan=planNotificationLanding(target,{...context,kind:'credit',ledger});assert.equal(plan.found,true);assert.equal(plan.detail,true);assert.equal(plan.row.id,'q15');
 assert.equal(planNotificationLanding({...target,entityId:'q1'},{...context,kind:'credit',ledger}).page,3);
 ledger[15].playerId='other';assert.equal(planNotificationLanding(target,{...context,kind:'credit',ledger}).found,false);
});
