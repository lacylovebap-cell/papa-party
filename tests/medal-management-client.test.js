import test from 'node:test';
import assert from 'node:assert/strict';
import {createMedalManagement,medalGrantHtml,medalManagementPager} from '../src/medal-management.js';
test('selected-player controls cannot offer global policy or other-player selection; historical certification keeps temporal controls',()=>{
 const row={name:'<img>',lifetime:'permanent'};
 const single=medalGrantHtml(row,{id:'P1',name:'<script>player</script>'});
 assert.doesNotMatch(single,/data-medal-list|data-achievement-code|<script>/);
 assert.match(single,/授予&lt;script&gt;player&lt;\/script&gt;此勳章/);
 assert.match(medalGrantHtml(row),/data-medal-list="candidates"/);
 assert.match(medalGrantHtml({...row,lifetime:'rolling'}),/data-medal-grant /);
 assert.match(medalGrantHtml({...row,lifetime:'24h'}),/原達成時間/);
 assert.doesNotMatch(medalGrantHtml({...row,qualified:true},{id:'P1',name:'test'}),/data-medal-grant /);
 for(const [count,page] of [[0,0],[41,2]]){const html=medalManagementPager('candidates',count,page);assert.match(html,/共 [13] 頁/);assert.match(html,/data-medal-jump="candidates"/);assert.match(html,/data-medal-jump-button/);}
});
function fakeRoot(){
 const events={},elements={'#medal-management':{innerHTML:'',textContent:''},'#dialog':{open:true},'[data-medal-management-body]':{},
 '[data-medal-grant-reason]':{value:'核對以前演唱紀錄'},'[data-medal-grant]':{disabled:false,textContent:''},
 '[data-medal-grant-status]':{textContent:''}};
 return {events,elements,querySelector:key=>elements[key]||null,addEventListener:(key,fn)=>(events[key]??=[]).push(fn)};
}
test('catalog reads are coalesced and cached; a late response cannot cross a manager or streamer change',async()=>{
 const root=fakeRoot(),calls=[];let c={active:true,spaceId:'space-001',room:'papa',actorKey:'manager',revision:1},resolve;
 const manager=createMedalManagement({root,context:()=>c,modal:()=>{},toast:()=>{},api:b=>{calls.push(b);return new Promise(r=>resolve=r);}});
 const pending=manager.load();manager.load();assert.equal(calls.length,1);
 resolve({version:1,scope:{spaceId:'space-001',streamerId:'papa'},rows:[]});await pending;await manager.load();assert.equal(calls.length,1);
 const old=manager.load(true);c={...c,room:'other',actorKey:'different'};resolve({version:1,scope:{spaceId:'space-001',streamerId:'papa'},rows:[{name:'private old room'}]});await old;
 assert.doesNotMatch(root.elements['#medal-management'].innerHTML,/private old room/);
});
test('single-player grant uses exactly the selected target and does not submit after a target switch',async()=>{
 const root=fakeRoot(),calls=[];delete root.elements['#medal-management'];let c={active:true,spaceId:'space-001',room:'papa',actorKey:'manager',revision:1,playerId:'P1'};
 const manager=createMedalManagement({root,context:()=>c,toast:()=>{},modal:()=>{},confirmGrant:()=>true,api:async b=>{calls.push(b);return{ok:true,alreadyRecorded:false};}});
 manager.openPlayer({code:'sung50',name:'50首兵郎',lifetime:'permanent'},{id:'P1',name:'Alice'});
 const target={dataset:{},matches:()=>false,hasAttribute:x=>x==='data-medal-grant',closest:()=>target};
 c={...c,playerId:'P2'};for(const fn of root.events.click)fn({target,preventDefault(){}});await Promise.resolve();assert.equal(calls.length,0);
 c={...c,playerId:'P1'};for(const fn of root.events.click)fn({target,preventDefault(){}});await new Promise(r=>setImmediate(r));
 assert.equal(calls.length,1);assert.equal(calls[0].op,'achievementManualGrant');assert.equal(calls[0].playerId,'P1');assert.equal(calls[0].playerIds,undefined);
 assert.equal(root.elements['[data-medal-grant]'].disabled,true);
});
test('inline confirmation binds the exact player, code, reason and date before any request is sent',async()=>{
 const root=fakeRoot(),calls=[];delete root.elements['#medal-management'];
 const c={active:true,spaceId:'space-001',room:'papa',actorKey:'manager',revision:1,playerId:'P1'};
 const manager=createMedalManagement({root,context:()=>c,toast:()=>{},modal:()=>{},api:async b=>{calls.push(b);return{ok:true,alreadyRecorded:false};}});
 manager.openPlayer({code:'sung50',name:'50首兵郎',lifetime:'permanent'},{id:'P1',name:'Alice'});
 const target={dataset:{},matches:()=>false,hasAttribute:x=>x==='data-medal-grant',closest:()=>target},click=async()=>{for(const fn of root.events.click)fn({target,preventDefault(){}});await new Promise(r=>setImmediate(r));};
 await click();assert.equal(calls.length,0);assert.match(root.elements['[data-medal-grant]'].textContent,/確認授予/);
 root.elements['[data-medal-grant-reason]'].value='新的核對依據';await click();assert.equal(calls.length,0);
 root.elements['[data-medal-certified-at]']={value:'2020-01-01T20:00'};await click();assert.equal(calls.length,0);
 await click();assert.equal(calls.length,1);assert.equal(calls[0].reason,'新的核對依據');assert.equal(calls[0].certificationAt,'2020-01-01T12:00:00.000Z');
 await click();assert.equal(calls.length,1);
});
