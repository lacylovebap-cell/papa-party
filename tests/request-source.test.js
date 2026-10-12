import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSource,requestSourceLabel} from '../src/request-source.js';
import {empty,mutate,songPlays,stats,achievements,balance} from '../src/core.js';
import {applyPlayerRequestBatch,validateRequestBatch} from '../src/player-bulk-tools.js';
const now='2026-10-12T12:15:00Z',admin={role:'admin'};
const run=(s,type,data,actor=admin)=>mutate(s,{type,data,streamer:'papa'},actor,now);
function fixture(){let s=run(empty(),'player',{name:'P',balance:20});s=run(s,'song',{title:'Song',artist:'Singer'});s=run(s,'settings',{hourlyLimit:100});return s;}
test('every declared random/self source forces the common exclusion flag; explicit selection is manual',()=>{
 for(const source of ['self','draw','cross_self','cross_draw','proxy_draw'])assert.deepEqual(requestSource({source,selfProvided:false}),{source,selfProvided:true});
 assert.deepEqual(requestSource({}),{source:'manual',selfProvided:false});assert.deepEqual(requestSource({selfProvided:true}),{source:'self',selfProvided:true});
 for(const source of ['anything',{},1])assert.throws(()=>requestSource({source}),/來源/);
 assert.throws(()=>requestSource({selfProvided:'false'}),/設定/);
 assert.match(requestSourceLabel({selfProvided:true,source:'cross_draw'}),/骰子/);assert.equal(requestSourceLabel({selfProvided:false,source:'manual'}),'');
});
test('all new self/draw performances retain accounting but do not enter plays, sung totals or listening achievements',()=>{
 let s=fixture();const playerId=s.players[0].playerId,songId=s.songs[0].songId,actor={role:'player',playerId};
 for(const source of ['self','draw','cross_self','cross_draw','proxy_draw','manual']){
  s=run(s,'request',{songId,kind:'saved',source},actor);const id=s.queue.at(-1).id;
  s=run(s,'queue',{id,operation:'acknowledge',preparationMinutes:0});s=run(s,'queue',{id,operation:'complete'});
 }
 assert.equal(s.queue.filter(row=>row.selfProvided).length,5);assert.equal(s.queue.at(-1).selfProvided,false);
 assert.equal(songPlays(s,songId),1);assert.equal(stats(s,now).sung,1);assert.ok(!achievements(s,playerId,now).includes('🔁 這首是真愛'));
 assert.equal(balance(s,playerId),14);assert.equal(s.ledger.filter(row=>row.queueId).length,6,'source flags never erase or waive actual settlement');
});
test('batch provenance survives core and rejects unsupported fields before committing',()=>{
 const s=fixture(),actor={role:'player',playerId:s.players[0].playerId};
 const next=applyPlayerRequestBatch(s,[{songId:s.songs[0].songId,kind:'saved',source:'cross_draw',selfProvided:false}],actor,now,'papa');
 assert.equal(next.queue[0].source,'cross_draw');assert.equal(next.queue[0].selfProvided,true);assert.equal(s.queue.length,0);
 assert.throws(()=>validateRequestBatch([{songId:s.songs[0].songId,kind:'saved',source:'unknown'}]),/不正確/);
});
