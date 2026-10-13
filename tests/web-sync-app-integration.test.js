import {supportsOperationReceipt,sendReceiptedOperation} from '../src/operation-recovery.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWebSyncRecovery} from '../src/web-sync-recovery.js';
import {webApiFailure} from '../src/web-api-errors.js';

// Exercise the application's real API/read/apply/dispatch wiring, rather than
// a copy of it. Only transport, rendering and the surrounding browser are fake.
const lines=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').split(/\r?\n/);
function declaration(name){
 const start=lines.findIndex(line=>line.startsWith('function '+name+'(')||line.startsWith('async function '+name+'('));assert.ok(start>=0,name);
 if(lines[start].endsWith('}'))return lines[start];
 const end=lines.findIndex((line,index)=>index>start&&line==='}');assert.ok(end>start,name+' closes');return lines.slice(start,end+1).join('\n');
}
const syncStart=lines.findIndex(line=>line.startsWith('let unavailableReadScope='));
const unavailableReadStart=lines.findIndex(line=>line.startsWith('let unavailableReadScope='));
const syncDeclarationStart=unavailableReadStart>=0?Math.min(syncStart,unavailableReadStart):syncStart;
const syncEnd=lines.findIndex((line,index)=>index>syncStart&&line.startsWith('function refresh('));
assert.ok(syncStart>=0&&syncEnd>syncStart,'application sync coordinator declaration');
const noticeLine=lines.find(line=>line.startsWith('const notifications=createNotifications('));
const noticeCallback=noticeLine.slice(noticeLine.indexOf('onUpdate:')+'onUpdate:'.length,noticeLine.lastIndexOf('});'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(setImmediate);
function harness(){
 const calls=[],renders=[],adoptions=[],storage=[],timers=new Map(),notices=[],chats=[],achievementReads=[];
 const ui={dialogOpen:false,editing:false,form:{query:'愛情',note:'尚未送出',selected:['song-1']}};let timerId=0;
 let ctx;
 ctx=vm.createContext({supportsOperationReceipt,sendReceiptedOperation,crypto,AbortSignal,URL,JSON,Date,structuredClone,queueMicrotask,webApiFailure,
  createWebSyncRecovery:options=>createWebSyncRecovery({...options,schedule:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},cancel:id=>timers.delete(id)}),
  state:{revision:10,currentStreamer:{id:'server-room-id',spaceId:'space-001'},songs:[{songId:'original'}]},full:null,
  session:{playerId:'P1',token:'player-token-one',sessionId:'device-one',role:'player',spaceId:'space-001'},admin:null,draft:null,demo:false,entryPending:false,busy:false,route:'home',selectedPlayer:null,
  signatures:{songs:'original-signature'},offset:0,lastFullRefreshAt:Date.now(),streamerSlug:'papa',API:'https://api.example.test/functions/v1/party-api',PUBLISHABLE_KEY:'public-fixture',
  location:{href:'https://party.example.test/?streamer=papa&spaceId=space-001#home'},navigator:{onLine:true},
  document:{hidden:false,querySelector:selector=>selector==='dialog[open]'&&ui.dialogOpen?{}:null,get activeElement(){return {matches:()=>ui.editing};}},
  isAdmin:()=>Boolean(ctx.admin&&ctx.route==='admin'),managerSessionExpired:(response,data)=>response.status===401||data?.code==='AUTH_EXPIRED',
  discardManagerSession:()=>{ctx.admin=null;},acceptSessionIdentity:(actor,verified)=>adoptions.push({actor,verified}),put:(name,value)=>storage.push({name,value}),
  get:()=>null,actor:()=>({role:'player'}),clock:()=>new Date(),publicView:()=>({revision:10}),timeValue:value=>Date.parse(value),
  render:()=>{renders.push(ctx.state.revision);ui.form.query='';ui.form.note='';ui.form.selected=[];},invalidateCatalogTabs(){},
  notifications:{localChange(){},refresh:async()=>{notices.push('refresh');}},
  chat:{refresh:async()=>{chats.push('refresh');}},achievementPanel:{load:async force=>achievementReads.push(force)},
  fetch:(_url,options)=>{const request=deferred();calls.push({body:JSON.parse(options.body),...request});return request.promise;}
 });
 vm.runInContext(['api','syncReadIdentity','syncCanRender','updateLiveSyncStatus','readLatestState','refresh','dispatch'].map(declaration).join('\n')+'\n'+lines.slice(syncDeclarationStart,syncEnd).join('\n')+'\nglobalThis.appSync=syncRecovery;globalThis.noticeCallback='+noticeCallback+';',ctx);
 const run=code=>vm.runInContext(code,ctx);
 const respond=(index,data,status=200)=>calls[index].resolve({status,ok:status>=200&&status<300,json:async()=>data});
 return {ctx,calls,renders,adoptions,storage,timers,notices,chats,achievementReads,ui,run,respond,sync:ctx.appSync,
  refresh:force=>run('refresh('+Boolean(force)+')'),dispatch:()=>run("dispatch('request',{songId:'song-1',kind:'saved'})")};
}

for(const replacement of [null,{playerId:'P2',token:'player-token-two',sessionId:'device-two',role:'player',spaceId:'space-001'}]){
 test(`an old player's in-flight write success after ${replacement?'replacement login':'logout'} cannot adopt state, signatures or identity`,async()=>{
  const h=harness(),requested=h.dispatch(),rejected=assert.rejects(requested,/已變更/);await tick();assert.equal(h.calls.length,1);
  h.ctx.session=replacement;h.respond(0,{state:{revision:50,songs:[{songId:'private-old-player'}]},signatures:{songs:'old-response'},sessionIdentity:{accountId:'old-account'},now:'2099-01-01T00:00:00Z'});await rejected;await tick();
  assert.equal(h.ctx.state.revision,10);assert.equal(h.ctx.state.songs[0].songId,'original');assert.equal(h.ctx.signatures.songs,'original-signature');assert.equal(h.ctx.offset,0);assert.equal(h.adoptions.length,0);assert.equal(h.renders.length,0);assert.equal(h.calls.length,1);
 });
}

test('an older read cannot replace a newer mutation state or poison its signatures',async()=>{
 const h=harness(),requested=h.refresh();await tick();assert.equal(h.calls[0].body.op,'read');
 h.ctx.state={...h.ctx.state,revision:12,songs:[{songId:'new-mutation'}]};h.ctx.signatures={songs:'mutation-signature'};
 h.respond(0,{state:{revision:11,songs:[{songId:'old-read'}]},signatures:{songs:'old-read-signature'}});await requested;
 assert.equal(h.ctx.state.revision,12);assert.equal(h.ctx.state.songs[0].songId,'new-mutation');assert.equal(h.ctx.signatures.songs,'mutation-signature');assert.equal(h.renders.length,0);
});

test('a delayed delta read without a revision cannot poison newer mutation signatures',async()=>{
 const h=harness(),requested=h.refresh();await tick();assert.equal(h.calls[0].body.revision,10);
 h.ctx.state={...h.ctx.state,revision:12,songs:[{songId:'new-mutation'}]};h.ctx.signatures={songs:'mutation-signature',revision:'revision-12'};
 // The server hashes each field and may omit an unchanged revision from its
 // delta. Its signatures still describe the old snapshot taken before write.
 h.respond(0,{state:{},signatures:{songs:'old-read-signature',revision:'revision-10'}});await requested;
 assert.equal(h.ctx.state.revision,12);assert.equal(h.ctx.signatures.songs,'mutation-signature');assert.equal(h.ctx.signatures.revision,'revision-12');assert.equal(h.renders.length,0);
});

test('old account read completion is discarded and its caller waits for a new account scoped read',async()=>{
 const h=harness(),requested=h.refresh(true);await tick();h.ctx.session={playerId:'P2',token:'player-token-two',sessionId:'device-two',role:'player',spaceId:'space-001'};
 h.respond(0,{state:{revision:50,songs:[{songId:'old-private-song'}]},signatures:{songs:'old-account-signature'},sessionIdentity:{accountId:'old-account'}});await tick();
 assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.profilePlayerId,'P2');assert.equal(h.ctx.state.revision,10);assert.equal(h.ctx.signatures.songs,'original-signature');assert.equal(h.adoptions.length,0);
 h.respond(1,{state:{revision:12,songs:[{songId:'new-account-song'}]},signatures:{songs:'new-account-signature'}});await requested;
 assert.equal(h.ctx.state.songs[0].songId,'new-account-song');assert.equal(h.ctx.signatures.songs,'new-account-signature');assert.equal(h.renders.length,1);
});

test('read scope stays stable when server metadata supplies a room ID/account enrichment, but follows the selected URL Space',async()=>{
 const h=harness(),original=h.run('syncReadIdentity()');h.ctx.state.currentStreamer={id:'different-server-derived-id',spaceId:'space-999'};h.ctx.session.accountId='newly-enriched-account';
 assert.equal(h.run('syncReadIdentity()'),original,'derived server metadata cannot discard its own response');
 h.ctx.location.href='https://party.example.test/?streamer=papa&spaceId=space-002#home';assert.notEqual(h.run('syncReadIdentity()'),original,'URL Space remains part of the request scope');
});

test('state reads and signatures apply while a dialog is edited without changing its live form contents',async()=>{
 const h=harness();h.ui.dialogOpen=true;h.ui.editing=true;const original=JSON.stringify(h.ui.form),requested=h.refresh();await tick();
 h.respond(0,{state:{revision:11,songs:[{songId:'updated'}]},signatures:{songs:'updated-signature'}});await requested;
 assert.equal(h.ctx.state.revision,11);assert.equal(h.ctx.signatures.songs,'updated-signature');assert.equal(JSON.stringify(h.ui.form),original);assert.equal(h.renders.length,0);assert.equal(h.sync.snapshot().renderPending,true);
 assert.equal(h.sync.flushRender(),false);h.ui.dialogOpen=false;h.ui.editing=false;assert.equal(h.sync.flushRender(),true);assert.deepEqual(h.renders,[11]);assert.equal(h.sync.flushRender(),false);
});

test('a confirmed revision rejection invalidates only reads and never replays the mutation or erases form input',async()=>{
 const h=harness();h.ui.dialogOpen=true;h.ui.editing=true;const original=JSON.stringify(h.ui.form),write=h.dispatch(),rejected=assert.rejects(write,/原本內容已保留/);await tick();
 h.respond(0,{code:'VERSION_CONFLICT',error:'資料剛更新了，請重新整理後再試一次',notCommitted:true},409);await rejected;await tick();
 assert.equal(h.calls.filter(call=>call.body.op==='mutate').length,1);assert.equal(h.calls.filter(call=>call.body.op==='read').length,1,'busy release resumes the pending read invalidation');
 assert.equal(JSON.stringify(h.ui.form),original);h.respond(1,{state:{revision:11,songs:[{songId:'new-server-state'}]},signatures:{songs:'new-server-signature'}});await tick();
 assert.equal(h.ctx.state.revision,11);assert.equal(JSON.stringify(h.ui.form),original);assert.equal(h.calls.filter(call=>call.body.op==='mutate').length,1);assert.equal(h.renders.length,0);
});

test('a read resolving during a busy mutation is discarded and resumes once the write releases the busy gate',async()=>{
 const h=harness(),requested=h.refresh();await tick();const write=h.dispatch();await tick();
 h.respond(0,{state:{revision:11,songs:[{songId:'read-before-write'}]},signatures:{songs:'read-before-write'}});await tick();assert.equal(h.ctx.state.revision,10);assert.equal(h.renders.length,0);
 h.respond(1,{state:{revision:12,songs:[{songId:'mutation-state'}]},signatures:{songs:'mutation-signature'}});await write;await tick();
 assert.equal(h.calls.length,3,'the pending read restarts after busy=false');assert.equal(h.calls[2].body.op,'read');assert.equal(h.calls[2].body.revision,12);
 h.respond(2,{state:{revision:12},signatures:{songs:'fresh-signature'}});await requested;assert.equal(h.ctx.state.songs[0].songId,'mutation-state');assert.equal(h.ctx.signatures.songs,'fresh-signature');assert.equal(h.calls.filter(call=>call.body.op==='mutate').length,1);
});

test('an uncertain transport write failure never schedules a mutation replay or a misleading revision retry',async()=>{
 const h=harness();h.ui.dialogOpen=true;h.ui.editing=true;
 const write=h.dispatch(),rejected=assert.rejects(write,/結果尚未確認/);await tick();h.calls[0].reject(Error('transport interrupted'));await tick();
 assert.equal(h.calls[1].body.op,'operationReceipt');h.respond(1,{committed:false});await rejected;await tick();
 assert.equal(h.calls.length,3);assert.equal(h.calls[2].body.op,'read');h.respond(2,{state:{revision:10},signatures:{songs:'original-signature'}});await tick();
 assert.equal(h.calls.filter(c=>c.body.op==='mutate').length,1);assert.equal(h.timers.size,0);assert.equal(h.sync.snapshot().pending,false);assert.equal(h.ctx.state.revision,10);assert.equal(h.ui.form.note,'尚未送出');
});

test('fresh notice routing reads only the affected business area and still updates state while a dialog is open',async()=>{
 const h=harness();h.ui.dialogOpen=true;h.ui.editing=true;
 h.run("noticeCallback([{type:'achievement'},{type:'comment'},{type:'announcement'},{type:'system'}])");await tick();assert.equal(h.calls.length,0);assert.equal(h.chats.length,0);assert.deepEqual(h.achievementReads,[true]);
 h.run("noticeCallback([{type:'message'}])");await tick();assert.equal(h.chats.length,1);assert.equal(h.calls.length,0,'private messages do not fetch the whole business view');
 const original=JSON.stringify(h.ui.form);h.run("noticeCallback([{type:'ready'},{type:'completed'},{type:'credit'}])");await tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.op,'read');assert.equal(h.chats.length,1);
 h.respond(0,{state:{revision:11,queue:[{id:'fresh-queue'}]},signatures:{queue:'fresh-queue-signature'}});await tick();assert.equal(h.ctx.state.revision,11);assert.equal(h.ctx.state.queue[0].id,'fresh-queue');assert.equal(JSON.stringify(h.ui.form),original);assert.equal(h.renders.length,0);assert.equal(h.sync.snapshot().renderPending,true);
});
