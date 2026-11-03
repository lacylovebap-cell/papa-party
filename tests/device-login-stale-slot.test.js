import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceSessions} from '../src/device-session.js';

test('a fresh password login replaces a stale credential left in the slot instead of blocking',async()=>{
 const stored=new Map([['manager',{sessionId:'old-session',refreshToken:'refresh:old',role:'streamer_admin',streamerId:'s1'}]]),calls=[];
 const transport=async b=>{calls.push(b.op);
  if(b.op==='deviceLogout')return {ok:true};
  if(b.op==='deviceStart')return {role:'streamer_admin',sessionId:'new-session',refreshToken:'refresh:new',streamerId:'s1',spaceId:'space-001'};
  if(b.op==='deviceRefresh')return {token:'device:new',refreshToken:'refresh:new2',sessionId:'new-session',role:'streamer_admin',streamerId:'s1',spaceId:'space-001',expiresIn:3600};
  throw Error('unexpected '+b.op);};
 const client=createDeviceSessions({transport,store:{get:async k=>stored.get(k),set:async(k,v)=>stored.set(k,v),remove:async k=>stored.delete(k)},lock:async(k,f)=>f(),installationId:'i1',platform:'web',appVersion:'t'});
 const token=await client.remember('streamer_admin','streamer:pw-token',{streamer:'s1'});
 assert.equal(token,'device:new');
 assert.deepEqual(calls,['deviceLogout','deviceStart','deviceRefresh'],'old credential revoked first, then the new login');
 assert.equal(stored.get('manager').sessionId,'new-session');
});
