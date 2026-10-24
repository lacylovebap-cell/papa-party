import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';

test('existing Web Push binds once per device/room, without prompting, duplicate subscription, or rebinding access refresh',async()=>{
 const names=['document','window','Audio','localStorage','navigator','setInterval','Notification'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 let room='papa',device='device-one',registrations=0;const requests=[];
 const put=(name,value)=>Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 try{
  put('document',{hidden:false,body:{append(){}},createElement:()=>({close(){},addEventListener(){}}),querySelectorAll:()=>[],addEventListener(){}});
  put('Notification',{permission:'granted'});put('window',{addEventListener(){}});put('Audio',class{constructor(url){this.src=String(url);}pause(){}});
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

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function pushHarness(t,{getRegistration,upsert=async()=>({})}={}){
 const names=['document','window','Audio','localStorage','navigator','setInterval','Notification'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const put=(name,value)=>Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 t.after(()=>{for(const [name,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 const listeners={},requests=[],subscription={toJSON:()=>({endpoint:'https://push.example/device',keys:{}})},registration={pushManager:{getSubscription:async()=>subscription}};
 let current={role:'player',recipient:'P1',streamer:'papa',spaceId:'space-001',deviceSessionId:'device-one'},registrationReads=0,permissionPrompts=0;
 put('document',{hidden:false,body:{append(){}},createElement:()=>({close(){},addEventListener(){}}),querySelectorAll:()=>[],addEventListener(type,fn){listeners[type]=fn;}});
 put('Notification',{permission:'granted'});put('window',{addEventListener(){}});put('Audio',class{constructor(url){this.src=String(url);}pause(){}});
 put('localStorage',{getItem:()=>null,setItem(){}});put('setInterval',()=>0);
 put('Notification',{permission:'granted',requestPermission(){permissionPrompts++;throw Error('automatic permission prompt');}});
 put('navigator',{serviceWorker:{getRegistration:async()=>{registrationReads++;return getRegistration?getRegistration():registration;}}});
 const notices=createNotifications({api:async b=>{requests.push({...b,context:{...current}});return b.op==='pushSubscribe'?upsert(b):{rows:[],unread:{},preferences:{pushEnabled:true}};},context:()=>({...current}),toast(){}});
 const settle=()=>new Promise(setImmediate);
 return {registration,subscription,requests,notices,settle,setContext(patch){current={...current,...patch};},bindings:()=>requests.filter(b=>b.op==='pushSubscribe'),reads:()=>registrationReads,prompts:()=>permissionPrompts,
  async refresh(){await notices.refresh();await settle();},async foreground(){listeners.visibilitychange();await settle();}};
}

test('a missing registration stays retryable when returning to the foreground',async t=>{
 let available=false;const harness=pushHarness(t,{getRegistration:()=>available?harness.registration:undefined});
 await harness.refresh();assert.equal(harness.bindings().length,0);
 available=true;await harness.foreground();await harness.refresh();
 assert.equal(harness.reads(),2);assert.equal(harness.bindings().length,1);assert.equal(harness.prompts(),0);
});

test('a missing subscription is not treated as a successful binding',async t=>{
 let available=false;const harness=pushHarness(t);
 harness.registration.pushManager.getSubscription=async()=>available?harness.subscription:null;
 await harness.refresh();assert.equal(harness.bindings().length,0);
 available=true;await harness.refresh();await harness.refresh();
 assert.equal(harness.reads(),2);assert.equal(harness.bindings().length,1);assert.equal(harness.prompts(),0);
});

test('a failed binding retries on the next refresh and latches only its success',async t=>{
 let attempts=0;const harness=pushHarness(t,{upsert:async()=>{if(++attempts===1)throw Error('temporary network failure');return {};}});
 await harness.refresh();await harness.refresh();await harness.refresh();
 assert.equal(attempts,2);assert.equal(harness.reads(),2);assert.equal(harness.bindings().length,2);assert.equal(harness.prompts(),0);
});

test('repeated refreshes coalesce an in-flight subscription lookup',async t=>{
 const pending=deferred(),harness=pushHarness(t);
 harness.registration.pushManager.getSubscription=()=>pending.promise;
 await harness.refresh();await harness.refresh();assert.equal(harness.reads(),1);assert.equal(harness.bindings().length,0);
 pending.resolve(harness.subscription);await harness.settle();await harness.refresh();
 assert.equal(harness.reads(),1);assert.equal(harness.bindings().length,1);
});

for(const [label,patch] of [['recipient',{recipient:'P2'}],['room',{streamer:'michelle'}],['Space',{spaceId:'space-002'}]]){
 test(`a stale lookup cannot bind after the ${label} changes before the next refresh`,async t=>{
  const pending=deferred();let lookups=0;const harness=pushHarness(t,{getRegistration:()=>++lookups===1?pending.promise:harness.registration});
  await harness.refresh();harness.setContext(patch);pending.resolve(harness.registration);await harness.settle();
  assert.equal(harness.bindings().length,0,'old recipient must not be bound using the replacement context');
  await harness.refresh();await harness.refresh();assert.equal(harness.bindings().length,1);
  assert.deepEqual(Object.fromEntries(Object.keys(patch).map(name=>[name,harness.bindings()[0].context[name]])),patch);
 });
}

 test('an old in-flight device write finishes before the newer device binds and cannot overwrite it',async t=>{
 const pending=deferred();const harness=pushHarness(t,{upsert:b=>b.expectedDeviceSessionId==='device-one'?pending.promise:Promise.resolve({})});
 await harness.refresh();harness.setContext({deviceSessionId:'device-two'});await harness.refresh();
 assert.equal(harness.bindings().length,1,'new route write waits for the old in-flight request');pending.resolve({});await harness.settle();await harness.refresh();
 assert.equal(harness.bindings().length,2,'current device remains successfully bound');
 assert.equal(harness.bindings()[1].expectedDeviceSessionId,'device-two');
});
