import test from 'node:test';
import assert from 'node:assert/strict';
import {mutate,upgradePlatform,empty,scopeState,balance} from '../src/core.js';

const admin={role:'admin'},T='2026-10-31T10:00:00.000Z',later='2026-10-31T11:00:00.000Z';
function room(credits=3){
 let s=upgradePlatform(empty());
 s=mutate(s,{type:'song',streamer:'papa',data:{title:'告白氣球',artist:'怕怕',cat:'華語'}},admin,T);
 s=mutate(s,{type:'player',streamer:'papa',data:{name:'不不',ids:['bu']}},admin,T);
 const r=scopeState(s,'papa'),player=r.players[0].playerId,songId=r.songs[0].songId;
 if(credits)s=mutate(s,{type:'ledger',streamer:'papa',data:{playerId:player,amount:credits,note:'一般 '+credits+' 首'}},admin,T);
 return {s,player,songId};
}
const run=(s,data,t=later)=>mutate(s,{type:'queue',streamer:'papa',data},admin,t);
const q=(s,id)=>scopeState(s,'papa').queue.find(x=>x.id===id);
const bal=(s,p)=>balance(scopeState(s,'papa'),p,'shengma');
function sung(s,player,songId,kind){
 s=mutate(s,{type:'request',streamer:'papa',data:{songId,kind,giftConfirmed:true}},{role:'player',playerId:player},T);
 const id=scopeState(s,'papa').queue.at(-1).id;
 if(kind==='live')s=run(s,{id,operation:'approve',preparationMinutes:0},T);else s=run(s,{id,operation:'acknowledge',preparationMinutes:0},T);
 s=run(s,{id,operation:'complete'},T);return {s,id};
}
test('completed 提歌 changed to 現點 gives the stored song back, and back again takes it',()=>{
 let {s,player,songId}=room(3);({s,id:globalThis.id}=sung(s,player,songId,'saved'));const id=globalThis.id;
 assert.equal(bal(s,player),2);
 s=run(s,{id,operation:'changeKind',kind:'live'});
 assert.equal(q(s,id).kind,'live');assert.equal(q(s,id).status,'completed');assert.equal(bal(s,player),3);
 assert.equal(q(s,id).kind_corrections.at(-1).credits,1);
 s=run(s,{id,operation:'changeKind',kind:'saved'});
 assert.equal(q(s,id).kind,'saved');assert.equal(bal(s,player),2);
 const rows=scopeState(s,'papa').ledger.filter(l=>l.queueId===id);
 assert.equal(rows.filter(l=>l.accounting_kind==='consumption').length,1,'one consumption debit only');
 assert.ok(rows.filter(l=>l.accounting_kind==='kind_correction').every(l=>l.conversion&&l.excludeStats));
});
test('completed 現點 changed to 提歌 records the single consumption debit; refused without credits',()=>{
 let {s,player,songId}=room(1);let r=sung(s,player,songId,'live');s=r.s;
 assert.equal(bal(s,player),1);
 s=run(s,{id:r.id,operation:'changeKind',kind:'saved'});
 const debit=scopeState(s,'papa').ledger.find(l=>l.queueId===r.id);
 assert.equal(debit.accounting_kind,'consumption');assert.equal(debit.amount,-1);assert.equal(debit.settlement_id,debit.id);assert.equal(q(s,r.id).settlement_id,debit.id);
 assert.equal(bal(s,player),0);
 s=run(s,{id:r.id,operation:'changeKind',kind:'live'});assert.equal(bal(s,player),1);
 let empty0=room(0);r=sung(empty0.s,empty0.player,empty0.songId,'live');
 assert.throws(()=>run(r.s,{id:r.id,operation:'changeKind',kind:'saved'}),/存歌不足/);
});
test('unsung rows switch kind without touching the ledger',()=>{
 let {s,player,songId}=room(2);
 s=mutate(s,{type:'request',streamer:'papa',data:{songId,kind:'saved'}},{role:'player',playerId:player},T);const id=scopeState(s,'papa').queue.at(-1).id;
 const before=scopeState(s,'papa').ledger.length;
 s=run(s,{id,operation:'changeKind',kind:'live'});assert.equal(q(s,id).kind,'live');assert.equal(q(s,id).consumed_storage_pool,undefined);
 s=run(s,{id,operation:'changeKind',kind:'saved'});assert.equal(q(s,id).kind,'saved');assert.equal(q(s,id).status,'waiting');
 assert.equal(scopeState(s,'papa').ledger.length,before);
});
test('refuses players, same kind, cancelled rows and allocated rows',()=>{
 let {s,player,songId}=room(2);let r=sung(s,player,songId,'saved');
 assert.throws(()=>run(r.s,{id:r.id,operation:'changeKind',kind:'saved'}),/已經是提歌/);
 assert.throws(()=>mutate(r.s,{type:'queue',streamer:'papa',data:{id:r.id,operation:'changeKind',kind:'live'}},{role:'player',playerId:player},later),/請先登入管理/);
 let c=mutate(s,{type:'request',streamer:'papa',data:{songId,kind:'saved'}},{role:'player',playerId:player},T);const cid=scopeState(c,'papa').queue.at(-1).id;c=run(c,{id:cid,operation:'cancel'});
 assert.throws(()=>run(c,{id:cid,operation:'changeKind',kind:'live'}),/已取消/);
});
