import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {streamerAdminDestination} from '../src/streamer-admin-navigation.js';
import {pageLocation} from '../src/streamer-navigation.js';
const mountUrl='https://paparty.app/';
test('streamer backend always opens queue and preserves the existing room scope',()=>{
 const u=new URL(streamerAdminDestination(mountUrl+'v2.html?streamer=papa&space=papa-party&spaceId=space-001&adminTab=platform&tab=platform&player=p1&queue=history#home',{mountUrl}));
 assert.equal(u.pathname,'/v2.html');assert.equal(u.searchParams.get('streamer'),'papa');
 assert.equal(u.searchParams.get('space'),'papa-party');assert.equal(u.searchParams.get('spaceId'),'space-001');
 assert.equal(u.searchParams.get('portalLogin'),'admin');assert.equal(pageLocation(u.href).tab,'queue');assert.equal(pageLocation(u.href).route,'admin');
 for(const key of ['tab','player','queue'])assert.equal(u.searchParams.has(key),false);
});
test('notification, request and credential parameters cannot enter the backend link',()=>{
 const u=new URL(streamerAdminDestination(mountUrl+'v2.html?streamer=papa&token=private&notificationId=n&entityId=p&commonRequest=s&commonKind=live&portalLogin=player#center',{mountUrl}));
 assert.equal(u.searchParams.get('portalLogin'),'admin');
 for(const key of ['token','notificationId','entityId','commonRequest','commonKind'])assert.equal(u.searchParams.has(key),false);
});
test('pretty routes use existing public metadata and preserve cross-Space verification',()=>{
 const context={kind:'streamer',canonicalPath:'/pa',streamerSlug:'papa',streamerId:'room1',spaceId:'space-002',section:'center'};
 const u=new URL(streamerAdminDestination(mountUrl+'pa/center?tab=platform',{mountUrl,context}));
 assert.equal(u.pathname,'/v2.html');assert.equal(u.searchParams.get('streamer'),'papa');assert.equal(u.searchParams.get('spaceId'),'space-002');
 assert.equal(u.searchParams.get('adminTab'),'queue');assert.equal(u.hash,'#admin');
});
test('preview and repository mounts stay local while foreign origins are rejected',()=>{
 assert.equal(new URL(streamerAdminDestination('https://example.test/app/preview.html?demo&streamer=papa',{mountUrl:'https://example.test/app/'})).pathname,'/app/preview.html');
 assert.throws(()=>streamerAdminDestination('https://foreign.test/v2.html',{mountUrl}));
});
test('existing admin action resets only view state and retains authentication workflow',async()=>{
 const source=fs.readFileSync('src/app.js','utf8'),line=source.split('\n').find(x=>x.startsWith('async function openStreamerAdmin(){'));
 for(const loggedIn of [true,false]){
  const effects=[],identity=loggedIn?{role:'streamer_admin',streamerSlug:'papa'}:null;
  const context=vm.createContext({tab:'platform',selectedPlayer:'old-player',queueHistory:true,admin:identity,
   go:async route=>effects.push(route),adminLogin:async()=>effects.push('login')});
  vm.runInContext(line,context);await context.openStreamerAdmin();
  assert.equal(context.tab,'queue');assert.equal(context.selectedPlayer,null);assert.equal(context.queueHistory,false);
  assert.equal(context.admin,identity);assert.deepEqual(effects,[loggedIn?'admin':'login']);
 }
});
