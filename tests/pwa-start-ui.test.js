import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppHomeSettings,currentAppHome} from '../src/pwa-start-ui.js';
import {HOME_KEY,readHome,saveHome} from '../src/pwa-start.js';
const room={id:'papa',spaceId:'space-001',display_name:'怕怕',active:true};
const row={kind:'streamer',spaceId:'space-001',streamerId:'papa',name:'怕怕',spaceName:'聲瑪',active:true};
const later={...row,streamerId:'michelle',name:'米雪'};
function fixture({standalone=true,api=null}={}){
 const items=new Map([['account','keep'],['push','keep']]),storage={getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v)},nodes=[],sources=[],requests=[];
 function element(tag){return {tag,style:{},children:[],attributes:{},value:'',open:false,disabled:false,setAttribute(k,v){this.attributes[k]=v;},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(k,fn){this['on'+k]=fn;},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.removed=true;},reportValidity(){this.invalid=true;}};}
 const document={createElement:element,body:{append:n=>nodes.push(n)}},environment={navigator:{standalone},location:{href:'https://paparty.app/pa'},history:{replaceState(){}}};
 const transport=async body=>{requests.push(body);return api?api(body):body.op==='publicAppHome'?{...row,streamerId:body.streamerId,name:body.streamerId==='michelle'?'米雪':'怕怕'}:{items:[row,later],page:body.page,pageSize:12,total:2,totalPages:1};};
 const settings=createAppHomeSettings({document,environment,storage,mountUrl:'https://paparty.app/',prepareManifest:args=>sources.push(args.source),api:transport});
 const all=()=>{const out=[];const walk=n=>{if(typeof n!=='object')return;out.push(n);n.children.forEach(walk);};nodes.forEach(walk);return out;};
 const find=text=>all().find(n=>n.textContent===text);
 return {settings,items,storage,nodes,sources,requests,all,find};
}
test('browsing another room or logging out only prepares install metadata and never changes saved home',()=>{
 const f=fixture();saveHome(f.storage,row,{source:'user'});const saved=f.items.get(HOME_KEY);
 f.settings.update(room);f.settings.update({...room,id:'michelle',display_name:'米雪'});f.settings.update(null);
 assert.equal(f.items.get(HOME_KEY),saved);assert.equal(f.nodes.length,0);assert.equal(f.requests.length,0);assert.equal(f.sources[1].streamerId,'michelle');assert.equal(f.sources[2],null);assert.equal(f.items.get('account'),'keep');
});
test('settings show names, search public homes and save only the explicitly selected stable identity',async()=>{
 const f=fixture();f.settings.update(room);await f.settings.show();assert.equal(f.find('儲存預設首頁').disabled,true);
 f.find('聲瑪 · 米雪 · 主播').onclick();await f.find('儲存預設首頁').onclick();
 assert.equal(readHome(f.storage).streamerId,'michelle');assert.equal(readHome(f.storage).source,'user');assert.equal(f.items.get('account'),'keep');assert.equal(f.items.get('push'),'keep');assert.ok(f.find('目前設定：聲瑪 · 米雪'));
});
test('scope substitution or a disabled source cannot change a saved preference',async()=>{
 for(const result of [{...row,streamerId:'someone-else'},null]){
  const f=fixture({api:body=>body.op==='publicAppHome'?result:{items:[row],page:1,pageSize:12,total:1,totalPages:1}});f.settings.update(room);await f.settings.show();f.find('選擇目前瀏覽的首頁').onclick();await f.find('儲存預設首頁').onclick();assert.equal(f.items.has(HOME_KEY),false);
 }
});
test('closing while validation is pending prevents a delayed preference write',async()=>{
 let resolve;const pending=new Promise(done=>resolve=done);const f=fixture({api:body=>body.op==='publicAppHome'?pending:{items:[row],page:1,pageSize:12,total:1,totalPages:1}});
 f.settings.update(room);await f.settings.show();f.find('選擇目前瀏覽的首頁').onclick();const saving=f.find('儲存預設首頁').onclick();f.nodes[0].close();resolve(row);await saving;assert.equal(f.items.has(HOME_KEY),false);
});
test('ordinary browser install metadata needs no standalone preference or background search',async()=>{
 const f=fixture({standalone:false});f.settings.update(room);await f.settings.show();assert.equal(f.sources[0].streamerId,'papa');assert.equal(f.nodes.length,0);assert.equal(f.items.size,2);assert.equal(f.requests.length,0);
 assert.equal(currentAppHome({...room,active:false}),null);assert.equal(currentAppHome(room,{enabled:false}),null);
});
test('hall install identity comes from the verified scope and never from its display name',()=>{
 const value=currentAppHome(null,{source:{v:1,kind:'hall',spaceId:'space-X',streamerId:null},name:'任意新廳'});assert.equal(value.spaceId,'space-X');assert.equal(value.kind,'hall');assert.equal(value.streamerId,null);
});
