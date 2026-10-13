import {supportsOperationReceipt,sendReceiptedOperation} from '../src/operation-recovery.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWebSyncRecovery} from '../src/web-sync-recovery.js';
import {webApiFailure} from '../src/web-api-errors.js';

// Use the real read/apply/render wiring, including the readiness gate. The
// rendered business views and browser transport are the only substitutes.
const lines=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').split(/\r?\n/);
function declaration(name){
 const start=lines.findIndex(line=>line.startsWith('function '+name+'(')||line.startsWith('async function '+name+'('));assert.ok(start>=0,name);
 if(lines[start].endsWith('}'))return lines[start];
 const end=lines.findIndex((line,index)=>index>start&&line==='}');assert.ok(end>start,name+' closes');return lines.slice(start,end+1).join('\n');
}
const readyStart=lines.findIndex(line=>line.startsWith('let unavailableReadScope='));
const refreshStart=lines.findIndex(line=>line.startsWith('function refresh('));
assert.ok(readyStart>=0&&refreshStart>readyStart,'real application ready/apply declarations');
const lifecycle=lines.filter(line=>/^document\.addEventListener\('(focusout|close)'/.test(line)).join('\n');
const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function harness(){
 const calls=[],renders=[],events=new Map(),app={innerHTML:'existing view'},ui={dialogOpen:false,editing:false,note:'尚未送出',query:'愛情',selection:['song-1']};
 let ctx;
 const view=name=>{app.innerHTML='business-'+name;renders.push(name);};
 ctx=vm.createContext({supportsOperationReceipt,sendReceiptedOperation,crypto,AbortSignal,URL,JSON,Date,queueMicrotask,createWebSyncRecovery,webApiFailure,
  state:{revision:10,songs:[{songId:'existing'}]},full:{revision:10},session:{playerId:'P1',token:'token-1',sessionId:'device-1',role:'player',spaceId:'space-001'},
  admin:null,draft:null,demo:false,entryPending:false,busy:false,route:'home',tab:'queue',selectedPlayer:null,streamerSlug:'papa',
  signatures:{songs:'old-signature'},lastFullRefreshAt:Date.now(),offset:0,API:'https://api.example.test',PUBLISHABLE_KEY:'fixture',
  location:{href:'https://party.example.test/?streamer=papa&spaceId=space-001#home'},navigator:{onLine:true},
  document:{hidden:false,querySelector:selector=>selector==='dialog[open]'&&ui.dialogOpen?{}:null,get activeElement(){return {matches:()=>ui.editing};},addEventListener:(name,callback)=>events.set(name,callback)},
  $:selector=>selector==='#app'?app:null,isAdmin:()=>Boolean(ctx.admin&&ctx.route==='admin'),isSuperAdmin:()=>ctx.admin?.role==='super_admin',
  button:(label,action)=>'<button data-act="'+action+'">'+label+'</button>',header(){},applyHomeTheme(){},prepareNoticeLanding:()=>null,renderNoticeLanding(){},
  nativePlayerView:{open:false},playerArchiveView:{open:false},
  renderHome:()=>view('home'),renderAdmin:()=>view('admin'),renderCenter:()=>view('center'),renderBook:()=>view('book'),renderGallery:()=>view('gallery'),renderCommonBook:()=>view('common'),
  loadVisibleFavoriteFlags(){},loadFavorites(){},loadListeningOverview(){},loadPlayerManagement(){},
  managerSessionExpired:response=>response.status===401,discardManagerSession(){},acceptSessionIdentity(){},put(){},get:()=>null,
  publicView:source=>({revision:source.revision,songs:[{songId:'local'}]}),actor:()=>({role:'manager'}),clock:()=>new Date(),timeValue:value=>Date.parse(value),
  fetch:(_url,options)=>{const request=deferred();calls.push({body:JSON.parse(options.body),...request});return request.promise;}
 });
 vm.runInContext(['api','syncReadIdentity','syncCanRender','updateLiveSyncStatus','readLatestState','render','refresh'].map(declaration).join('\n')+'\n'+lines.slice(readyStart,refreshStart).join('\n')+'\n'+lifecycle+'\nglobalThis.appSync=syncRecovery;',ctx);
 const run=code=>vm.runInContext(code,ctx);
 const respond=(index,data)=>calls[index].resolve({status:200,ok:true,json:async()=>data});
 return {ctx,calls,renders,events,app,ui,run,respond,sync:ctx.appSync,refresh:force=>run('refresh('+Boolean(force)+')')};
}

test('unready player read displays the migration gate and does not expose business views',async()=>{
 const h=harness(),requested=h.refresh(true);await tick();h.respond(0,{ready:false,state:{revision:11,songs:[{songId:'unready-source'}]},signatures:{songs:'unready-signature'}});await requested;
 assert.match(h.app.innerHTML,/歌本整理中/);assert.match(h.app.innerHTML,/管理入口/);assert.deepEqual(h.renders,[]);
 assert.equal(h.ctx.signatures.songs,'old-signature','unready source cannot poison the usable snapshot signature');
});

test('readiness transitions render even when the backend supplies an empty delta',async()=>{
 const h=harness(),unready=h.refresh();await tick();h.respond(0,{ready:false,state:{}});await unready;assert.match(h.app.innerHTML,/歌本整理中/);
 const ready=h.refresh();await tick();h.respond(1,{ready:true,state:{}});await ready;assert.equal(h.app.innerHTML,'business-home');assert.deepEqual(h.renders,['home']);
});

test('readiness replacement preserves an edited form until the actual dialog close lifecycle',async()=>{
 const h=harness();h.ui.dialogOpen=true;h.ui.editing=true;const original=JSON.stringify(h.ui),requested=h.refresh();await tick();h.respond(0,{ready:false,state:{}});await requested;
 assert.equal(h.app.innerHTML,'existing view');assert.equal(JSON.stringify(h.ui),original);assert.equal(h.sync.snapshot().renderPending,true);
 h.events.get('focusout')();await tick();assert.equal(h.app.innerHTML,'existing view','dialog still open blocks focusout rendering');
 h.ui.dialogOpen=false;h.ui.editing=false;h.events.get('close')();await tick();assert.match(h.app.innerHTML,/歌本整理中/);assert.equal(h.ui.note,'尚未送出');assert.equal(h.ui.query,'愛情');assert.deepEqual(h.ui.selection,['song-1']);assert.equal(h.calls.length,1);
});

test('manager migration access remains available despite an unready response',async()=>{
 const h=harness();h.ctx.admin={token:'manager-token',sessionId:'manager-device',role:'super_admin',legacy:true};h.ctx.route='admin';
 const requested=h.refresh(true);await tick();h.respond(0,{ready:false,state:{revision:11,schemaVersion:2}});await requested;
 assert.equal(h.app.innerHTML,'business-admin');assert.equal(h.ctx.state.schemaVersion,2);assert.deepEqual(h.renders,['admin']);
});

test('the old readiness gate cannot carry into a different player or selected Space',async()=>{
 for(const change of [h=>{h.ctx.session={playerId:'P2',token:'token-2',sessionId:'device-2',role:'player',spaceId:'space-001'};},h=>{h.ctx.location.href='https://party.example.test/?streamer=papa&spaceId=space-002#home';}]){
  const h=harness(),requested=h.refresh();await tick();h.respond(0,{ready:false,state:{}});await requested;assert.match(h.app.innerHTML,/歌本整理中/);
  change(h);h.run('render()');assert.equal(h.app.innerHTML,'business-home');
 }
});

test('an old actor unready response is discarded before it can gate the replacement actor',async()=>{
 const h=harness(),requested=h.refresh(true);await tick();h.ctx.session={playerId:'P2',token:'token-2',sessionId:'device-2',role:'player',spaceId:'space-001'};
 h.respond(0,{ready:false,state:{revision:99}});await tick();assert.equal(h.calls.length,2);assert.equal(h.app.innerHTML,'existing view');
 h.respond(1,{ready:true,state:{revision:11}});await requested;assert.equal(h.app.innerHTML,'business-home');assert.equal(h.ctx.state.revision,11);
});

test('older read revisions cannot create or remove the current readiness gate',async()=>{
 const h=harness(),older=h.refresh();await tick();h.respond(0,{ready:false,state:{revision:9}});await older;assert.equal(h.app.innerHTML,'existing view');
 const unready=h.refresh();await tick();h.respond(1,{ready:false,state:{}});await unready;assert.match(h.app.innerHTML,/歌本整理中/);
 const oldReady=h.refresh();await tick();h.respond(2,{ready:true,state:{revision:9}});await oldReady;assert.match(h.app.innerHTML,/歌本整理中/);
});

test('a stored manager draft does not bypass the offline gate on a player route',async()=>{
 const h=harness();h.ctx.draft={state:{revision:10}};h.ctx.navigator.onLine=false;const requested=h.refresh();await tick();
 assert.equal(h.calls.length,0,'player read must pause offline even if an unrelated manager draft is stored');assert.equal(h.sync.snapshot().pending,true);
 h.ctx.navigator.onLine=true;h.sync.resume();await tick();assert.equal(h.calls.length,1);h.respond(0,{ready:true,state:{revision:11}});await requested;assert.equal(h.ctx.state.revision,11);
});

test('an offline manager draft remains locally readable and clears its old player gate',async()=>{
 const h=harness(),requested=h.refresh();await tick();h.respond(0,{ready:false,state:{}});await requested;
 h.ctx.admin={token:'manager-token',sessionId:'manager-device',role:'super_admin',legacy:true};h.ctx.route='admin';h.ctx.draft={state:{revision:12}};h.ctx.navigator.onLine=false;
 await h.refresh(true);assert.equal(h.calls.length,1);assert.equal(h.ctx.state.songs[0].songId,'local');assert.equal(h.app.innerHTML,'business-admin');
});

test('leaving a modified local draft restores the lower formal revision and formal songs',async()=>{
 const h=harness();h.ctx.admin={token:'manager-token',sessionId:'manager-device',role:'super_admin',legacy:true};h.ctx.route='admin';h.ctx.draft={state:{revision:15}};
 await h.refresh(true);assert.equal(h.ctx.state.revision,15);assert.equal(h.ctx.state.songs[0].songId,'local');
 h.ctx.draft=null;const requested=h.refresh(true);await tick();h.respond(0,{ready:true,state:{revision:11,songs:[{songId:'formal-song'}]},signatures:{songs:'formal-signature'}});await requested;
 assert.equal(h.ctx.state.revision,11);assert.equal(h.ctx.state.songs[0].songId,'formal-song');assert.equal(h.ctx.signatures.songs,'formal-signature');
});

test('returning to a saved draft may restore its own older revision without mixing formal songs',async()=>{
 const h=harness();h.ctx.admin={token:'manager-token',sessionId:'manager-device',role:'super_admin',legacy:true};h.ctx.route='admin';
 const requested=h.refresh(true);await tick();h.respond(0,{ready:true,state:{revision:11,songs:[{songId:'formal-song'}]}});await requested;
 h.ctx.draft={state:{revision:10}};await h.refresh(true);assert.equal(h.ctx.state.revision,10);assert.equal(h.ctx.state.songs[0].songId,'local');
});
