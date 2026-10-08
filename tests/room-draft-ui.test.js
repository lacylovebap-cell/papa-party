import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {empty,mutate,publicView} from '../src/core.js';
import {createRoomDraft,recordRoomDraftAction,recordRoomDraftImport,replayRoomDraft} from '../src/room-draft.js';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),at='2026-10-09T04:00:00.000Z';
function page(){
 const full=mutate(empty(),{type:'song',data:{title:'Existing',artist:'Artist'}},{role:'admin'},at);full.revision=7;
 const writes=[],requests=[],backups=[];
 const c=vm.createContext({structuredClone,Error,createRoomDraft,recordRoomDraftAction,recordRoomDraftImport,mutate,publicView,
  full,state:publicView(full,{role:'admin'},at,'papa'),draft:{state:full,journal:createRoomDraft(full,'papa'),baseRevision:7},demo:false,busy:false,
  streamerSlug:'papa',actor:()=>({role:'admin'}),isAdmin:()=>true,clock:()=>at,put:(key,value)=>writes.push({key,value:structuredClone(value)}),
  notifications:{localChange:()=>{},refresh:async()=>{}},invalidateCatalogTabs:()=>{},render:()=>{},toast:()=>{},confirm:()=>true,
  refresh:async()=>{},backup:(value,name)=>backups.push({value:structuredClone(value),name}),
  api:async body=>{requests.push(body);throw Error('unexpected request');}});
 const fn=name=>source.split('\n').find(line=>line.startsWith('async function '+name+'('));
 vm.runInContext(fn('dispatch'),c);vm.runInContext(fn('executeImport'),c);
 for(const name of ['draft','publish']){const line=source.split('\n').find(line=>line.startsWith("case '"+name+"':"));vm.runInContext('async function '+name+'Event(){'+line.replace("case '"+name+"':",'').replace(/break;\s*$/,'')+'}',c);}
 return {c,writes,requests,backups,full};
}

test('draft UI journals edits/imports and preserves stable dependent IDs without network writes',async()=>{
 const {c,writes,requests,full}=page();
 await c.dispatch('player',{name:'Created',balance:2});const player=c.full.players.at(-1);
 await c.dispatch('onBehalf',{songId:full.songs[0].songId,playerId:player.playerId,kind:'saved'});
 c.importKind='songs';c.importText='Imported｜Artist';c.importRows=[{}];
 c.$=selector=>selector==='#dialog'?{close:()=>{}}:{value:'add'};
 await c.executeImport();
 assert.equal(c.draft.journal.actions.length,3);assert.equal(c.draft.journal.baseRevision,7);assert.equal(c.draft.state.players.at(-1).playerId,player.playerId);
 assert.deepEqual(JSON.parse(JSON.stringify(replayRoomDraft(full,c.draft.journal,{role:'admin'},at))),JSON.parse(JSON.stringify(c.full)));
 assert.equal(requests.length,0);assert.equal(writes.filter(row=>row.key==='draft').length,3);assert.equal(c.busy,false);
});

test('new draft uses server source revision and publishes only the journal after preserving a backup',async()=>{
 const {c,requests,backups,full}=page();c.draft=null;c.state.revision=99;
 c.api=async body=>{requests.push(body);if(body.op==='draftStart')return {draft:{state:structuredClone(full),journal:createRoomDraft(full,'papa'),baseRevision:7}};
  assert.equal(body.op,'publish');assert.equal(body.revision,7);assert.equal(body.baseRevision,7);assert.equal(Object.hasOwn(body,'state'),false);assert.equal(body.journal.actions.length,1);return {state:{revision:8}};};
 await c.draftEvent();assert.equal(c.draft.baseRevision,7);await c.dispatch('song',{title:'Added',artist:'Artist'});
 await c.publishEvent();assert.deepEqual(requests.map(row=>row.op),['draftStart','publish']);assert.equal(backups.length,1);assert.equal(backups[0].name,'before-publish');assert.equal(c.draft,null);
});

test('old unjournalled drafts remain recoverable and cannot mutate or publish unvalidated state',async()=>{
 const {c,requests,backups,full}=page();c.draft={state:structuredClone(full),baseRevision:7};
 await assert.rejects(c.dispatch('song',{title:'Should not save',artist:'Artist'}),/下載備份/);assert.equal(c.busy,false);
 await assert.rejects(c.publishEvent(),/下載備份/);assert.equal(requests.length,0);assert.equal(backups.length,0);assert.equal(c.draft.state.revision,7);
});
