import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installed,pagePreference,readPreference,launchPlan,PREFERENCE_KEY} from '../src/pwa-start.js';
import {legacyPortalDestination} from '../src/portal-routing.js';
import {spaceDestination} from '../src/space-entry.js';
const mount='https://paparty.app/',room={id:'r1',slug:'papa',spaceId:'space-001',active:true};
const pref=pagePreference(mount+'v2.html?streamer=papa#book',mount,room);
const plan=(tail,extra={})=>launchPlan({href:mount+tail,mount,standalone:true,preference:pref,...extra});
test('Android and iOS installed modes only; normal browser unaffected',()=>{
 assert.equal(installed({navigator:{standalone:true}}),true);
 assert.equal(installed({matchMedia:()=>({matches:true})}),true);
 assert.equal(installed({navigator:{}}),false);
 assert.equal(plan('?appLaunch=1',{standalone:false}),null);
});
test('first/new/old launches reach portal without preference and stable room with preference',()=>{
 for(const entry of ['?appLaunch=1','#home']){
  assert.equal(plan(entry,{preference:null}).target,mount);
  for(let i=0;i<5;i++)assert.equal(plan(entry).target,entry==='#home'?mount:mount+'v2.html?streamer=papa&pwaDefault=1#book');
 }
});
test('share, push, manual home, foreground, back and reload do not override explicit destination',()=>{
 for(const tail of ['','index.html','#features','?streamer=papa#book','?notificationId=n#center','?entryLogin=player','?appLaunch=1&notificationId=n','v2.html?streamer=papa#home'])assert.equal(plan(tail),null);
 for(const navigationType of ['reload','back_forward'])assert.equal(plan('#home',{navigationType}).target,mount);
 assert.equal(plan('#home',{referrer:mount+'lobby.html'}).target,mount);
});
test('only confirmed active room identities and whitelisted page controls are stored',()=>{
 assert.equal(pagePreference(mount+'v2.html?streamer=papa#book',mount),null);
 assert.equal(pagePreference(mount+'v2.html?streamer=papa#book',mount,{...room,active:false}),null);
 assert.equal(pagePreference('https://evil.test/v2.html?streamer=papa#book',mount,room),null);
 const p=pagePreference(mount+'v2.html?streamer=papa&token=secret&player=private&notificationId=x&adminTab=queue#admin',mount,room);
 assert.equal(p.path,'/v2.html?streamer=papa&adminTab=queue#admin');assert.equal(p.streamerId,'r1');
});
test('persistent preference validates corrupted and forged routes; reset is explicit portal preference',()=>{
 for(const value of [null,'{',JSON.stringify({...pref,path:'https://evil.test/'}),JSON.stringify({...pref,path:'/v2.html?streamer=papa&token=secret#book'})])assert.equal(readPreference({getItem:()=>value},mount),null);
 assert.deepEqual(readPreference({getItem:key=>key===PREFERENCE_KEY?JSON.stringify(pref):null},mount),pref);
 const portal=pagePreference(mount,mount);assert.equal(plan('?appLaunch=1',{preference:portal}).target,mount);
 const lobby=pagePreference(mount+'lobby.html?q=search',mount);assert.equal(plan('?appLaunch=1',{preference:lobby}).target,mount+'lobby.html');
});
test('verified entry converges on v2 instead of forming a portal loop',()=>{
 const space={id:'space-001',slug:'shengma',streamerSlug:'papa'};
 const old=mount+'?space=shengma&spaceId=space-001&streamer=papa#home';
 const app=legacyPortalDestination(old),verified=spaceDestination(app,mount,space);
 assert.equal(new URL(verified).pathname,'/v2.html');
 assert.equal(spaceDestination(verified,mount,space),verified);
 assert.equal(new URL(spaceDestination('https://example.test/papa-party/v2.html','https://example.test/papa-party/',space)).pathname,'/papa-party/v2.html');
});
test('manifest identity and scope remain unchanged; new launch marker is explicit',()=>{
 const m=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
 assert.equal(m.id,'./');assert.equal(m.scope,'./');assert.equal(m.start_url,'./?appLaunch=1');
});
