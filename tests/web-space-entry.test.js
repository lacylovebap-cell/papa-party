import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createWebDeviceLogin} from '../src/web-device-login.js';
import {createWebCredentialStore} from '../src/web-credential-store.js';
import {createWebSpaceEntry} from '../src/web-space-entry.js';
import {storage} from './helpers/web-storage.js';

const mountUrl='https://party.test/app/';
const publicFields=['id','name','slug','streamerCount','streamerId','streamerName','streamerSlug'];
const space=(id,slug,streamer=slug)=>({id,slug,name:'Space '+slug,streamerCount:2,streamerId:streamer,streamerSlug:streamer,streamerName:'Room '+streamer});
const compact=row=>({id:row.id,slug:row.slug,name:row.name});
function fixture({home=null,last=null,selected=null}={}){
 const db=storage(),local=new Map(),sessions=new Map(),tokens=new Map(),calls=[];
 const spaces=[space('space-001','papa-party','papa'),space('space-002','other','native-room'),
  ...Array.from({length:56},(_,i)=>space('space-'+String(i+3).padStart(3,'0'),'space-'+String(i+3).padStart(3,'0'))),
  space('space-059','home-outside'),space('space-060','last-outside')];
 let serial=0,failOp=null,onEntry=null;
 const denied=new Set();
 const environment={...db,crypto:webcrypto,navigator:{locks:db.locks},localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value)}};
 const adapter=()=>createWebCredentialStore({...db,crypto:webcrypto});
 const publicRecord=record=>Object.fromEntries(Object.entries(record).filter(([key])=>key!=='accountId'));
 const preference=value=>typeof value==='number'?compact(spaces[value]):value;
 const transport=async body=>{
  calls.push(structuredClone(body));
  await new Promise(resolve=>setImmediate(resolve));
  if(body.op===failOp)throw Error('offline');
  if(body.op==='deviceStart'){
   const role=body.token==='president'?'super_admin':body.token;
   const row={sessionId:webcrypto.randomUUID(),refreshToken:'refresh:'+(++serial),accountId:'private-account-A',role,
    spaceId:role==='super_admin'?null:spaces[0].id,streamerId:role==='streamer_admin'?'papa':null,
    ...(role==='player'?{playerId:'P1',loginId:'legacy-login'}:{}),homeSpace:preference(home),lastSpace:preference(last),
    selectedSpace:preference(selected),selectedStreamerId:null};
   sessions.set(row.sessionId,row);return publicRecord(row);
  }
  if(body.op==='spaceEntry'){
   const current=sessions.get(tokens.get(body.token));
   if(!current)throw Object.assign(Error('expired'),{authExpired:true});
   const allowed=spaces.filter(row=>!denied.has(row.slug)&&(current.role!=='streamer_admin'||row.id===current.spaceId&&row.streamerId===current.streamerId));
   const filtered=body.slug?allowed.filter(row=>row.slug===body.slug):allowed;
   const offset=body.offset||0,rows=filtered.slice(offset,offset+body.limit);
   const result={spaces:rows.map(row=>({...row,...(current.role==='streamer_admin'?{streamerCount:1}:{}),
    accountId:'private-account-A',token:'device:private-row',refreshToken:'refresh:private-row',internal:'private-room'})),
    total:filtered.length,membershipCount:body.slug&&!filtered.length?0:allowed.length,hasMore:offset+rows.length<filtered.length};
   if(onEntry){const run=onEntry;onEntry=null;await run(body,result);}
   return result;
  }
  const current=sessions.get(body.sessionId);
  if(!current||current.refreshToken!==body.refreshToken)throw Object.assign(Error('expired'),{authExpired:true});
  if(body.op==='deviceLogout'){sessions.delete(current.sessionId);return {ok:true};}
  if(body.op==='deviceSwitchSpace'){
   const target=spaces.find(row=>row.slug===body.slug&&!denied.has(row.slug));
   if(!target||current.role==='streamer_admin'&&(target.id!==spaces[0].id||body.streamer&&body.streamer!=='papa'))throw Error('membership required');
   const row={sessionId:webcrypto.randomUUID(),refreshToken:'refresh:'+(++serial),accountId:current.accountId,role:current.role,
    spaceId:current.role==='super_admin'?null:target.id,streamerId:current.role==='streamer_admin'?'papa':null,
    ...(current.role==='player'?{playerId:target.id===spaces[0].id?'P1':'NATIVE-P1',loginId:''}:{}),
    spaceSlug:target.slug,selectedSpace:compact(target),selectedStreamerId:body.streamer||null,
    homeSpace:current.homeSpace,lastSpace:compact(target)};
   sessions.delete(current.sessionId);sessions.set(row.sessionId,row);return publicRecord(row);
  }
  assert.equal(body.op,'deviceRefresh');
  current.refreshToken='refresh:'+(++serial);
  const token='device:'+(++serial);tokens.set(token,current.sessionId);
  return {...publicRecord(current),token,expiresIn:3600};
 };
 const web=()=>createWebDeviceLogin({environment,transport,appVersion:'test'});
 const login=async(role='player',extra={})=>{
  const deviceLogin=web(),identity=await deviceLogin.remember({role,token:role==='super_admin'?'president':role,
   ...(role==='player'?{playerId:'P1'}:{}),...extra});
  return {deviceLogin,identity};
 };
 const entry=({deviceLogin,identity},url=mountUrl)=>createWebSpaceEntry({deviceLogin,transport,identity,url,mountUrl});
 return {spaces,sessions,tokens,calls,denied,db,local,transport,adapter,web,login,entry,
  get entries(){return calls.filter(call=>call.op==='spaceEntry');},set failOp(value){failOp=value;},set onEntry(value){onEntry=value;}};
}
function assertPublic(result){
 assert.equal('token' in result.identity,false);assert.equal('refreshToken' in result.identity,false);
 assert.equal('accountId' in result.identity,false);assert.equal('privateNonce' in result.identity,false);
 for(const row of result.space?[result.space]:result.spaces||[])assert.deepEqual(Object.keys(row).sort(),publicFields);
 assert.equal(/private-account|private-room|private-row|caller-secret/.test(JSON.stringify(result)),false);
}

test('explicit Space URL makes one bounded authenticated request and returns only canonical public metadata',async()=>{
 const f=fixture({home:58,last:59}),login=await f.login('player',{privateNonce:'caller-secret',name:'caller-name'});
 const scopes=[],identity=login.deviceLogin.client.identity.bind(login.deviceLogin.client);
 login.deviceLogin.client.identity=async(role,scope)=>{scopes.push({role,scope:structuredClone(scope)});return identity(role,scope);};
 const result=await f.entry(login,mountUrl+'?space=other&streamer=native-room').resolve();
 assert.equal(result.kind,'destination');assert.deepEqual(result.space,f.spaces[1]);assertPublic(result);
 assert.equal(result.membershipCount,60);
 assert.deepEqual(f.entries,[{op:'spaceEntry',token:login.identity.token,slug:'other',streamer:'native-room',limit:50,offset:0}]);
 assert.equal(result.identity.role,'player');assert.equal(result.identity.playerId,'P1');assert.equal(result.identity.sessionId,login.identity.sessionId);
 assert.equal(scopes.filter(call=>call.role==='player'&&call.scope?.sessionId===login.identity.sessionId&&call.scope?.token===login.identity.token).length>=2,true,
  'canonical identity is credential-bound both before and after the entry request');
});

test('root entry probes canonical Home directly even when it is outside the first permitted page',async()=>{
 const f=fixture({home:58,last:59}),login=await f.login(),result=await f.entry(login).resolve();
 assert.equal(result.kind,'destination');assert.deepEqual(result.space,f.spaces[58]);assertPublic(result);
 assert.equal(result.membershipCount,60);
 assert.deepEqual(f.entries.map(call=>({slug:call.slug,limit:call.limit,offset:call.offset})),[{slug:'home-outside',limit:50,offset:0}]);
});

test('revoked Home tries a distinct canonical Last, with at most two direct preference requests',async()=>{
 const f=fixture({home:58,last:59});f.denied.add('home-outside');
 const result=await f.entry(await f.login()).resolve();
 assert.equal(result.kind,'destination');assert.deepEqual(result.space,f.spaces[59]);
 assert.deepEqual(f.entries.map(call=>call.slug),['home-outside','last-outside']);
});

test('preference requires the same authorized id and slug; unavailable preferences fall back to the first bounded page',async()=>{
 const f=fixture({home:{id:'forged-id',slug:'home-outside',name:'Forged'},last:59});f.denied.add('last-outside');
 const result=await f.entry(await f.login()).resolve();
 assert.equal(result.kind,'choice');assert.equal(result.spaces.length,50);assert.equal(result.total,59);assert.equal(result.hasMore,true);assertPublic(result);
 assert.equal(result.membershipCount,59);
 assert.deepEqual(f.entries.map(call=>call.slug),['home-outside','last-outside',undefined]);
 assert.equal(f.entries.every(call=>call.limit===50&&call.offset===0),true);
});

test('duplicate Home and Last do not repeat the same direct probe; no preference page chooses the first of many',async()=>{
 const f=fixture({home:58,last:58});f.denied.add('home-outside');
 const result=await f.entry(await f.login()).resolve();
 assert.equal(result.kind,'choice');assert.equal(result.spaces.length,50);assert.equal(result.total,59);
 assert.deepEqual(f.entries.map(call=>call.slug),['home-outside',undefined]);
});

test('pagination goes directly to the requested page and retains choices even when Home appears there',async()=>{
 const f=fixture({home:58,last:59}),result=await f.entry(await f.login()).resolve({offset:50});
 assert.equal(result.kind,'choice');assert.equal(result.spaces.length,10);assert.equal(result.total,60);assert.equal(result.hasMore,false);
 assert.equal(result.membershipCount,60);
 assert.deepEqual(result.spaces,f.spaces.slice(50));assertPublic(result);
 assert.equal(f.entries.length,1);assert.deepEqual({limit:f.entries[0].limit,offset:f.entries[0].offset,slug:f.entries[0].slug},{limit:50,offset:50,slug:undefined});
});

test('list mode ignores an explicit URL destination and preferences so users can browse the permitted page',async()=>{
 const f=fixture({home:58,last:59}),entry=f.entry(await f.login(),mountUrl+'?space=other&streamer=native-room');
 const result=await entry.resolve({list:true});
 assert.equal(result.kind,'choice');assert.deepEqual(result.spaces,f.spaces.slice(0,50));assert.equal(result.total,60);assert.equal(result.membershipCount,60);assert.equal(result.hasMore,true);assertPublic(result);
 assert.equal(f.entries.length,1);assert.deepEqual({slug:f.entries[0].slug,streamer:f.entries[0].streamer,limit:f.entries[0].limit,offset:f.entries[0].offset},
  {slug:undefined,streamer:'native-room',limit:50,offset:0});
});

test('streamer manager forwarding returns its assigned own room despite a foreign room hint and denies an unauthorized Space',async()=>{
 const f=fixture(),login=await f.login('streamer_admin');
 const foreignHintEntry=f.entry(login,mountUrl+'?space=papa-party&streamer=another-room#admin'),own=await foreignHintEntry.resolve();
 assert.equal(own.kind,'destination');assert.equal(f.entries[0].streamer,'another-room');
 assert.equal(own.membershipCount,1);assert.equal(own.identity.streamerSlug,'papa');assert.equal(own.space.streamerCount,1);
 assert.equal(own.space.streamerId,'papa');assert.equal(own.space.streamerSlug,'papa');assertPublic(own);
 const ownEntered=await foreignHintEntry.enter(own.space);assert.equal(new URL(ownEntered.url).searchParams.get('streamer'),'papa');
 assert.equal(ownEntered.identity.streamerSlug,'papa');assert.equal(ownEntered.identity.streamerId,'papa');
 const other=await f.entry(login,mountUrl+'?space=other#admin').resolve();assert.equal(other.kind,'denied');assert.equal(other.membershipCount,0);
 const entry=f.entry(login,mountUrl+'?space=papa-party&streamer=papa&player=old&adminTab=ledger#admin'),allowed=await entry.resolve();
 assert.equal(allowed.identity.streamerSlug,'papa');assert.equal(allowed.membershipCount,1);assert.equal(allowed.space.streamerCount,1);
 assert.equal(allowed.kind,'destination');const entered=await entry.enter(allowed.space);
 assert.equal(entered.identity.role,'streamer_admin');assert.equal(entered.identity.streamerId,'papa');
 assert.equal(entered.identity.streamerSlug,'papa');
 const url=new URL(entered.url);assert.equal(url.hash,'#admin');assert.equal(url.searchParams.get('streamer'),'papa');
 assert.equal(url.searchParams.has('player'),false);assert.equal(url.searchParams.has('adminTab'),false);
 assert.equal(f.calls.filter(call=>call.op==='deviceSwitchSpace').length,0,'same authorized Space navigation does not rotate registration');
 assertPublic(entered);
});

test('player entry switches to the canonical target profile and clears stale room actions before home navigation',async()=>{
 const f=fixture(),login=await f.login(),entry=f.entry(login,mountUrl+'?space=other&streamer=native-room&commonRequest=old&commonKind=legacy&player=P9&adminTab=queue&tab=ledger#admin');
 const result=await entry.resolve(),entered=await entry.enter(result.space);
 assert.equal(entered.identity.role,'player');assert.equal(entered.identity.spaceId,'space-002');assert.equal(entered.identity.playerId,'NATIVE-P1');assert.equal(entered.identity.loginId,'');
 assert.notEqual(entered.identity.sessionId,login.identity.sessionId);assertPublic(entered);
 const url=new URL(entered.url);assert.equal(url.origin,'https://party.test');assert.equal(url.pathname,'/app/');assert.equal(url.hash,'#home');
 assert.equal(url.searchParams.get('space'),'other');assert.equal(url.searchParams.get('spaceId'),'space-002');assert.equal(url.searchParams.get('streamer'),'native-room');
 for(const key of ['commonRequest','commonKind','player','adminTab','tab'])assert.equal(url.searchParams.has(key),false);
 assert.deepEqual(f.calls.filter(call=>['deviceSwitchSpace','deviceRefresh'].includes(call.op)).slice(-2).map(call=>call.op),['deviceSwitchSpace','deviceRefresh']);
 const stored=await f.adapter().store.get('player');assert.equal(stored.sessionId,entered.identity.sessionId);
 assert.equal(Buffer.from(f.db.rows.get('record-player').body).includes(Buffer.from(stored.refreshToken)),false);
 assert.equal(JSON.stringify([...f.local.values()]).includes('refresh:'),false);
});

test('president choice keeps global durable authority while changing the public selected Space',async()=>{
 const f=fixture(),login=await f.login('super_admin'),entry=f.entry(login,mountUrl+'?space=other#admin');
 const result=await entry.resolve(),entered=await entry.enter(result.space);
 assert.equal(entered.identity.role,'super_admin');assert.equal(entered.identity.spaceId,null);assert.equal(entered.identity.streamerId,null);
 assert.deepEqual(entered.identity.selectedSpace,compact(f.spaces[1]));assert.equal(new URL(entered.url).hash,'#admin');assertPublic(entered);
 login.deviceLogin.client.forgetAccess();await login.deviceLogin.access(entered.identity);
 const recovered=await login.deviceLogin.client.identity('super_admin');assert.equal(recovered.spaceId,null);assert.deepEqual(recovered.selectedSpace,compact(f.spaces[1]));
});

test('matching president public selection and matching player authorization navigate without rotating a session',async()=>{
 for(const role of ['player','super_admin']){
  const f=fixture({selected:0}),login=await f.login(role),entry=f.entry(login,mountUrl+'?space=papa-party#admin');
  const result=await entry.resolve(),count=f.calls.length,entered=await entry.enter(result.space);
  assert.equal(entered.identity.sessionId,login.identity.sessionId);assert.equal(f.calls.slice(count).some(call=>call.op==='deviceSwitchSpace'||call.op==='deviceRefresh'),false);
  assert.equal(new URL(entered.url).hash,role==='player'?'#home':'#admin');assertPublic(entered);
 }
});

test('enter rereads the canonical president selection so metadata refreshed after resolve does not trigger a redundant switch',async()=>{
 const f=fixture({selected:0}),login=await f.login('super_admin'),entry=f.entry(login,mountUrl+'?space=other#admin'),result=await entry.resolve();
 const adapter=f.adapter(),record=await adapter.store.get('manager');
 await adapter.store.set('manager',{...record,selectedSpace:compact(f.spaces[1]),spaceSlug:'other',selectedStreamerId:'native-room'});
 const count=f.calls.length,entered=await entry.enter(result.space);
 assert.equal(entered.identity.sessionId,login.identity.sessionId);assert.deepEqual(entered.identity.selectedSpace,compact(f.spaces[1]));
 assert.equal(f.calls.slice(count).some(call=>call.op==='deviceSwitchSpace'),false);assert.equal(new URL(entered.url).searchParams.get('space'),'other');
});

test('foreign URLs and fabricated or altered destinations cannot make a switching request',async()=>{
 const f=fixture(),login=await f.login();
 await assert.rejects(async()=>f.entry(login,'https://foreign.test/app/?space=other').resolve());assert.equal(f.entries.length,0);
 const entry=f.entry(login),result=await entry.resolve(),count=f.calls.length;
 await assert.rejects(entry.enter(f.spaces[59]));
 await assert.rejects(entry.enter({...result.spaces[0],slug:'other',streamerId:'native-room',streamerSlug:'native-room'}));
 await assert.rejects(entry.enter('space-060'));
 assert.equal(f.calls.slice(count).some(call=>call.op==='deviceSwitchSpace'),false);
 const entered=await entry.enter(result.spaces[0].id);assert.equal(entered.identity.spaceId,'space-001');
 assert.equal(new URL(entered.url).searchParams.get('streamer'),'papa');
});

test('another tab switching during entry resolution cannot replace the caller identity or authorize its stale result',async()=>{
 const f=fixture(),login=await f.login(),other=f.web(),entry=f.entry(login,mountUrl+'?space=other');
 f.onEntry=async()=>{await other.switchSpace(login.identity,{slug:'other',streamer:'native-room'});};
 await assert.rejects(entry.resolve());
 assert.equal((await other.client.identity('player')).spaceId,'space-002');
 assert.equal(f.calls.some(call=>call.op==='deviceLogout'),false,'a stale tab cannot revoke the valid new registration');
});

test('another tab switching after resolution is rejected before enter and never adopted',async()=>{
 const f=fixture(),login=await f.login(),entry=f.entry(login,mountUrl+'?space=other'),result=await entry.resolve(),other=f.web();
 const switched=await other.switchSpace(login.identity,{slug:'other',streamer:'native-room'}),count=f.calls.length;
 await assert.rejects(entry.enter(result.space));assert.equal(f.calls.length,count);
 assert.equal((await other.client.identity('player')).sessionId,switched.sessionId);assert.equal(f.calls.some(call=>call.op==='deviceLogout'),false);
});

test('a second tab switch between registration and the new-token identity read cannot replace the requested result',async()=>{
 const f=fixture(),login=await f.login(),entry=f.entry(login,mountUrl+'?space=other'),result=await entry.resolve(),other=f.web();
 const identity=login.deviceLogin.client.identity.bind(login.deviceLogin.client);let raced=false;
 login.deviceLogin.client.identity=async(role,scope)=>{
  if(scope?.token&&scope.token!==login.identity.token&&!raced){
   raced=true;const current=await other.client.identity(role);await other.switchSpace({...current,device:true},{slug:'papa-party',streamer:'papa'});
  }
  return identity(role,scope);
 };
 await assert.rejects(entry.enter(result.space));assert.equal(raced,true);
 assert.equal((await other.client.identity('player')).spaceId,'space-001');assert.equal(f.sessions.size,1);
 assert.equal(f.calls.some(call=>call.op==='deviceLogout'),false);
});

test('entry network errors preserve credential recovery and do not automatically log out',async()=>{
 const f=fixture(),login=await f.login(),entry=f.entry(login,mountUrl+'?space=other'),before=await f.adapter().store.get('player');
 f.failOp='spaceEntry';await assert.rejects(entry.resolve(),/offline/);assert.deepEqual(await f.adapter().store.get('player'),before);
 assert.equal(f.calls.some(call=>call.op==='deviceLogout'),false);f.failOp=null;
 assert.equal((await entry.resolve()).kind,'destination');assert.match(await login.deviceLogin.access(login.identity),/^device:/);
 login.deviceLogin.client.forgetAccess();f.failOp='deviceRefresh';await assert.rejects(entry.resolve(),/offline/);
 assert.deepEqual(await f.adapter().store.get('player'),before);assert.equal(f.calls.some(call=>call.op==='deviceLogout'),false);
 f.failOp=null;assert.match(await login.deviceLogin.access(login.identity),/^device:/);
});

test('offline refresh after a persisted switch rejects navigation while preserving the new credential for recovery',async()=>{
 const f=fixture(),login=await f.login(),entry=f.entry(login,mountUrl+'?space=other'),result=await entry.resolve();
 f.failOp='deviceRefresh';await assert.rejects(entry.enter(result.space),/offline/);
 const current=await login.deviceLogin.client.identity('player');assert.equal(current.spaceId,'space-002');assert.notEqual(current.sessionId,login.identity.sessionId);
 assert.equal(f.sessions.size,1);assert.equal(f.calls.some(call=>call.op==='deviceLogout'),false);
 f.failOp=null;assert.match(await login.deviceLogin.access({...current,device:true}),/^device:/);
 assert.equal((await login.deviceLogin.client.identity('player')).playerId,'NATIVE-P1');
});

test('a switch with no returned access token cannot produce a successful destination from persisted metadata',async()=>{
 const f=fixture(),login=await f.login(),entry=f.entry(login,mountUrl+'?space=other'),result=await entry.resolve();
 const switchSpace=login.deviceLogin.client.switchSpace.bind(login.deviceLogin.client);
 login.deviceLogin.client.switchSpace=async(...args)=>{await switchSpace(...args);return undefined;};
 await assert.rejects(entry.enter(result.space));
 const current=await login.deviceLogin.client.identity('player');assert.equal(current.spaceId,'space-002');assert.equal(f.sessions.size,1);
 assert.match(await login.deviceLogin.access({...current,device:true}),/^device:/);assert.equal(f.calls.some(call=>call.op==='deviceLogout'),false);
});
