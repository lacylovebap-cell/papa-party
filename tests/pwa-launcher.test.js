import test from 'node:test';
import assert from 'node:assert/strict';
import {createPwaLauncher,publicHomeRow} from '../src/pwa-launcher.js';
import {HOME_KEY,PREFERENCE_KEY,saveHome,readHome} from '../src/pwa-start.js';
import {encodeInstallSource} from '../src/pwa-install-source.js';
const mount='https://paparty.app/';
const papa={v:1,kind:'streamer',spaceId:'space-001',streamerId:'s1'},snow={v:1,kind:'streamer',spaceId:'space-001',streamerId:'s2'},hall={v:1,kind:'hall',spaceId:'space-001',streamerId:null};
const rows=[{...papa,name:'怕怕',spaceName:'聲瑪',streamerSlug:'papa',canonicalPath:'/pa',homePath:'/pa',active:true},{...snow,name:'米雪',spaceName:'聲瑪',streamerSlug:'snow',canonicalPath:null,homePath:'/v2.html?streamer=snow#home',active:true},{...hall,name:'聲瑪',spaceName:'聲瑪',streamerSlug:null,canonicalPath:'/sm',homePath:'/sm',active:true}];
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};};
const same=(a,b)=>a.kind===b.kind&&a.spaceId===b.spaceId&&a.streamerId===b.streamerId;
function fixture({source=null,store=storage(),handler}={}){
 const calls=[],targets=[],states=[];const api=async body=>{calls.push(body);if(handler)return handler(body);if(body.op==='publicAppHome')return rows.find(row=>same(row,body))||null;return {items:rows,page:body.page,pageSize:12,total:3,totalPages:1};};
 const href=mount+'app.html'+(source?'?install='+encodeInstallSource(source):'');
 return {store,calls,targets,states,launcher:createPwaLauncher({api,storage:store,mount,href,navigate:url=>targets.push(url),render:value=>states.push(value)})};
}
test('install source initializes Android/iOS fresh isolated storage and survives repeated starts',async()=>{
 for(const source of [papa,snow,hall]){const f=fixture({source});await f.launcher.start();assert.equal(f.targets.length,1);assert.deepEqual({...readHome(f.store),name:undefined,spaceName:undefined},{...source,v:2,name:undefined,spaceName:undefined,source:'install'});const restarted=fixture({store:f.store});await restarted.launcher.start();assert.equal(restarted.targets[0],f.targets[0]);assert.equal(f.calls.length,1);}
});
test('manual user preference wins over original source and no temporary browsing/logout changes it',async()=>{
 const f=fixture({source:papa});await f.launcher.start();await f.launcher.select(snow,{enter:false});assert.equal(readHome(f.store).source,'user');const saved=f.store.getItem(HOME_KEY);f.store.removeItem('papa.login.player');await f.launcher.start();assert.equal(f.targets.at(-1),mount+'v2.html?streamer=snow#home');assert.equal(f.store.getItem(HOME_KEY),saved);assert.equal(f.store.values.size,1);
});
test('no source and former portal preference show in-app chooser, never sales root',async()=>{
 for(const legacy of [null,{version:1,kind:'portal',path:'/'}]){const f=fixture({source:legacy?papa:null});if(legacy)f.store.setItem(PREFERENCE_KEY,JSON.stringify(legacy));await f.launcher.start();assert.equal(f.launcher.snapshot().phase,'chooser');assert.equal(f.targets.length,0);assert.equal(f.store.getItem(HOME_KEY),null);assert.deepEqual(f.calls.map(call=>call.op),['publicAppHomes']);}
});
test('old v1 room migrates stable identity to homepage without changing old preference or other storage',async()=>{
 const f=fixture({source:snow}),legacy={version:1,kind:'room',spaceId:papa.spaceId,streamerId:papa.streamerId,slug:'papa',path:'/v2.html?streamer=papa&tab=medals#center'};f.store.setItem(PREFERENCE_KEY,JSON.stringify(legacy));f.store.setItem('papa.account.token','untouched');await f.launcher.start();assert.equal(f.targets[0],mount+'pa');assert.equal(readHome(f.store).source,'legacy');assert.deepEqual(JSON.parse(f.store.getItem(PREFERENCE_KEY)),legacy);assert.equal(f.store.getItem('papa.account.token'),'untouched');
});
test('old hall preference migrates existing hall identity and route renames resolve latest server path',async()=>{
 const f=fixture();f.store.setItem(PREFERENCE_KEY,JSON.stringify({version:1,kind:'lobby',path:'/lobby.html'}));await f.launcher.start();assert.equal(f.targets[0],mount+'sm');assert.equal(readHome(f.store).kind,'hall');
 const g=fixture({handler:body=>body.op==='publicAppHome'?{...rows[0],canonicalPath:'/papa520',homePath:'/papa520'}:null});saveHome(g.store,rows[0]);await g.launcher.start();assert.equal(g.targets[0],mount+'papa520');
});
test('inactive or unauthorized explicit default opens chooser without erasing or reinstall-source override',async()=>{
 const f=fixture({source:snow,handler:body=>body.op==='publicAppHome'?null:{items:[rows[1]],page:1,pageSize:12,total:1,totalPages:1}});saveHome(f.store,rows[0]);const before=f.store.getItem(HOME_KEY);await f.launcher.start();assert.equal(f.launcher.snapshot().phase,'chooser');assert.equal(f.targets.length,0);assert.equal(f.store.getItem(HOME_KEY),before);assert.match(f.launcher.snapshot().message,/原本的首頁/);
});
test('timeout/offline preserves preference, offers retry, does not misclassify as inactive or query directory',async()=>{
 let online=false;const f=fixture({handler:()=>{if(!online)throw Error('offline');return rows[0];}});saveHome(f.store,rows[0]);const before=f.store.getItem(HOME_KEY);await f.launcher.start();assert.equal(f.launcher.snapshot().phase,'error');assert.equal(f.launcher.snapshot().retryable,true);assert.equal(f.store.getItem(HOME_KEY),before);assert.deepEqual(f.calls.map(call=>call.op),['publicAppHome']);online=true;await f.launcher.retry();assert.equal(f.targets[0],mount+'pa');
});
test('chooser search/page is bounded and requested only by explicit start/search, no polling or all-history query',async()=>{
 const f=fixture({handler:body=>({items:[rows[0]],page:body.page,pageSize:12,total:30,totalPages:3})});await f.launcher.start();await f.launcher.search({q:'雪',kind:'streamer',page:2});assert.deepEqual(f.calls.at(-1),{op:'publicAppHomes',q:'雪',kind:'streamer',page:2,pageSize:12});assert.equal(f.calls.length,2);assert.equal(f.launcher.snapshot().totalPages,3);await assert.rejects(f.launcher.search({page:0}),/頁碼/);assert.equal(f.calls.length,2);
});
test('directory shrink clamps to the returned final page within the original single bounded query',async()=>{
 const f=fixture({handler:()=>({items:[rows[0]],page:2,pageSize:12,total:13,totalPages:2})});await f.launcher.search({q:'怕',kind:'all',page:3});assert.equal(f.calls.length,1);assert.equal(f.launcher.snapshot().page,2);assert.equal(f.launcher.snapshot().totalPages,2);assert.equal(f.launcher.snapshot().items.length,1);
 const bad=fixture({handler:()=>({items:[rows[0]],page:1,pageSize:12,total:13,totalPages:2})});await bad.launcher.search({page:3});assert.match(bad.launcher.snapshot().message,/清單/);assert.equal(bad.launcher.snapshot().items.length,0);
});
test('chooser revalidates scope at save; forged server scope/private destinations never become defaults',async()=>{
 for(const bad of [{...rows[0],streamerId:'someone-else'},{...rows[0],canonicalPath:'/',homePath:'/'},{...rows[0],homePath:'/pa?token=secret'},{...rows[0],homePath:'https://evil.test/pa'},{...rows[0],canonicalPath:'/app.html',homePath:'/app.html'},{...rows[1],homePath:'/v2.html?streamer=snow&token=secret#home'},{...rows[1],spaceId:'space-other'}]){const f=fixture({handler:()=>bad});assert.equal(await f.launcher.select(papa),false);assert.equal(f.store.getItem(HOME_KEY),null);assert.equal(f.targets.length,0);}
});
test('storage failure never falsely reports a persisted default or clears any data',async()=>{
 const store={getItem:()=>null,setItem:()=>{throw Error('quota');}},f=fixture({source:papa,store});await f.launcher.start();assert.equal(f.launcher.snapshot().phase,'error');assert.equal(f.targets.length,0);assert.match(f.launcher.snapshot().message,/儲存/);assert.equal(await f.launcher.select(papa),false);
});
test('late directory or startup responses cannot overwrite newer explicit selection',async()=>{
 let release;const f=fixture({source:papa,handler:body=>body.op==='publicAppHome'&&body.streamerId===papa.streamerId?new Promise(done=>release=done):rows[1]});const pending=f.launcher.start();await Promise.resolve();assert.equal(await f.launcher.select(snow),true);release(rows[0]);await pending;assert.deepEqual(f.targets,[mount+'v2.html?streamer=snow#home']);assert.equal(readHome(f.store).streamerId,snow.streamerId);
});
test('duplicate save clicks coalesce without duplicate writes or navigation',async()=>{
 let release;const f=fixture({handler:()=>new Promise(done=>release=done)});const first=f.launcher.select(papa),second=f.launcher.select(snow);assert.equal(await second,false);release(rows[0]);assert.equal(await first,true);assert.equal(f.calls.length,1);assert.equal(f.targets.length,1);
});
test('corrupt explicit v2 cannot be overwritten by a manifest source; manual choice repairs only the home key',async()=>{
 const f=fixture({source:papa});f.store.setItem(HOME_KEY,'{bad');await f.launcher.start();assert.equal(f.launcher.snapshot().phase,'chooser');assert.equal(f.targets.length,0);assert.equal(f.store.getItem(HOME_KEY),'{bad');assert.equal(await f.launcher.select(snow),true);assert.equal(readHome(f.store).streamerId,snow.streamerId);
});
test('native-looking unsupported halls cannot be guessed through legacy lobby fallback',()=>{
 assert.throws(()=>publicHomeRow({...rows[2],spaceId:'new-space',canonicalPath:null,homePath:'/lobby.html'},mount));assert.throws(()=>publicHomeRow({...rows[0],homePath:'/pa/book',canonicalPath:'/pa/book'},mount));assert.equal(publicHomeRow(rows[2],mount).spaceId,hall.spaceId);
});
