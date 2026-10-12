import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {NOTICE_TYPES} from '../src/notification-rules.js';
import {notificationTargetPath} from '../src/notification-target.js';
const code=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const scope='https://example.test/papa-party/';
const link={version:1,spaceId:'space-001',streamerId:'room-1',streamerSlug:'mi chelle',section:'center',entityType:'completed',entityId:'queue:1',notificationId:'notice-1'};
function worker({scopeUrl=scope,existing=[],clients=[]}={}){
 const listeners={},shown=[],opened=[],focused=[];let fetches=0,closed=0,clientReads=0;
 const self={registration:{scope:scopeUrl,getNotifications:async()=>existing,showNotification:async(title,options)=>shown.push({title,options})},addEventListener:(type,handler)=>listeners[type]=handler,skipWaiting:()=>{},clients:{claim:async()=>{},matchAll:async()=>{clientReads++;return clients.map(url=>({url,focus:async()=>focused.push(url)}));},openWindow:async url=>opened.push(url)}};
 const sandbox={self,URL,fetch:()=>{fetches++;throw Error('worker click must not fetch');}};vm.runInNewContext(code,sandbox);
 async function dispatch(type,event){let pending;listeners[type]({...event,waitUntil:value=>pending=value});await pending;}
 return {shown,opened,focused,fetches:()=>fetches,clientReads:()=>clientReads,closed:()=>closed,push:data=>dispatch('push',{data:{json:()=>data}}),click:url=>dispatch('notificationclick',{notification:{data:{url},close:()=>closed++}})};
}
test('push upgrades the existing abbreviated URL with canonical entity identity and uses the brand icon',async()=>{
 const w=worker();await w.push({id:'n1',body:'body',url:'./?streamer=wrong#admin',link});
 assert.equal(w.shown.length,1);assert.equal(w.shown[0].title,'PA Party');
 assert.equal(w.shown[0].options.data.url,new URL(notificationTargetPath(link),scope).href);
 assert.equal(w.shown[0].options.icon,'./assets/app-icon-192.png');
 assert.equal(w.fetches(),0);
});
test('classic worker serializer stays in parity for every notice type and nullable legacy field',async()=>{
 for(const entityType of Object.keys(NOTICE_TYPES))for(const nullable of [false,true]){
  const target={...link,section:entityType==='live'?'admin':'center',entityType,...(nullable?{spaceId:null,entityId:null,notificationId:null}:{})};
  const w=worker();await w.push({id:'n1',body:'body',link:target});
  assert.equal(w.shown[0]?.options.data.url,new URL(notificationTargetPath(target),scope).href);
 }
});
test('worker rejects malformed canonical links instead of silently trusting an abbreviated fallback',async()=>{
 for(const patch of [{version:2},{section:'home'},{entityType:'unknown'},{streamerId:''},{streamerId:42},{streamerSlug:' padded '},{spaceId:''},{entityId:'\u0000bad'},{notificationId:'n'.repeat(129)},{entityId:'e'.repeat(257)},{spaceId:'s'.repeat(129)},{streamerSlug:'s'.repeat(129)}]){
  const w=worker();await w.push({id:'n1',body:'body',link:{...link,...patch},url:'./?streamer=papa#center'});assert.equal(w.shown.length,0);
 }
});
test('legacy notification URLs remain usable within the original mounted site',async()=>{
 const w=worker();await w.push({id:'n1',body:'body',url:'./?streamer=papa#admin'});
 assert.equal(w.shown[0].options.data.url,'https://example.test/papa-party/?streamer=papa#admin');
 await w.click(w.shown[0].options.data.url);
 assert.deepEqual(w.opened,['https://example.test/papa-party/?streamer=papa#admin']);assert.equal(w.closed(),1);assert.equal(w.fetches(),0);
});
test('notification clicks focus the exact existing target and never repurpose another room tab',async()=>{
 const url=new URL(notificationTargetPath(link),scope).href,w=worker({clients:[url]});
 await w.click(url);assert.deepEqual(w.focused,[url]);assert.deepEqual(w.opened,[]);
 const other=worker({clients:['https://example.test/papa-party/?streamer=other#center']});await other.click(url);
 assert.deepEqual(other.focused,[]);assert.deepEqual(other.opened,[url]);assert.equal(other.fetches(),0);
});
test('external, out-of-mount, credential and malformed click URLs fail without client or network work',async()=>{
 for(const url of ['https://evil.test/papa-party/','https://example.test/papa-party-other/','../?streamer=papa#admin','./%2foutside#admin','https://user:pass@example.test/papa-party/','javascript:alert(1)','https://[invalid/','./?token=secret#center','./?streamer=papa#unsupported','./\\outside','./?'+'x'.repeat(4096)]){
  const w=worker();await w.click(url);assert.deepEqual(w.opened,[],url);assert.deepEqual(w.focused,[],url);assert.equal(w.clientReads(),0,url);assert.equal(w.fetches(),0,url);
 }
});
test('same-origin root scope and duplicate notice delivery retain their prior behavior',async()=>{
 const w=worker({scopeUrl:'https://example.test/'});await w.push({id:'n1',body:'body',link});
 assert.equal(w.shown[0].options.data.url,new URL(notificationTargetPath(link),'https://example.test/').href);
 const duplicate=worker({existing:[{}]});await duplicate.push({id:'n1',body:'body',link});assert.equal(duplicate.shown.length,0);
});
