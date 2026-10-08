import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';

test('existing Web Push binds once per device/room, without prompting, duplicate subscription, or rebinding access refresh',async()=>{
 const names=['document','window','Audio','localStorage','navigator','setInterval'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 let room='papa',device='device-one',registrations=0;const requests=[];
 const put=(name,value)=>Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 try{
  put('document',{hidden:false,body:{append(){}},createElement:()=>({close(){},addEventListener(){}}),querySelectorAll:()=>[],addEventListener(){}});
  put('window',{addEventListener(){}});put('Audio',class{constructor(url){this.src=String(url);}pause(){}});
  put('localStorage',{getItem:()=>null,setItem(){}});put('setInterval',()=>0);
  put('navigator',{serviceWorker:{getRegistration:async()=>{registrations++;return {pushManager:{getSubscription:async()=>({toJSON:()=>({endpoint:'https://push.example/device',keys:{}})})}};}}});
  const notices=createNotifications({api:async b=>{requests.push(b);return {rows:[],unread:{},preferences:{pushEnabled:true}};},context:()=>({role:'player',recipient:'P1',streamer:room,deviceSessionId:device}),toast(){}});
  const refresh=async()=>{await notices.refresh();await new Promise(setImmediate);};
  await refresh();await refresh();await refresh();
  const bindings=()=>requests.filter(b=>b.op==='pushSubscribe');
  assert.equal(bindings().length,1);assert.equal(registrations,1);assert.equal(bindings()[0].expectedDeviceSessionId,'device-one');
  room='michelle';await refresh();assert.equal(bindings().length,2,'same player/device has independent room bindings');
  device='device-two';await refresh();assert.equal(bindings().length,3);assert.equal(bindings()[2].expectedDeviceSessionId,'device-two');
 }finally{for(const [name,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
});
