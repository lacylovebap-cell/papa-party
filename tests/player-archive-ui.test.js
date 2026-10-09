import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createPlayerManager} from '../src/player-manager.js';
import {eventDescription} from '../src/catalog-tools.js';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const line=prefix=>source.split(/\r?\n/).find(row=>row.startsWith(prefix));
const setup=source.slice(source.indexOf('function playerManagementContext()'),source.indexOf('const songFavorites='));
const helpers=source.slice(source.indexOf('function loadPlayerManagement('),source.indexOf("let songCatalogStatusFilter="));
const plain=value=>JSON.parse(JSON.stringify(value));
const escape=value=>String(value??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

function harness({respond,confirm=true}={}){
 const calls=[],messages=[],counts={render:0},nodes=new Map(),listeners=new Map();
 let context;
 const dialog={open:true,addEventListener:(event,fn)=>listeners.set(event,fn),close:()=>{dialog.open=false;listeners.get('close')?.();}};
 context=vm.createContext({JSON,Map,Set,Promise,structuredClone,createPlayerManager,
  admin:{role:'super_admin',accountId:'president-a',streamer_id:null},demo:false,draft:null,
  state:{revision:7,currentStreamer:{spaceId:'space-001',id:'papa'},players:[{playerId:'P1',name:'<A>',ids:['a'],archived:false}],queue:[{id:'Q',status:'completed'}],ledger:[{id:'L',amount:4}]},
  route:'admin',tab:'players',selectedPlayer:null,streamerSlug:'papa',
  isSuperAdmin:()=>context.admin?.role==='super_admin',isAdmin:()=>!!context.admin,
  h:escape,blank:label=>'<p>'+escape(label)+'</p>',button:(label,action,id='',cls='',extra='')=>'<button data-act="'+action+'" data-id="'+escape(id)+'" '+extra+'>'+label+'</button>',
  confirm:()=>confirm,toast:message=>messages.push(message),render:()=>counts.render++,
  $:selector=>selector==='#dialog'?dialog:nodes.get(selector)||null,
  modal:()=>{dialog.open=true;nodes.set('#player-archive-panel',{innerHTML:''});},
  playerManagementPanel:()=>'',api:body=>{calls.push(plain(body));return respond?respond(body):Promise.resolve(body.op==='playerArchive'?{revision:8,playerId:body.playerId,archived:body.archived,changed:true}:{rows:[{playerId:'P1',name:'<A>',ids:['a'],storedCredits:4}],total:1});}
 });
 vm.runInContext(setup+helpers+'\n'+line('function playerOptions('),context);
 return {context,calls,messages,counts,nodes,dialog,run:code=>vm.runInContext(code,context)};
}

test('archive uses one explicit mutation, preserves existing records and avoids a full refresh',async()=>{
 const u=harness();const queue=plain(u.context.state.queue),ledger=plain(u.context.state.ledger);
 await u.run("changePlayerArchived('P1',true)");
 assert.deepEqual(u.calls,[{op:'playerArchive',playerId:'P1',archived:true,revision:7,management:true}]);
 assert.equal(u.context.state.players[0].archived,true);assert.equal(u.context.state.revision,8);
 assert.deepEqual(plain(u.context.state.queue),queue);assert.deepEqual(plain(u.context.state.ledger),ledger);assert.equal(u.counts.render,1);
 assert.deepEqual(plain(u.run('playerOptions()')),[['','請選玩家']]);
 assert.deepEqual(plain(u.run("playerOptions('P1')")),[['','請選玩家'],['P1','<A> · a']]);
 assert.equal(u.run('playerArchiveView.pending.size'),0);
});

test('ordinary managers, unsigned presidents, previews and cancelled confirmations cannot mutate',async()=>{
 for(const admin of [null,{role:'streamer_admin',accountId:'a'},{role:'super_admin'}]){const u=harness();u.context.admin=admin;await assert.rejects(u.run("changePlayerArchived('P1',true)"));assert.equal(u.calls.length,0);}
 for(const flag of ['demo','draft']){const u=harness();u.context[flag]=true;await assert.rejects(u.run("changePlayerArchived('P1',true)"));assert.equal(u.calls.length,0);}
 const u=harness({confirm:false});await u.run("changePlayerArchived('P1',true)");assert.equal(u.calls.length,0);assert.equal(u.context.state.revision,7);
});

test('concurrent clicks coalesce and changed Account, role or Space cannot apply old responses',async()=>{
 for(const change of [ctx=>ctx.admin={...ctx.admin,accountId:'president-b'},ctx=>ctx.admin=null,ctx=>ctx.admin={...ctx.admin,role:'streamer_admin'},ctx=>ctx.state.currentStreamer.spaceId='space-b',ctx=>ctx.state.currentStreamer.id='michelle']){
  let resolve;const u=harness({respond:()=>new Promise(done=>resolve=done)});
  const first=u.run("changePlayerArchived('P1',true)");await u.run("changePlayerArchived('P1',true)");assert.equal(u.calls.length,1);
  change(u.context);resolve({revision:8,playerId:'P1',archived:true,changed:true});await first;
  assert.equal(u.context.state.players[0].archived,false);assert.equal(u.context.state.revision,7);assert.equal(u.counts.render,0);assert.equal(u.run('playerArchiveView.pending.size'),0);
 }
});

test('newer authoritative revisions and malformed replies never overwrite current player flags',async()=>{
 let resolve;const u=harness({respond:()=>new Promise(done=>resolve=done)});const pending=u.run("changePlayerArchived('P1',true)");u.context.state.revision=9;resolve({revision:8,playerId:'P1',archived:true,changed:true});await pending;assert.equal(u.context.state.players[0].archived,false);assert.equal(u.context.state.revision,9);
 for(const result of [{revision:6,playerId:'P1',archived:true,changed:true},{revision:8,playerId:'P2',archived:true,changed:true},{revision:8,playerId:'P1',archived:false,changed:true},{revision:8,playerId:'P1',archived:true}]){const bad=harness({respond:async()=>result});await assert.rejects(bad.run("changePlayerArchived('P1',true)"),/結果不正確/);assert.equal(bad.context.state.revision,7);assert.equal(bad.context.state.players[0].archived,false);}
});

test('archive modal reuses the bounded manager controller and restore reloads only its page',async()=>{
 const u=harness();await u.run('openPlayerArchives()');assert.equal(u.calls.length,1);
 assert.deepEqual(u.calls[0],{op:'playerManagementPage',mode:'all',query:'',page:0,limit:20,archived:true,management:true});
 const html=u.run('archivedPlayersPanel()');assert.match(html,/&lt;A&gt;/);assert.match(html,/恢復玩家/);assert.match(html,/共 1 位/);
 u.context.state.players[0].archived=true;await u.run("changePlayerArchived('P1',false)");assert.equal(u.context.state.players[0].archived,false);assert.equal(u.calls.length,3);assert.equal(u.calls[2].op,'playerManagementPage');assert.equal(u.counts.render,0);
 u.dialog.close();assert.equal(u.run('playerArchiveView.open'),false);assert.equal(u.counts.render,1);
});

test('closing archive modal or changing identity before dispatch prevents unused page reads',async()=>{
 for(const change of [u=>u.dialog.close(),u=>u.context.admin=null,u=>u.context.admin={...u.context.admin,accountId:'president-b'}]){
  const u=harness();const pending=u.run('openPlayerArchives()');change(u);await pending;assert.equal(u.calls.length,0);
 }
});

test('archive errors leave source data unchanged and surface an explicit retry',async()=>{
 const u=harness({respond:async body=>{if(body.op==='playerArchive')throw Error('仍有待播歌曲');throw Error('連線失敗');}});
 await assert.rejects(u.run("changePlayerArchived('P1',true)"),/待播/);assert.equal(u.context.state.revision,7);assert.equal(u.context.state.players[0].archived,false);assert.equal(u.run('playerArchiveView.pending.size'),0);
 await u.run('openPlayerArchives()');assert.match(u.run('archivedPlayersPanel()'),/連線失敗/);assert.match(u.run('archivedPlayersPanel()'),/重新讀取/);assert.equal(u.calls.length,2);
});

test('archive summaries use retained player names without raw identifiers',()=>{
 for(const action of ['playerArchive','playerRestore']){
  const event={entity_kind:'players',action,actor_role:'president',target_player_name_snapshot:'小明',after_data:{playerId:'secret-id',archived:action==='playerArchive'}};
  assert.equal(eventDescription(event),'PA Party總裁'+(action==='playerArchive'?'封存':'恢復')+'了玩家小明');
  const context={...event,action:undefined,actor_context:{action}};assert.equal(eventDescription(context),eventDescription(event));
 }
});
