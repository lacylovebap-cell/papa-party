import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';

// 2026-10-31 production evidence: players whose browser already had permission
// and a Web Push subscription (shared with the president/manager login on the
// same phone, or with a never-chosen blank preference) never got a player row.
function harness(t,{main,companion=null,mainPrefs={pushEnabled:true},companionPrefs={pushEnabled:true},local={}}){
 const names=['document','window','Audio','localStorage','navigator','setInterval','Notification'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const put=(name,value)=>Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 t.after(()=>{for(const [name,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 const store=new Map(Object.entries(local));
 put('document',{hidden:false,body:{append(){}},createElement:()=>({close(){},addEventListener(){}}),querySelectorAll:()=>[],addEventListener(){}});
 put('window',{addEventListener(){},PushManager:class{},Notification:class{}});put('Audio',class{constructor(url){this.src=String(url);}pause(){}});
 put('localStorage',{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))});put('setInterval',()=>0);
 put('Notification',{permission:'granted',requestPermission(){throw Error('must never prompt automatically');}});
 const subscription={toJSON:()=>({endpoint:'https://fcm.example/shared-browser',keys:{p256dh:'k',auth:'a'}})};
 let subscribes=0;
 const reg={active:{},pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{subscribes++;return subscription;}}};
 put('navigator',{serviceWorker:{getRegistration:async()=>reg,register:async()=>reg,ready:Promise.resolve(reg)}});
 globalThis.window.PushManager=class{};globalThis.isSecureContext=true;
 const main_requests=[],companion_requests=[];
 const reply=(b,prefs)=>b.op==='pushKey'?{publicKey:'AQID'}:b.op==='notifications'?{rows:[],unread:{},preferences:prefs}:b.op==='noticePreferences'?{preferences:b.preferences}:{ok:true};
 let comp=companion;
 const notices=createNotifications({api:async b=>{main_requests.push(b);return reply(b,mainPrefs);},context:()=>({...main}),toast(){},
  companion:()=>comp&&{...comp},companionApi:async b=>{companion_requests.push(b);return reply(b,companionPrefs);}});
 const settle=async()=>{for(let i=0;i<6;i++)await new Promise(setImmediate);};
 return {notices,settle,main_requests,companion_requests,subscribes:()=>subscribes,setCompanion(v){comp=v;}};
}
const president={role:'super_admin',recipient:'__super__',streamer:'__global__',deviceSessionId:'president-device',accountId:'acct-president'};
const player={role:'player',recipient:'P900000000',streamer:'papa',spaceId:'space-001',deviceSessionId:'player-device',accountId:'acct-player'};

test('a player signed in beside the president on the same browser gets a device-bound player subscription',async t=>{
 const h=harness(t,{main:president,companion:player});
 await h.notices.refresh();await h.settle();
 const bind=h.companion_requests.filter(b=>b.op==='pushSubscribe');
 assert.equal(bind.length,1,'player identity is bound, not only the active manager');
 assert.equal(bind[0].expectedDeviceSessionId,'player-device');
 assert.equal(bind[0].subscription.endpoint,'https://fcm.example/shared-browser','reuses the existing browser subscription');
 assert.equal(h.main_requests.filter(b=>b.op==='pushSubscribe').length,1,'manager binding is unchanged');
 assert.equal(h.subscribes(),0,'never creates a second browser subscription');
 await h.notices.refresh();await h.settle();
 assert.equal(h.companion_requests.filter(b=>b.op==='pushSubscribe').length,1,'binds once per player/device, no repeated writes');
 h.setCompanion({...player,deviceSessionId:'player-device-2'});await h.notices.refresh();await h.settle();
 assert.equal(h.companion_requests.filter(b=>b.op==='pushSubscribe').at(-1).expectedDeviceSessionId,'player-device-2','new device login rebinds');
});

test('companion binding never overrides an explicit off, a local device opt-out, or the room manager row',async t=>{
 {const h=harness(t,{main:president,companion:player,companionPrefs:{pushEnabled:false}});await h.notices.refresh();await h.settle();
  assert.equal(h.companion_requests.filter(b=>b.op==='pushSubscribe').length,0,'explicit account off stays off');
  assert.equal(h.companion_requests.filter(b=>b.op==='noticePreferences').length,0);}
 {const h=harness(t,{main:president,companion:player,local:{'pa-notice-papa:P900000000-push-disabled:player-device':'true'}});await h.notices.refresh();await h.settle();
  assert.equal(h.companion_requests.length,0,'device-level opt-out is respected');}
 {const h=harness(t,{main:{role:'streamer_admin',recipient:'__admin__',streamer:'papa',spaceId:'space-001',deviceSessionId:'admin-device'},companion:player});await h.notices.refresh();await h.settle();
  assert.equal(h.companion_requests.length,0,'same room + endpoint belongs to the manager; never overwritten by the player');}
});

test('a blank (never chosen) preference on an authorized browser binds and records push intent; explicit false does not',async t=>{
 {const h=harness(t,{main:player,mainPrefs:{}});await h.notices.refresh();await h.settle();
  const bind=h.main_requests.filter(b=>b.op==='pushSubscribe');
  assert.equal(bind.length,1,'authorized browser with blank preference is bound');assert.equal(bind[0].expectedDeviceSessionId,'player-device');
  const pref=h.main_requests.filter(b=>b.op==='noticePreferences');
  assert.equal(pref.length,1);assert.equal(pref[0].preferences.pushEnabled,true);}
 {const h=harness(t,{main:player,mainPrefs:{pushEnabled:false}});await h.notices.refresh();await h.settle();
  assert.equal(h.main_requests.filter(b=>b.op==='pushSubscribe').length,0,'explicit off is never re-enabled');
  assert.equal(h.main_requests.filter(b=>b.op==='noticePreferences').length,0);}
 {const h=harness(t,{main:player,companion:{...player},mainPrefs:{pushEnabled:true}});await h.notices.refresh();await h.settle();
  assert.equal(h.companion_requests.length,0,'same identity is not bound twice');}
});

test('a companion with blank preference records push intent once after binding',async t=>{
 const h=harness(t,{main:president,companion:player,companionPrefs:{}});await h.notices.refresh();await h.settle();
 const ops=h.companion_requests.map(b=>b.op);
 assert.deepEqual(ops,['notifications','pushSubscribe','noticePreferences']);
 assert.equal(h.companion_requests[2].preferences.pushEnabled,true);
});
