import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceSessions} from '../src/device-session.js';

function fixture(){
 const records=new Map(),tails=new Map(),sessions=new Map(),calls=[];let clock=0,serial=0,fail=null,failStore=false;
 const store={get:async key=>structuredClone(records.get(key)||null),set:async(key,value)=>{if(failStore)throw Error('storage failed');records.set(key,structuredClone(value));},remove:async key=>records.delete(key)};
 const lock=async(key,run)=>{const prev=tails.get(key)||Promise.resolve();const next=prev.catch(()=>{}).then(run);tails.set(key,next);return next;};
 const transport=async body=>{
  calls.push(body);if(fail)throw fail;
  if(body.op==='deviceStart'){
   const role=body.token,sessionId='session-'+(++serial),record={sessionId,role:role==='president'?'super_admin':role,refreshToken:'refresh:'+serial,spaceId:role==='president'?null:'space-001',streamerId:role==='streamer_admin'?'papa':null,...(role==='player'?{playerId:'P1',loginId:'ID1'}:{})};
   sessions.set(sessionId,record);return {...record,role};
  }
  const session=sessions.get(body.sessionId);
  if(!session||session.refreshToken!==body.refreshToken)throw Object.assign(Error('expired'),{authExpired:true});
  if(body.op==='deviceLogout'){sessions.delete(body.sessionId);return {ok:true};}
  session.refreshToken='refresh:'+(++serial);return {...session,token:'device:'+serial,expiresIn:3600};
 };
 const client=()=>createDeviceSessions({transport,store,lock,installationId:'installation',platform:'web',appVersion:'test',now:()=>clock});
 return {client,store,records,sessions,calls,set clock(value){clock=value;},set fail(value){fail=value;},set failStore(value){failStore=value;}};
}

test('parallel access requests coalesce, reuse unexpired access, and refresh only on demand',async()=>{
 const f=fixture(),client=f.client();await client.remember('player','player');
 const initial=f.calls.length;
 const tokens=await Promise.all(Array.from({length:20},()=>client.token('player',{spaceId:'space-001'})));
 assert.equal(new Set(tokens).size,1);assert.equal(f.calls.length,initial);
 f.clock=3600000;
 const renewed=await Promise.all(Array.from({length:20},()=>client.token('player')));
 assert.equal(new Set(renewed).size,1);assert.equal(f.calls.length,initial+1);
 assert.notEqual(renewed[0],tokens[0]);
});

test('two tabs rotate the latest stored credential without replay, retaining identity separation',async()=>{
 const f=fixture(),a=f.client(),b=f.client();await a.remember('player','player');
 await Promise.all([a.token('player'),b.token('player')]);
 await a.token('player');await b.token('player');
 assert.equal(f.records.get('player').refreshToken,[...f.sessions.values()][0].refreshToken);
 await a.remember('streamer_admin','streamer_admin');
 await assert.rejects(b.token('streamer_admin',{streamerId:'michelle'}),/不適用/);
 await assert.rejects(b.token('player',{spaceId:'space-002'}),/不適用/);
 await assert.rejects(a.remember('super_admin','president'),/先登出/);
 await a.logout('player');assert.equal(await b.token('player'),null);
 assert.ok(await b.token('streamer_admin'));
});

test('network failure preserves credentials, authentication expiry removes them',async()=>{
 const f=fixture(),a=f.client();await a.remember('player','player');a.forgetAccess();
 const saved=structuredClone(f.records.get('player'));f.fail=Error('offline');
 await assert.rejects(a.token('player'),/offline/);assert.deepEqual(f.records.get('player'),saved);
 f.fail=Object.assign(Error('expired'),{authExpired:true});
 await assert.rejects(a.token('player'),/expired/);assert.equal(f.records.has('player'),false);
});

test('storage failures revoke orphaned starts and rotated sessions',async()=>{
 const f=fixture(),a=f.client();f.failStore=true;
 await assert.rejects(a.remember('player','player'),/storage failed/);assert.equal(f.sessions.size,0);
 f.failStore=false;await a.remember('player','player');a.forgetAccess();f.failStore=true;
 await assert.rejects(a.token('player'),/storage failed/);assert.equal(f.sessions.size,0);assert.equal(f.records.size,0);
});

test('wrong server role never enters storage; corrupted credentials make no refresh request',async()=>{
 const f=fixture(),a=f.client();await assert.rejects(a.remember('player','streamer_admin'),/不一致/);
 assert.equal(f.records.size,0);assert.equal(f.sessions.size,0);
 f.records.set('player',{role:'player',refreshToken:'bad'});const count=f.calls.length;
 await assert.rejects(a.token('player'),/不完整/);assert.equal(f.calls.length,count);assert.equal(f.records.size,0);
});

test('failed logout remains retryable and president role maps to separate manager slot',async()=>{
 const f=fixture(),a=f.client();await a.remember('super_admin','president');
 assert.equal(f.records.get('manager').role,'super_admin');f.fail=Error('offline');
 await assert.rejects(a.logout('super_admin'),/offline/);assert.equal(f.records.size,1);
 f.fail=null;await a.logout('super_admin');assert.equal(f.records.size,0);assert.equal(f.sessions.size,0);
});

test('remembered player metadata is server-verified and a different business player cannot silently replace it',async()=>{
 const f=fixture(),client=f.client();await client.remember('player','player');
 assert.equal((await client.identity('player')).playerId,'P1');
 assert.equal((await client.identity('player')).loginId,'ID1');
 const remote=[...f.sessions.values()][0];remote.playerId='P-OTHER';client.forgetAccess();
 await assert.rejects(client.token('player'),/不一致/);
 assert.equal(f.records.size,0);assert.equal(f.sessions.size,0);
});
