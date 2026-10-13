import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createNativePlayerProvisioner} from '../src/native-player-provisioning.js';
import {installPageJumps} from '../src/ui-page-jumps.js';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const line=prefix=>source.split(/\r?\n/).find(row=>row.startsWith(prefix));
const helpers=source.slice(source.indexOf('function nativePlayerProvisionContext('),source.indexOf('async function api('));
const entry=source.slice(source.indexOf('function showSpaceEntry('),source.indexOf('async function enterSpace('));
const plain=value=>JSON.parse(JSON.stringify(value));
const escape=value=>String(value??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
const manager='10000000-0000-4000-8000-000000000001',account='20000000-0000-4000-8000-000000000001',membership='30000000-0000-4000-8000-000000000001';
const legacy={id:'space-001',name:'Original',streamerId:'papa'},native={id:'space-native',name:'New Space',streamerId:'native-room'};
const eligible={accountId:account,membershipId:membership,spaceId:native.id,role:'player',status:'active',createdAt:'2026-10-09T00:00:00Z',displayLabel:'<Player>'};
const page=()=>({revision:7,rows:[eligible],total:1,pageLimit:20,pageOffset:0});
const account2='20000000-0000-4000-8000-000000000002',membership2='30000000-0000-4000-8000-000000000002';
const eligible2={...eligible,accountId:account2,membershipId:membership2,displayLabel:'Second Account'};
const batchText='<First>|ID-1|Alias|Confirmed|Private note\nSecond|ID-2|Old name|Verified|Another note';
const batchData=[{name:'<First>',ids:'ID-1',names:'Alias',certification:'Confirmed',note:'Private note'},
 {name:'Second',ids:'ID-2',names:'Old name',certification:'Verified',note:'Another note'}];
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

function harness({respond}={}){
 const calls=[],messages=[],dialogs=[],nodes=new Map(),listeners=[];
 let context,form;
 const dialog={open:false,addEventListener:(name,fn)=>{if(name==='close')listeners.push(fn);},close:()=>{dialog.open=false;if(form)form.isConnected=false;nodes.delete('#native-player-form');for(const fn of listeners.splice(0))fn();}};
 const data={name:'New Player',ids:'ID-1',names:'Alias',certification:'Confirmed',note:'Private note'};
 const createForm=html=>{
  if(form)form.isConnected=false;
  const fieldset={disabled:false},submit={disabled:true};
  form={isConnected:true,onsubmit:null,querySelector:selector=>selector==='fieldset'?fieldset:selector==='[type=submit]'?submit:nodes.get(selector)||null};
  nodes.set('#native-player-form',form);nodes.set('#native-player-error',{textContent:''});
  nodes.set('#native-player-query',{id:'native-player-query',value:'',type:'search',matches:selector=>selector==='input'});
  nodes.set('#native-player-candidates',{_html:'',get innerHTML(){return this._html;},set innerHTML(value){this._html=value;const input={id:'native-player-query',value:value.match(/id="native-player-query"[^>]*value="([^"]*)"/)?.[1]||'',type:'search',matches:selector=>selector==='input'};nodes.set('#native-player-query',input);}});
  if(html.includes('native-player-import')){nodes.set('#native-player-import',{id:'native-player-import',value:'',type:'textarea',matches:()=>false});nodes.set('#native-player-batch-preview',{innerHTML:''});}
  else {nodes.delete('#native-player-import');nodes.delete('#native-player-batch-preview');}
 };
 context=vm.createContext({
  nativePlayerView:{open:false,space:null,generation:0},entryPending:true,entryOffset:0,entryTotal:0,entryChoices:[legacy,native],entryIdentity:null,
  admin:{role:'super_admin',accountId:manager},demo:false,draft:null,route:'admin',
  state:{revision:9,currentStreamer:{id:'papa',spaceId:'space-001'},players:[],queue:[{id:'preserved'}],ledger:[{id:'credit',amount:3}]},
  h:escape,blank:text=>'<p>'+escape(text)+'</p>',button:(label,action,id='',classes='',extra='')=>'<button type="button" data-act="'+action+'" data-id="'+escape(id)+'" class="'+classes+'" '+extra+'>'+label+'</button>',
  card:(title,html)=>'<section>'+html+'</section>',header:()=>{},prepareNoticeLanding:()=>null,renderNoticeLanding:()=>{},unavailableReadScope:null,syncReadIdentity:()=>'fixture-scope',toast:message=>messages.push(message),isSuperAdmin:()=>context.admin?.role==='super_admin',
  FormData:class {get(key){return data[key]??'';}},
  $:selector=>selector==='#dialog'?dialog:nodes.get(selector)||null,
  modal:(title,html,submit)=>{dialogs.push({title,html,submit});dialog.open=true;if(html.includes('native-player-form'))createForm(html);},
  api:body=>{calls.push(plain(body));return respond?respond(body):Promise.resolve(body.op==='nativePlayerEligibility'?page():{revision:8,created:[{playerId:'N1',name:'New Player'}]});}
 });
 context.entryIdentity=context.admin;nodes.set('#app',{innerHTML:''});
 const actions=source.slice(source.indexOf("case 'nativePlayerPrepare':"),source.indexOf("case 'switchSpace':",source.indexOf("case 'nativePlayerPrepare':")));
 const jumps=source.slice(source.indexOf('async function jumpRemotePage('),source.indexOf('installPageJumps({onJump:jumpRemotePage'));
 vm.runInContext(helpers+entry+'\n'+['const field=','const area=','const check=','function editPlayer('].map(line).join('\n')+'\n'+jumps+'\nasync function nativeUiAction(a,id){try{switch(a){'+actions+'}}catch(error){toast(error.message);}}',context);
 context.nativePlayerProvisioner=createNativePlayerProvisioner({api:context.api,context:context.nativePlayerProvisionContext,onChange:context.renderNativePlayerProvision});
 return {context,calls,messages,dialogs,nodes,dialog,data,get form(){return form;},run:code=>vm.runInContext(code,context),
  action:(action,id='')=>context.nativeUiAction(action,id),
  input:value=>{const target=nodes.get('#native-player-import');target.value=value;form.oninput({target});}};
}

test('verified native entry exposes setup only to the President; legacy entry and unrelated actors retain their existing path',async()=>{
 const u=harness();u.run('showSpaceEntry({spaces:entryChoices,hasMore:false})');
 const html=u.nodes.get('#app').innerHTML;assert.match(html,/data-act="nativePlayerPrepare" data-id="space-native"/);assert.doesNotMatch(html,/data-act="nativePlayerPrepare" data-id="space-001"/);
 for(const admin of [null,{role:'streamer_admin',accountId:manager},{role:'super_admin'},{role:'player',accountId:manager}]){
  const denied=harness();denied.context.admin=admin;denied.context.entryIdentity=admin;
  await assert.rejects(denied.run("openNativePlayerProvision('space-native')"));assert.equal(denied.calls.length,0);
 }
 for(const code of ["entryPending=false","draft={state:{}}","demo=true","entryIdentity={role:'player',accountId:admin.accountId}"]){
  const denied=harness();denied.run(code);await assert.rejects(denied.run("openNativePlayerProvision('space-native')"));assert.equal(denied.calls.length,0);
 }
 await assert.rejects(u.run("openNativePlayerProvision('unverified-url-hint')"));await assert.rejects(u.run("openNativePlayerProvision('space-001')"));assert.equal(u.calls.length,0);
});

test('real form uses one bounded eligibility read and an explicit Account/Membership write without replacing room state',async()=>{
 const u=harness(),before=plain(u.context.state);await u.run("openNativePlayerProvision('space-native')");
 assert.deepEqual(u.calls,[{op:'nativePlayerEligibility',spaceId:native.id,query:'',page:0,limit:20,management:true}]);
 const html=u.dialogs[0].html;assert.match(html,/新增玩家|native-player-form/);assert.match(html,/玩家名稱/);assert.doesNotMatch(html,/name="(?:password|balance|test|accountId|membershipId)"/);
 assert.ok(html.includes('maxlength="1000"'));assert.match(u.nodes.get('#native-player-candidates').innerHTML,/&lt;Player&gt;/);
 assert.equal(u.form.querySelector('[type=submit]').disabled,true);
 u.context.nativePlayerProvisioner.selectAccount(account);assert.equal(u.form.querySelector('[type=submit]').disabled,false);
 await u.form.onsubmit({preventDefault(){}});
 assert.deepEqual(u.calls[1],{op:'nativePlayerProvision',streamer:native.streamerId,spaceId:native.id,revision:7,rows:[{accountId:account,membershipId:membership,...u.data}],management:true});
 assert.equal(u.calls.length,2);assert.deepEqual(plain(u.context.state),before);assert.deepEqual(u.messages,['已建立 1 位玩家資料']);assert.equal(u.dialog.open,false);
});

test('closing a pending eligibility dialog or changing verified identity discards late results',async()=>{
 for(const close of [u=>u.dialog.close(),u=>u.context.admin={role:'super_admin',accountId:'10000000-0000-4000-8000-000000000002'},u=>u.context.entryChoices=[legacy]]){
  let finish;const u=harness({respond:()=>new Promise(resolve=>finish=resolve)}),pending=u.run("openNativePlayerProvision('space-native')");
  await Promise.resolve();close(u);finish(page());await pending;
  assert.equal(u.context.nativePlayerProvisioner.state().rows.length,0);assert.equal(u.messages.length,0);assert.equal(u.calls.length,1);
 }
});

test('closing during a real write cannot close a later dialog or apply its result to another view',async()=>{
 let finish;const u=harness({respond:body=>body.op==='nativePlayerEligibility'?Promise.resolve(page()):new Promise(resolve=>finish=resolve)});
 await u.run("openNativePlayerProvision('space-native')");u.context.nativePlayerProvisioner.selectAccount(account);
 const pending=u.form.onsubmit({preventDefault(){}});await Promise.resolve();assert.equal(u.form.querySelector('fieldset').disabled,true);
 u.dialog.close();u.dialog.open=true;finish({revision:8,created:[{playerId:'N1',name:'New Player'}]});await pending;
 assert.equal(u.dialog.open,true);assert.equal(u.messages.length,0);assert.equal(u.context.state.revision,9);assert.equal(u.calls.length,2);
});

test('legacy new-player form retains its original fields; native failures offer explicit retry without a timer',async()=>{
 const old=harness();old.run('editPlayer()');assert.match(old.dialogs[0].html,/name="password"/);assert.match(old.dialogs[0].html,/name="balance"/);
 const u=harness({respond:async()=>{throw Error('Search failed');}});
 await u.run("openNativePlayerProvision('space-native')");const html=u.nodes.get('#native-player-candidates').innerHTML;
 assert.match(html,/Search failed/);assert.match(html,/nativePlayerRetry/);assert.equal(u.calls.length,1);
});

test('silent token refresh keeps the same verified choice; replacing permitted destinations closes setup immediately',async()=>{
 const u=harness();await u.run("openNativePlayerProvision('space-native')");u.context.nativePlayerProvisioner.selectAccount(account);
 u.context.admin={...u.context.admin,token:'refreshed-same-account'};
 assert.equal(u.run('nativePlayerProvisionContext().active'),true);assert.equal(u.context.nativePlayerProvisioner.state().selectedAccountId,account);
 u.run('showSpaceEntry({spaces:[entryChoices[0]],hasMore:false})');assert.equal(u.dialog.open,false);assert.equal(u.context.nativePlayerProvisioner.state().rows.length,0);assert.equal(u.calls.length,1);
});

test('normal app rendering closes an unauthorized setup form before rendering another page',async()=>{
 const u=harness();await u.run("openNativePlayerProvision('space-native')");
 Object.assign(u.context,{playerArchiveView:{open:false},applyHomeTheme:()=>{},isAdmin:()=>false,renderHome:()=>{},loadVisibleFavoriteFlags:()=>{},loadFavorites:()=>{},loadListeningOverview:()=>{},achievementPanel:{load:async()=>{}},activityPage:{load:async()=>{}},route:'home',session:null,admin:null});
 vm.runInContext(line('function render(){'),u.context);u.run('render()');assert.equal(u.dialog.open,false);assert.equal(u.context.nativePlayerProvisioner.state().rows.length,0);assert.equal(u.calls.length,1);
});

async function prepareBatch(u,text=batchText){
 await u.action('nativePlayerBatchPrepare',native.id);
 u.input(text);await u.action('nativePlayerBatchPreview');
}
async function bindBatch(u,index,accountId){await u.action('nativePlayerBatchRow',String(index));await u.action('nativePlayerBatchBind',accountId);}
const batchResult=(rows=batchData)=>({revision:8,created:rows.map((row,index)=>({playerId:'N'+(index+1),name:row.name}))});

test('verified native entry exposes batch setup only for permitted native Spaces',async()=>{
 const u=harness();u.run('showSpaceEntry({spaces:entryChoices,hasMore:false})');
 const html=u.nodes.get('#app').innerHTML;
 assert.match(html,/data-act="nativePlayerBatchPrepare" data-id="space-native"/);
 assert.doesNotMatch(html,/data-act="nativePlayerBatchPrepare" data-id="space-001"/);
 for(const change of [u=>u.context.admin=null,u=>u.context.admin={role:'player',accountId:manager},u=>u.context.admin={role:'streamer_admin',accountId:manager},u=>u.context.entryChoices=[legacy]]){
  const denied=harness();change(denied);await denied.action('nativePlayerBatchPrepare',native.id);
  assert.equal(denied.calls.length,0);assert.equal(denied.dialogs.length,0);assert.equal(denied.messages.length,1);
 }
 await u.action('nativePlayerBatchPrepare',legacy.id);assert.equal(u.calls.length,0);assert.equal(u.dialogs.length,0);
});

test('batch form explicitly binds different eligibility pages and submits one complete transaction while keeping room state',async()=>{
 const u=harness({respond:async body=>body.op==='nativePlayerEligibility'
  ?{revision:7,rows:body.page===1||body.query==='Second'?[eligible2]:[eligible],total:body.query?1:21,pageLimit:20,pageOffset:body.page*20}
  :batchResult()}),before=plain(u.context.state);
 await prepareBatch(u);
 const html=u.dialogs[0].html;assert.match(html,/批量玩家資料/);assert.match(html,/一行一位/);
 assert.doesNotMatch(html,/name="(?:password|balance|test|accountId|membershipId)"/);
 assert.match(u.nodes.get('#native-player-batch-preview').innerHTML,/&lt;First&gt;/);
 assert.equal(u.form.querySelector('[type=submit]').disabled,true);
 await bindBatch(u,0,account);assert.equal(u.form.querySelector('[type=submit]').disabled,true);
 await u.action('nativePlayerPage','1');await bindBatch(u,1,account2);
 assert.equal(u.form.querySelector('[type=submit]').disabled,false);
 u.nodes.get('#native-player-query').value='Second';await u.action('nativePlayerSearch');
 assert.deepEqual(plain(u.context.nativePlayerProvisioner.state().batch.rows.map(row=>row.binding.accountId)),[account,account2]);
 assert.equal(u.form.querySelector('[type=submit]').disabled,false,'same revision search preserves both explicit bindings');
 await u.form.onsubmit({preventDefault(){}});
 assert.deepEqual(u.calls.filter(call=>call.op==='nativePlayerProvision'),[{op:'nativePlayerProvision',streamer:native.streamerId,spaceId:native.id,revision:7,
  rows:[{accountId:account,membershipId:membership,...batchData[0]},{accountId:account2,membershipId:membership2,...batchData[1]}],management:true}]);
 assert.equal(u.calls.filter(call=>call.op==='nativePlayerEligibility').length,3,'searching reads one bounded page each time');
 assert.deepEqual(plain(u.context.state),before);assert.deepEqual(u.messages,['已建立 2 位玩家資料']);assert.equal(u.dialog.open,false);
});

test('invalid preview rows prevent submission until explicitly skipped, and one Account cannot bind two rows',async()=>{
 const u=harness({respond:async body=>body.op==='nativePlayerEligibility'?{...page(),rows:[eligible,eligible2],total:2}:batchResult([{name:'First',ids:'',names:'',certification:'',note:''},{name:'Second',ids:'',names:'',certification:'',note:''}])});
 await prepareBatch(u,'First||||\n||||\nSecond||||');
 assert.ok(u.context.nativePlayerProvisioner.state().batch.rows[1].error);
 await bindBatch(u,0,account);await bindBatch(u,2,account);
 assert.equal(u.context.nativePlayerProvisioner.state().batch.rows[2].binding,null);
 assert.ok(u.messages.length,'duplicate explicit binding is rejected through the actual UI action');
 await bindBatch(u,2,account2);assert.equal(u.form.querySelector('[type=submit]').disabled,true);
 await u.form.onsubmit({preventDefault(){}});assert.equal(u.calls.length,1);assert.ok(u.nodes.get('#native-player-error').textContent);
 u.form.onchange({target:{dataset:{nativePlayerSkip:'1'},checked:true}});
 assert.equal(u.context.nativePlayerProvisioner.state().batch.rows[1].skip,true);assert.equal(u.form.querySelector('[type=submit]').disabled,false);
 await u.form.onsubmit({preventDefault(){}});
 assert.equal(u.calls[1].rows.length,2);assert.deepEqual(u.calls[1].rows.map(row=>row.name),['First','Second']);
 assert.equal(u.calls.length,2,'skipped invalid row is excluded from a single bounded write');
});

test('editing the import text invalidates preview and bindings; a missed input event is still rejected before writing',async()=>{
 const u=harness({respond:async()=>({...page(),rows:[eligible,eligible2],total:2})});
 await prepareBatch(u);await bindBatch(u,0,account);await bindBatch(u,1,account2);
 assert.equal(u.form.querySelector('[type=submit]').disabled,false);
 const input=u.nodes.get('#native-player-import');input.value=batchText+'\nChanged||||';
 await u.form.onsubmit({preventDefault(){}});
 assert.equal(u.calls.length,1);assert.match(u.nodes.get('#native-player-error').textContent,/修改|重新檢查/);
 u.form.oninput({target:input});assert.equal(u.context.nativePlayerProvisioner.state().batch.rows.length,0);
 assert.equal(u.form.querySelector('[type=submit]').disabled,true);assert.equal(u.nodes.get('#native-player-import').value,input.value,'rendering does not erase edited import text');
 await u.action('nativePlayerBatchPreview');assert.equal(u.context.nativePlayerProvisioner.state().batch.rows.length,3);
 assert.ok(u.context.nativePlayerProvisioner.state().batch.rows.every(row=>row.binding===null));
});

test('a new eligibility revision clears batch bindings and cannot submit the old choices',async()=>{
 const u=harness({respond:async body=>({...page(),revision:body.query?8:7,rows:[eligible,eligible2],total:2})});
 await prepareBatch(u);await bindBatch(u,0,account);await bindBatch(u,1,account2);
 u.nodes.get('#native-player-query').value='changed';await u.action('nativePlayerSearch');
 assert.equal(u.context.nativePlayerProvisioner.state().revision,8);
 assert.ok(u.context.nativePlayerProvisioner.state().batch.rows.every(row=>row.binding===null));
 assert.equal(u.form.querySelector('[type=submit]').disabled,true);
 await u.form.onsubmit({preventDefault(){}});assert.equal(u.calls.length,2);assert.ok(u.nodes.get('#native-player-error').textContent);
});

test('pending batch writes disable the form, reject repeat submits, and ignore completion after close, replacement or identity change',async()=>{
 for(const change of ['close','replace','identity']){
  let finish;const u=harness({respond:body=>body.op==='nativePlayerEligibility'?Promise.resolve({...page(),rows:[eligible,eligible2],total:2}):new Promise(resolve=>finish=resolve)});
  await prepareBatch(u);await bindBatch(u,0,account);await bindBatch(u,1,account2);
  const oldForm=u.form,pending=oldForm.onsubmit({preventDefault(){}});await settle();
  assert.equal(oldForm.querySelector('fieldset').disabled,true);assert.equal(oldForm.querySelector('[type=submit]').disabled,true);
  await oldForm.onsubmit({preventDefault(){}});assert.equal(u.calls.filter(call=>call.op==='nativePlayerProvision').length,1);
  if(change==='close'){u.dialog.close();u.dialog.open=true;}
  else if(change==='replace'){u.context.modal('Later dialog','<form id="native-player-form"></form>');}
  else {u.context.admin={role:'super_admin',accountId:'10000000-0000-4000-8000-000000000002'};u.run('renderNativePlayerProvision()');u.dialog.open=true;}
  finish(batchResult());await pending;
  assert.equal(u.dialog.open,true,change);assert.equal(u.messages.length,0,change);assert.equal(u.context.state.revision,9,change);
 }
});

test('batch write failure requires a new explicit eligibility read and does not retry automatically',async()=>{
 const u=harness({respond:async body=>{if(body.op==='nativePlayerEligibility')return {...page(),rows:[eligible,eligible2],total:2};throw Error('Acknowledgement lost');}});
 await prepareBatch(u);await bindBatch(u,0,account);await bindBatch(u,1,account2);
 await u.form.onsubmit({preventDefault(){}});await settle();
 assert.equal(u.calls.length,2);assert.equal(u.form.querySelector('[type=submit]').disabled,true);
 assert.match(u.nodes.get('#native-player-error').textContent,/Acknowledgement lost/);assert.equal(u.dialog.open,true);
 await u.form.onsubmit({preventDefault(){}});assert.equal(u.calls.length,2,'the uncertain write is not sent again from the same stale form');
 await u.action('nativePlayerRetry');assert.equal(u.calls.length,3);
 assert.ok(u.context.nativePlayerProvisioner.state().batch.rows.every(row=>row.binding===null));
 assert.equal(u.form.querySelector('[type=submit]').disabled,true,'a fresh read requires new explicit account choices');
});

test('Enter searches the native candidate list and IME Enter never submits the batch',async()=>{
 const u=harness({respond:async()=>({...page(),rows:[eligible,eligible2],total:2})});await prepareBatch(u);
 const query=u.nodes.get('#native-player-query');query.value='Second';let prevented=0,stopped=0;
 await query.onkeydown({key:'Enter',isComposing:false,target:query,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 await settle();assert.equal(prevented,1);assert.equal(stopped,1);
 assert.equal(u.calls.at(-1).op,'nativePlayerEligibility');assert.equal(u.calls.at(-1).query,'Second');assert.equal(u.calls.length,2);
 const current=u.nodes.get('#native-player-query');await current.onkeydown({key:'Enter',isComposing:true,target:current,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 u.form.onkeydown({key:'Enter',isComposing:true,target:current,preventDefault(){prevented++;}});
 assert.equal(prevented,2);assert.equal(u.calls.length,2,'IME confirmation does not search or write');
 let newlinePrevented=false;u.form.onkeydown({key:'Enter',isComposing:false,target:u.nodes.get('#native-player-import'),preventDefault(){newlinePrevented=true;}});
 assert.equal(newlinePrevented,false,'Enter in the import textarea remains a new line');
});

test('universal page jump Enter reads only its selected native page and preserves the current search and batch choices',async()=>{
 const u=harness({respond:async body=>({...page(),rows:body.page===1?[eligible2]:[eligible],total:21,pageOffset:body.page*20})});
 await prepareBatch(u,'First||||');await bindBatch(u,0,account);
 u.nodes.get('#native-player-query').value='kept';await u.action('nativePlayerSearch');
 const html=u.nodes.get('#native-player-candidates').innerHTML;
 assert.match(html,/data-remote-page="nativePlayerPage"/);assert.match(html,/data-remote-jump="nativePlayerPage"/);
 const listeners=new Map(),nav={dataset:{jumpReady:'true'},querySelector:selector=>selector==='[data-remote-jump]'?button:input};
 const input={value:'2',max:'2',dataset:{remotePage:'nativePlayerPage',targetId:''},closest:()=>nav,matches:selector=>selector==='[data-remote-page],[data-catalog-page]'};
 const button={dataset:{remoteJump:'nativePlayerPage'},closest:()=>nav};
 const root={querySelectorAll:()=>[nav],addEventListener:(name,fn)=>listeners.set(name,fn)};
 const savedObserver=globalThis.MutationObserver;globalThis.MutationObserver=class{observe(){}disconnect(){}};
 let disconnect;try{disconnect=installPageJumps({root,onJump:(...args)=>u.context.jumpRemotePage(...args),onError:message=>u.messages.push(message)});}finally{globalThis.MutationObserver=savedObserver;}
 let prevented=0;listeners.get('keydown')({key:'Enter',isComposing:false,target:input,preventDefault(){prevented++;}});await settle();
 assert.equal(prevented,1);assert.deepEqual(u.calls.at(-1),{op:'nativePlayerEligibility',spaceId:native.id,query:'kept',page:1,limit:20,management:true});
 assert.equal(u.context.nativePlayerProvisioner.state().batch.rows[0].binding.accountId,account);assert.equal(u.calls.filter(call=>call.op==='nativePlayerProvision').length,0);
 const before=u.calls.length;input.value='3';listeners.get('keydown')({key:'Enter',isComposing:false,target:input,preventDefault(){}});await settle();
 assert.equal(u.calls.length,before);assert.match(u.messages.at(-1),/1 到 2/);disconnect();
});

test('spreadsheet clipboard rows preserve five fields and embedded pipes without adding privileged inputs',async()=>{
 const data={name:'Clipboard player',ids:'ID-3,ID-4',names:'Old name',certification:'Verified',note:'Note | remains ｜ data'};
 const u=harness({respond:async body=>body.op==='nativePlayerEligibility'?page():batchResult([data])});
 await prepareBatch(u,'\n'+Object.values(data).join('\t')+'\n');await bindBatch(u,0,account);
 assert.equal(u.context.nativePlayerProvisioner.state().batch.rows[0].line,2);
 assert.deepEqual(plain(u.context.nativePlayerProvisioner.state().batch.rows[0].fields),data);
 await u.form.onsubmit({preventDefault(){}});
 assert.deepEqual(u.calls[1].rows,[{accountId:account,membershipId:membership,...data}]);
 assert.ok(Object.keys(u.calls[1].rows[0]).every(key=>['accountId','membershipId','name','ids','names','certification','note'].includes(key)));
});

test('oversized batch input clears an old preview and cannot send an old prepared transaction',async()=>{
 const u=harness();await prepareBatch(u,'First||||');await bindBatch(u,0,account);
 assert.equal(u.form.querySelector('[type=submit]').disabled,false);
 u.input(Array.from({length:101},(_,index)=>'Player '+index+'||||').join('\n'));await u.action('nativePlayerBatchPreview');
 assert.equal(u.context.nativePlayerProvisioner.state().batch.rows.length,0);assert.equal(u.form.querySelector('[type=submit]').disabled,true);
 assert.match(u.messages.at(-1),/100/);await u.form.onsubmit({preventDefault(){}});assert.equal(u.calls.length,1);
});

test('late native reads and writes cannot edit a replacement form sharing the same DOM IDs',async()=>{
 for(const stage of ['read','write']){
  let finish;
  const u=harness({respond:body=>stage==='read'||body.op==='nativePlayerProvision'?new Promise(resolve=>finish=resolve):Promise.resolve({...page(),rows:[eligible,eligible2],total:2})});
  let pending;
  if(stage==='read'){pending=u.action('nativePlayerBatchPrepare',native.id);await settle();}
  else {await prepareBatch(u);await bindBatch(u,0,account);await bindBatch(u,1,account2);pending=u.form.onsubmit({preventDefault(){}});await settle();}
  u.context.modal('Later form','<form id="native-player-form"><textarea id="native-player-import"></textarea><div id="native-player-batch-preview"></div></form>');
  const replacement=u.form,candidates=u.nodes.get('#native-player-candidates'),preview=u.nodes.get('#native-player-batch-preview');
  candidates.innerHTML='New dialog candidate content';preview.innerHTML='New dialog preview content';replacement.querySelector('fieldset').disabled=true;
  finish(stage==='read'?page():batchResult());await pending;
  assert.equal(u.dialog.open,true,stage);assert.equal(u.form,replacement,stage);
  assert.equal(candidates.innerHTML,'New dialog candidate content',stage);assert.equal(preview.innerHTML,'New dialog preview content',stage);
  assert.equal(replacement.querySelector('fieldset').disabled,true,stage);assert.equal(u.messages.length,0,stage);
 }
});

test('Space entry uses the universal bounded page jump with the current identity and never launches legacy batch setup',async()=>{
 const u=harness(),identity=u.context.entryIdentity,reads=[];u.context.entryOffset=50;
 u.run('showSpaceEntry({spaces:entryChoices,total:125,hasMore:true})');
 const html=u.nodes.get('#app').innerHTML;assert.match(html,/第 2 頁 · 共 125 個空間/);
 assert.doesNotMatch(html,/data-act="nativePlayerBatchPrepare" data-id="space-001"/);
 const inputHtml=html.match(/<input\b[^>]*data-remote-page="entryPage"[^>]*>/)?.[0];assert.ok(inputHtml);
 assert.match(inputHtml,/value="2"/);assert.match(inputHtml,/max="3"/);
 u.context.openSpaceEntry=async options=>{reads.push({options:plain(options),identity:u.context.entryIdentity});};
 const listeners=new Map(),nav={dataset:{jumpReady:'true'},querySelector:selector=>selector==='[data-remote-jump]'?button:input};
 const input={value:'3',max:inputHtml.match(/max="(\d+)"/)[1],dataset:{remotePage:'entryPage',targetId:''},closest:()=>nav,matches:selector=>selector==='[data-remote-page],[data-catalog-page]'};
 const button={dataset:{remoteJump:'entryPage'},closest:()=>nav},root={querySelectorAll:()=>[nav],addEventListener:(name,fn)=>listeners.set(name,fn)};
 const savedObserver=globalThis.MutationObserver;globalThis.MutationObserver=class{observe(){}disconnect(){}};
 let disconnect;try{disconnect=installPageJumps({root,onJump:(...args)=>u.context.jumpRemotePage(...args),onError:message=>u.messages.push(message)});}finally{globalThis.MutationObserver=savedObserver;}
 let prevented=0;listeners.get('keydown')({key:'Enter',isComposing:false,target:input,preventDefault(){prevented++;}});await settle();
 assert.equal(prevented,1);assert.equal(reads.length,1);assert.deepEqual(reads[0].options,{list:true,offset:100});assert.equal(reads[0].identity,identity);
 assert.equal(u.context.entryIdentity,identity);assert.equal(u.context.admin,identity);assert.equal(u.calls.length,0);assert.equal(u.dialogs.length,0);
 input.value='4';listeners.get('keydown')({key:'Enter',isComposing:false,target:input,preventDefault(){}});await settle();
 assert.equal(reads.length,1);assert.equal(u.calls.length,0);assert.match(u.messages.at(-1),/1 到 3/);
 await u.action('nativePlayerBatchPrepare',legacy.id);assert.equal(u.calls.length,0);assert.equal(u.dialogs.length,0);disconnect();
});

