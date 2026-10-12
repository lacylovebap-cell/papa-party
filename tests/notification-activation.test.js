import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function harness(t,{permission='granted',requestPermission,register,getSubscription,apiHook,rows=[],onNavigate,initialPreferences={pushEnabled:false},storage=new Map(),storageError=false}={}){
 const names=['document','window','Audio','localStorage','navigator','setInterval','Notification','isSecureContext','FormData'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const put=(name,value)=>Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 t.after(()=>{for(const [name,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 const documentListeners={},dialogListeners={},requests=[],toasts=[],healthTarget={innerHTML:''},healthButton={disabled:false},errorTarget={textContent:''};
 let current={role:'player',recipient:'P1',streamer:'papa',spaceId:'space-001',deviceSessionId:'device-one'},prefs=initialPreferences,prompts=0,workerReads=0,workerRegistrations=0,subscriptions=0,inGesture=false;
 const subscription={endpoint:'https://push.example/device',toJSON:()=>({endpoint:'https://push.example/device',keys:{}})};
 const registration={active:{},pushManager:{getSubscription:()=>getSubscription?getSubscription():Promise.resolve(subscription),subscribe:async()=>{subscriptions++;return subscription;}}};
 const dialog={open:false,innerHTML:'',showModal(){this.open=true;errorTarget.textContent='';},close(){const wasOpen=this.open;this.open=false;if(wasOpen)dialogListeners.close?.();},addEventListener(type,fn){dialogListeners[type]=fn;},querySelector(selector){return selector==='[data-notice-health]'?healthTarget:selector==='[data-notice="health"]'?healthButton:selector==='#notice-error'?errorTarget:null;}};
 put('document',{hidden:false,body:{append(){}},createElement:()=>dialog,querySelectorAll:()=>[],addEventListener(type,fn){documentListeners[type]=fn;}});
 const notification={permission,requestPermission(){prompts++;assert.equal(inGesture,true,'permission prompt requires the explicit synchronous click');return requestPermission?requestPermission():Promise.resolve('granted');}};
 put('window',{Notification:notification,PushManager:class{},addEventListener(){}});put('Notification',notification);put('isSecureContext',true);
 put('Audio',class{constructor(url){this.src=String(url);}pause(){}});put('localStorage',{getItem:name=>storage.get(name)??null,setItem(name,value){if(storageError)throw Error('storage unavailable');storage.set(name,value);}});put('setInterval',()=>0);
 put('FormData',class{constructor(form){this.values=new Set(form.values||[]);}has(key){return this.values.has(key);}});
 put('navigator',{serviceWorker:{getRegistration:async()=>{workerReads++;return registration;},register:()=>{workerRegistrations++;return register?register():Promise.resolve(registration);},ready:Promise.resolve(registration)}});
 const create=()=>createNotifications({api:async body=>{requests.push({...body,context:{...current}});const result=apiHook?await apiHook(body):undefined;if(body.op==='noticePreferences')prefs=body.preferences;if(result!==undefined)return result;if(body.op==='pushKey')return {publicKey:'AQID'};if(body.op==='notifications')return {rows,preferences:prefs,unread:{}};return {};},context:()=>({...current}),toast:message=>toasts.push(message),onNavigate});
 let notices=create();
 notices.button();
 const settle=()=>new Promise(setImmediate);
 const click=(action,id)=>{const button={dataset:{notice:action,noticeId:id}};inGesture=true;try{return documentListeners.click({target:{closest:()=>button},preventDefault(){}});}finally{inGesture=false;}};
 const form={id:'notice-settings',values:['pushEnabled'],submit:{disabled:false},querySelector(){return this.submit;}};
 return {get notices(){return notices;},dialog,requests,toasts,errorTarget,healthTarget,notification,registration,subscription,settle,click,form,storage,
  reload(){dialog.open=false;dialog.innerHTML='';for(const listeners of [documentListeners,dialogListeners])for(const name of Object.keys(listeners))delete listeners[name];notices=create();notices.button();},
  setContext(patch){current={...current,...patch};},prompts:()=>prompts,reads:()=>workerReads,registrations:()=>workerRegistrations,subscriptions:()=>subscriptions,
  async settings(){await click('settings');await settle();},close(){dialog.close();},submit(){return dialogListeners.submit({target:form,preventDefault(){}});}};
}

test('settings health is local/on-demand and exposes no automatic test notice or business API read',async t=>{
 const h=harness(t);assert.equal(h.reads(),0);await h.settings();
 assert.equal(h.reads(),1);assert.equal(h.requests.length,0);assert.equal(h.prompts(),0);assert.equal(h.registrations(),0);
 assert.match(h.dialog.innerHTML,/本機推播檢查/);assert.match(h.healthTarget.innerHTML,/通知是否送達需另外測試/);assert.match(h.healthTarget.innerHTML,/尚無紀錄/);
 await h.click('health');assert.equal(h.reads(),2);assert.equal(h.requests.length,0);assert.equal(h.healthTarget.innerHTML.includes('https://push.example'),false);
});

test('already granted permission reuses subscription and binds the captured device without requesting permission',async t=>{
 const h=harness(t);await h.settings();await h.click('enablePush');
 assert.equal(h.prompts(),0);assert.equal(h.registrations(),1);assert.equal(h.subscriptions(),0);
 assert.deepEqual(h.requests.map(body=>body.op),['pushKey','pushSubscribe','noticePreferences','notifications']);
 assert.equal(h.requests.find(body=>body.op==='pushSubscribe').expectedDeviceSessionId,'device-one');
 assert.equal(h.requests.some(body=>body.op==='noticeTest'),false);assert.equal(h.toasts.some(message=>message.includes('已啟用')),true);
 assert.match(h.healthTarget.innerHTML,/最近綁定成功/);assert.match(h.healthTarget.innerHTML,/通知是否送達需另外測試/);
});

test('denied permission gives browser guidance without another permission request or API write',async t=>{
 const h=harness(t,{permission:'denied'});await h.settings();await h.click('enablePush');await h.click('enablePush');
 assert.equal(h.prompts(),0);assert.equal(h.registrations(),0);assert.equal(h.requests.length,0);assert.match(h.errorTarget.textContent,/瀏覽器設定/);
});

test('permission is requested synchronously from the click and repeated clicks coalesce until it resolves',async t=>{
 const choice=deferred(),h=harness(t,{permission:'default',requestPermission:()=>choice.promise});await h.settings();
 const first=h.click('enablePush'),second=h.click('enablePush');assert.equal(h.prompts(),1);assert.equal(h.requests.length,0);assert.equal(h.registrations(),0);
 h.notification.permission='granted';choice.resolve('granted');await Promise.all([first,second]);
 assert.equal(h.registrations(),1);assert.equal(h.requests.filter(body=>body.op==='pushSubscribe').length,1);assert.equal(h.requests.filter(body=>body.op==='noticePreferences').length,1);
});

for(const [name,patch] of [['recipient',{recipient:'P2'}],['room',{streamer:'michelle'}],['Space',{spaceId:'space-002'}],['device',{deviceSessionId:'device-two'}],['role',{role:'streamer_admin'}]]){
 test(`a permission completion cannot activate after the ${name} changes`,async t=>{
  const choice=deferred(),h=harness(t,{permission:'default',requestPermission:()=>choice.promise});await h.settings();const activation=h.click('enablePush');
  h.setContext(patch);choice.resolve('granted');await activation;
  assert.equal(h.registrations(),0);assert.equal(h.requests.length,0);assert.equal(h.toasts.some(message=>message.includes('已啟用')),false);
 });
}

for(const stage of ['register','pushKey','subscription','pushSubscribe','noticePreferences']){
 test(`a stale ${stage} completion cannot continue activation or report success in a replacement identity`,async t=>{
  const pending=deferred();let lookups=0;
  const h=harness(t,{register:stage==='register'?()=>pending.promise:undefined,getSubscription:stage==='subscription'?()=>++lookups===1?Promise.resolve(null):pending.promise:undefined,apiHook:body=>body.op===stage?pending.promise:undefined});
  await h.settings();const activation=h.click('enablePush');await h.settle();
  h.setContext({recipient:'P2'});h.notices.button();
  pending.resolve(stage==='register'?h.registration:stage==='subscription'?h.subscription:stage==='pushKey'?{publicKey:'AQID'}:{});await activation;
  const operations=h.requests.map(body=>body.op);
  if(stage==='register')assert.deepEqual(operations,[]);
  if(['pushKey','subscription'].includes(stage))assert.deepEqual(operations,['pushKey']);
  if(stage==='pushSubscribe')assert.deepEqual(operations,['pushKey','pushSubscribe']);
  if(stage==='noticePreferences')assert.deepEqual(operations,['pushKey','pushSubscribe','noticePreferences']);
  assert.equal(h.toasts.some(message=>message.includes('已啟用')),false);assert.equal(h.dialog.open,false);
 });
}

test('closing settings while permission is pending cancels later activation stages',async t=>{
 const choice=deferred(),h=harness(t,{permission:'default',requestPermission:()=>choice.promise});await h.settings();const activation=h.click('enablePush');h.close();choice.resolve('granted');await activation;
 assert.equal(h.registrations(),0);assert.equal(h.requests.length,0);assert.equal(h.toasts.some(message=>message.includes('已啟用')),false);assert.equal(h.dialog.open,false);
});

test('settings save suppresses duplicates and does not repaint/show success after the form closes',async t=>{
 const pending=deferred(),h=harness(t,{apiHook:body=>body.op==='noticePreferences'?pending.promise:undefined});await h.settings();const first=h.submit(),second=h.submit();
 assert.equal(h.requests.filter(body=>body.op==='noticePreferences').length,1);assert.equal(h.form.submit.disabled,true);
 h.close();pending.resolve({});await Promise.all([first,second]);
 assert.equal(h.dialog.open,false);assert.equal(h.requests.some(body=>body.op==='notifications'),false);assert.equal(h.toasts.some(message=>message.includes('已儲存')),false);
});

test('settings save cannot refresh replacement recipient preferences or report its success',async t=>{
 const pending=deferred(),h=harness(t,{apiHook:body=>body.op==='noticePreferences'?pending.promise:undefined});await h.settings();const save=h.submit();h.setContext({spaceId:'space-002',recipient:'P2'});h.notices.button();pending.resolve({});await save;
 assert.equal(h.requests.some(body=>body.op==='notifications'),false);assert.equal(h.toasts.some(message=>message.includes('已儲存')),false);assert.equal(h.dialog.open,false);
});

test('inbox 查看 routes only a loaded notice in the current identity and has no button for an unknown empty target',async t=>{
 const destinations=[],notice={id:'notice-1',recipient:'P1',streamer_id:'papa',type:'completed',entity_id:'queue-1',body:'完成',created_at:'2026-10-11T01:00:00Z'};
 const h=harness(t,{rows:[notice,{id:'unknown',type:'unrecognized',body:'其他',created_at:notice.created_at}],onNavigate:value=>destinations.push(value)});await h.click('open');
 assert.match(h.dialog.innerHTML,/data-notice="view" data-notice-id="notice-1"/);assert.equal(h.dialog.innerHTML.includes('data-notice="view" data-notice-id="unknown"'),false);
 await h.click('view','not-loaded');assert.equal(destinations.length,0);
 await h.click('view','notice-1');assert.deepEqual(destinations,[notice]);assert.equal(h.dialog.open,false);
 await h.click('open');h.setContext({recipient:'P2'});await h.click('view','notice-1');assert.equal(destinations.length,1,'stale DOM cannot route the previous inbox identity');
});

test('disabling this device survives reload and blocks remembered binding without changing global preferences',async t=>{
 const h=harness(t,{initialPreferences:{pushEnabled:true}});await h.settings();await h.click('disablePush');
 assert.deepEqual(h.requests.map(body=>body.op),['pushUnsubscribe']);assert.equal(h.requests[0].endpoint,h.subscription.endpoint);assert.match(h.healthTarget.innerHTML,/已在這台裝置停用/);
 h.reload();const reads=h.reads();await h.notices.refresh();await h.settle();await h.notices.refresh();await h.settle();
 assert.equal(h.reads(),reads,'disabled room does not even inspect the subscription during refresh');assert.equal(h.requests.some(body=>body.op==='pushSubscribe'),false);assert.equal(h.requests.some(body=>body.op==='noticePreferences'),false);
 assert.equal(h.storage.size,1,'choice is a single scoped local marker');await h.settings();assert.match(h.healthTarget.innerHTML,/已在這台裝置停用/);
});

for(const [name,patch] of [['room',{streamer:'michelle'}],['Space',{spaceId:'space-002'}],['recipient',{recipient:'P2'}],['device',{deviceSessionId:'device-two'}]]){
 test(`a local disable does not disable another ${name} binding`,async t=>{
  const h=harness(t,{initialPreferences:{pushEnabled:true}});await h.settings();await h.click('disablePush');h.reload();h.setContext(patch);
  await h.notices.refresh();await h.settle();const bindings=h.requests.filter(body=>body.op==='pushSubscribe');assert.equal(bindings.length,1);assert.equal(h.requests.some(body=>body.op==='noticePreferences'),false);
  for(const [key,value] of Object.entries(patch))assert.equal(bindings[0].context[key],value);
  h.setContext({role:'player',recipient:'P1',streamer:'papa',spaceId:'space-001',deviceSessionId:'device-one'});await h.notices.refresh();await h.settle();assert.equal(h.requests.filter(body=>body.op==='pushSubscribe').length,1,'original device/room remains disabled');
 });
}

test('explicit enable clears only its scoped disable choice and remembered binding works after reload',async t=>{
 const h=harness(t,{initialPreferences:{pushEnabled:true}});await h.settings();await h.click('disablePush');await h.click('enablePush');
 assert.match(h.healthTarget.innerHTML,/未於本機停用/);assert.equal(h.requests.filter(body=>body.op==='pushSubscribe').length,1);
 h.reload();await h.notices.refresh();await h.settle();assert.equal(h.requests.filter(body=>body.op==='pushSubscribe').length,2,'explicit enable restored permission to bind this room/device');
 assert.equal(h.prompts(),0);assert.equal(h.requests.filter(body=>body.op==='noticePreferences').length,1);
});

test('failed local persistence cannot claim a durable disable or remove the server route',async t=>{
 const h=harness(t,{storageError:true});await h.settings();await h.click('disablePush');
 assert.equal(h.requests.length,0);assert.equal(h.toasts.some(message=>message.includes('已停用')),false);assert.match(h.errorTarget.textContent,/無法保存/);
});

test('disable waits for an already-issued remembered bind, then deletes it and stays disabled after reload',async t=>{
 const pending=deferred(),h=harness(t,{initialPreferences:{pushEnabled:true},apiHook:body=>body.op==='pushSubscribe'?pending.promise:undefined});
 await h.notices.refresh();await h.settle();assert.equal(h.requests.filter(body=>body.op==='pushSubscribe').length,1);
 await h.settings();const disabling=h.click('disablePush');await h.settle();assert.equal(h.requests.some(body=>body.op==='pushUnsubscribe'),false,'cannot delete before the older upsert is acknowledged');
 pending.resolve({});await disabling;assert.deepEqual(h.requests.map(body=>body.op),['notifications','pushSubscribe','pushUnsubscribe']);
 h.reload();await h.notices.refresh();await h.settle();assert.equal(h.requests.filter(body=>body.op==='pushSubscribe').length,1);assert.equal(h.requests.some(body=>body.op==='noticePreferences'),false);
});

test('disable cancels a pending permission activation without an upsert or preference change',async t=>{
 const permission=deferred(),h=harness(t,{permission:'default',requestPermission:()=>permission.promise});await h.settings();const activating=h.click('enablePush');await h.click('disablePush');
 h.notification.permission='granted';permission.resolve('granted');await activating;
 assert.deepEqual(h.requests.map(body=>body.op),['pushUnsubscribe']);assert.equal(h.toasts.some(message=>message.includes('已啟用')),false);assert.match(h.healthTarget.innerHTML,/已在這台裝置停用/);
});

test('disable after an explicit bind was issued deletes after it and suppresses stale activation success',async t=>{
 const pending=deferred(),h=harness(t,{apiHook:body=>body.op==='pushSubscribe'?pending.promise:undefined});await h.settings();const activation=h.click('enablePush');await h.settle();const disabling=h.click('disablePush');await h.settle();
 assert.equal(h.requests.some(body=>body.op==='pushUnsubscribe'),false);pending.resolve({});await Promise.all([activation,disabling]);
 assert.deepEqual(h.requests.map(body=>body.op),['pushKey','pushSubscribe','pushUnsubscribe']);assert.equal(h.toasts.some(message=>message.includes('已啟用')),false);assert.match(h.healthTarget.innerHTML,/已在這台裝置停用/);
});

for(const changedIdentity of [false,true]){
 test(`${changedIdentity?'a replacement identity':'a reopened form'} gets a fresh activation while sharing the pending origin permission prompt`,async t=>{
  const permission=deferred(),h=harness(t,{permission:'default',requestPermission:()=>permission.promise});await h.settings();const old=h.click('enablePush');h.close();
  if(changedIdentity)h.setContext({recipient:'P2',deviceSessionId:'device-two'});await h.settings();const latest=h.click('enablePush');assert.equal(h.prompts(),1,'the browser origin permission prompt is not duplicated');
  h.notification.permission='granted';permission.resolve('granted');await Promise.all([old,latest]);
  const bindings=h.requests.filter(body=>body.op==='pushSubscribe');assert.equal(bindings.length,1);assert.equal(bindings[0].context.recipient,changedIdentity?'P2':'P1');assert.equal(bindings[0].expectedDeviceSessionId,changedIdentity?'device-two':'device-one');
  assert.equal(h.toasts.filter(message=>message.includes('已啟用')).length,1);
 });
}

test('a replacement recipient binding waits for the old in-flight upsert so the final endpoint belongs to the latest identity',async t=>{
 const pending=deferred();let binds=0;const h=harness(t,{apiHook:body=>body.op==='pushSubscribe'&&++binds===1?pending.promise:undefined});await h.settings();const old=h.click('enablePush');await h.settle();
 h.setContext({recipient:'P2',deviceSessionId:'device-two'});await h.settings();const latest=h.click('enablePush');await h.settle();assert.equal(h.requests.filter(body=>body.op==='pushSubscribe').length,1);
 pending.resolve({});await Promise.all([old,latest]);const bindings=h.requests.filter(body=>body.op==='pushSubscribe');assert.deepEqual(bindings.map(body=>body.context.recipient),['P1','P2']);assert.equal(h.requests.filter(body=>body.op==='noticePreferences').length,1);assert.equal(h.toasts.filter(message=>message.includes('已啟用')).length,1);
});
