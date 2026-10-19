import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicRoutePath,canonicalPublicHome,publicPageDestination} from '../src/public-route-location.js';
import {pageLocation} from '../src/streamer-navigation.js';

test('pretty homepage candidates retain alias spelling and never infer streamer IDs',()=>{
 for(const path of ['/sm','/pa','/PAPA520','/other-hall/PAPA','/pa.Artist-01','/qq.Artist-01']){
  assert.deepEqual(parsePublicRoutePath('https://paparty.app'+path),{eligible:true,candidates:[{homepagePath:path,section:'home'}],reason:null});
 }
 assert.deepEqual(parsePublicRoutePath('https://paparty.app/SM/PApa/').candidates,[{homepagePath:'/SM/PApa',section:'home'}]);
 assert.equal(Object.hasOwn(parsePublicRoutePath('https://paparty.app/pa'),'streamerId'),false);
});

test('every existing section extends the chosen home and old alias subpages keep their section',()=>{
 for(const home of ['/pa','/hall/PAPA','/pa.Singer','/qq.Singer'])for(const section of ['home','book','common-book','center','gallery','admin']){
  const parsed=parsePublicRoutePath('https://paparty.app'+home+'/'+section);
  assert.equal(parsed.eligible,true);
  assert.deepEqual(parsed.candidates.at(-1),{homepagePath:home,section});
 }
 assert.deepEqual(parsePublicRoutePath('https://paparty.app/sm/book').candidates,[{homepagePath:'/sm/book',section:'home'},{homepagePath:'/sm',section:'book'}],'registered exact alias is tried before shorter fallback');
});

test('unknown and system routes are not resolved as streamer aliases',()=>{
 for(const path of ['/','/index.html','/preview.html','/404.html','/src/app.js','/assets/logo.png','/auth/callback','/login','/admin','/favicon.ico','/pa/a/b/c','/hall/singer/not-a-section','/pa.Singer/another-home','/solo/Singer']){
  assert.equal(parsePublicRoutePath('https://paparty.app'+path).eligible,false,path);
 }
 assert.equal(parsePublicRoutePath('https://paparty.app/?streamer=papa#book').eligible,false,'query/hash legacy navigation remains on the existing bootstrap');
});

test('unsafe paths cannot become public resolver input',()=>{
 for(const path of ['/../pa','/pa/../sm','/sm//PAPA','//evil.test/papa','/sm/PAPA//','/sm%2fPAPA','/sm/PAPA%5cbook','/sm/%2e%2e','/pa%2eabc','/sm/中文','/sm/PAPA_1','/sm/PA.PA','/pa./book','/pa.abc/other/book','/qq..abc','/qq.abc.def','/qq.-abc','/qq.abc-','/abc-','/a'.repeat(50),'/a b','/sm\\papa']){
  assert.equal(parsePublicRoutePath('https://paparty.app'+path).eligible,false,path);
 }
 assert.equal(parsePublicRoutePath('https://person:secret@paparty.app/pa').eligible,false);
 assert.equal(parsePublicRoutePath('javascript:alert(1)').eligible,false);
});

test('mount isolation and localhost previews retain exact route candidates',()=>{
 const mount='https://example.test/app/';
 assert.deepEqual(parsePublicRoutePath('https://example.test/app/hall/singer/book',{mountUrl:mount}).candidates,[{homepagePath:'/hall/singer',section:'book'}]);
 assert.equal(parsePublicRoutePath('https://example.test/elsewhere/pa',{mountUrl:mount}).eligible,false);
 assert.equal(parsePublicRoutePath('https://evil.test/app/pa',{mountUrl:mount}).eligible,false);
 assert.equal(parsePublicRoutePath('http://127.0.0.1:8861/pa.singer').eligible,true);
});

test('canonical shares contain only a public homepage without login or selected-player state',()=>{
 assert.equal(canonicalPublicHome('https://paparty.app/?token=secret#admin','/pa'),'https://paparty.app/pa');
 assert.equal(canonicalPublicHome('https://paparty.app/old','/hall/PAPA/'),'https://paparty.app/hall/PAPA');
 assert.equal(canonicalPublicHome('https://paparty.app','/pa.Singer'),'https://paparty.app/pa.Singer');
 for(const path of ['/pa?token=secret','/pa#admin','//evil.test/x','https://evil.test/pa','/pa/../sm','/pa%2fadmin','/src','/pa.Singer/subhome','/hall/singer/book'])assert.equal(canonicalPublicHome('https://paparty.app',path),null,path);
 assert.equal(canonicalPublicHome('https://person:secret@paparty.app','/pa'),null);
 assert.equal(canonicalPublicHome('javascript:bad','/pa'),null);
});

test('navigation round-trips exact admin/player/history state and drops other account or notice hints',()=>{
 const source='https://paparty.app/old?token=secret&adminToken=secret&streamer=other&spaceId=other&entityId=x&notificationId=y&demo=1#admin';
 const home='https://paparty.app/hall/PAPA';
 for(const route of ['home','book','common-book','center','gallery','admin']){
  const view={route,tab:'players',subtab:'achievements',selectedPlayer:'P中文',queueHistory:false};
  const dest=publicPageDestination(source,home,view),url=new URL(dest);
  assert.equal(url.pathname,'/hall/PAPA'+(route==='home'?'':'/'+route));assert.equal(url.hash,'');
  for(const key of ['token','adminToken','streamer','spaceId','entityId','notificationId','demo'])assert.equal(url.searchParams.has(key),false,key);
  // Existing parser consumes the resolved section, with exactly the existing tab rules.
  url.hash=route;const parsed=pageLocation(url.href);
  assert.equal(parsed.route,route);assert.equal(parsed.selectedPlayer,route==='admin'?'P中文':null);
  assert.equal(parsed.subtab,route==='center'||route==='admin'?'achievements':'overview');
 }
 const history=publicPageDestination(source,'https://paparty.app/pa.Singer',{route:'admin',tab:'queue',queueHistory:true});
 assert.equal(history,'https://paparty.app/pa.Singer/admin?adminTab=queue&queue=history');
 const old='https://paparty.app/old-home/center?tab=ledger&notificationId=N';
 const moved=publicPageDestination(old,home,{route:'center',subtab:'ledger'});
 assert.equal(moved,'https://paparty.app/hall/PAPA/center?tab=ledger');
});

test('page serialization rejects cross-origin home and never serializes invalid routes or hidden hashes',()=>{
 assert.equal(publicPageDestination('https://paparty.app/pa','https://evil.test/pa',{route:'book'}),null);
 for(const home of ['https://paparty.app/pa?token=secret','https://paparty.app/pa#admin','https://person:secret@paparty.app/pa','https://paparty.app/src','https://paparty.app/old/../pa','https://paparty.app/%70a'])assert.equal(publicPageDestination('https://paparty.app/pa',home,{route:'book'}),null,home);
 assert.equal(publicPageDestination('https://paparty.app/old#admin','https://paparty.app/pa',{route:'unexpected'}),'https://paparty.app/pa');
 assert.equal(publicPageDestination('https://paparty.app/old?adminTab=players&player=someone&tab=ledger&queue=history','https://paparty.app/pa',{route:'book'}),'https://paparty.app/pa/book');
});
