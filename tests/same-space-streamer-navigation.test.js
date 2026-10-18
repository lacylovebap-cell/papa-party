import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publicStreamerDestination,pageLocation} from '../src/streamer-navigation.js';
import {requiresSpaceEntry} from '../src/space-entry.js';

const mount='https://party.test/app/';
const rooms=[
 {id:'papa',slug:'papa',display_name:'怕怕',spaceId:'space-001',active:true},
 {id:'mimi',slug:'michelle',display_name:'米雪',spaceId:'space-001',active:true}
];
const currentRoom=rooms[0],targetSlug=rooms[1].slug;
const options={currentRoom,rooms,mountUrl:mount};
const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),lines=source.split(/\r?\n/);
function declaration(name){
 if(name==='start')return source.slice(source.indexOf('async function start(){'),source.indexOf('\nlet lastHour=',source.indexOf('async function start(){')));
 const line=lines.find(line=>line.startsWith('function '+name+'(')||line.startsWith('async function '+name+'('));
 assert.ok(line&&line.endsWith('}'),'actual complete application declaration: '+name);return line;
}
const headerChange=lines.find(line=>line.startsWith("document.addEventListener('change',e=>{if(e.target.id==='header-streamer')"));
const roomChange=lines.find(line=>line.startsWith("document.addEventListener('change',e=>{if(e.target.name==='streamer-switch')"));
assert.ok(headerChange&&roomChange,'both real application streamer change entry points exist');
const navigationSource=['roomDestination','switchStreamer','commonBookDestination','commonBookRequest','start'].map(declaration).join('\n');

function harness(href,{directory=rooms,current=directory.find(room=>room.slug===new URL(href).searchParams.get('streamer'))||currentRoom,
 mountUrl=mount,admin=null,session={role:'player',playerId:'P1',spaceId:'space-001'},subtab='overview',tab='queue'}={}){
 const calls={entry:0,reads:[],requests:[],login:0,common:[],go:[],errors:[]},changes=[],node={innerHTML:''};
 const location={href};let context;
 context=vm.createContext({URL,publicStreamerDestination,pageLocation,requiresSpaceEntry,location,
  history:{replaceState:(_state,_title,url)=>{location.href=url;}},state:{currentStreamer:current,streamers:directory},
  spaceMount:mountUrl,streamerSlug:new URL(href).searchParams.get('streamer')||'papa',admin,session,subtab,tab,
  route:pageLocation(href).route,entryPending:requiresSpaceEntry(href,mountUrl),demo:false,pendingCommonRequest:null,
  document:{addEventListener:(event,callback)=>{if(event==='change')changes.push(callback);}},
  openSpaceEntry:async()=>{calls.entry++;node.innerHTML='fixture-space-choice';return false;},
  refresh:async force=>{calls.reads.push({streamer:context.streamerSlug,route:context.route,force});},
  requestSong:async(songId,kind)=>{calls.requests.push({streamer:context.streamerSlug,songId,kind});},
  loginDialog:async()=>{calls.login++;},loadCommonBook:async page=>calls.common.push(page),
  go:async route=>{context.route=route;calls.go.push(route);},
  header(){calls.errors.push('unexpected-start-error');},$:()=>node,card:(_title,body)=>body,h:String,button:()=>''
 });
 vm.runInContext(navigationSource+'\n'+headerChange+'\n'+roomChange,context);
 const run=code=>vm.runInContext(code,context);
 const change=target=>{for(const callback of changes)callback({target:{id:'',name:'',matches:()=>false,...target}});};
 return {context,location,calls,node,run,change,start:()=>run('start()')};
}

test('canonical same-Space public room links preserve each public page and bypass only redundant Space entry',()=>{
 for(const filename of ['', 'index.html','v2.html','preview.html'])for(const route of ['home','book','common-book','center','gallery']){
  const href=mount+filename+'?streamer=papa&spaceId=space-001&v=release#'+route;
  const url=new URL(publicStreamerDestination(href,targetSlug,{...options,subtab:'ledger'}));
  assert.equal(url.hash,'#'+route);assert.equal(url.pathname,new URL(href).pathname);
  assert.equal(url.searchParams.get('streamer'),targetSlug);assert.equal(url.searchParams.get('v'),'release');
  assert.equal(url.searchParams.has('spaceId'),false);assert.equal(url.searchParams.has('space'),false);
  assert.equal(url.searchParams.get('tab'),route==='center'?'ledger':null);
  assert.equal(requiresSpaceEntry(url.href,mount),false);
 }
 for(const query of ['spaceId=space-001','space=papa-party&spaceId=space-001','space=papa-party']){
  const url=publicStreamerDestination(mount+'?streamer=papa&'+query+'#book',targetSlug,options);
  assert.equal(new URL(url).hash,'#book');assert.equal(requiresSpaceEntry(url,mount),false);
 }
});

test('unknown native inactive noncanonical dedicated and forged destinations keep the original Space entry guard',()=>{
 const href=mount+'?streamer=papa&spaceId=space-001#book';
 const cases=[
  ['unknown room',href,'unknown',options],
  ['native current and target',href,targetSlug,{...options,currentRoom:{...currentRoom,spaceId:'space-native'},rooms:rooms.map(room=>({...room,spaceId:'space-native'}))}],
  ['native target',href,targetSlug,{...options,rooms:[currentRoom,{...rooms[1],spaceId:'space-native'}]}],
  ['current missing canonical Space',href,targetSlug,{...options,currentRoom:{...currentRoom,spaceId:undefined}}],
  ['target missing canonical Space',href,targetSlug,{...options,rooms:[currentRoom,{...rooms[1],spaceId:undefined}]}],
  ['target missing canonical ID',href,targetSlug,{...options,rooms:[currentRoom,{...rooms[1],id:undefined}]}],
  ['missing directory',href,targetSlug,{...options,rooms:undefined}],
  ['inactive target',href,targetSlug,{...options,rooms:[currentRoom,{...rooms[1],active:false}]}],
  ['dedicated Space path',mount+'private/?streamer=papa&spaceId=space-001#book',targetSlug,options],
  ['nested path',mount+'private/other?streamer=papa&spaceId=space-001#book',targetSlug,options],
  ['foreign mount',href,targetSlug,{...options,mountUrl:'https://other.test/app/'}],
  ['outside mount',href,targetSlug,{...options,mountUrl:'https://party.test/different/'}],
  ['missing mount',href,targetSlug,{...options,mountUrl:undefined}],
  ['forged Space ID',mount+'?streamer=papa&spaceId=space-private#book',targetSlug,options],
  ['blank Space ID',mount+'?streamer=papa&spaceId=#book',targetSlug,options],
  ['source streamer mismatch',mount+'?streamer=other&spaceId=space-001#book',targetSlug,options]
 ];
 for(const [label,input,slug,config] of cases){
  const destination=publicStreamerDestination(input,slug,config),url=new URL(destination);
  assert.equal(url.searchParams.get('spaceId'),new URL(input).searchParams.get('spaceId'),label);
  assert.equal(requiresSpaceEntry(destination,config.mountUrl||mount),true,label);
  assert.equal(url.hash,'#book',label+' retains requested route for verified entry');
 }
 // The URL-only gate itself stays strict; metadata is needed to mint the
 // clean public room navigation, and no caller input becomes a Space grant.
 for(const url of [href,mount+'?streamer=papa&space=private#book',mount+'private/?streamer=papa#book'])
  assert.equal(requiresSpaceEntry(url,mount),true);
});

test('manager cross-room switches cannot enter another backend and president keeps its management section',()=>{
 const href=mount+'?streamer=papa&spaceId=space-001&adminTab=players&player=P1#admin';
 const manager=new URL(publicStreamerDestination(href,targetSlug,{...options,role:'streamer_admin',managedSlug:'papa',adminTab:'players'}));
 assert.equal(manager.hash,'#home');assert.equal(manager.searchParams.has('adminTab'),false);assert.equal(manager.searchParams.has('player'),false);
 const president=new URL(publicStreamerDestination(href,targetSlug,{...options,role:'super_admin',adminTab:'songs'}));
 assert.equal(president.hash,'#admin');assert.equal(president.searchParams.get('adminTab'),'songs');assert.equal(requiresSpaceEntry(president.href,mount),false);
});

test('plain room switching clears consumed notice metadata and old pending song actions',()=>{
 const href=mount+'?streamer=papa&space=papa-party&spaceId=space-001&streamerId=old-room&entityType=queue&entityId=old-record&notificationId=old-notice&commonRequest=old-song&commonKind=saved&player=P1&adminTab=ledger#book';
 const url=new URL(publicStreamerDestination(href,targetSlug,options));
 for(const key of ['space','spaceId','streamerId','entityType','entityId','notificationId','commonRequest','commonKind','player','adminTab'])assert.equal(url.searchParams.has(key),false,key);
 assert.equal(url.hash,'#book');assert.equal(url.searchParams.get('streamer'),targetSlug);
});

test('actual header and alternate streamer selectors keep the selected songbook after reload without showing Space choice',async()=>{
 for(const params of ['spaceId=space-001','space=papa-party&spaceId=space-001'])for(const control of ['header','alternate','function']){
  const h=harness(mount+'?streamer=papa&'+params+'#book');
  assert.equal(h.context.entryPending,true,'reproduces the old raw URL gate');
  const computed=h.run('roomDestination("michelle")');
  if(control==='header')h.change({id:'header-streamer',value:targetSlug});
  else if(control==='alternate')h.change({name:'streamer-switch',value:targetSlug});
  else h.run('switchStreamer("michelle")');
  assert.equal(h.location.href,computed);assert.equal(new URL(h.location.href).hash,'#book');
  const target=harness(h.location.href);await target.start();
  assert.equal(target.calls.entry,0);assert.equal(target.calls.reads.length,1);assert.deepEqual(target.calls.reads[0],{streamer:targetSlug,route:'book',force:true});
  assert.equal(target.context.route,'book');assert.equal(target.calls.requests.length,0);assert.equal(target.calls.errors.length,0);
  // The return trip also reuses canonical same-Space metadata, not the old
  // origin streamer's URL or identity selectors.
  target.run('switchStreamer("papa")');const back=harness(target.location.href);await back.start();
  assert.equal(back.calls.entry,0);assert.equal(back.context.route,'book');assert.equal(back.calls.reads[0].streamer,'papa');
 }
 const same=harness(mount+'?streamer=papa&spaceId=space-001#book');
 same.run('switchStreamer("papa")');assert.equal(same.location.href,mount+'?streamer=papa&spaceId=space-001#book','selecting current room does not navigate');
});

test('actual common-song navigation hands exactly one target song and request kind to the real startup path',async()=>{
 for(const kind of ['saved','live'])for(const params of ['spaceId=space-001','space=papa-party&spaceId=space-001']){
  const old=mount+'?streamer=papa&'+params+'&entityId=old&notificationId=old&commonRequest=wrong&commonKind=live#common-book';
  const origin=harness(old),songId='原歌/ID? "𝄞';
  await origin.run('commonBookRequest('+JSON.stringify(targetSlug)+','+JSON.stringify(songId)+','+JSON.stringify(kind)+')');
  const destination=new URL(origin.location.href);assert.equal(destination.hash,'#book');assert.equal(destination.searchParams.get('streamer'),targetSlug);
  assert.equal(destination.searchParams.get('commonRequest'),songId);assert.equal(destination.searchParams.get('commonKind'),kind);
  assert.equal(destination.searchParams.has('entityId'),false);assert.equal(destination.searchParams.has('notificationId'),false);
  assert.equal(origin.calls.requests.length,0,'request remains a navigation intent until target startup');
  const target=harness(destination.href);await target.start();
  assert.equal(target.calls.entry,0);assert.deepEqual(target.calls.requests,[{streamer:targetSlug,songId,kind}]);
  assert.equal(new URL(target.location.href).searchParams.has('commonRequest'),false);assert.equal(new URL(target.location.href).searchParams.has('commonKind'),false);
  assert.equal(target.context.pendingCommonRequest,null);assert.equal(target.context.route,'book');
  await target.start();assert.equal(target.calls.requests.length,1,'consumed intent is not replayed on another startup/read');
  const refreshed=harness(target.location.href);await refreshed.start();assert.equal(refreshed.calls.entry,0);assert.equal(refreshed.calls.requests.length,0);
 }
 const plain=harness(mount+'?streamer=papa&spaceId=space-001&commonRequest=old&commonKind=saved#common-book');
 plain.run('commonBookDestination("michelle")');assert.equal(new URL(plain.location.href).hash,'#home');
 assert.equal(new URL(plain.location.href).searchParams.has('commonRequest'),false);assert.equal(requiresSpaceEntry(plain.location.href,mount),false);
});

test('actual unsafe or unknown switch destinations still stop at startup entry before a business read',async()=>{
 const href=mount+'?streamer=papa&spaceId=space-001#book';
 const cases=[
  {slug:'unknown'},
  {directory:[currentRoom,{...rooms[1],active:false}]},
  {directory:[currentRoom,{...rooms[1],spaceId:'space-native'}]},
  {current:{...currentRoom,spaceId:undefined}},
  {directory:[currentRoom,{...rooms[1],spaceId:undefined}]},
  {href:mount+'private/?streamer=papa&spaceId=space-001#book'},
  {href:mount+'?streamer=papa&spaceId=forged#book'},
  {href:mount+'?streamer=other&spaceId=space-001#book',current:currentRoom},
  {mountUrl:'https://foreign.test/app/'}
 ];
 for(const item of cases){
  const original=harness(item.href||href,item);original.run('switchStreamer('+JSON.stringify(item.slug||targetSlug)+')');
  const target=harness(original.location.href,{mountUrl:item.mountUrl||mount});await target.start();
  assert.equal(target.calls.entry,1,JSON.stringify(item));assert.equal(target.calls.reads.length,0);assert.equal(target.calls.requests.length,0);assert.equal(target.calls.errors.length,0);
 }
});

test('actual management selector uses the same scoped destination helper and preserves the president section',async()=>{
 const href=mount+'?streamer=papa&spaceId=space-001&adminTab=songs#admin';
 const own=harness(href,{admin:{role:'streamer_admin',streamerSlug:'papa'},tab:'songs'});own.change({id:'header-streamer',value:targetSlug});
 assert.equal(new URL(own.location.href).hash,'#home');assert.equal(new URL(own.location.href).searchParams.has('adminTab'),false);
 const president=harness(href,{admin:{role:'super_admin'},tab:'songs'});president.change({name:'streamer-switch',value:targetSlug});
 const moved=new URL(president.location.href);assert.equal(moved.hash,'#admin');assert.equal(moved.searchParams.get('adminTab'),'songs');assert.equal(requiresSpaceEntry(moved.href,mount),false);
 const loaded=harness(moved.href,{admin:{role:'super_admin'},tab:'songs'});await loaded.start();assert.equal(loaded.calls.entry,0);assert.equal(loaded.calls.reads[0].route,'admin');
});
