import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNativePlayerBindings} from '../src/native-player-bindings.js';
import {empty,upgradePlatform,DEFAULTS,mutate,scopeState} from '../src/core.js';
import {applyRoomImport} from '../src/room-import.js';
import {stateChanges} from '../src/state-patch.js';

const spaceId='native-space',roomId='native-room',time='2026-10-09T04:00:00Z',admin={role:'admin'};
const uuid=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const eligible=(index=1,extra={})=>({accountId:uuid(index),membershipId:uuid(index+10000),spaceId,...extra});
const selection=(playerId,index=1)=>({playerId,accountId:uuid(index),membershipId:uuid(index+10000)});
const patch=(id='NEW',data={})=>({kind:'players',id,data:{playerId:id,name:'Same name',ids:[],names:[],note:'business note',...data}});
function fixture(){
 const state=upgradePlatform(empty());
 state.streamers.push({id:roomId,slug:'native',display_name:'Native',active:true,spaceId});
 state.streamerSettings[roomId]=structuredClone(DEFAULTS);
 state.players=[{playerId:'EXISTING',name:'Existing',ids:['old-login'],names:['Old alias'],privateNotes:{body:'Retain private business notes'}}];
 return state;
}
function input(extra={}){
 return {spaceId,source:scopeState(fixture(),roomId),changes:[patch()],eligible:[eligible()],selections:[selection('NEW')],...extra};
}
function rejectsUnchanged(value,pattern){const before=structuredClone(value);assert.throws(()=>buildNativePlayerBindings(value),pattern);assert.deepEqual(value,before);}

test('single add uses the actual Core-generated patch ID and preserves original source and empty credential scaffold',()=>{
 const before=fixture(),after=mutate(before,{streamer:roomId,type:'player',data:{name:'Single native player',ids:['single-login'],balance:3}},admin,time);
 const changes=stateChanges(before,after,{preserveOrder:true}).changes,added=changes.find(row=>row.kind==='players'),choice=eligible(1,{name:'Unrelated account label'});
 assert.equal(added.data.password,'');
 const args=input({source:scopeState(before,roomId),changes,eligible:[choice],selections:[selection(added.id)]}),snapshot=structuredClone(args);
 const result=buildNativePlayerBindings(args);
 assert.deepEqual(result,[{player_id:added.id,account_id:uuid(1),membership_id:uuid(10001)}]);assert.deepEqual(args,snapshot);
 assert.equal(added.data.password,'','the existing commit remains responsible for stripping only this empty scaffold');
 assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result[0]),true);
 assert.deepEqual(Object.keys(result[0]),['player_id','account_id','membership_id']);assert.equal(JSON.stringify(result).includes('single-login'),false);
});

test('existing import parsing and add/update/skip choices need exactly one binding for the actual new profile',()=>{
 const before=fixture(),after=applyRoomImport(before,'players','Existing renamed｜old-login\nImported new｜new-login\nSkipped new｜skip-login',['update','add','skip'],admin,time,roomId);
 const changes=stateChanges(before,after,{preserveOrder:true}).changes,newProfile=changes.find(row=>row.kind==='players'&&row.id!=='EXISTING');
 assert.equal(changes.filter(row=>row.kind==='players').length,2);assert.equal(after.players.length,2);
 const result=buildNativePlayerBindings(input({source:scopeState(before,roomId),changes,selections:[selection(newProfile.id)]}));
 assert.deepEqual(result,[{player_id:newProfile.id,account_id:uuid(1),membership_id:uuid(10001)}]);
 assert.equal(changes.some(row=>row.kind==='players'&&row.data.name==='Skipped new'),false);
 const updateOnly=input({changes:[patch('EXISTING',{name:'Changed',password:'',privateNotes:{body:'Still private',history:[{note:'Old administrative note'}]}})],eligible:[],selections:[]});
 const snapshot=structuredClone(updateOnly);assert.deepEqual(buildNativePlayerBindings(updateOnly),[]);assert.deepEqual(updateOnly,snapshot);
});

test('identical names never infer an account, and binding order follows patch IDs rather than chooser order',()=>{
 const args=input({changes:[patch('B'),patch('A')],eligible:[eligible(1,{name:'Same name'}),eligible(2,{name:'Same name'})],selections:[selection('A',2),selection('B',1)]});
 assert.deepEqual(buildNativePlayerBindings(args),[{player_id:'B',account_id:uuid(1),membership_id:uuid(10001)},{player_id:'A',account_id:uuid(2),membership_id:uuid(10002)}]);
 rejectsUnchanged({...args,selections:[]},/明確選擇/);
 rejectsUnchanged({...args,selections:[{name:'Same name',accountId:uuid(1),membershipId:uuid(10001)}]});
});

test('missing, unused, stale, foreign and mismatched selections fail without changing any input',()=>{
 const args=input();
 for(const selections of [[],[selection('UI-PREVIEW-ID')],[selection('EXISTING')],[selection('NEW'),selection('UNUSED',2)],[{...selection('NEW'),membershipId:uuid(10002)}]])rejectsUnchanged({...args,selections});
 const nowExisting=input();nowExisting.source.players.push({playerId:'NEW',name:'Already provisioned'});rejectsUnchanged(nowExisting);
 rejectsUnchanged(input({source:{...args.source,currentStreamer:{...args.source.currentStreamer,spaceId:'foreign-space'}}}),/目前 Space/);
 const foreignProfile=input();foreignProfile.source.players[0].spaceId='foreign-space';rejectsUnchanged(foreignProfile,/目前 Space/);
 rejectsUnchanged(input({eligible:[eligible(1,{spaceId:'foreign-space'})]}),/目前 Space/);
 rejectsUnchanged(input({eligible:[]}));
 rejectsUnchanged(input({changes:[patch('NEW',{playerId:'DIFFERENT'})]}));
 rejectsUnchanged(input({spaceId:'space-001',source:{...args.source,currentStreamer:{spaceId:'space-001'}}}),/目前 Space/);
});

test('UUIDs normalize case and duplicate player, Account or Membership identities are rejected',()=>{
 const upper=input({eligible:[eligible(171)],selections:[{playerId:'NEW',accountId:uuid(171).toUpperCase(),membershipId:uuid(10171).toUpperCase()}]});
 assert.deepEqual(buildNativePlayerBindings(upper),[{player_id:'NEW',account_id:uuid(171),membership_id:uuid(10171)}]);
 rejectsUnchanged(input({changes:[patch(),patch()]}));
 const duplicateSource=input();duplicateSource.source.players.push({...duplicateSource.source.players[0]});rejectsUnchanged(duplicateSource);
 rejectsUnchanged(input({selections:[selection('NEW'),selection('NEW')]}));
 rejectsUnchanged(input({eligible:[eligible(),{...eligible(2),accountId:uuid(1).toUpperCase()}]}));
 rejectsUnchanged(input({eligible:[eligible(),{...eligible(2),membershipId:uuid(10001).toUpperCase()}]}));
 for(const selections of [[selection('A'),selection('B')],[selection('A'),{...selection('B',2),membershipId:uuid(10001)}]]){
  rejectsUnchanged(input({changes:[patch('A'),patch('B')],eligible:[eligible(),eligible(2)],selections}));
 }
});

test('safe business IDs and canonical UUIDs reject malformed or altered mapping keys',()=>{
 for(const id of ['', ' ', ' leading','trailing ','line\nbreak','a\u0000b','a'.repeat(201),7])rejectsUnchanged(input({changes:[patch(id)],selections:[selection(id)]}));
 for(const value of ['bad-uuid','00000000000040008000000000000001',' '+uuid(1),uuid(1)+' ',null,7]){
  rejectsUnchanged(input({eligible:[eligible(1,{accountId:value})]}));
  rejectsUnchanged(input({selections:[{...selection('NEW'),membershipId:value}]}));
 }
 for(const changes of [null,{},[null],[[]],Array(1)])rejectsUnchanged(input({changes}));
 assert.deepEqual(buildNativePlayerBindings(input({changes:[patch('玩家:原始-ID')],selections:[selection('玩家:原始-ID')]}))[0].player_id,'玩家:原始-ID');
});

test('profile credentials and binding identities are rejected recursively while private business notes remain intact',()=>{
 const credentials=['password','currentPassword','token','refreshToken','accessToken','secret'];
 for(const key of credentials){
  rejectsUnchanged(input({changes:[patch('NEW',{[key]:'credential'})]}),/登入與帳號/);
  rejectsUnchanged(input({changes:[patch('NEW',{privateNotes:{history:[{[key.toUpperCase()]:'credential'}]}})]}),/登入與帳號/);
 }
 for(const key of ['accountId','account_id','membershipId','membership_id','spaceId','space_id']){
  rejectsUnchanged(input({changes:[patch('NEW',{[key]:'identity'})]}),/登入與帳號/);
  rejectsUnchanged(input({changes:[patch('NEW',{privateNotes:{[key]:'identity'}})]}),/登入與帳號/);
 }
 rejectsUnchanged(input({changes:[patch('NEW',{PASSWORD:''})]}),/登入與帳號/);
 rejectsUnchanged(input({changes:[patch('NEW',{privateNotes:{password:''}})]}),/登入與帳號/);
 const allowed=input({changes:[patch('NEW',{password:'',certification:'認證',privateNotes:{body:'Keep business details',history:[{note:'Original remark',at:time}]}})]});
 const before=structuredClone(allowed);assert.equal(buildNativePlayerBindings(allowed).length,1);assert.deepEqual(allowed,before);
 let deep={note:'nested'};for(let i=0;i<25;i++)deep={nested:deep};rejectsUnchanged(input({changes:[patch('NEW',{privateNotes:deep})]}),/層級或大小/);
 rejectsUnchanged(input({changes:[patch('NEW',{names:Array(10001).fill('name')})]}),/層級或大小/);
});

test('binding batches accept exactly 2000 entries and refuse oversized patches, choices or selections',()=>{
 const count=2000,args=input({changes:Array.from({length:count},(_,i)=>patch('P'+i)),eligible:Array.from({length:count},(_,i)=>eligible(i+1)),selections:Array.from({length:count},(_,i)=>selection('P'+i,i+1))});
 const result=buildNativePlayerBindings(args);assert.equal(result.length,2000);assert.equal(result[1999].player_id,'P1999');
 for(const field of ['changes','eligible','selections'])rejectsUnchanged({...args,[field]:[...args[field],args[field][0]]},/最多 2000/);
 const update=input({changes:[patch('P2000')],eligible:[],selections:[]});update.source.players=Array.from({length:2001},(_,i)=>({playerId:'P'+i}));
 assert.deepEqual(buildNativePlayerBindings(update),[],'the write batch bound must not reject a larger trusted source catalog');
});
