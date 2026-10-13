import test from 'node:test';import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';import {NOTICE_TYPES} from '../src/notification-rules.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
function fixture(t,role='player'){
 const saved=Object.fromEntries(['document','window','Audio','localStorage','setInterval','FormData'].map(k=>[k,globalThis[k]]));t.after(()=>{for(const [k,v] of Object.entries(saved))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
 const listeners=new Map(),dialogListeners=new Map(),calls=[],timers=[],toasts=[],navigations=[],opened=[],c={accountId:'owner',role,streamer:role==='super_admin'?'__global__':'papa',selectedStreamer:'papa',streamerId:'papa',spaceId:'space-001',streamerName:'目前主播',selectedStreamerName:'怕怕',recipient:role==='player'?'P1':'__super__',demo:false};
 let form,error={textContent:''},html='',response;
 const dialog={open:false,showModal(){this.open=true;},close(){if(this.open){this.open=false;for(const fn of dialogListeners.get('close')||[])fn();}},addEventListener(name,fn){if(!dialogListeners.has(name))dialogListeners.set(name,[]);dialogListeners.get(name).push(fn);},set innerHTML(value){html=value;error={textContent:''};if(value.includes('id="notice-center-settings"'))form={id:'notice-center-settings',submit:{disabled:false},fields:new Set(Object.keys(NOTICE_TYPES).flatMap(type=>[type+'.center',type+'.badge'])),querySelector:s=>s==='[type=submit]'?form.submit:null};else form=null;},get innerHTML(){return html;},querySelector:s=>s==='#notice-error'?error:s==='#notice-center-settings'?form:s==='[data-notice-page]'?{value:'2'}:null};
 globalThis.document={hidden:false,body:{append(){}},createElement:()=>dialog,querySelectorAll:()=>[],addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);}};
 globalThis.window={addEventListener(){}};globalThis.Audio=class{constructor(url){this.src=String(url);}pause(){}};globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length;};globalThis.FormData=class{constructor(f){this.form=f;}has(k){return this.form.fields.has(k);}};
 const scope=b=>({spaceId:c.spaceId,streamerId:b.scopeMode==='space'?null:c.streamerId,mode:b.scopeMode});
 const defaultResponse=async b=>{
  if(b.op==='notifications')return {rows:[],unread:{},preferences:{muteAll:true}};
  if(b.op==='messageCenterCounts')return {version:1,scope:scope(b),unreadByCategory:{system:1,message:2,board:0},badgeUnreadByCategory:{system:1,message:0,board:0}};
  if(b.op==='messageCenter')return {version:1,scope:scope(b),category:b.category,page:b.page,pageSize:50,total:51,hasMore:b.page===0,snapshotId:b.snapshotId||id(90),snapshotAt:'2026-10-12T00:00:00Z',rows:[{id:id(b.category==='message'?2:1),space_id:c.spaceId,streamer_id:c.streamerId,streamer_name:'怕怕',type:b.category==='message'?'message':b.category==='board'?'comment':'completed',level:2,body:'Actual notification',entity_id:id(20),created_at:'2026-10-12T00:00:00Z',read_at:null}]};
  if(b.op==='messageCenterRead')return {version:1,scope:scope(b),category:b.category,marked:1};
  if(b.op==='messageCenterPreferences')return {version:1,scope:scope(b),settings:{types:Object.fromEntries(Object.keys(NOTICE_TYPES).map(type=>[type,{center:true,badge:true}]))}};
  throw Error('Unexpected '+b.op);
 };response=defaultResponse;
 const notices=createNotifications({messageCenterV2:true,context:()=>({...c}),api:async b=>{calls.push(structuredClone(b));return response(b);},apiUrl:'https://example.test/functions/v1/party-api',apiKey:'fixture',toast:x=>toasts.push(x),onNavigate:async n=>navigations.push(n),onOpenCategory:async category=>opened.push(category)});
 const click=async(notice,extra={})=>{const target={dataset:{notice,...extra},closest:()=>target};for(const fn of listeners.get('click')||[])await fn({target,preventDefault(){}});};
 const submit=async(target=form)=>{for(const fn of dialogListeners.get('submit')||[])await fn({target,preventDefault(){}});};
 return {notices,click,submit,c,calls,dialog,timers,toasts,navigations,opened,defaultResponse,setResponse:f=>response=f,get form(){return form;}};
}
test('actual notification entry uses the three-category controller, navigation uses its selected rows and mark-page does not read conversations',async t=>{
 const f=fixture(t);await f.notices.refresh();assert.match(f.notices.button(),/訊息中心/);assert.equal(f.timers.length,1);
 const before=f.calls.filter(b=>b.op==='messageCenter').length;await f.notices.refresh();assert.equal(f.calls.filter(b=>b.op==='messageCenter').length,before,'idle refresh builds no page snapshot');
 await f.click('open');assert.match(f.dialog.innerHTML,/訊息中心/);assert.equal(f.calls.filter(b=>b.op==='messageCenter').length,1);
 await f.click('centerCategory',{category:'message'});await f.click('readPage');const mark=f.calls.find(b=>b.op==='messageCenterRead');assert.equal(mark.category,'message');assert.deepEqual(mark.ids,[id(2)]);assert.ok(f.calls.every(b=>b.op!=='chatRead'&&b.op!=='noticeRead'));
 await f.click('view',{noticeId:id(2)});assert.equal(f.navigations.length,1);assert.equal(f.navigations[0].type,'message');assert.equal(f.dialog.open,false);
 await f.click('open');await f.click('centerCategory',{category:'message'});await f.click('centerConversation');assert.deepEqual(f.opened,['message']);
});
test('actual scoped settings submit writes only display keys and cannot toast/reopen after same-identity replacement modal',async t=>{
 const f=fixture(t,'super_admin');await f.click('open');await f.click('centerScope',{scope:'space'});assert.match(f.dialog.innerHTML,/目前空間 · 全部主播/);
 await f.click('centerSettings');const form=f.form;form.fields.delete('message.center');await f.submit(form);const write=f.calls.find(b=>b.op==='messageCenterPreferences'&&b.settings);assert.equal(write.scopeMode,'space');assert.deepEqual(write.settings.types.message,{center:false,badge:true});assert.ok(Object.values(write.settings.types).every(value=>Object.keys(value).sort().join(',')==='badge,center'));
 await f.click('centerSettings');const old=f.form,pending=deferred();f.setResponse(b=>b.op==='messageCenterPreferences'&&b.settings?pending.promise:f.defaultResponse(b));const submission=f.submit(old);await f.click('centerSettings');const replacement=f.form,toasts=f.toasts.length;pending.resolve(await f.defaultResponse({op:'messageCenterPreferences',scopeMode:'space'}));await submission;assert.equal(f.form,replacement);assert.equal(f.toasts.length,toasts);
});
test('actual refresh invalidates the center when selected host or Account changes, including a president global delivery identity',async t=>{
 const f=fixture(t,'super_admin');await f.click('open');assert.equal(f.dialog.open,true);f.c.selectedStreamer='michelle';f.c.streamerId='michelle';f.c.selectedStreamerName='咪醬';await f.notices.refresh();assert.equal(f.dialog.open,false);
 await f.click('open');assert.match(f.dialog.innerHTML,/咪醬/);f.c.accountId='replacement';await f.notices.refresh();assert.equal(f.dialog.open,false);
});


test('compact header bell uses the same scoped category badge without another read, subscription or audio button',async t=>{
 const f=fixture(t);await f.notices.refresh();const before=f.calls.length;
 const html=f.notices.button(true);assert.match(html,/class="notice-bell"/);assert.match(html,/aria-label="訊息中心，1 則未讀"/);
 assert.match(html,/data-notice="open"/);assert.match(html,/notice-count">1</);assert.doesNotMatch(html,/enableAudio/);
 assert.equal(f.calls.length,before);assert.equal(f.timers.length,1);
});
