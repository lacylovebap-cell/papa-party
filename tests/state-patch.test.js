import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,balance,usedHour,scopeState,TABLES} from '../src/core.js';
import {stateChanges,scopedOperationalAction} from '../src/state-patch.js';

test('room patches preserve sparse ordering, read-only song fields and other room data through queue completion/cancel',()=>{
 const now='2026-10-08T04:00:00Z';let full=empty();full.players=[{playerId:'P1',name:'Player',ids:[],names:[]}];
 full=mutate(full,{type:'song',data:{title:'Song',artist:'Artist',lyrics:'do not write the stripped lyric',creditCost:2}},{role:'admin'},now);
 full=mutate(full,{type:'ledger',data:{playerId:'P1',amount:10}},{role:'admin'},now);
 const id=full.songs[0].songId;
 full=mutate(full,{type:'request',data:{songId:id,kind:'saved'}},{role:'player',playerId:'P1'},now);
 full=mutate(full,{type:'queue',data:{id:full.queue[0].id,operation:'acknowledge',preparationMinutes:0}},{role:'admin'},now);
 full.queue[0]._order=73;full.ledger[0]._order=95;full.songs[0]._order=510;
 full=mutate(full,{type:'streamer',data:{slug:'michelle',display_name:'米雪'}},{role:'admin'},now);
 const other=full.streamers.find(r=>r.slug==='michelle').id;
 full.queue.push({id:'other-queue',streamer_id:other,status:'waiting',kind:'saved',creditCost:2,playerId:'P1',at:now,_order:120});
 full.ledger.push({id:'other-credit',streamer_id:other,playerId:'P1',amount:100,at:now});
 const lean=structuredClone(full);for(const kind of TABLES.filter(kind=>kind!=='players'))lean[kind]=lean[kind].filter(row=>row.streamer_id==='papa');delete lean.songs[0].lyrics;
 const after=mutate(lean,{type:'queue',data:{id:lean.queue[0].id,operation:'complete'}},{role:'admin'},now);
 const patch=stateChanges(lean,after,{preserveOrder:true});
 assert.ok(patch.changes.every(r=>['ledger','queue'].includes(r.kind)));
 assert.equal(patch.changes.find(r=>r.kind==='queue').data._order,73);
 assert.equal(balance(scopeState(after,'papa'),'P1'),8);assert.equal(usedHour(scopeState(after,'papa'),now),2);
 assert.equal(patch.removed.length,0);assert.equal(JSON.stringify(patch).includes('do not write the stripped lyric'),false);
 const complete=mutate(full,{type:'queue',data:{id:lean.queue[0].id,operation:'complete'}},{role:'admin'},now);
 assert.deepEqual(complete.queue.find(q=>q.id==='other-queue'),full.queue.find(q=>q.id==='other-queue'));
 assert.equal(balance(scopeState(complete,'papa'),'P1'),balance(scopeState(after,'papa'),'P1'));
});

test('reorder changes only moved rows; deletion leaves sparse ordering stable; appends use a new slot',()=>{
 const before=empty();before.queue=[{id:'a',_order:10},{id:'b',_order:30},{id:'c',_order:50}];
 let after=structuredClone(before);after.queue=[after.queue[2],after.queue[1],after.queue[0]];
 const moved=stateChanges(before,after,{preserveOrder:true});
 assert.deepEqual(moved.changes.map(r=>[r.id,r.data._order]),[['c',10],['a',50]]);
 after=structuredClone(before);after.queue.splice(1,1);after.queue.push({id:'d'});
 const changed=stateChanges(before,after,{preserveOrder:true});
 assert.deepEqual(changed.removed,[{kind:'queue',id:'b'}]);assert.deepEqual(changed.changes.map(r=>[r.id,r.data._order]),[['d',51]]);
});

test('the lean operational path never handles song/private/profile/settings writes',()=>{
 for(const type of ['song','songsBulk','self','player','settings','tag','streamer'])assert.equal(scopedOperationalAction({type}),false);
 assert.equal(scopedOperationalAction({type:'recordTime',data:{table:'queue'}}),true);
 assert.equal(scopedOperationalAction({type:'recordTime',data:{table:'players'}}),false);
 assert.equal(scopedOperationalAction({type:'queue'}),true);
 assert.equal(scopedOperationalAction({type:'wishAdmin',data:{status:'已學會',addSong:true}}),false);
 assert.equal(scopedOperationalAction({type:'wishAdmin',data:{status:'已學會',addSong:false}}),true);
});
