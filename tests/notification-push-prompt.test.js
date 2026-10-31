import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';

function harness(t,{context,prefs={},permission='default',ua='Mozilla/5.0 (Linux; Android 14) Chrome/156',local={},bound=false}){
 t.mock.timers.enable({apis:['setTimeout']});
 const names=['document','window','Audio','localStorage','sessionStorage','navigator','setInterval','Notification'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const put=(name,value)=>Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 t.after(()=>{for(const [name,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 const store=new Map(Object.entries(local)),session=new Map(),dialogs=[];
 const element=()=>{const el={innerHTML:'',open:false,listeners:[],addEventListener(type,f){this.listeners.push(f);},showModal(){this.open=true;dialogs.push(this);},close(){this.open=false;},remove(){}};return el;};
 put('document',{hidden:false,body:{append(){}},createElement:element,querySelectorAll:()=>[],addEventListener(){}});
 put('window',{addEventListener(){},PushManager:class{},Notification:class{}});put('Audio',class{constructor(url){this.src=String(url);}pause(){}});
 put('localStorage',{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))});
 put('sessionStorage',{getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v))});put('setInterval',()=>0);
 let prompts=0;put('Notification',{permission,requestPermission(){prompts++;return Promise.resolve('granted');}});
 const sub={toJSON:()=>({endpoint:'https://fcm.example/x',keys:{p256dh:'k',auth:'a'}})};
 const reg={active:{},pushManager:{getSubscription:async()=>bound?sub:null,subscribe:async()=>sub}};
 put('navigator',{userAgent:ua,serviceWorker:{getRegistration:async()=>reg,register:async()=>reg,ready:Promise.resolve(reg)}});
 globalThis.isSecureContext=true;
 const requests=[];
 const notices=createNotifications({api:async b=>{requests.push(b);return b.op==='pushKey'?{publicKey:'AQID'}:b.op==='notifications'?{rows:[],unread:{},preferences:prefs}:b.op==='noticePreferences'?{preferences:b.preferences}:{ok:true};},context:()=>({...context}),toast(){}});
 const settle=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
 return {notices,settle,dialogs,requests,prompts:()=>prompts,tick:ms=>t.mock.timers.tick(ms)};
}
const player={role:'player',recipient:'P900000000',streamer:'papa',spaceId:'space-001',deviceSessionId:'player-device'};
const click=async(dialog,action,h)=>{const target={closest:()=>({dataset:{pushPrompt:action}})};for(const f of dialog.listeners)f({target});await h.settle();};

test('a player whose phone is not receiving push gets one popup; one tap asks permission and binds',async t=>{
 const h=harness(t,{context:player});
 await h.notices.refresh();await h.settle();h.tick(3000);await h.settle();
 assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0].innerHTML,/data-push-prompt="on"/);assert.match(h.dialogs[0].innerHTML,/主播呼叫/);
 await click(h.dialogs[0],'on',h);
 assert.equal(h.prompts(),1,'the tap itself asks the browser');
 assert.equal(h.requests.filter(b=>b.op==='pushSubscribe').length,1,'and binds this phone');
 await h.notices.refresh();await h.settle();h.tick(3000);await h.settle();
 assert.equal(h.dialogs.length,1,'never shown twice in one visit');
});
test('no popup for managers, an already receiving phone, or an explicit off',async t=>{
 for(const [name,opts] of [['manager',{context:{role:'streamer_admin',recipient:'__admin__',streamer:'papa',deviceSessionId:'d'}}],['bound',{context:player,permission:'granted',prefs:{pushEnabled:true},bound:true}],['off',{context:player,prefs:{pushEnabled:false}}]]){
  await t.test(name,async t=>{const h=harness(t,opts);await h.notices.refresh();await h.settle();h.tick(3000);await h.settle();assert.equal(h.dialogs.length,0);});
 }
});
test('iPhone outside the Home Screen and blocked permission get the one step they need, without a button',async t=>{
 await t.test('iphone',async t=>{const h=harness(t,{context:player,ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari'});await h.notices.refresh();await h.settle();h.tick(3000);await h.settle();assert.match(h.dialogs[0].innerHTML,/加入主畫面/);assert.doesNotMatch(h.dialogs[0].innerHTML,/data-push-prompt="on"/);});
 await t.test('denied',async t=>{const h=harness(t,{context:player,permission:'denied'});await h.notices.refresh();await h.settle();h.tick(3000);await h.settle();assert.match(h.dialogs[0].innerHTML,/改成「允許」/);});
});
test('after logging out and back in on any streamer page, an allowed phone re-binds by itself (no popup, no prompt)',async t=>{
 const h=harness(t,{context:player,permission:'granted',prefs:{}});
 await h.notices.refresh();await h.settle();h.tick(3000);await h.settle();
 assert.equal(h.requests.filter(b=>b.op==='pushSubscribe').length,1);assert.equal(h.prompts(),0);assert.equal(h.dialogs.length,0);
});
