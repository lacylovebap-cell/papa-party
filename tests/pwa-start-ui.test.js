import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../src/pwa-start.js';
const root='https://paparty.app/',room={id:'r1',slug:'papa',spaceId:'space-001',active:true};
function fixture({standalone=true,href=root+'v2.html?streamer=papa#book',stored={}}={}){
 const items=new Map(Object.entries(stored)),nodes=[],events={},redirects=[];
 const el=tag=>({tag,style:{},children:[],open:false,setAttribute(){},append(...children){this.children.push(...children);},addEventListener(k,fn){this["on"+k]=fn;},showModal(){this.open=true;},close(){this.open=false;},remove(){}});
 const document={createElement:el,addEventListener(k,f){events[k]=f;},querySelector:()=>nodes.find(n=>n.open)||null,body:{append:n=>nodes.push(n)}};
 const location={href,replace:url=>redirects.push(String(url))};
 const context=vm.createContext({...core,URL,window:{navigator:{standalone}},document,location,localStorage:{getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v)},history:{state:null,replaceState:(_a,_b,url)=>location.href=url}});
 const source=fs.readFileSync('src/pwa-start-ui.js','utf8').replace(/^import .*\n/,'').replace("new URL('../',import.meta.url)","new URL('https://paparty.app/')").replaceAll('export function','function');
 vm.runInContext(source,context);
 return {context,items,nodes,redirects,update:r=>context.updateAppStart(r),open:()=>events.click({target:{closest:()=>true}})};
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
