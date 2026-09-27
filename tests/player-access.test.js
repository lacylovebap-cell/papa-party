import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,publicView,balance} from '../src/core.js';
import {prepareManagerAction,authorizeManagerOperation,coreActor,managementView} from '../src/access-policy.js';
const admin={role:'admin'},streamer={role:'streamer_admin',streamer_id:'papa'},t='2026-09-27T12:00:00Z';
function run(s,type,data,room='papa',who=admin){return mutate(s,{type,data,streamer:room},who,t);}
function fixture(){
 let s=run(empty(),'player',{name:'原玩家',ids:['shared'],names:['舊名'],certification:'已認證',balance:8,password:'protected',note:'private note',test:true});
 const p=s.players[0];
 s=run(s,'song',{title:'怕怕的歌',artist:'甲'});
 s=run(s,'request',{songId:s.songs[0].songId,kind:'saved'},'papa',{role:'player',playerId:p.playerId});
 s=run(s,'streamer',{slug:'other',display_name:'其他主播'});
 s=run(s,'song',{title:'其他主播的歌',artist:'乙'},'other');
 s=run(s,'ledger',{playerId:p.playerId,amount:6,note:'other private ledger'},'other');
 const other=scopeState(s,'other');
 return run(s,'request',{songId:other.songs[0].songId,kind:'saved'},'other',{role:'player',playerId:p.playerId});
}
function hostPlayer(s,data,who=streamer,room='papa'){
 const action={type:'player',data,streamer:room};
 authorizeManagerOperation(who,{op:'mutate',action},scopeState(s,room).currentStreamer.id);
 return mutate(s,prepareManagerAction(who,action,s),coreActor(who),t);
}
function unchangedRoomRecords(next,before){
 for(const room of ['papa','other'])for(const table of ['ledger','queue','songs','cards','crowns','wishes'])assert.deepEqual(scopeState(next,room)[table],scopeState(before,room)[table],room+' '+table);
}
test('streamer creates a shared player with zero balances in all rooms',()=>{
 const s=fixture(),before=structuredClone(s),next=hostPlayer(s,{name:'新玩家',ids:['new'],names:['別名'],certification:'已核對'}),p=next.players.at(-1);
 assert.equal(next.players.length,s.players.length+1);assert.equal(p.password,'');assert.equal(p.note,'');assert.equal(p.test,false);
 for(const room of ['papa','other']){const scoped=scopeState(next,room);assert.equal(scoped.players.at(-1).playerId,p.playerId);assert.equal(balance(scoped,p.playerId),0);}
 unchangedRoomRecords(next,s);
 assert.deepEqual(s,before);
});
test('basic profile edits are shared but preserve secrets, flags and every room record',()=>{
 const s=fixture(),p=s.players[0],next=hostPlayer(s,{playerId:p.playerId,name:'新名稱',ids:['shared','new-id'],names:['新別名'],certification:'新認證'}),changed=next.players[0];
 assert.equal(changed.name,'新名稱');assert.deepEqual(changed.ids,['shared','new-id']);assert.ok(changed.names.includes('原玩家'));assert.ok(changed.names.includes('新別名'));assert.equal(changed.certification,'新認證');
 for(const key of ['note','password','test','created_at'])assert.deepEqual(changed[key],p[key],key);
 for(const room of ['papa','other'])assert.equal(scopeState(next,room).players[0].name,'新名稱');
 unchangedRoomRecords(next,s);
 assert.equal(balance(scopeState(next,'papa'),p.playerId),8);assert.equal(balance(scopeState(next,'other'),p.playerId),6);
 const view=managementView(publicView(next,coreActor(streamer),t,'papa'),streamer);
 assert.equal(view.players[0].password,undefined);assert.equal(view.players[0].note,undefined);assert.ok(view.queue.every(q=>q.streamer_id==='papa'));
});
test('partial basic edit retains other global profile fields',()=>{
 const s=fixture(),p=s.players[0],next=hostPlayer(s,{playerId:p.playerId,name:'只改名'});
 for(const key of ['ids','certification','note','password','test'])assert.deepEqual(next.players[0][key],p[key],key);
 assert.ok(next.players[0].names.includes('舊名'));
});
test('streamer cannot inject account controls, opening balance, deletion or private data',()=>{
 const s=fixture(),p=s.players[0],before=structuredClone(s);
 for(const key of ['balance','password','currentPassword','test','note','remove','streamer_id','role','queue','ledger','created_at','__proto__']){
  for(const base of [{name:'new',ids:['new']},{playerId:p.playerId,name:'changed'}]){
   const data=Object.fromEntries([...Object.entries(base),[key,key==='balance'?99:true]]);
   assert.throws(()=>hostPlayer(s,data),/只能修改/,key);
  }
 }
 assert.deepEqual(s,before);
});
test('streamer player edit rejects unknown identity, duplicate ID and cross-room execution',()=>{
 const s=fixture();
 assert.throws(()=>hostPlayer(s,{playerId:'missing',name:'no'}),/找不到玩家/);
 assert.throws(()=>hostPlayer(s,{name:'duplicate',ids:['shared']}),/已綁定/);
 assert.throws(()=>hostPlayer(s,{name:'wrong room'},streamer,'other'),/自己的主播空間/);
 const other={role:'streamer_admin',streamer_id:scopeState(s,'other').currentStreamer.id};
 assert.equal(hostPlayer(s,{playerId:s.players[0].playerId,name:'其他主播可編輯'},other,'other').players[0].name,'其他主播可編輯');
 assert.throws(()=>hostPlayer(s,{name:'player attempt'},{role:'player',playerId:s.players[0].playerId}),/請先登入管理/);
});
test('president keeps authorized account controls without streamer sanitization',()=>{
 const s=fixture(),action={type:'player',data:{playerId:s.players[0].playerId,name:'總裁修改',password:'new-password',note:'new note',test:false}};
 assert.equal(prepareManagerAction({role:'super_admin'},action,s),action);
 const next=hostPlayer(s,action.data,{role:'super_admin'});
 assert.equal(next.players[0].password,'new-password');assert.equal(next.players[0].note,'new note');assert.equal(next.players[0].test,false);
});
