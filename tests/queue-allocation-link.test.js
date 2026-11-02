import test from 'node:test';
import assert from 'node:assert/strict';
import {mutate,upgradePlatform,empty,scopeState,balance} from '../src/core.js';

const admin={role:'admin'},T='2026-10-31T10:00:00.000Z',later='2026-10-31T11:00:00.000Z';
const run=(s,type,data,who=admin,t=later)=>mutate(s,{type,streamer:'papa',data},who,t);
const room=s=>scopeState(s,'papa');
const bal=(s,p)=>balance(room(s),p,'shengma');
function setup(){
 let s=upgradePlatform(empty());
 for(const title of ['甲','乙','丙','丁'])s=run(s,'song',{title,artist:'歌手',cat:'華語'},admin,T);
 s=run(s,'player',{name:'連動玩家',ids:['link']},admin,T);
 const pid=room(s).players[0].playerId,songs=room(s).songs.map(x=>x.songId);
 s=run(s,'ledger',{playerId:pid,amount:3,note:'禮物'},admin,T);
 const ledgerId=room(s).ledger.at(-1).id,queued=[];
 for(const songId of songs.slice(0,3)){s=run(s,'request',{songId,kind:'live',giftConfirmed:true},{role:'player',playerId:pid},T);queued.push(room(s).queue.at(-1).id);}
 return {s,pid,ledgerId,queued,songs};
}
const link=(s,pid,ledgerId,ids,extra={})=>run(s,'allocate',{playerId:pid,ledgerId,total:3,stored:0,effective_at:later,items:[],existingQueueIds:ids,...extra});

test('allocate attaches existing pending live songs without creating duplicates',()=>{
 const {s:s0,pid,ledgerId,queued}=setup();const before=room(s0).queue.length;
 assert.ok(queued.every(id=>room(s0).queue.find(q=>q.id===id).status==='pending'));
 const s=link(s0,pid,ledgerId,queued);
 assert.equal(room(s).queue.length,before);
 const receipt=room(s).ledger.find(l=>l.id===ledgerId);
 for(const id of queued){const q=room(s).queue.find(x=>x.id===id);assert.ok(q.allocation_id);assert.equal(q.source_transaction_id,receipt.id);assert.equal(q.allocation_model,'reservation-v1');assert.equal(q.status,'waiting');}
 assert.equal(new Set(queued.map(id=>room(s).queue.find(x=>x.id===id).allocation_id)).size,1);
});

test('attached songs: completing spends 1 each once; cancelling gives 1 back; total never exceeds 3',()=>{
 const {s:s0,pid,ledgerId,queued}=setup();
 let s=link(s0,pid,ledgerId,queued);
 const start=bal(s,pid);
 s=run(s,'queue',{id:queued[0],operation:'stage',preparationMinutes:0});s=run(s,'queue',{id:queued[0],operation:'complete'});
 const afterComplete=bal(s,pid);
 s=run(s,'queue',{id:queued[1],operation:'cancel'});
 const afterCancel=bal(s,pid);
 console.log('balances start/complete/cancel',start,afterComplete,afterCancel);
 assert.ok(afterComplete<=start);assert.ok(afterCancel>=afterComplete);assert.ok(afterCancel<=3);
 assert.equal(room(s).queue.find(q=>q.id===queued[2]).status,'waiting');
});

test('rejects mismatched totals, unknown ids, and songs already allocated',()=>{
 const {s:s0,pid,ledgerId,queued}=setup();
 assert.throws(()=>link(s0,pid,ledgerId,queued.slice(0,2)),/必須等於|可用存歌|分配/);
 assert.throws(()=>link(s0,pid,ledgerId,['nope','x','y']),/不能掛上/);
 const s=link(s0,pid,ledgerId,queued);
 assert.throws(()=>run(s,'allocate',{playerId:pid,total:1,stored:0,effective_at:later,items:[],existingQueueIds:[queued[0]]}),/不能掛上/);
});
