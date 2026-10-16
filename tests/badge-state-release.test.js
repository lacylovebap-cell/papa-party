import test from 'node:test';
import assert from 'node:assert/strict';
import {badgeFactsFromState,roomBadgeChanges} from '../supabase/functions/party-api/badge-state.js';
const at='2026-10-15T12:00:00Z',room='papa',spaceId='space-001';
const q=(id,extra={})=>({id,playerId:'P1',streamer_id:room,kind:'live',source:'manual',title:'歌',artist:'甲＋乙',
 at,acceptedAt:at,status:'completed',completedAt:at,achievement_tags:['傷感'],...extra});
const state=queue=>({players:[{playerId:'P1'},{playerId:'TEST',test:true}],queue,ledger:[]});
test('room normalization preserves genuine performance units, source and corrected slot; excludes test/void/duplicate rows',()=>{
 const s=state([q('a',{items:[{title:'歌',artist:'甲＋乙',performances:2}],quota_effective_at:'2026-10-15T13:00:00Z'}),
  q('test',{playerId:'TEST'}),q('void',{voided_at:at}),q('duplicate',{performance_duplicate_of:'a'}),q('other',{streamer_id:'other'})]);
 const {facts}=badgeFactsFromState(s,spaceId,room);
 assert.equal(facts.length,2);assert.notEqual(facts[0].eventKey,facts[1].eventKey);
 assert.deepEqual(facts[0].performers,['甲','乙']);assert.deepEqual(facts[0].keywords,['傷感']);
 assert.equal(facts[0].slotAt,'2026-10-15T13:00:00Z');
});
test('receipt quantity counts songs; conversions, opening balances and corrections do not become new requests',()=>{
 const s=state([q('a',{status:'stored',completedAt:null})]);
 s.ledger=[{id:'new',playerId:'P1',streamer_id:room,amount:10,receipt_quantity:10,accounting_kind:'receipt',at},
  {id:'convert',playerId:'P1',streamer_id:room,amount:1,conversion:true,at},
  {id:'opening',playerId:'P1',streamer_id:room,amount:50,openingBalance:true,at},
  {id:'debit',playerId:'P1',streamer_id:room,amount:-2,at}];
 const result=badgeFactsFromState(s,spaceId,room);
 assert.equal(result.facts.filter(f=>f.kind==='credit').length,1);
 assert.equal(result.facts.find(f=>f.kind==='credit').quantity,10);
 assert.equal(result.balance.get('P1'),59);
});
test('unchanged snapshots generate no award writes; a completed first request emits only changed candidates',()=>{
 const before=state([q('a',{status:'waiting',completedAt:null})]),after=state([q('a')]);
 assert.deepEqual(roomBadgeChanges(before,before,{spaceId,roomId:room,asOf:at}),[]);
 const changes=roomBadgeChanges(before,after,{spaceId,roomId:room,asOf:at});
 assert.ok(changes.some(r=>r.id==='P01'&&r.active));
 assert.ok(changes.some(r=>r.id==='C01'&&r.active));
 assert.ok(changes.every(r=>r.playerId==='P1'&&r.scope==='streamer'));
 assert.deepEqual(roomBadgeChanges(after,after,{spaceId,roomId:room,asOf:at}),[]);
});
test('multi-song historical union tags cannot be assigned to every separate song',()=>{
 const {facts}=badgeFactsFromState(state([q('pair',{items:[{title:'甲歌',artist:'甲'},{title:'乙歌',artist:'乙'}],achievement_tags:['傷感','甜歌']})]),spaceId,room);
 assert.deepEqual(facts.filter(f=>f.kind==='live').map(f=>f.keywords),[[],[]]);
 assert.deepEqual(facts.find(f=>f.kind==='tag_completion').keywords,['傷感','甜歌']);
});
test('voided receipt and its reversal still cancel correctly in authoritative stock balance',()=>{
 const s=state([]);s.ledger=[
  {id:'old',playerId:'P1',streamer_id:room,amount:100,accounting_kind:'receipt',voided_at:at,at},
  {id:'reversal',playerId:'P1',streamer_id:room,amount:-100,reversal_of:'old',conversion:true,at},
  {id:'replacement',playerId:'P1',streamer_id:room,amount:50,accounting_kind:'receipt',at}];
 const result=badgeFactsFromState(s,spaceId,room);
 assert.equal(result.balance.get('P1'),50);assert.equal(result.facts.length,1);
});

test('P22 live room changes accept only player-side dice and preserve the technical selfProvided marker without treating ordinary self as dice',()=>{
 const before=state([]);
 for(const source of ['draw','cross_draw','proxy_draw','streamer_draw','manual','self','cross_self']){
  const after=state([q('dice',{source,selfProvided:source!=='manual'})]);
  const changes=roomBadgeChanges(before,after,{spaceId,roomId:room,asOf:at});
  assert.equal(changes.some(r=>r.id==='P22'&&r.active),['draw','cross_draw'].includes(source),source);
 }
 const noPlayer=state([q('streamer',{source:'streamer_draw',kind:'self',playerId:null,selfProvided:true})]);
 assert.equal(roomBadgeChanges(before,noPlayer,{spaceId,roomId:room,asOf:at}).some(r=>r.id==='P22'),false);
 const waiting=state([q('player',{source:'draw',selfProvided:true,status:'waiting',completedAt:null})]);
 assert.equal(roomBadgeChanges(before,waiting,{spaceId,roomId:room,asOf:at}).some(r=>r.id==='P22'),false);
 const after=state([q('player',{source:'draw',selfProvided:true})]);
 assert.equal(roomBadgeChanges(after,after,{spaceId,roomId:room,asOf:at}).some(r=>r.id==='P22'),false);
});
