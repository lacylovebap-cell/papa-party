import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePushClient} from '../src/native-push-client.js';
import {createDeviceSessions} from '../src/device-session.js';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const destination='fixture-native-token-A';
const player={sessionId:uuid(1),role:'player',spaceId:'space-one',streamerId:null,playerId:'P1'};
const manager={sessionId:uuid(2),role:'streamer_admin',spaceId:'space-one',streamerId:'room-one'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const input=(extra={})=>({expectedDeviceSessionId:player.sessionId,destination,...extra});
const noSecret=value=>assert.doesNotMatch(JSON.stringify(value),/fixture-native-token|device:|refresh:|credential|destination|private-detail/);
async function tick(){await new Promise(resolve=>setImmediate(resolve));}

function fixture({platform='android'}={}){
 const identities=new Map([['player',structuredClone(player)],['manager',structuredClone(manager)]]),calls=[],reads=[];
 const state={send:null,token:null,identity:null};
 const key=role=>role==='player'?'player':'manager';
 const sessions={
  async token(role,scope){reads.push({method:'token',role,scope});if(state.token)return state.token(role,scope);const value=identities.get(key(role));return value?.role===role?'device:fixture-'+value.sessionId:null;},
  async identity(role,scope){reads.push({method:'identity',role,scope});if(state.identity)return state.identity(role,scope);const value=identities.get(key(role));
   if(!value||value.role!==role||value.sessionId!==scope.sessionId||scope.token&&scope.token!=='device:fixture-'+value.sessionId)return null;
   return structuredClone(value);
  }
 };
 const transport=async body=>{calls.push(structuredClone(body));if(state.send)return state.send(body);return {registrationId:body.registrationId||uuid(body.expectedDeviceSessionId===manager.sessionId?12:11),permission:body.permission||'granted',enabled:body.op==='nativePushRegister'&&body.permission==='granted',changed:true};};
 const client=createNativePushClient({sessions,transport,platform});
 return {client,sessions,transport,state,identities,calls,reads};
}

test('native registration sends only the pinned server contract and projects only public result fields',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
 f.state.send=async()=>({registrationId:uuid(11),permission:'granted',enabled:true,changed:true,destination,credentials:{refresh:'refresh:private-detail'},accountId:uuid(99)});
 const result=await f.client.register('player',input({scope:{spaceId:'space-one',playerId:'P1'},accountId:uuid(99),streamer:'forged-room',transport:'desktop_os'}));
 assert.deepEqual(f.calls,[{op:'nativePushRegister',token:'device:fixture-'+player.sessionId,expectedDeviceSessionId:player.sessionId,transport:'fcm',destination,permission:'granted'}]);
 assert.deepEqual(result,{registrationId:uuid(11),permission:'granted',enabled:true,changed:true});noSecret(result);
});

test('all native permission states require a real token and updates retain the injected platform',async()=>{
 for(const platform of ['android','desktop']){
  const f=fixture({platform});
  for(const permission of ['granted','prompt','denied','unsupported']){
   const result=await f.client.register('player',input({permission}));assert.equal(result.permission,permission);assert.equal(result.enabled,permission==='granted');
  }
  await f.client.register('player',input({destination:'fixture-native-token-B'}));
  assert.equal(f.calls.length,5);assert.equal(f.calls.at(-1).destination,'fixture-native-token-B');
  assert.ok(f.calls.every(body=>body.transport===(platform==='android'?'fcm':'desktop_os')));
 }
});

test('identical in-flight operations coalesce; settled calls defer no-op decisions to the server',async()=>{
 const f=fixture(),gate=deferred();f.state.send=()=>gate.promise;
 const first=f.client.register('player',input()),duplicates=Array.from({length:15},()=>f.client.register('player',input()));
 assert.ok(duplicates.every(promise=>promise===first));await tick();assert.equal(f.calls.length,1);
 gate.resolve({registrationId:uuid(11),permission:'granted',enabled:true,changed:false});
 const result=await Promise.all([first,...duplicates]);assert.ok(result.every(value=>value.changed===false));
 await f.client.register('player',input());assert.equal(f.calls.length,2);
});

test('different token and permission updates serialize within one identity instead of racing',async()=>{
 const f=fixture(),gate=deferred();f.state.send=body=>f.calls.length===1?gate.promise:Promise.resolve({registrationId:uuid(11),permission:body.permission,enabled:body.permission==='granted',changed:true});
 const first=f.client.register('player',input()),second=f.client.register('player',input({destination:'fixture-native-token-B'})),third=f.client.register('player',input({destination:'fixture-native-token-B',permission:'denied'}));
 await tick();assert.equal(f.calls.length,1);gate.resolve({registrationId:uuid(11),permission:'granted',enabled:true,changed:true});
 await Promise.all([first,second,third]);assert.deepEqual(f.calls.map(body=>[body.destination,body.permission]),[[destination,'granted'],['fixture-native-token-B','granted'],['fixture-native-token-B','denied']]);
});

test('A to B to A token changes preserve the last desired token rather than coalescing with an older A',async()=>{
 const f=fixture(),gate=deferred();f.state.send=body=>f.calls.length===1?gate.promise:Promise.resolve({registrationId:uuid(11),permission:body.permission,enabled:true,changed:true});
 const first=f.client.register('player',input()),second=f.client.register('player',input({destination:'fixture-native-token-B'})),third=f.client.register('player',input());
 assert.notEqual(first,third);await tick();gate.resolve({registrationId:uuid(11),permission:'granted',enabled:true,changed:true});
 await Promise.all([first,second,third]);assert.deepEqual(f.calls.map(body=>body.destination),[destination,'fixture-native-token-B',destination]);
});

test('player and manager slots do not block each other; no role or token crosses the slots',async()=>{
 const f=fixture(),gate=deferred();f.state.send=body=>body.expectedDeviceSessionId===player.sessionId?gate.promise:Promise.resolve({registrationId:uuid(12),permission:'granted',enabled:true,changed:true});
 const first=f.client.register('player',input());await tick();
 const result=await f.client.register('streamer_admin',input({expectedDeviceSessionId:manager.sessionId,scope:{streamerId:'room-one'}}));
 assert.equal(result.registrationId,uuid(12));assert.equal(f.calls[1].token,'device:fixture-'+manager.sessionId);
 gate.resolve({registrationId:uuid(11),permission:'granted',enabled:true,changed:true});await first;
 f.identities.set('manager',{sessionId:uuid(3),role:'super_admin',spaceId:null,streamerId:null});
 await assert.rejects(f.client.register('streamer_admin',input({expectedDeviceSessionId:manager.sessionId})),/登入身分已變更/);
 await f.client.register('super_admin',input({expectedDeviceSessionId:uuid(3)}));assert.equal(f.calls.at(-1).expectedDeviceSessionId,uuid(3));
});

test('invalid input and missing destinations never read credentials or send fallback requests',async()=>{
 const f=fixture();
 for(const extra of [{expectedDeviceSessionId:undefined},{expectedDeviceSessionId:'bad'},...['','short','space token',destination+'\n','x'.repeat(4097),null,{}].map(value=>({destination:value})),...['denied','prompt','unsupported'].map(permission=>({permission,destination:null})),{permission:'allowed'},{scope:{sessionId:uuid(88)}},{scope:{token:'device:forged'}},{scope:{spaceId:' padded '}},{scope:[]}]){
  await assert.rejects(f.client.register('player',input(extra)),error=>{noSecret({message:error.message,code:error.code});return true;});
 }
 await assert.rejects(f.client.register('president',input()),/不完整或不正確/);
 await assert.rejects(f.client.disable('player',{expectedDeviceSessionId:player.sessionId}),/不完整或不正確/);
 assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
 for(const platform of ['web','ios','windows',null])assert.throws(()=>createNativePushClient({sessions:f.sessions,transport:f.transport,platform}),/不完整或不正確/);
});

test('forged expected session or scope is rejected before a push token can be sent',async()=>{
 for(const extra of [{expectedDeviceSessionId:uuid(99)},{scope:{spaceId:'other-space'}},{scope:{streamerId:'other-room'}},{scope:{playerId:'other-player'}}]){
  const f=fixture();await assert.rejects(f.client.register('player',input(extra)),/登入身分已變更/);assert.equal(f.calls.length,0);assert.equal(f.reads.filter(read=>read.method==='token').length,0);
 }
});

test('logout while access is refreshing prevents the old destination from being sent',async()=>{
 const f=fixture(),gate=deferred();f.state.token=()=>gate.promise;
 const task=f.client.register('player',input());await tick();f.identities.delete('player');gate.resolve('device:fixture-'+player.sessionId);
 await assert.rejects(task,/登入身分已變更/);assert.equal(f.calls.length,0);
});

test('Space switch invalidates queued old events rather than rebinding them to the replacement session',async()=>{
 const f=fixture(),gate=deferred();f.state.send=()=>gate.promise;
 const first=f.client.register('player',input()),queued=f.client.register('player',input({destination:'fixture-native-token-OLD'}));
 const oldSettled=Promise.allSettled([first,queued]);await tick();
 f.identities.set('player',{...player,sessionId:uuid(4),spaceId:'space-two',playerId:'P2'});
 f.state.send=async()=>({registrationId:uuid(14),permission:'granted',enabled:true,changed:true});
 // The host invalidates at the start of the transition, so a hung old request
 // cannot block a new session. Server guards still decide any in-flight write.
 f.client.invalidate('player');
 const result=await f.client.register('player',input({expectedDeviceSessionId:uuid(4),destination:'fixture-native-token-NEW',scope:{spaceId:'space-two',playerId:'P2'}}));
 assert.equal(result.registrationId,uuid(14));gate.resolve({registrationId:uuid(11),permission:'granted',enabled:true,changed:true});
 assert.ok((await oldSettled).every(value=>value.status==='rejected'&&value.reason.code==='NATIVE_PUSH_IDENTITY'));
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].expectedDeviceSessionId,uuid(4));assert.equal(f.calls.some(body=>body.destination==='fixture-native-token-OLD'),false);
});

test('in-flight replies are discarded after unannounced logout, same-session scope change, or explicit invalidation',async()=>{
 for(const change of [f=>f.identities.delete('player'),f=>f.identities.set('player',{...player,spaceId:'space-two'}),f=>f.client.invalidate()]){
  const f=fixture(),gate=deferred();f.state.send=()=>gate.promise;const task=f.client.register('player',input());await tick();change(f);
  gate.resolve({registrationId:uuid(11),permission:'granted',enabled:true,changed:true});await assert.rejects(task,/登入身分已變更/);
 }
});

test('disable names one exact registration and must confirm the same disabled binding',async()=>{
 const f=fixture(),result=await f.client.disable('player',{expectedDeviceSessionId:player.sessionId,registrationId:uuid(11)});
 assert.deepEqual(f.calls,[{op:'nativePushDisable',token:'device:fixture-'+player.sessionId,expectedDeviceSessionId:player.sessionId,transport:'fcm',registrationId:uuid(11)}]);assert.equal(result.enabled,false);noSecret(result);
 for(const response of [{registrationId:uuid(12),permission:'granted',enabled:false,changed:true},{registrationId:uuid(11),permission:'granted',enabled:true,changed:true}]){
  f.state.send=async()=>response;await assert.rejects(f.client.disable('player',{expectedDeviceSessionId:player.sessionId,registrationId:uuid(11)}),/尚未確認/);
 }
});

test('upstream errors and malformed replies are redacted without retries or poisoned queues',async()=>{
 const f=fixture();f.state.send=async()=>{throw Error('private-detail '+destination+' refresh:secret');};
 await assert.rejects(f.client.register('player',input()),error=>{assert.equal(error.code,'NATIVE_PUSH_FAILED');noSecret(error);return true;});
 const good={registrationId:uuid(11),permission:'granted',enabled:true,changed:true};
 for(const response of [null,[],{},'bad',{...good,registrationId:'bad'},{...good,permission:'allowed'},{...good,enabled:1},{...good,changed:1},{...good,permission:'denied'},{...good,enabled:false}]){
  f.state.send=async()=>response;await assert.rejects(f.client.register('player',input()),error=>{assert.equal(error.code,'NATIVE_PUSH_RESULT');noSecret(error);return true;});
 }
 f.state.send=async()=>good;assert.deepEqual(await f.client.register('player',input()),good);assert.equal(f.calls.length,12);
});

test('the real device-session API pins access and identity, preserves credential storage, and rejects an old login event',async()=>{
 const records=new Map(),server=new Map(),calls=[],pushCalls=[];let serial=0;
 const store={get:async key=>structuredClone(records.get(key)),set:async(key,value)=>records.set(key,structuredClone(value)),remove:async key=>records.delete(key)};
 const deviceTransport=async body=>{
  calls.push(structuredClone(body));
  if(body.op==='deviceStart'){const value={...player,sessionId:uuid(++serial),refreshToken:'refresh:'+serial};server.set(value.sessionId,value);return value;}
  const value=server.get(body.sessionId);if(!value||value.refreshToken!==body.refreshToken)throw Error('private-detail');
  if(body.op==='deviceLogout'){server.delete(body.sessionId);return {ok:true};}
  value.refreshToken='refresh:'+(++serial);return {...value,token:'device:session-'+value.sessionId,expiresIn:3600};
 };
 const sessions=createDeviceSessions({transport:deviceTransport,store,lock:async(key,run)=>run(),installationId:'fixture-installation',platform:'android',appVersion:'fixture'});
 await sessions.remember('player','legacy-player');const original=await sessions.identity('player'),stored=structuredClone([...records]);
 const client=createNativePushClient({sessions,platform:'android',transport:async body=>{pushCalls.push(body);return {registrationId:uuid(11),permission:'granted',enabled:true,changed:true};}});
 await client.register('player',input({expectedDeviceSessionId:original.sessionId}));assert.deepEqual([...records],stored);assert.equal(calls.length,2);
 client.invalidate('player');await sessions.logout('player');await sessions.remember('player','legacy-player');
 await assert.rejects(client.register('player',input({expectedDeviceSessionId:original.sessionId})),/登入身分已變更/);assert.equal(pushCalls.length,1);
 const next=await sessions.identity('player');await client.register('player',input({expectedDeviceSessionId:next.sessionId}));assert.equal(pushCalls[1].expectedDeviceSessionId,next.sessionId);
});
