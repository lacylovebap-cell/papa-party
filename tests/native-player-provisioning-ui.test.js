import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createNativePlayerProvisioner} from '../src/native-player-provisioning.js';

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

function harness({respond}={}){
 const calls=[],messages=[],dialogs=[],nodes=new Map(),listeners=[];
 let context,form;
 const dialog={open:false,addEventListener:(name,fn)=>{if(name==='close')listeners.push(fn);},close:()=>{dialog.open=false;if(form)form.isConnected=false;nodes.delete('#native-player-form');for(const fn of listeners.splice(0))fn();}};
 const data={name:'New Player',ids:'ID-1',names:'Alias',certification:'Confirmed',note:'Private note'};
 const createForm=()=>{const fieldset={disabled:false},submit={disabled:true};form={isConnected:true,onsubmit:null,querySelector:selector=>selector==='fieldset'?fieldset:selector==='[type=submit]'?submit:null};nodes.set('#native-player-form',form);nodes.set('#native-player-candidates',{innerHTML:''});nodes.set('#native-player-error',{textContent:''});nodes.set('#native-player-query',{value:''});};
 context=vm.createContext({
  nativePlayerView:{open:false,space:null,generation:0},entryPending:true,entryOffset:0,entryChoices:[legacy,native],entryIdentity:null,
  admin:{role:'super_admin',accountId:manager},demo:false,draft:null,route:'admin',
  state:{revision:9,currentStreamer:{id:'papa',spaceId:'space-001'},players:[],queue:[{id:'preserved'}],ledger:[{id:'credit',amount:3}]},
  h:escape,blank:text=>'<p>'+escape(text)+'</p>',button:(label,action,id='',classes='',extra='')=>'<button type="button" data-act="'+action+'" data-id="'+escape(id)+'" class="'+classes+'" '+extra+'>'+label+'</button>',
  card:(title,html)=>'<section>'+html+'</section>',header:()=>{},toast:message=>messages.push(message),isSuperAdmin:()=>context.admin?.role==='super_admin',
  FormData:class {get(key){return data[key]??'';}},
  $:selector=>selector==='#dialog'?dialog:nodes.get(selector)||null,
  modal:(title,html,submit)=>{dialogs.push({title,html,submit});dialog.open=true;if(html.includes('native-player-form'))createForm();},
  api:body=>{calls.push(plain(body));return respond?respond(body):Promise.resolve(body.op==='nativePlayerEligibility'?page():{revision:8,created:[{playerId:'N1',name:'New Player'}]});}
 });
 context.entryIdentity=context.admin;nodes.set('#app',{innerHTML:''});
 vm.runInContext(helpers+entry+'\n'+['const field=','const area=','const check=','function editPlayer('].map(line).join('\n'),context);
 context.nativePlayerProvisioner=createNativePlayerProvisioner({api:context.api,context:context.nativePlayerProvisionContext,onChange:context.renderNativePlayerProvision});
 return {context,calls,messages,dialogs,nodes,dialog,data,get form(){return form;},run:code=>vm.runInContext(code,context)};
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
 Object.assign(u.context,{playerArchiveView:{open:false},applyHomeTheme:()=>{},isAdmin:()=>false,renderHome:()=>{},loadVisibleFavoriteFlags:()=>{},loadFavorites:()=>{},loadListeningOverview:()=>{},route:'home',session:null,admin:null});
 vm.runInContext(line('function render(){'),u.context);u.run('render()');assert.equal(u.dialog.open,false);assert.equal(u.context.nativePlayerProvisioner.state().rows.length,0);assert.equal(u.calls.length,1);
});

