import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readPublicRouteContext,publicApplicationHref,publicApplicationPage} from '../src/public-links.js';
import {publicPageDestination} from '../src/public-route-location.js';
import {pageLocation,pageDestination,publicStreamerDestination} from '../src/streamer-navigation.js';
import {roomStorageKey} from '../src/communication-context.js';
import {requiresSpaceEntry} from '../src/space-entry.js';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const take=(first,last)=>{const start=source.indexOf(first),end=source.indexOf(last,start);assert.ok(start>=0&&end>start,first);return source.slice(start,end);};
const roomNavigation=take('function roomDestination(',"document.addEventListener('change',e=>{if(e.target.id==='header-streamer')");
const pageNavigation=take('function syncPageLocation(','const notifications=createNotifications(');
const loginSource=take('async function loginDialog(){','function changeManagerPassword(');
const startup=take('async function start(){','\nlet lastHour=');
const initialSource=take('let publicRouteContext=','let pendingNoticeTarget=');
const plain=value=>JSON.parse(JSON.stringify(value));
const rooms=[{id:'papa',slug:'papa',display_name:'怕怕',active:true,spaceId:'space-001'},{id:'mimi',slug:'michelle',display_name:'米雪',active:true,spaceId:'space-001'}];
const info=(room=rooms[0],path='/pa')=>({version:1,kind:'streamer',spaceId:room.spaceId,streamerId:room.id,streamerSlug:room.slug,canonicalPath:path,canonicalHome:'https://paparty.app'+path,section:'home',configured:true});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

function fixture(href='https://paparty.app/pa',{context=info(),room=rooms[0],admin=null,session=null,entryPending=false,lookup=async target=>info(rooms.find(row=>row.id===target.streamerId),target.streamerId==='mimi'?'/MICHELLE':'/pa'),respond}={}){
 const calls={reads:[],info:[],share:[],api:[],put:[],modal:[],entry:[],request:[],toast:[],errors:[]},stack=[href],nodes=new Map();let position=0,c;
 const location={href};Object.defineProperties(location,{origin:{get:()=>new URL(location.href).origin},search:{get:()=>new URL(location.href).search},pathname:{get:()=>new URL(location.href).pathname}});
 const history={state:null,pushState(_state,_title,url){stack.splice(++position);stack.push(url);location.href=url;},replaceState(_state,_title,url){stack[position]=url;location.href=url;}};
 const initial=publicApplicationPage(href,context,'https://paparty.app/');
 c=vm.createContext({URL,URLSearchParams,publicApplicationHref,publicApplicationPage,publicPageDestination,pageLocation,pageDestination,publicStreamerDestination,location,history,
  publicRouteContext:context,spaceMount:'https://paparty.app/',state:{currentStreamer:room,streamers:rooms,players:[]},streamerSlug:context?.streamerSlug||new URL(href).searchParams.get('streamer')||'papa',
  route:initial.route,tab:initial.tab,subtab:initial.subtab,selectedPlayer:initial.selectedPlayer,queueHistory:initial.queueHistory,admin,session,entryPending,demo:false,draft:null,deviceLogin:null,
  publicLinks:{info:async target=>{calls.info.push(plain(target));return lookup(target);},shareUrl:value=>'https://paparty.app'+value.canonicalPath,invalidate(){}},
  publicShare:{open:async value=>calls.share.push(plain(value))},
  refresh:async force=>calls.reads.push({force,route:c.route,subtab:c.subtab,tab:c.tab,selectedPlayer:c.selectedPlayer}),
  openSpaceEntry:async()=>{calls.entry.push('verified-space-entry');return false;},showSpaceEntry:()=>calls.entry.push('login-entry-screen'),
  requestSong:async(songId,kind)=>calls.request.push({songId,kind}),loadCommonBook:async()=>{},
  api:async body=>{calls.api.push(plain(body));if(respond)return respond(body);if(body.op==='search')return {players:[{playerId:'P1',name:'布布',ids:['123']}]};if(body.op==='login')return {token:'fixture-player-token'};if(body.op==='streamerLogin')return {role:'streamer_admin',streamerSlug:body.streamer,token:'fixture-manager-token',expiresIn:43200};if(body.op==='adminLogin')return {role:'super_admin',token:'fixture-president-token',expiresIn:43200};throw Error('unexpected API '+body.op);},
  deviceTransport:async body=>{throw Error('unexpected legacy directory '+body.op);},
  legacyEntryRoomsLoaded:false,modal:(title,body,submit)=>calls.modal.push({title,body,submit}),put:(name,value)=>calls.put.push({name,value:plain(value)}),
  nativeSelect:()=>'',select:()=>'',field:()=>'',toast:text=>calls.toast.push(text),hostName:()=>c.state.currentStreamer.display_name,
  $:selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',addEventListener(){}});return nodes.get(selector);},
  header:()=>calls.errors.push('unexpected-start-error'),card:(_title,body)=>body,h:String,button:()=>'',
  signatures:{},filters:{},pages:{},roomSearch:{generation:0},clearTimeout(){},pendingCommonRequest:null
 });
 vm.runInContext(roomNavigation+'\n'+pageNavigation+'\n'+loginSource+'\n'+startup,c);
 return {c,calls,location,history,stack,run:code=>vm.runInContext(code,c),async back(){if(position>0){location.href=stack[--position];await vm.runInContext('restorePageLocation()',c);}},async forward(){if(position<stack.length-1){location.href=stack[++position];await vm.runInContext('restorePageLocation()',c);}},async submit(values){const callback=calls.modal.at(-1)?.submit;assert.equal(typeof callback,'function');await callback(new Map(Object.entries(values)));}};
}

test('actual pretty bootstrap partitions only room preferences and restores the exact page without stale URL hints',()=>{
 const record={...info({...rooms[1],spaceId:'space-Q'},'/qq.MICHELLE'),section:'admin'},reads=[],written=[],data=new Map();
 data.set('papa-v2-player',JSON.stringify({playerId:'P1',token:'fixture-global-player'}));
 data.set('papa-v2-admin',JSON.stringify({role:'super_admin',token:'fixture-global-manager'}));
 data.set('papa-v2-'+roomStorageKey('adminTab',{spaceId:'space-Q',streamerSlug:'michelle'}),JSON.stringify('songs'));
 data.set('papa-v2-'+roomStorageKey('draft',{spaceId:'space-Q',streamerSlug:'michelle'}),JSON.stringify({id:'correct-private-draft'}));
 data.set('papa-v2-adminTab-papa',JSON.stringify('ledger'));data.set('papa-v2-draft-papa',JSON.stringify({id:'wrong-draft'}));
 const document={querySelector:()=>({textContent:JSON.stringify(record)})},href='https://paparty.app/qq.MICHELLE/admin?streamer=wrong&spaceId=wrong';
 const c=vm.createContext({URL,URLSearchParams,spaceMount:'https://paparty.app/',location:{href,search:new URL(href).search,pathname:new URL(href).pathname},deviceLogin:null,
  readPublicRouteContext:options=>readPublicRouteContext({...options,document}),publicApplicationHref,publicApplicationPage,roomStorageKey,empty:()=>({}),
  localStorage:{getItem:key=>{reads.push(key);return data.get(key)||null;},setItem:(key,value)=>written.push({key,value})}
 });
 vm.runInContext(initialSource,c);
 assert.equal(vm.runInContext('streamerSlug',c),'michelle');assert.equal(vm.runInContext('tab',c),'songs');assert.equal(vm.runInContext('route',c),'admin');assert.equal(vm.runInContext('draft.id',c),'correct-private-draft');
 assert.equal(vm.runInContext('session.token',c),'fixture-global-player');assert.equal(vm.runInContext('admin.token',c),'fixture-global-manager');
 assert.equal(reads.includes('papa-v2-draft-papa'),false);assert.equal(reads.some(key=>key.includes('wrong')),false);
 vm.runInContext("put('adminTab','queue')",c);assert.equal(written[0].key,'papa-v2-'+roomStorageKey('adminTab',{spaceId:'space-Q',streamerSlug:'michelle'}));
 const normalized=new URL(vm.runInContext('roomContextHref()',c));assert.equal(normalized.searchParams.get('streamer'),'michelle');assert.equal(normalized.searchParams.get('spaceId'),'space-Q');
 assert.equal(requiresSpaceEntry(normalized.href,'https://paparty.app/'),true,'public metadata does not grant entry to a nonlegacy Space');
});

test('actual sync and Back/Forward keep the pretty prefix and restore complete admin details/history without duplicate history entries',async()=>{
 const f=fixture('https://paparty.app/pa/admin?adminTab=queue&queue=history',{admin:{role:'super_admin'}});
 f.run("tab='players';selectedPlayer='P1';subtab='ledger';queueHistory=false;syncPageLocation(true)");
 assert.equal(f.location.href,'https://paparty.app/pa/admin?adminTab=players&tab=ledger&player=P1');
 f.run("route='book';syncPageLocation(true)");assert.equal(f.location.href,'https://paparty.app/pa/book');assert.equal(f.stack.length,3);
 await f.back();assert.equal(f.c.route,'admin');assert.equal(f.c.tab,'players');assert.equal(f.c.subtab,'ledger');assert.equal(f.c.selectedPlayer,'P1');assert.equal(f.stack.length,3);
 await f.back();assert.equal(f.c.tab,'queue');assert.equal(f.c.queueHistory,true);assert.equal(f.c.selectedPlayer,null);assert.equal(f.location.href,'https://paparty.app/pa/admin?adminTab=queue&queue=history');
 await f.forward();assert.equal(f.c.selectedPlayer,'P1');assert.equal(f.stack.length,3);
});

test('switching pretty room uses the target registered prefix and preserves only its permitted section',async()=>{
 const player=fixture('https://paparty.app/pa/book');await player.run('switchPublicStreamer("michelle")');assert.equal(player.location.href,'https://paparty.app/MICHELLE/book');assert.deepEqual(player.calls.info,[{spaceId:'space-001',streamerId:'mimi'}]);
 const own=fixture('https://paparty.app/pa/admin?adminTab=songs',{admin:{role:'streamer_admin',streamerSlug:'papa'}});await own.run('switchPublicStreamer("michelle")');assert.equal(own.location.href,'https://paparty.app/MICHELLE');
 const president=fixture('https://paparty.app/pa/admin?adminTab=songs',{admin:{role:'super_admin'}});await president.run('switchPublicStreamer("michelle")');assert.equal(president.location.href,'https://paparty.app/MICHELLE/admin?adminTab=songs');
});

test('room-switch lookup failure falls back to a clean legacy target, and a late reply cannot replace a newer page',async()=>{
 const unavailable=fixture('https://paparty.app/pa/book',{lookup:async()=>{throw Error('offline');}});await unavailable.run('switchPublicStreamer("michelle")');const fallback=new URL(unavailable.location.href);assert.equal(fallback.pathname,'/v2.html');assert.equal(fallback.searchParams.get('streamer'),'michelle');assert.equal(fallback.hash,'#book');
 const pending=deferred(),late=fixture('https://paparty.app/pa/book',{lookup:()=>pending.promise}),request=late.run('switchPublicStreamer("michelle")');late.location.href='https://paparty.app/pa/gallery';pending.resolve(info(rooms[1],'/MICHELLE'));await request;assert.equal(late.location.href,'https://paparty.app/pa/gallery');
});

test('share always uses the currently viewed room and returns its public homepage, never the manager owner or current subpage',async()=>{
 const f=fixture('https://paparty.app/MICHELLE/book',{context:info(rooms[1],'/MICHELLE'),room:rooms[1],admin:{role:'streamer_admin',streamerSlug:'papa',streamer_id:'papa'}});
 assert.equal(f.calls.info.length,0);await f.run('openPublicShare()');assert.deepEqual(f.calls.info,[{spaceId:'space-001',streamerId:'mimi'}]);assert.deepEqual(f.calls.share,[{name:'米雪',url:'https://paparty.app/MICHELLE',kind:'streamer'}]);
 const pending=deferred(),late=fixture('https://paparty.app/pa/book',{lookup:()=>pending.promise}),request=late.run('openPublicShare()');late.c.state.currentStreamer=rooms[1];pending.resolve(info());await request;assert.equal(late.calls.share.length,0,'late same-URL replies cannot share a previously viewed room');
});

test('same-room manager login preserves direct admin player/tab destination; cross-room login cannot leave the old pretty prefix',async()=>{
 const own=fixture('https://paparty.app/pa/admin?adminTab=players&player=P1&tab=ledger');await own.run('adminLogin()');await own.submit({mode:'streamer',streamer:'papa',password:'fixture'});
 assert.equal(own.location.href,'https://paparty.app/pa/admin?adminTab=players&player=P1&tab=ledger');assert.equal(own.c.selectedPlayer,'P1');assert.equal(own.c.subtab,'ledger');assert.equal(own.c.route,'admin');
 const other=fixture('https://paparty.app/pa/admin?adminTab=players&player=P1&tab=ledger');await other.run('adminLogin()');await other.submit({mode:'streamer',streamer:'michelle',password:'fixture'});
 const url=new URL(other.location.href);assert.equal(url.pathname,'/v2.html');assert.equal(url.searchParams.get('streamer'),'michelle');assert.equal(url.hash,'#admin');assert.notEqual(url.pathname,'/pa/admin');
});

test('direct pretty admin or center opens the existing login form and retains intended tab/player selectors',async()=>{
 const admin=fixture('https://paparty.app/pa/admin?adminTab=players&player=P1&tab=ledger');await admin.run('start()');assert.match(admin.calls.modal.at(-1).title,/管理入口/);assert.equal(admin.c.tab,'players');assert.equal(admin.c.selectedPlayer,'P1');assert.equal(admin.c.subtab,'ledger');
 await admin.submit({mode:'streamer',streamer:'papa',password:'fixture'});assert.equal(admin.c.route,'admin');assert.equal(admin.c.selectedPlayer,'P1');
 const player=fixture('https://paparty.app/pa/center?tab=achievements');await player.run('start()');assert.match(player.calls.modal.at(-1).title,/玩家登入/);assert.equal(player.c.subtab,'achievements');
 await player.run('chooseLogin("P1")');await player.submit({loginId:'123',password:''});assert.equal(player.c.route,'center');assert.equal(player.c.subtab,'achievements');assert.equal(player.location.href,'https://paparty.app/pa/center?tab=achievements');
 assert.equal(player.calls.errors.length,0);assert.equal(admin.calls.errors.length,0);
});

test('pretty player login restores public destinations while legacy login stays home and cannot grant admin',async()=>{
 for(const route of ['home','book','common-book','center','gallery']){
  const href='https://paparty.app/pa'+(route==='home'?'':'/'+route),f=fixture(href);await f.run('chooseLogin("P1")');await f.submit({loginId:'123'});assert.equal(f.c.route,route);assert.equal(f.location.href,href+(route==='center'?'?tab=overview':''));
 }
 const legacy=fixture('https://paparty.app/v2.html?streamer=papa#book',{context:null});await legacy.run('chooseLogin("P1")');await legacy.submit({loginId:'123'});assert.equal(legacy.c.route,'home');assert.equal(new URL(legacy.location.href).hash,'#home');
 const admin=fixture('https://paparty.app/pa/admin?adminTab=players&player=P1');await admin.run('chooseLogin("P1")');await admin.submit({loginId:'123'});assert.equal(admin.c.admin,null);assert.equal(admin.c.route,'home');assert.equal(admin.location.href,'https://paparty.app/pa');
});

test('returning to a pretty public page consumes the original pending song intent exactly once after login',async()=>{
 const f=fixture('https://paparty.app/pa/book');f.c.pendingCommonRequest={songId:'S1',kind:'saved'};await f.run('chooseLogin("P1")');await f.submit({loginId:'123'});
 assert.equal(f.c.route,'book');assert.deepEqual(f.calls.request,[{songId:'S1',kind:'saved'}]);assert.equal(f.c.pendingCommonRequest,null);await f.run("go('book')");assert.equal(f.calls.request.length,1);
});
