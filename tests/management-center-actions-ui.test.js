import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformManagement} from '../src/platform-management.js';

class FakeFormData{
 constructor(form){this.data=form.fields;}
 get(key){const value=this.data[key];return Array.isArray(value)?value[0]:value??null;}
 getAll(key){const value=this.data[key];return value==null?[]:Array.isArray(value)?value:[value];}
 has(key){return this.data[key]!==undefined;}
 *[Symbol.iterator](){for(const [key,value] of Object.entries(this.data))if(value!==undefined)for(const item of Array.isArray(value)?value:[value])yield [key,item];}
}
globalThis.FormData=FakeFormData;
const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(resolve=>setTimeout(resolve,0));};
const form=(type,fields,checkboxes=[])=>({dataset:{pmForm:type},fields,matches:()=>true,querySelectorAll:()=>checkboxes.map(name=>({name}))});
const token='0123456789abcdef0123456789abcdef';
const shengma={id:'space-001',kind:'hall',name:'聲瑪',status:'active',revision:3,operational:true,homePath:'/sm',managerCount:1,managers:[{name:'怕怕'}],hostCount:2,hosts:[
 {id:'papa',spaceId:'space-001',spaceName:'聲瑪',name:'怕怕',slug:'pa',active:true,loginEnabled:true,loginExists:true,accountReady:true,operational:true,homePath:'/pa'},
 {id:'mi',spaceId:'space-001',spaceName:'聲瑪',name:'咪醬',slug:'mi',active:true,loginEnabled:false,loginExists:false,accountReady:false,operational:true,homePath:null}]};
const fairy={id:'space-fairy',kind:'independent',name:'仙女',status:'suspended',provisioningPending:true,revision:1,operational:false,managerCount:0,managers:[],hostCount:0,hosts:[]};
const directory=(rows=[shengma,fairy])=>({rows,total:rows.length,page:1,pages:1,summary:{halls:1,streamerSpaces:2,pendingSetup:1},registryRevision:9});

function controller(handler,extra={}){
 const calls=[];let ids=0;
 const c=createPlatformManagement({api:async body=>{calls.push(body);return handler(body,calls);},identity:()=> 'president',escape,changed:()=>{},uuid:()=>'op-'+(++ids),...extra});
 const root={querySelector:()=>null,contains:()=>true};
 const press=async(action,id='')=>{c.bind(root);root.onclick({target:{closest:()=>({dataset:{pmAction:action,pmId:id},isConnected:false,closest:()=>null,textContent:''})}});await tick();};
 const send=async(type,fields,checkboxes=[])=>{c.bind(root);root.onsubmit({target:form(type,fields,checkboxes),preventDefault(){}});await tick();};
 return {c,calls,press,send,modal:()=>c.html().split('<template data-pm-dialog-content>')[1]||''};
}

test('every hall, hall streamer and independent card offers the confirmed actions with a red delete',async()=>{
 const opened=[];const {c}=controller(()=>directory(),{openStreamerAdmin:row=>opened.push(row),streamerHome:()=>{}});
 await c.load();const html=c.html();
 const hall=html.slice(html.indexOf('<h2>聲瑪</h2>'),html.indexOf('<h2>仙女</h2>'));
 for(const label of ['＋新增廳內主播','綁定已有帳號','編輯資料','編輯管理權限','查看專屬首頁'])assert.ok(hall.includes(label),label);
 assert.ok(!hall.includes('刪除廳'),'聲瑪 itself can never be deleted');
 const papa=hall.slice(hall.indexOf('<b>怕怕</b>'),hall.indexOf('<b>咪醬</b>')),mi=hall.slice(hall.indexOf('<b>咪醬</b>'));
 for(const label of ['登入設定','綁定已有帳號','編輯資料','編輯管理權限','進入管理後台','查看專屬首頁'])assert.ok(papa.includes(label),label);
 assert.ok(!papa.includes('pm-danger'),'the original streamer is protected');
 assert.ok(mi.includes('建立登入帳號')&&mi.includes('class="pm-danger"')&&mi.includes('>刪除<'));
 const independent=html.slice(html.indexOf('<h2>仙女</h2>'));
 for(const label of ['建立主播資料與登入帳號','編輯資料','編輯管理權限','營運啟用設定','刪除獨立主播'])assert.ok(independent.includes(label),label);
 assert.ok(!independent.includes('所屬廳'),'independent streamers never select a hall');
 assert.ok(!independent.includes('進入管理後台'),'non-operational Space has no admin entry yet');
});

test('creating an independent streamer is one request with login code and password, never a hall choice',async()=>{
 const {c,calls,press,send,modal}=controller(body=>body.op==='platformProvisionStreamer'?{spaceId:'space-new',streamerId:'room-new',slug:'fairy',accountId:'acct',loginExists:true,loginEnabled:true}:directory());
 await c.load();await press('create-space');
 c.state().editor.draft.kind='independent';
 let dialog=modal();assert.ok(dialog.includes('登入代碼')&&dialog.includes('登入密碼')&&dialog.includes('再次輸入密碼'));assert.ok(!dialog.includes('name="spaceId"')&&dialog.includes('不需要選擇所屬廳'));
 await send('create-space',{name:'仙女',kind:'independent',slug:'fairy',password:'fairy-pass-1',passwordConfirm:'other',loginEnabled:'on'},['loginEnabled']);
 assert.match(c.state().error,/密碼不一致/);assert.ok(!calls.some(b=>b.op==='platformProvisionStreamer'));
 await send('create-space',{name:'仙女',kind:'independent',slug:'fairy',password:'fairy-pass-1',passwordConfirm:'fairy-pass-1',loginEnabled:'on'},['loginEnabled']);
 const request=calls.find(b=>b.op==='platformProvisionStreamer');
 assert.deepEqual({...request,operationId:undefined},{op:'platformProvisionStreamer',mode:'independent',spaceName:'仙女',descriptor:{display_name:'仙女',slug:'fairy'},password:'fairy-pass-1',loginEnabled:true,management:true,operationId:undefined});
 assert.ok(!('spaceId' in request));
 dialog=modal();assert.ok(dialog.includes('已建立')&&dialog.includes('<b>fairy</b>')&&dialog.includes('第 2 批'));assert.ok(!dialog.includes('data-pm-action="enter-admin"'));
 assert.ok(!JSON.stringify(c.state()).includes('fairy-pass-1'),'password never kept in controller state');
});

test('adding a hall streamer creates its login at once and offers the admin entry for an operational hall',async()=>{
 const opened=[];
 const {c,calls,press,send,modal}=controller(body=>body.op==='platformProvisionStreamer'?{spaceId:'space-001',streamerId:'new-room',slug:'star',accountId:'acct',loginExists:true,loginEnabled:true}:directory(),{openStreamerAdmin:row=>opened.push(row)});
 await c.load();await press('add-hall-host','space-001');
 assert.ok(modal().includes('所屬廳：聲瑪'));
 await send('streamer',{spaceId:'space-001',display_name:'星星',slug:'star',home_title:'',subtitle:'',active:'on',password:'star-pass-1',passwordConfirm:'star-pass-1',loginEnabled:'on'},['active','loginEnabled']);
 const request=calls.find(b=>b.op==='platformProvisionStreamer');
 assert.equal(request.spaceId,'space-001');assert.equal(request.mode,'streamer');assert.equal(request.loginEnabled,true);assert.ok(!('id' in request.descriptor));
 assert.ok(modal().includes('data-pm-action="enter-admin"'));
 await press('enter-admin','new-room');assert.equal(opened[0].slug,'star');
});

test('backfilling a login reads canonical status, retries with the same operation and never stores the password',async()=>{
 let fail=true;
 const {c,calls,press,send,modal}=controller(body=>{
  if(body.op==='platformStreamerLoginStatus')return {exists:false,enabled:false,slug:'mi',operational:true};
  if(body.op==='platformStreamerLogin'){if(fail){fail=false;throw Error('connection lost');}return {spaceId:'space-001',streamerId:'mi',slug:'mi',accountId:'acct',loginExists:true,loginEnabled:true};}
  return directory();});
 await c.load();await press('credentials','mi');
 assert.equal(calls.at(-1).op,'platformStreamerLoginStatus');assert.deepEqual([calls.at(-1).spaceId,calls.at(-1).streamerId],['space-001','mi']);
 assert.ok(modal().includes('建立登入帳號')&&modal().includes('<b>mi</b>'));
 const fields={password:'mi-pass-1',passwordConfirm:'mi-pass-1',enabled:'on'};
 await send('credentials',fields,['enabled']);assert.match(c.state().error,/connection lost/);
 await send('credentials',fields,['enabled']);
 const writes=calls.filter(b=>b.op==='platformStreamerLogin');assert.equal(writes.length,2);assert.equal(writes[0].operationId,writes[1].operationId);
 assert.deepEqual([writes[1].enabled,writes[1].password],[true,'mi-pass-1']);
 assert.ok(modal().includes('登入帳號已建立'));assert.ok(!JSON.stringify(c.state()).includes('mi-pass-1'));
});

test('delete shows exactly what is removed and kept, requires the typed name, and blocked data offers archive instead',async()=>{
 const safe={target:{kind:'streamer',spaceId:'space-001',streamerId:'mi',name:'咪醬'},blockers:[],removes:[{label:'主播資料與首頁設定',count:1}],keeps:[{label:'操作歷史',count:3}],affectedStreamers:[],safeToDelete:true,confirmationToken:token};
 let report=safe;
 const {c,calls,press,send,modal}=controller(body=>body.op==='platformDeleteReview'?report:body.op==='platformDelete'?{deleted:true}:directory());
 await c.load();await press('delete','mi');
 let dialog=modal();assert.ok(dialog.includes('將移除')&&dialog.includes('主播資料與首頁設定')&&dialog.includes('會保留')&&dialog.includes('請輸入「咪醬」確認刪除'));
 assert.ok(dialog.includes('class="pm-danger"'));
 await send('delete',{confirmedName:'咪醬'});
 const request=calls.find(b=>b.op==='platformDelete');
 assert.deepEqual([request.spaceId,request.streamerId,request.confirmationToken,request.confirmedName],['space-001','mi',token,'咪醬']);
 assert.ok(modal().includes('已永久刪除'));
 report={...safe,safeToDelete:false,blockers:[{label:'存歌／帳務',count:12},{label:'勳章取得紀錄',count:1001,capped:true}],removes:[]};
 await press('close-editor');await press('delete','mi');dialog=modal();
 assert.ok(dialog.includes('不能永久刪除')&&dialog.includes('存歌／帳務')&&dialog.includes('1001+ 筆')&&dialog.includes('停用並封存'));
 assert.ok(!dialog.includes('data-pm-form="delete"'),'no delete form while important data exists');
 const hall={...safe,target:{kind:'space',spaceId:'space-x',name:'測試廳'},safeToDelete:false,blockers:[{code:'HAS_STREAMERS',label:'此空間仍有主播，不會自動連帶刪除；請先逐一刪除或移出：甲、乙',count:2}],affectedStreamers:[{id:'a',name:'甲'},{id:'b',name:'乙'}]};
 report=hall;c.state().rows.push({id:'space-x',kind:'hall',name:'測試廳',status:'active',hosts:[]});await press('close-editor');await press('delete','space-x');
 dialog=modal();assert.ok(dialog.includes('會受影響的主播：甲、乙')&&dialog.includes('停用空間'));
});

test('accounts tab lists every management Account with codes and roles, and binding pre-selects the chosen Account',async()=>{
 const accounts={rows:[{id:'p',name:'平台總裁',kind:'president',roles:[],roleCount:0},{id:'f',name:'仙女',kind:'streamer',loginCode:'fairy',roles:[{spaceName:'仙女',streamerName:'仙女',role:'streamer_admin',status:'active'}],roleCount:1}],total:2,page:1,pages:1};
 const {c,calls,press,modal}=controller(body=>body.op==='platformAccounts'?accounts:body.op==='platformManagementDetail'?{space:{id:'space-001',name:'聲瑪',revision:3},streamer:{descriptor:{id:'mi',display_name:'咪醬'}},memberships:[],canManageMemberships:true}:directory());
 await c.load({section:'accounts',q:'',page:1});
 assert.equal(calls[0].op,'platformAccounts');const html=c.html();
 assert.ok(html.includes('登入代碼 fairy')&&html.includes('仙女・仙女（主播）')&&html.includes('可管理全部廳及主播'));
 await press('account-memberships','f');assert.equal(c.state().section,'all-spaces');assert.ok(c.html().includes('為「仙女」選擇要綁定的空間'));
 await press('bind-account','mi');
 const dialog=c.html();assert.ok(dialog.includes('綁定已有帳號 · 咪醬')&&dialog.includes('選擇要綁定的帳號'));assert.ok(dialog.includes('<strong>仙女</strong>'));
 assert.equal(c.state().editor.draft.role,'streamer_admin');
 await press('lookup-accounts','accountId');assert.equal(calls.at(-1).op,'platformAccounts');
 assert.ok(modal().includes('全新的廳管理員專屬登入帳號屬第 3 批'));
});

test('readiness explains each requirement and offers direct actions for missing logins',async()=>{
 const readiness={spaceId:'space-fairy',name:'仙女',kind:'independent',status:'suspended',operational:false,hosts:[{id:'fairy',name:'仙女',slug:'fairy',login:false,account:false}],
  items:[{code:'streamer',done:true,label:'主播資料',detail:'已建立 1 位主播'},{code:'login',done:false,label:'登入帳號',detail:'尚未建立登入：仙女'},{code:'operations',done:false,label:'營運功能（歌本、點歌、存歌、帳務）',detail:'新空間的營運功能屬第 2 批開放項目'}]};
 const {c,calls,press,modal}=controller(body=>body.op==='platformSpaceReadiness'?readiness:body.op==='platformStreamerLoginStatus'?{exists:false,enabled:false,slug:'fairy'}:directory());
 await c.load();await press('readiness','space-fairy');
 const dialog=modal();assert.ok(dialog.includes('✓ 主播資料')&&dialog.includes('○ 登入帳號')&&dialog.includes('不會為了移除提示而略過會員方案或權限'));
 await press('credentials-by-id','fairy');assert.deepEqual([calls.at(-1).op,calls.at(-1).spaceId,calls.at(-1).streamerId],['platformStreamerLoginStatus','space-fairy','fairy']);
});

test('readiness without amounts still offers 開放營運 and a direct 填寫價目 button',async()=>{
 const readiness={spaceId:'space-fairy',name:'仙女',kind:'independent',status:'suspended',operational:false,canActivate:true,hosts:[{id:'fairy',name:'仙女',slug:'fairy',login:true,account:true}],
  items:[{code:'streamer',done:true,label:'主播資料',detail:'已建立 1 位主播'},{code:'login',done:true,label:'登入帳號',detail:'每位主播都已有可登入帳號'},{code:'pricing',done:false,label:'價目設定',detail:'尚未填寫金額：玩家點歌會顯示 0，建議開放前先到「價目設定」填好'},{code:'operations',done:false,label:'開放營運',detail:'可按「開放營運」'}]};
 const {c,calls,press,modal}=controller(body=>body.op==='platformSpaceReadiness'?readiness:directory());
 await c.load();await press('readiness','space-fairy');
 const dialog=modal();assert.ok(dialog.includes('○ 價目設定')&&dialog.includes('填寫價目')&&dialog.includes('開放營運'));
 await press('pricing','space-fairy');assert.deepEqual([calls.at(-1).op,calls.at(-1).spaceId],['platformSpacePricing','space-fairy']);
 readiness.items[2].done=true;await c.load();await press('readiness','space-fairy');assert.ok(!modal().includes('填寫價目'));
});
