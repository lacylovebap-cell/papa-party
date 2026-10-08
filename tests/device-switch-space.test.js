import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createDeviceSessions} from '../src/device-session.js';
import {createWebDeviceLogin} from '../src/web-device-login.js';
import {createWebCredentialStore} from '../src/web-credential-store.js';
import {storage} from './helpers/web-storage.js';

function fixture(){
 const db=storage(),local=new Map(),sessions=new Map(),calls=[];
 let serial=0,failOp=null,failStore=false,badSwitch=null,active=0,peak=0;
 const environment={...db,crypto:webcrypto,navigator:{locks:db.locks},localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value)}};
 const adapter=()=>createWebCredentialStore({...db,crypto:webcrypto});
 const publicRecord=record=>Object.fromEntries(Object.entries(record).filter(([key])=>key!=='accountId'));
 const transport=async body=>{
  calls.push(structuredClone(body));active++;peak=Math.max(peak,active);
  try{
   await new Promise(resolve=>setImmediate(resolve));
   if(body.op===failOp)throw Error('offline');
   if(body.op==='deviceStart'){
    const role=body.token==='president'?'super_admin':body.token;
    const row={sessionId:webcrypto.randomUUID(),refreshToken:'refresh:'+(++serial),accountId:'account-A',role,
     spaceId:role==='super_admin'?null:'space-001',streamerId:role==='streamer_admin'?'papa':null,
     ...(role==='player'?{playerId:'P1',loginId:'legacy-login'}:{})};
    sessions.set(row.sessionId,row);return publicRecord(row);
   }
   const current=sessions.get(body.sessionId);
   if(!current||current.refreshToken!==body.refreshToken)throw Object.assign(Error('expired'),{authExpired:true});
   if(body.op==='deviceLogout'){sessions.delete(body.sessionId);return {ok:true};}
   if(body.op==='deviceSwitchSpace'){
    const target=body.slug==='other'?{id:'space-002',slug:'other',name:'Other'}:
     body.slug==='papa-party'?{id:'space-001',slug:'papa-party',name:'PA Party'}:null;
    if(!target||current.role==='streamer_admin'&&(target.id!=='space-001'||body.streamer&&body.streamer!=='papa'))throw Error('membership required');
    const row={sessionId:webcrypto.randomUUID(),refreshToken:'refresh:'+(++serial),accountId:current.accountId,role:current.role,
     spaceId:current.role==='super_admin'?null:target.id,streamerId:current.role==='streamer_admin'?'papa':null,
     ...(current.role==='player'?{playerId:target.id==='space-002'?'NATIVE-P1':'P1',loginId:''}:{}),
     spaceSlug:target.slug,selectedSpace:target,selectedStreamerId:body.streamer||null,
     homeSpace:{id:'space-001',slug:'papa-party',name:'PA Party'},lastSpace:target};
    sessions.delete(current.sessionId);sessions.set(row.sessionId,row);
    if(failStore)db.abortNext=true;
    return {...publicRecord(row),...(badSwitch||{})};
   }
   current.refreshToken='refresh:'+(++serial);
   return {...publicRecord(current),token:'device:'+serial,expiresIn:3600};
  }finally{active--;}
 };
 const client=()=>createDeviceSessions({...adapter(),transport,installationId:'installation',platform:'web',appVersion:'test'});
 const web=()=>createWebDeviceLogin({environment,transport,appVersion:'test'});
 return {db,local,sessions,calls,transport,adapter,client,web,get peak(){return peak;},
  set failOp(value){failOp=value;},set failStore(value){failStore=value;},set badSwitch(value){badSwitch=value;}};
}

test('explicit switch stores the new encrypted registration before one refresh and changes only the selected player profile',async()=>{
 const f=fixture(),client=f.client();await client.remember('player','player');
 const before=await client.identity('player'),oldRecord=await f.adapter().store.get('player'),count=f.calls.length;
 const token=await client.switchSpace('player',{slug:'other',streamer:'native-room'});
 const identity=await client.identity('player');
 assert.match(token,/^device:/);assert.notEqual(identity.sessionId,before.sessionId);
 assert.equal(identity.role,'player');assert.equal(identity.spaceId,'space-002');assert.equal(identity.playerId,'NATIVE-P1');assert.equal(identity.loginId,'');
 assert.deepEqual(identity.selectedSpace,{id:'space-002',slug:'other',name:'Other'});
 assert.equal(identity.selectedStreamerId,'native-room');
 assert.deepEqual(identity.homeSpace,{id:'space-001',slug:'papa-party',name:'PA Party'});assert.equal(identity.lastSpace.id,'space-002');
 assert.deepEqual(f.calls.slice(count).map(c=>c.op),['deviceSwitchSpace','deviceRefresh']);
 assert.deepEqual(f.calls[count],{op:'deviceSwitchSpace',sessionId:oldRecord.sessionId,refreshToken:oldRecord.refreshToken,slug:'other',streamer:'native-room'});
 assert.equal(f.sessions.has(oldRecord.sessionId),false);assert.equal(f.sessions.size,1);
 assert.equal(f.sessions.values().next().value.accountId,'account-A');
 const stored=await f.adapter().store.get('player');
 assert.equal(Buffer.from(f.db.rows.get('record-player').body).includes(Buffer.from(stored.refreshToken)),false);
 assert.equal('refreshToken' in identity,false);assert.equal('token' in identity,false);assert.equal('accountId' in identity,false);
 const after=f.calls.length;assert.equal(await client.token('player',{spaceId:'space-002',playerId:'NATIVE-P1'}),token);assert.equal(f.calls.length,after);
 await assert.rejects(f.transport({op:'deviceRefresh',sessionId:oldRecord.sessionId,refreshToken:oldRecord.refreshToken}),/expired/);
 assert.equal((await f.adapter().store.get('player')).sessionId,identity.sessionId,'old refresh replay cannot restore the prior record');
});

test('switches across adapter instances serialize and old Space-bound tabs cannot adopt the new profile',async()=>{
 const f=fixture(),a=f.client(),b=f.client();await a.remember('player','player');
 const old=await a.identity('player');await b.token('player',{spaceId:old.spaceId});
 await a.switchSpace('player',{slug:'other'});
 const count=f.calls.length;await assert.rejects(b.token('player',{spaceId:old.spaceId,playerId:old.playerId}),/不適用/);
 assert.equal(f.calls.length,count,'rejected old tab does not refresh the new credential');
 await Promise.all([a.switchSpace('player',{slug:'papa-party'}),b.switchSpace('player',{slug:'other'})]);
 assert.equal(f.peak,1);assert.equal(f.sessions.size,1);
 const record=await f.adapter().store.get('player');assert.equal(record.refreshToken,f.sessions.get(record.sessionId).refreshToken);
 assert.equal(f.calls.filter(c=>c.op==='deviceSwitchSpace').length,3);
 assert.equal(f.calls.filter(c=>c.op==='deviceRefresh').length,5);
});

test('offline before switch preserves the old credential and access; failed persistence revokes the new registration and clears stale access',async()=>{
 const f=fixture(),client=f.client(),oldToken=await client.remember('player','player'),before=await f.adapter().store.get('player');
 f.failOp='deviceSwitchSpace';await assert.rejects(client.switchSpace('player',{slug:'other'}),/offline/);
 assert.deepEqual(await f.adapter().store.get('player'),before);assert.equal(await client.token('player',{spaceId:'space-001'}),oldToken);assert.equal(f.sessions.size,1);
 f.failOp=null;f.failStore=true;const count=f.calls.length;
 await assert.rejects(client.switchSpace('player',{slug:'other'}),/disk unavailable/);
 assert.equal(await f.adapter().store.get('player'),null);assert.equal(await client.token('player'),null);assert.equal(f.sessions.size,0);
 assert.deepEqual(f.calls.slice(count).map(c=>c.op),['deviceSwitchSpace','deviceLogout']);
 assert.notEqual(f.calls.at(-1).sessionId,before.sessionId,'cleanup revokes the new session rather than replaying old logout');
});

test('malformed new metadata is rejected before persistence and its new credential is revoked',async()=>{
 for(const bad of [{role:'streamer_admin'},{spaceSlug:'wrong'},{spaceId:'space-001'},{playerId:null},{selectedSpace:{id:'space-002',slug:'wrong',name:'Wrong'}}]){
  const f=fixture(),client=f.client();await client.remember('player','player');const old=await client.identity('player');f.badSwitch=bad;
  await assert.rejects(client.switchSpace('player',{slug:'other'}),/不一致/);
  assert.equal(await f.adapter().store.get('player'),null);assert.equal(await client.token('player'),null);assert.equal(f.sessions.size,0);
  assert.equal(f.calls.at(-1).op,'deviceLogout');assert.notEqual(f.calls.at(-1).sessionId,old.sessionId);
 }
});

test('normal refresh still rejects a changed player after an explicit switch',async()=>{
 const f=fixture(),client=f.client();await client.remember('player','player');await client.switchSpace('player',{slug:'other'});
 const remote=f.sessions.values().next().value;remote.playerId='OTHER-ACCOUNT-PLAYER';client.forgetAccess();
 await assert.rejects(client.token('player'),/不一致/);assert.equal(f.sessions.size,0);assert.equal(await client.identity('player'),null);
});

test('switch validation makes no request for missing credentials or invalid selectors and keeps roles separate',async()=>{
 const f=fixture(),client=f.client();await assert.rejects(client.switchSpace('player',{slug:'other'}),/登入/);assert.equal(f.calls.length,0);
 await client.remember('streamer_admin','streamer_admin');const before=await f.adapter().store.get('manager'),count=f.calls.length;
 await assert.rejects(client.switchSpace('streamer_admin',{slug:''}),/Space/);
 await assert.rejects(client.switchSpace('streamer_admin',{slug:'x'.repeat(101)}),/Space/);
 await assert.rejects(client.switchSpace('streamer_admin',{slug:'papa-party',streamer:42}),/Space/);
 assert.equal(f.calls.length,count);
 await assert.rejects(client.switchSpace('super_admin',{slug:'other'}),/不適用/);
 await assert.rejects(client.switchSpace('streamer_admin',{slug:'other'}),/membership/);assert.deepEqual(await f.adapter().store.get('manager'),before);
 await client.switchSpace('streamer_admin',{slug:'papa-party',streamer:'papa'});assert.equal((await client.identity('streamer_admin')).streamerId,'papa');
});

test('president switch preserves the global durable role while retaining the explicit public Space selection across refresh',async()=>{
 const f=fixture(),client=f.client();await client.remember('super_admin','president');await client.switchSpace('super_admin',{slug:'other',streamer:'native-room'});
 client.forgetAccess();await client.token('super_admin');const identity=await client.identity('super_admin');
 assert.equal(identity.role,'super_admin');assert.equal(identity.spaceId,null);assert.equal(identity.streamerId,null);
 assert.deepEqual(identity.selectedSpace,{id:'space-002',slug:'other',name:'Other'});assert.equal(identity.selectedStreamerId,'native-room');
 assert.equal(identity.homeSpace.id,'space-001');assert.equal(identity.lastSpace.id,'space-002');
});

test('explicit null refreshed preferences clear old home and last metadata without changing device authorization',async()=>{
 const f=fixture(),client=f.client();await client.remember('player','player');await client.switchSpace('player',{slug:'other'});
 const remote=f.sessions.values().next().value;remote.homeSpace=null;remote.lastSpace=null;client.forgetAccess();await client.token('player');
 const identity=await client.identity('player');assert.equal(identity.homeSpace,null);assert.equal(identity.lastSpace,null);
 assert.equal(identity.spaceId,'space-002');assert.equal(identity.playerId,'NATIVE-P1');assert.equal(identity.selectedSpace.id,'space-002');
});

test('president preference revalidation clears suspended navigation while null durable authorization remains fixed',async()=>{
 const f=fixture(),client=f.client();await client.remember('super_admin','president');await client.switchSpace('super_admin',{slug:'other'});
 const remote=f.sessions.values().next().value;remote.selectedSpace=null;remote.selectedStreamerId=null;remote.spaceSlug=null;
 client.forgetAccess();await client.token('super_admin');const identity=await client.identity('super_admin');
 assert.equal(identity.selectedSpace,null);assert.equal(identity.spaceSlug,null);assert.equal(identity.selectedStreamerId,null);
 assert.equal(identity.spaceId,null);assert.equal(identity.streamerId,null);
 remote.spaceId='space-002';client.forgetAccess();await assert.rejects(client.token('super_admin'),/不一致/);
 assert.equal(await client.identity('super_admin'),null);assert.equal(f.sessions.size,0);
});

test('Web explicit switch returns canonical metadata, keeps secrets encrypted, and rejects stale identities in another tab',async()=>{
 const f=fixture(),a=f.web(),b=f.web();const original=await a.remember({role:'player',token:'player',playerId:'P1'});
 const identity=await b.switchSpace(original,{slug:'other',streamer:'native-room'}),metadata=b.persisted(identity);
 assert.equal(metadata.device,true);assert.equal(metadata.spaceId,'space-002');assert.equal(metadata.playerId,'NATIVE-P1');assert.equal(metadata.loginId,'');
 assert.equal('token' in metadata,false);assert.equal('refreshToken' in metadata,false);assert.equal(JSON.stringify([...f.local.values()]).includes('refresh:'),false);
 const count=f.calls.length;await assert.rejects(a.access(original),/不適用/);await assert.rejects(a.switchSpace(original,{slug:'papa-party'}),/不適用/);assert.equal(f.calls.length,count);
 assert.match(await a.access(metadata),/^device:/);assert.equal(f.calls.filter(c=>c.op==='deviceStart').length,1);
 await assert.rejects(a.switchSpace({role:'player',token:'legacy'},{slug:'other'}),/裝置/);
});

test('Web switch does not adopt old metadata on pre-registration failure and preserves new metadata when its first refresh goes offline',async()=>{
 const f=fixture(),web=f.web(),original=await web.remember({role:'player',token:'player',playerId:'P1'});
 f.failOp='deviceSwitchSpace';await assert.rejects(web.switchSpace(original,{slug:'other'}),/offline/);
 assert.equal((await web.client.identity('player')).spaceId,'space-001');
 f.failOp='deviceRefresh';const switched=await web.switchSpace(original,{slug:'other'});
 assert.equal(switched.spaceId,'space-002');assert.equal(switched.playerId,'NATIVE-P1');assert.equal(switched.token,undefined);
 f.failOp=null;assert.match(await web.access(web.persisted(switched)),/^device:/);
});

test('Web switch storage failure surfaces the error and cannot recover a revoked registration as public metadata',async()=>{
 const f=fixture(),web=f.web(),original=await web.remember({role:'player',token:'player',playerId:'P1'});f.failStore=true;
 await assert.rejects(web.switchSpace(original,{slug:'other'}),/disk unavailable/);
 assert.equal(await web.client.identity('player'),null);assert.equal(await web.access(original),null);assert.equal(f.sessions.size,0);
});

test('a second switch between Web completion and metadata read cannot replace the first requested identity',async()=>{
 const f=fixture(),a=f.web(),b=f.web(),original=await a.remember({role:'player',token:'player',playerId:'P1'});
 const identity=a.client.identity.bind(a.client);let switched=false;
 a.client.identity=async(role,scope)=>{
  if(scope?.token&&!switched){switched=true;const current=await b.client.identity(role);await b.switchSpace({...current,device:true},{slug:'papa-party'});}
  return identity(role,scope);
 };
 await assert.rejects(a.switchSpace(original,{slug:'other'}),/不適用/);
 assert.equal((await b.client.identity('player')).spaceId,'space-001');assert.equal(f.sessions.size,1);
});
