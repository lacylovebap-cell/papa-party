import test from 'node:test';
import assert from 'node:assert/strict';
import {communicationIdentity,roomStorageKey} from '../src/communication-context.js';
import {createNotifications} from '../src/notifications.js';

test('native Space drafts and selected admin pages do not share legacy cache keys or change login slots',()=>{
 for(const name of ['draft','adminTab']){
  assert.equal(roomStorageKey(name,{streamerSlug:'papa'}),name+'-papa');
  assert.equal(roomStorageKey(name,{spaceId:'space-001',streamerSlug:'papa'}),name+'-papa');
  assert.notEqual(roomStorageKey(name,{spaceId:'space-002',streamerSlug:'papa'}),name+'-papa');
  assert.notEqual(roomStorageKey(name,{spaceId:'space-002',streamerSlug:'papa'}),roomStorageKey(name,{spaceId:'space-003',streamerSlug:'papa'}));
 }
 for(const name of ['player','admin'])assert.equal(roomStorageKey(name,{spaceId:'space-002',streamerSlug:'papa'}),name);
});

test('a stale notification response cannot transfer unread state across Spaces with the same recipient',async()=>{
 const names=['document','window','Audio','localStorage','setInterval'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const put=(name,value)=>Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 let spaceId='space-001',resolveOld,calls=0;
 const old=new Promise(resolve=>resolveOld=resolve);
 try{
  put('document',{hidden:false,body:{append(){}},createElement:()=>({open:false,close(){},addEventListener(){}}),querySelectorAll:()=>[],addEventListener(){}});
  put('window',{addEventListener(){}});put('Audio',class{constructor(url){this.src=String(url);}pause(){}});
  put('localStorage',{getItem:()=>null,setItem(){}});put('setInterval',()=>0);
  const notices=createNotifications({api:async()=>++calls===1?old:{rows:[],unread:{},preferences:{}},context:()=>({spaceId,role:'player',recipient:'P1',streamer:'same-room'}),toast(){},apiUrl:'https://example.test/functions/v1/party-api',apiKey:'test'});
  const pending=notices.refresh();spaceId='space-002';notices.button();
  resolveOld({rows:[],unread:{message:17},preferences:{}});await pending;
  assert.equal(notices.button().includes('notice-count'),false,'old Space response was discarded');
  await notices.refresh();assert.equal(calls,2);assert.equal(notices.button().includes('notice-count'),false);
  assert.equal(communicationIdentity({spaceId:'space-001'},'papa:P1'),'papa:P1','legacy local preferences retain their key');
  assert.notEqual(communicationIdentity({spaceId:'space-001'},'same:P1'),communicationIdentity({spaceId:'space-002'},'same:P1'));
  assert.equal(communicationIdentity({spaceId:'space-002',streamer:'__global__',recipient:'__super__'},'__global__:__super__'),'__global__:__super__','president platform inbox stays global');
 }finally{for(const [name,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
});
