import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {legacyPortalDestination} from '../src/portal-routing.js';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const bootstrap=source.slice(source.indexOf('async function start(){'),source.indexOf('\nlet lastHour=',source.indexOf('async function start(){')));
function fixture({mode='player',session=null,admin=null,entryPending=true,readError=false}={}){
 const effects=[];
 const context=vm.createContext({URL,demo:false,session,admin,route:'home',entryPending,
  location:{href:'https://paparty.app/v2.html?portalLogin='+mode},
  history:{state:null,replaceState(_state,_title,url){context.location.href=String(url);}},
  showSpaceEntry(){effects.push('entry-screen');},
  async loginDialog(){effects.push('player-login');},
  async adminLogin(){effects.push('admin-login');},
  async openSpaceEntry(){effects.push('verified-entry:'+context.route);return false;},
  async refresh(){effects.push('room-read');if(readError)throw Error('Scope denied');},
  managementPage:()=>false,
  header(){effects.push('error');},$:()=>({}),card:()=>'',h:String,button:()=>''
 });
 vm.runInContext(bootstrap,context);
 return {context,effects,run:()=>context.start()};
}
test('portal player entry opens the existing player login without reading a room',async()=>{
 const f=fixture();await f.run();assert.deepEqual(f.effects,['entry-screen','player-login']);
 assert.equal(new URL(f.context.location.href).searchParams.has('portalLogin'),false);
 assert.equal(f.context.session,null);assert.equal(f.context.admin,null);
});
test('portal manager entry opens manager login even when a player is signed in',async()=>{
 const f=fixture({mode:'admin',session:{role:'player'}});await f.run();
 assert.deepEqual(f.effects,['entry-screen','admin-login']);assert.equal(f.context.route,'admin');
});
test('portal player entry does not borrow a manager identity',async()=>{
 const f=fixture({admin:{role:'super_admin'}});await f.run();assert.deepEqual(f.effects,['entry-screen','player-login']);
});

for(const mode of ['player','admin'])test('scoped '+mode+' entry loads its authoritative room directory before showing login',async()=>{
 const f=fixture({mode,entryPending:false});await f.run();
 assert.deepEqual(f.effects,['room-read',mode==='admin'?'admin-login':'player-login']);
 assert.equal(f.context.route,'home');
});

test('a rejected room scope never falls back to the seeded papa login directory',async()=>{
 const f=fixture({mode:'admin',entryPending:false,readError:true});await f.run();
 assert.deepEqual(f.effects,['room-read','error']);
});
for(const mode of ['player','admin'])test('remembered '+mode+' still resolves permissions through existing entry',async()=>{
 const f=fixture({mode,session:mode==='player'?{role:'player'}:null,admin:mode==='admin'?{role:'streamer_admin'}:null});
 await f.run();assert.deepEqual(f.effects,['verified-entry:'+(mode==='admin'?'admin':'home')]);
});
test('a fabricated login mode never supplies a role or bypasses the existing entry',async()=>{
 const f=fixture({mode:'super_admin'});await f.run();assert.deepEqual(f.effects,['verified-entry:home']);assert.equal(f.context.admin,null);
});
test('marketing links stay on the portal, including ordinary campaign parameters',()=>{
 for(const hash of ['', '#features','#experience','#audience','#plans'])assert.equal(legacyPortalDestination('https://paparty.app/?utm_source=share'+hash),null);
});
test('existing room, space, notification and PWA links preserve exact query and hash',()=>{
 for(const tail of ['?streamer=papa#home','?space=hall&spaceId=abc#admin','?streamer=papa&notificationId=n%2B1&entityId=a%20b#center','?demo','#book','#home']){
  const original=new URL('https://paparty.app/'+tail),next=new URL(legacyPortalDestination(original));
  assert.equal(next.pathname,'/v2.html');assert.equal(next.search,original.search);assert.equal(next.hash,original.hash);
 }
});
test('production build keeps the portal separate from the existing app and includes its assets',()=>{
 const root=new URL('../dist/',import.meta.url),read=name=>fs.readFileSync(new URL(name,root),'utf8');
 assert.match(read('index.html'),/讓每一首歌/);assert.match(read('v2.html'),/src\/app\.js/);
 assert.equal(read('preview.html'),read('v2.html'));assert.notEqual(read('index.html'),read('v2.html'));
 assert.ok(fs.existsSync(new URL('src/portal-routing.js',root)));assert.ok(fs.existsSync(new URL('assets/pa-party-approved.png',root)));
});
