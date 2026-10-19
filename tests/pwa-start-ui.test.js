import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../src/pwa-start.js';
import {publicApplicationHref} from '../src/public-links.js';
const root='https://paparty.app/',room={id:'r1',slug:'papa',spaceId:'space-001',active:true};
function fixture({standalone=true,href=root+'v2.html?streamer=papa#book',stored={}}={}){
 const items=new Map(Object.entries(stored)),nodes=[],events={},redirects=[];
 const el=tag=>({tag,style:{},children:[],open:false,setAttribute(){},append(...children){this.children.push(...children);},addEventListener(k,fn){this["on"+k]=fn;},showModal(){this.open=true;},close(){this.open=false;},remove(){}});
 const document={createElement:el,addEventListener(k,f){events[k]=f;},querySelector:()=>nodes.find(n=>n.open)||null,body:{append:n=>nodes.push(n)}};
 const location={href,replace:url=>redirects.push(String(url))};
 const context=vm.createContext({...core,URL,window:{navigator:{standalone}},document,location,localStorage:{getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v)},history:{state:null,replaceState:(_a,_b,url)=>location.href=url}});
 const source=fs.readFileSync('src/pwa-start-ui.js','utf8').replace(/^import .*;\r?\n/gm,'').replace("new URL('../',import.meta.url)","new URL('https://paparty.app/')").replaceAll('export function','function');
 vm.runInContext(source,context);
 return {context,items,nodes,redirects,update:(r,href)=>context.updateAppStart(r,href),open:()=>events.click({target:{closest:()=>true}})};
}
test('prompt occurs once, postponing does not change preference, manager can set and reset later',()=>{
 const f=fixture();f.update(room);assert.equal(f.nodes.length,1);
 f.nodes[0].children.find(c=>c.textContent==='稍後再說').onclick();f.update(room);assert.equal(f.nodes.length,1);
 assert.equal(f.items.has(core.PREFERENCE_KEY),false);
 f.open();f.nodes.at(-1).children.find(c=>c.textContent==='將目前頁面設為預設開啟位置').onclick();
 assert.equal(JSON.parse(f.items.get(core.PREFERENCE_KEY)).streamerId,'r1');
 f.open();f.nodes.at(-1).children.find(c=>c.textContent==='恢復為 PA Party 官方首頁').onclick();
 assert.equal(JSON.parse(f.items.get(core.PREFERENCE_KEY)).kind,'portal');
});
test('browser and notification entries do not prompt or change login/push storage',()=>{
 for(const options of [{standalone:false},{href:root+'v2.html?streamer=papa&notificationId=n#center'}]){
  const f=fixture({...options,stored:{login:'keep',push:'keep'}});f.update(room);assert.equal(f.nodes.length,0);
  assert.equal(f.items.get('login'),'keep');assert.equal(f.items.get('push'),'keep');
 }
});
test('saved room mismatch returns once to portal; valid target consumes marker without redirect',()=>{
 const pref=core.pagePreference(root+'v2.html?streamer=papa#book',root,room);
 for(const actual of [room,{...room,id:'other'},null]){
  const f=fixture({href:root+'v2.html?streamer=papa&pwaDefault=1#book',stored:{[core.PREFERENCE_KEY]:JSON.stringify(pref)}});
  f.update(actual);if(actual===room){assert.equal(f.redirects.length,0);assert.equal(new URL(f.context.location.href).searchParams.has('pwaDefault'),false);}
  else assert.deepEqual(f.redirects,[root]);
 }
});


test('verified pretty room and hall pages retain existing device-local launch preferences',()=>{
 const metadata={kind:'streamer',spaceId:room.spaceId,streamerId:room.id,streamerSlug:room.slug,canonicalPath:'/pa',section:'book'};
 const f=fixture({href:root+'pa/book?token=private&player=P1'});
 f.update(room,publicApplicationHref(f.context.location.href,metadata,root));
 assert.equal(f.nodes.length,1);
 f.nodes[0].children.find(c=>c.textContent==='設為預設首頁').onclick();
 const chosen=core.readPreference({getItem:k=>f.items.get(k)},root);
 assert.equal(chosen.kind,'room');assert.equal(chosen.streamerId,room.id);assert.equal(chosen.path,'/v2.html?streamer=papa#book');
 assert.equal(core.launchPlan({href:root+'?appLaunch=1',mount:root,standalone:true,preference:chosen}).target,root+'v2.html?streamer=papa&pwaDefault=1#book');
 assert.equal(f.context.location.href,root+'pa/book?token=private&player=P1','setting preference does not navigate or rewrite the current page');
 const hall=fixture({href:root+'sm?q=search'});hall.update(null,root+'lobby.html');
 assert.equal(hall.nodes.length,1);hall.nodes[0].children.find(c=>c.textContent==='設為預設首頁').onclick();
 assert.equal(core.readPreference({getItem:k=>hall.items.get(k)},root).path,'/lobby.html');
});

test('projected preferences retain native scope guard and targeted-entry prompt suppression',()=>{
 const roomQ={...room,spaceId:'space-Q'},metadata={kind:'streamer',spaceId:roomQ.spaceId,streamerId:roomQ.id,streamerSlug:roomQ.slug,canonicalPath:'/qq.papa',section:'book'};
 const foreign=fixture({href:root+'qq.papa/book'});foreign.update(roomQ,publicApplicationHref(foreign.context.location.href,metadata,root));
 assert.equal(foreign.nodes.length,0);foreign.open();assert.equal(foreign.nodes[0].children.find(c=>c.textContent==='將目前頁面設為預設開啟位置').disabled,true);
 const login=fixture({href:root+'pa/book?portalLogin=player'});login.update(room,publicApplicationHref(login.context.location.href,{...metadata,spaceId:room.spaceId,canonicalPath:'/pa'},root));
 assert.equal(login.nodes.length,0);assert.equal(login.items.has(core.PREFERENCE_KEY),false);
});
