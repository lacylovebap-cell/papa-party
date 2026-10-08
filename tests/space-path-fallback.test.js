import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spacePathFallback} from '../src/space-path-fallback.js';
import {requestedSpace,requiresSpaceEntry} from '../src/space-entry.js';
import {createWebSpaceEntry} from '../src/web-space-entry.js';

const mount='https://example.test/papa-party/';

test('Pages fallback retains the mounted query and hash while making Space entry explicit',()=>{
 const query='?v=10.08-UI.2&streamer=foreign&spaceId=forged&tag=a%20b&tag=c&empty=';
 for(const suffix of ['star','star/']){
  const destination=spacePathFallback(mount+suffix+query+'#admin',mount);
  assert.equal(destination,mount+query+'&space=star#admin');
  assert.equal(requestedSpace(destination,mount),'star');
  assert.equal(requiresSpaceEntry(destination,mount),true,'legacy room hints cannot bypass authenticated Space entry');
 }
 assert.equal(spacePathFallback(mount+'star#home',mount),mount+'?space=star#home');
 assert.equal(spacePathFallback('https://example.test/star?streamer=papa#admin','https://example.test/'),
  'https://example.test/?streamer=papa&space=star#admin');
});

test('an existing matching explicit Space query is preserved without reserializing it',()=>{
 const query='?space=star&v=release%20value&streamer=papa';
 assert.equal(spacePathFallback(mount+'star/'+query+'#admin',mount),mount+query+'#admin');
 assert.equal(spacePathFallback(mount+'star?space=other#admin',mount),null);
 assert.equal(spacePathFallback(mount+'star?space=../star',mount),null);
});

test('fallback leaves root, file, nested, malformed and out-of-mount missing URLs as 404',()=>{
 for(const url of [mount,mount+'index.html?space=star',mount+'v2.html',mount+'preview.html',
  mount+'404.html',mount+'src/missing.js?space=star',mount+'star/other?space=star',mount+'star//',
  mount+'STAR',mount+'star%2Fother',mount+'star.html?space=star',mount+'?space=star',
  'https://example.test/not-mounted/star?space=star','https://foreign.test/papa-party/star',
  'not a URL'])assert.equal(spacePathFallback(url,mount),null,url);
});

test('404 page uses mounted module and redirect URLs even when the missing path is nested',()=>{
 const html=fs.readFileSync(new URL('../404.html',import.meta.url),'utf8');
 const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 assert.match(source,/from '\/papa-party\/src\/space-path-fallback\.js'/);
 const run=new Function('spacePathFallback','location',source.replace(/^import .*;\s*$/m,''));
 const calls=[],location={href:mount+'star/?streamer=papa#admin',replace:url=>calls.push(url)};
 run(spacePathFallback,location);
 assert.deepEqual(calls,[mount+'?streamer=papa&space=star#admin']);
 location.href=mount+'star/other?space=star';run(spacePathFallback,location);
 assert.equal(calls.length,1);
});

test('a fallback destination supplies no permission and an unauthorized Space remains denied',async()=>{
 const destination=spacePathFallback(mount+'unknown?streamer=papa&spaceId=forged#admin',mount);
 const identity={device:true,role:'player',sessionId:'verified-session',spaceId:'own-space',streamerId:null,playerId:'P1'};
 const calls=[],deviceLogin={access:async()=>'verified-access',client:{identity:async()=>({...identity}),
  switchSpace:async()=>assert.fail('denied entry cannot switch registrations')}};
 assert.throws(()=>createWebSpaceEntry({deviceLogin,transport:async()=>{},identity:{role:'player'},url:destination,mountUrl:mount}),/登入裝置/);
 const entry=createWebSpaceEntry({deviceLogin,identity,url:destination,mountUrl:mount,transport:async body=>{
  calls.push(body);return {spaces:[],total:0,hasMore:false,membershipCount:0};
 }});
 assert.equal((await entry.resolve()).kind,'denied');
 assert.deepEqual(calls,[{op:'spaceEntry',token:'verified-access',slug:'unknown',streamer:'papa',limit:50,offset:0}]);
 await assert.rejects(entry.enter('forged'),/選擇可使用的空間/);
});
