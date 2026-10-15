import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pageLocation,pageDestination,streamerDestination} from '../src/streamer-navigation.js';
import {refreshView,rememberView} from '../src/view-refresh.js';

test('reload round-trips each page and exact player/history subview without inheriting unrelated URL selectors',()=>{
 const base='https://paparty.app/?spaceId=space-1&streamer=papa&demo=1#home';
 for(const route of ['home','book','common-book','center','gallery','admin']){
  for(const subtab of ['overview','achievements','ledger','queue']){
   const view={route,tab:'players',subtab,selectedPlayer:'P中文',queueHistory:false};
   const url=pageDestination(base,view),restored=pageLocation(url);
   assert.equal(restored.route,route);
   assert.equal(restored.subtab,route==='center'||route==='admin'?subtab:'overview');
   assert.equal(restored.selectedPlayer,route==='admin'?'P中文':null);
   assert.equal(new URL(url).searchParams.get('spaceId'),'space-1');
  }
 }
 const history=pageLocation(pageDestination(base,{route:'admin',tab:'queue',queueHistory:true}));assert.equal(history.queueHistory,true);
 for(const tab of ['queue','songs','players','ledger','crowns','cards','wishes','stats','events','settings','medals','activity','catalog'])assert.equal(pageLocation(pageDestination(base,{route:'admin',tab})).tab,tab);
 const moved=pageDestination('https://paparty.app/?entityType=queue&entityId=q1&notificationId=n1&adminTab=players&player=P1#admin',{route:'book'});
 assert.equal(/[?&](?:entityType|entityId|notificationId|player|adminTab|tab)=/.test(moved),false,'old notices must not hijack a refreshed page');
 assert.equal(pageLocation(base.replace('#home','#invalid'),'bad').route,'home');
 assert.equal(pageLocation(base+'', 'bad').tab,'queue');
 assert.equal(new URL(streamerDestination(base.replace('#home','#center'),'other',{subtab:'achievements'})).searchParams.get('tab'),'achievements');
});

test('actual tab navigation overwrites stale URL state and browser Back restores the exact subview',async()=>{
 const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const initial='https://paparty.app/?streamer=papa&adminTab=queue#admin',stack=[initial];let reads=0;
 const location={href:initial};
 const ctx=vm.createContext({URL,pageDestination,pageLocation,location,history:{state:null,pushState:(_state,_title,url)=>{stack.push(url);location.href=url;},replaceState:(_state,_title,url)=>{location.href=url;}},
  route:'admin',tab:'queue',subtab:'overview',selectedPlayer:null,queueHistory:false,admin:{role:'super_admin'},session:null,entryPending:false,
  filters:{q:'',tags:[],language:''},pages:{},roomSearch:{generation:0},pendingCommonRequest:null,
  signatures:{},clearTimeout(){},refresh:async()=>{reads++;},render(){},put(){},playerManagement:{setMode(){}},adminQuery:''});
 vm.runInContext(app.slice(app.indexOf('function syncPageLocation('),app.indexOf('const notifications=createNotifications(')),ctx);
 const action=app.slice(app.indexOf("case 'adminTab':"),app.indexOf("case 'activityRefresh':"));
 vm.runInContext('async function choose(id){switch("adminTab"){'+action+'}}',ctx);
 await vm.runInContext('choose("songs")',ctx);
 assert.equal(pageLocation(location.href).tab,'songs');
 vm.runInContext('tab="players";selectedPlayer="P1";subtab="ledger";syncPageLocation(true)',ctx);
 assert.equal(pageLocation(location.href).subtab,'ledger');
 location.href=stack.at(-2);await vm.runInContext('restorePageLocation()',ctx);
 assert.equal(ctx.tab,'songs');assert.equal(ctx.selectedPlayer,null);assert.equal(reads,1);
 assert.equal(location.href,stack.at(-2),'Back must not push another entry');
});

test('background rendering retains scroll and open details but does not restore another view',()=>{
 let current='queue',position,opened;
 const detail=()=>({id:'tags',closest:()=>null,querySelector:()=>({textContent:'篩選'}),open:false});
 const before=detail(),after=detail();let rendered=false;
 const root={dataset:{}},document={querySelector:()=>root,querySelectorAll:selector=>selector.includes('[open]')?[before]:[after]};rememberView(document,'queue');
 const window={scrollX:0,scrollY:640,scrollTo:value=>{position=value;opened=after.open;}};
 refreshView(()=>{rendered=true;},{document,window,viewKey:()=>current});
 assert.equal(rendered,true);assert.equal(position.top,640);assert.equal(opened,true);
 assert.deepEqual(root.dataset,{},'view identities stay in memory and never enter DOM attributes');
 position=null;refreshView(()=>{current='book';},{document,window,viewKey:()=>current});assert.equal(position,null);
 refreshView(()=>{}, {document,window,viewKey:()=>current});assert.equal(position,null,'a newly selected page cannot inherit the old page viewport');
});
