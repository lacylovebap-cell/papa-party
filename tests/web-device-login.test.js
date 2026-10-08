import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createWebDeviceLogin} from '../src/web-device-login.js';
import {storage} from './helpers/web-storage.js';

test('Web reload resumes a remembered device with metadata only in localStorage and no repeated login/start',async()=>{
 const db=storage(),local=new Map(),sessions=new Map(),calls=[];let serial=0;
 const environment={...db,crypto:webcrypto,navigator:{locks:db.locks},localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value)}};
 const transport=async body=>{
  calls.push(body);
  if(body.op==='deviceStart'){const row={role:body.token,sessionId:'s'+(++serial),refreshToken:'refresh:'+serial,spaceId:'space-001',streamerId:body.token==='streamer_admin'?'papa':null};sessions.set(row.sessionId,row);return {...row};}
  const row=sessions.get(body.sessionId);assert.equal(row.refreshToken,body.refreshToken);
  if(body.op==='deviceLogout'){sessions.delete(row.sessionId);return {ok:true};}
  row.refreshToken='refresh:'+(++serial);return {...row,token:'device:'+serial,expiresIn:3600};
 };
 const create=()=>createWebDeviceLogin({environment,transport,appVersion:'test'});
 const a=create(),identity=await a.remember({role:'player',token:'player',playerId:'P1',loginId:'id'},{streamer:'papa'});
 const metadata=a.persisted(identity);assert.equal(metadata.device,true);assert.equal(metadata.playerId,'P1');
 assert.equal('token' in metadata,false);assert.equal('refreshToken' in metadata,false);
 assert.equal(JSON.stringify([...local.values()]).includes('refresh:'),false);
 const b=create();assert.match(await b.access(metadata),/^device:/);assert.equal(calls.filter(b=>b.op==='deviceStart').length,1);
 assert.equal(calls[0].streamer,'papa');
 await b.logout(metadata);assert.equal(await a.access(metadata),null);
 assert.equal(sessions.size,0);assert.equal(local.size,1,'only the public installation UUID is stored');
});

test('unsupported Web storage never silently puts a refresh credential into localStorage',()=>{
 const env={crypto:webcrypto,navigator:{},localStorage:{setItem(){throw Error('unexpected');}}};
 assert.equal(createWebDeviceLogin({environment:env,transport:()=>{throw Error('unexpected');}}),null);
});
