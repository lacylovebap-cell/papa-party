import test from 'node:test';
import assert from 'node:assert/strict';
import {createHallNavigation} from '../src/hall-navigation.js';

const hall=(spaceId='space-Q',extra={})=>({v:1,kind:'hall',spaceId,streamerId:null,name:'QQ',spaceName:'QQ',canonicalPath:'/qq',active:true,...extra});
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};

test('hall navigation is lazy, exact-scope, and reuses bounded public metadata without name guesses',async()=>{
 const calls=[];let now=0;const client=createHallNavigation({api:async body=>{calls.push(body);return hall(body.spaceId,body.spaceId==='space-001'?{name:'實際廳名',canonicalPath:'/actual'}:{});},now:()=>now});
 assert.equal(calls.length,0);assert.equal(client.peek('space-Q'),undefined);
 assert.deepEqual(await client.get('space-Q'),{spaceId:'space-Q',name:'QQ',canonicalPath:'/qq',url:'https://paparty.app/qq'});
 assert.deepEqual(calls,[{op:'publicAppHome',v:1,kind:'hall',spaceId:'space-Q',streamerId:null}]);
 assert.equal((await client.get('space-Q')).name,'QQ');assert.equal(calls.length,1);
 assert.equal((await client.get('space-001')).name,'實際廳名');assert.equal(calls.length,2);
 now=300001;await client.get('space-Q');assert.equal(calls.length,3);
});

test('missing, independent or unconfigured public halls have no guessed generic lobby link',async()=>{
 for(const row of [null,hall('independent',{canonicalPath:null,homePath:'/lobby.html'})]){
  const client=createHallNavigation({api:async()=>row});assert.equal(await client.get(row?'independent':'missing'),null);assert.equal(client.peek(row?'independent':'missing'),null);
 }
 let calls=0;const client=createHallNavigation({api:async()=>{calls++;return null;}});
 for(const bad of ['',undefined,'bad scope'])assert.equal(await client.get(bad),null);assert.equal(calls,0);
});

test('foreign, inactive or unsafe metadata cannot add a hall destination',async()=>{
 for(const row of [hall('foreign'),hall('space-Q',{kind:'streamer',streamerId:'room'}),hall('space-Q',{active:false}),hall('space-Q',{name:'\u0000fake'}),hall('space-Q',{canonicalPath:'//evil.invalid'})]){
  const client=createHallNavigation({api:async()=>row});await assert.rejects(client.get('space-Q'),/尚未確認/);assert.equal(client.peek('space-Q'),undefined);
 }
});

test('concurrent opens share one read and an invalidated response cannot populate a new session',async()=>{
 const pending=deferred();let calls=0;const client=createHallNavigation({api:async()=>{calls++;return pending.promise;}});
 const first=client.get('space-Q'),second=client.get('space-Q');await Promise.resolve();assert.equal(calls,1);
 client.invalidate();pending.resolve(hall());assert.equal(await first,null);assert.equal(await second,null);assert.equal(client.peek('space-Q'),undefined);
});
