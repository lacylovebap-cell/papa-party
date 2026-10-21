import {createServer} from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const server=createServer((req,res)=>{const name=req.url.split('?')[0].slice(1);if(!/^src\/[a-z-]+\.(css|js)$/.test(name)){res.end('<!doctype html><html><head></head><body><main id="app"></main></body></html>');return;}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(name));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222';
const longName='LongPublicManagementNameWithoutAnySpaces'.repeat(2);
async function setup(page,width){
 await page.setViewportSize({width,height:900});await page.goto(origin);
 await page.evaluate(async({owner,member,longName})=>{
  for(const name of ['style','mobile','theme','platform-management']){const link=document.createElement('link');link.rel='stylesheet';link.href='/src/'+name+'.css';document.head.append(link);}
  document.body.style.margin='0';document.querySelector('#app').style.cssText='box-sizing:border-box;margin:0 auto;padding:12px;max-width:1100px';
  const {createPlatformManagement}=await import('/src/platform-management.js');
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const hall={id:'hall-Q',name:longName,kind:'hall',status:'active',ownerAccountId:owner,revision:41};
  const streamer={id:'streamer-1',slug:'test-streamer',name:longName,spaceId:'hall-Q',spaceName:longName,active:false,descriptor:{id:'streamer-1',slug:'test-streamer',display_name:longName,home_title:'Existing home',subtitle:'Existing subtitle',active:false}};
  const membership={id:'member-1',accountId:member,name:longName,role:'space_admin',streamerId:null,status:'active',permissions:[],permissionsExplicit:false,effectivePermissions:['songs','queue']};
  window.pmCalls=[];window.pmActor='president';window.pmCapabilities={allowed:true,president:true};window.pmFailure=null;window.pmDeferred=null;window.pmRelease=null;
  const api=async body=>{window.pmCalls.push(structuredClone(body));if(window.pmFailure===body.op){window.pmFailure=null;throw Error('fixture failure');}if(window.pmDeferred===body.op){window.pmDeferred=null;await new Promise(resolve=>window.pmRelease=resolve);}
   if(body.op==='platformManagementDirectory'){const rows=body.section==='overview'?[]:body.section==='halls'?[hall]:body.section==='accounts'?[{id:member,name:longName,managerKey:'streamer:test-streamer'}]:[streamer];return {rows,total:rows.length,page:1,pages:1,registryRevision:7,summary:{halls:1,independent:0,streamers:1,managers:2,unclassified:0}};}
   if(body.op==='platformManagementDetail')return {space:hall,memberships:[membership],total:1,page:body.page,pages:1,canManageMemberships:true,canEditSpace:false,...(body.streamerId?{streamer:{descriptor:streamer.descriptor,archivedAt:null}}:{})};
   if(body.op==='platformStreamerCredentials')return {exists:true,enabled:false};
   if(body.op==='platformManagementDependencies')return {songs:0,players:0,ledger:0,audit:4,safeToDelete:false};
   return {ok:true};
  };
  const root=document.querySelector('#app');let controller;
  const paint=()=>{root.innerHTML=controller.html();controller.bind(root);};
  controller=createPlatformManagement({api,identity:()=>window.pmActor,capabilities:()=>window.pmCapabilities,escape,changed:paint,confirm:()=>true});window.pm=controller;window.pmPaint=paint;
  await controller.load({section:'halls'});
 },{owner,member,longName});
 await page.waitForFunction(()=>[...document.querySelectorAll('link')].every(link=>link.sheet));
}
async function noOverflow(page,width,label){
 const layout=await page.evaluate(()=>{const root=document.querySelector('section.platform-management'),modal=document.querySelector('[data-pm-dialog]');return {document:document.documentElement.scrollWidth,body:document.body.scrollWidth,card:root.getBoundingClientRect().right,modal:modal?{left:modal.getBoundingClientRect().left,right:modal.getBoundingClientRect().right,top:modal.getBoundingClientRect().top,bottom:modal.getBoundingClientRect().bottom}:null,buttons:[...document.querySelectorAll('.platform-management button')].filter(button=>button.getBoundingClientRect().height>0).map(button=>({text:button.textContent,height:button.getBoundingClientRect().height}))};});
 assert.ok(layout.document<=width&&layout.body<=width&&layout.card<=width,JSON.stringify({width,label,...layout}));
 if(layout.modal)assert.ok(layout.modal.left>=0&&layout.modal.right<=width&&layout.modal.top>=0&&layout.modal.bottom<=900,JSON.stringify({width,label,modal:layout.modal}));
 assert.ok(layout.buttons.every(button=>button.height>=44),JSON.stringify({width,label,short:layout.buttons.filter(button=>button.height<44)}));
}
const payload=(page,op)=>page.evaluate(op=>window.pmCalls.filter(body=>body.op===op).at(-1),op);
const submit=async(page,type)=>{await page.locator(`[data-pm-form="${type}"]`).evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>!window.pm.state().saving);};
const section=async(page,id)=>{if(await page.locator('[data-pm-dialog][open]').count())await page.keyboard.press('Escape');await page.locator(`[data-pm-action="section"][data-pm-id="${id}"]`).click();};
try{
 const page=await browser.newPage();
 for(const width of [320,375,390,430,768,1024,1440]){
  await setup(page,width);await noOverflow(page,width,'hall directory');
  await page.locator('[data-pm-action="create-space"]').click();const create=page.locator('[data-pm-form="create-space"]');
  await create.locator('[name="name"]').fill('New '+longName);await page.locator('[data-pm-action="lookup-accounts"]').click();await page.locator('.pm-account-picker [data-pm-action="select-account"]').click();await create.locator('[name="kind"]').selectOption('hall');await noOverflow(page,width,'create hall');
  await page.evaluate(()=>window.pmFailure='platformManageSpace');await submit(page,'create-space');assert.equal(await create.locator('[name="name"]').inputValue(),'New '+longName,'failed write preserves new hall input');
  const failed=await payload(page,'platformManageSpace');await submit(page,'create-space');const created=await payload(page,'platformManageSpace');assert.equal(created.operationId,failed.operationId,'explicit retry preserves idempotency key');assert.deepEqual(created.payload,{name:'New '+longName,kind:'hall',ownerAccountId:member});
  await page.locator('[data-pm-action="detail"]').click();const edit=page.locator('[data-pm-form="edit-space"]');await edit.locator('[name="name"]').fill('Renamed '+longName);await noOverflow(page,width,'hall details');await submit(page,'edit-space');
  assert.deepEqual((await payload(page,'platformManageSpace')).payload,{spaceId:'hall-Q',revision:41,name:'Renamed '+longName});
  await page.locator('[data-pm-action="detail"]').click();await page.locator('[data-pm-action="edit-membership"]').click();const grant=page.locator('[data-pm-form="membership"]');await grant.locator('.pm-advanced summary').click();assert.equal(await grant.locator('[name="permissions"][value="songs"]').isChecked(),true,'legacy effective songs permission stays selected');assert.equal(await grant.locator('[name="permissions"][value="queue"]').isChecked(),true,'legacy effective queue permission stays selected');
  await grant.locator('[name="role"]').selectOption('space_admin');await noOverflow(page,width,'membership');await submit(page,'membership');
  assert.deepEqual((await payload(page,'platformManageSpace')).payload,{spaceId:'hall-Q',revision:41,accountId:member,role:'space_admin',status:'active',permissions:['songs','queue']});
  await section(page,'streamers');await page.locator('[data-pm-action="edit-streamer"]').click();const singer=page.locator('[data-pm-form="streamer"]');await singer.locator('[name="display_name"]').fill('Edited '+longName);assert.equal(await singer.locator('[name="active"]').isChecked(),false);await noOverflow(page,width,'streamer edit');await submit(page,'streamer');
  assert.deepEqual(await payload(page,'platformStreamerSave'),{op:'platformStreamerSave',management:true,spaceId:'hall-Q',revision:7,anchorStreamer:'streamer-1',descriptor:{id:'streamer-1',display_name:'Edited '+longName,slug:'test-streamer',home_title:'Existing home',subtitle:'Existing subtitle',active:false}});
  await page.locator('[data-pm-action="credentials"]').click();const credentials=page.locator('[data-pm-form="credentials"]');await credentials.waitFor();assert.equal(await credentials.locator('[name="enabled"]').isChecked(),false,'disabled manager login is never silently enabled');await credentials.locator('[name="password"]').fill('fixture-only-password');await noOverflow(page,width,'credentials');await submit(page,'credentials');
  assert.deepEqual(await payload(page,'setStreamerAccount'),{op:'setStreamerAccount',management:true,streamer:'test-streamer',password:'fixture-only-password',enabled:false});
  await section(page,'accounts');await page.locator('[data-pm-action="account-memberships"]').click();await page.locator('[data-pm-action="detail"]').click();assert.equal(await page.locator('[data-pm-form="membership"] [name="accountId"]').inputValue(),member);await noOverflow(page,width,'account binding');
  console.log('platform management '+width+' passed');
 }
 // A cleared page must not be resurrected by any older result on the same account.
 for(const operation of ['platformStreamerSave','setStreamerAccount','platformManagementDependencies']){
  await setup(page,390);await section(page,'streamers');
  if(operation==='platformStreamerSave'){await page.locator('[data-pm-action="edit-streamer"]').click();}
  else if(operation==='setStreamerAccount'){await page.locator('[data-pm-action="credentials"]').click();await page.locator('[data-pm-form="credentials"]').waitFor();}
  else{await page.locator('[data-pm-action="detail"]').click();await page.locator('[data-pm-action="dependencies"]').waitFor();}
  await page.evaluate(op=>window.pmDeferred=op,operation);
  if(operation==='platformManagementDependencies')await page.locator('[data-pm-action="dependencies"]').click();
  else await page.locator(`[data-pm-form="${operation==='platformStreamerSave'?'streamer':'credentials'}"]`).evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>!!window.pmRelease);const count=await page.evaluate(()=>window.pmCalls.length);
  await page.evaluate(()=>{window.pm.clear();window.pmPaint();window.pmRelease();});await page.waitForTimeout(40);
  assert.equal(await page.evaluate(()=>window.pmCalls.length),count,'no late directory reload after clear: '+operation);assert.equal(await page.evaluate(()=>window.pm.state().loaded),false);assert.equal(await page.evaluate(()=>window.pm.state().saving),false);
 }

 // Choosing an account for one grant must not leak into later hall details.
 await setup(page,390);await section(page,'accounts');await page.locator('[data-pm-action="account-memberships"]').click();await page.locator('[data-pm-action="detail"]').click();
 assert.equal(await page.locator('[data-pm-form="membership"] [name="accountId"]').inputValue(),member);
 await page.locator('.pm-dialog-header [data-pm-action="close-editor"]').click();await page.locator('[data-pm-action="detail"]').click();assert.equal(await page.locator('[data-pm-form="membership"] [name="accountId"]').inputValue(),'','grant target is consumed once');
 await section(page,'accounts');await page.locator('[data-pm-action="account-memberships"]').click();await section(page,'streamers');await section(page,'halls');await page.locator('[data-pm-action="detail"]').click();assert.equal(await page.locator('[data-pm-form="membership"] [name="accountId"]').inputValue(),'','navigation clears pending target');
 // Delayed readers must not overwrite a different editor opened afterwards.
 for(const operation of ['platformManagementDetail','platformStreamerCredentials']){
  await setup(page,390);await section(page,'streamers');await page.evaluate(op=>window.pmDeferred=op,operation);
  await page.locator(`[data-pm-action="${operation==='platformManagementDetail'?'detail':'credentials'}"]`).click();await page.waitForFunction(()=>!!window.pmRelease);
  await page.keyboard.press('Escape');await page.locator('[data-pm-action="create-streamer"]').click();await page.evaluate(()=>window.pmRelease());await page.waitForTimeout(30);
  assert.equal(await page.locator('[data-pm-form="streamer"]').count(),1,operation+' cannot replace new streamer editor');
 }
 // An existing account can be found without copying a raw identifier.
 await setup(page,390);await page.locator('[data-pm-action="create-space"]').click();await page.locator('[data-pm-form="create-space"] [name="name"]').fill('Preserved draft');
 await page.locator('[data-pm-action="lookup-accounts"]').click();await page.locator('.pm-account-picker [data-pm-action="select-account"]').waitFor();await noOverflow(page,390,'bounded account search');
 await page.locator('.pm-account-picker [name="accountQuery"]').fill('LongPublic');await submit(page,'account-search');await page.locator('.pm-account-picker [data-pm-action="select-account"]').click();
 assert.equal(await page.locator('[data-pm-form="create-space"] [name="ownerAccountId"]').inputValue(),member);await page.locator('[data-pm-form="create-space"] [name="name"]').fill('Preserved draft');await page.evaluate(()=>window.pmPaint());assert.ok((await page.locator('.pm-selected-account strong').innerText()).includes('LongPublic'));assert.equal(await page.locator('[data-pm-form="create-space"] [name="name"]').inputValue(),'Preserved draft');
 const accountQuery=(await page.evaluate(()=>window.pmCalls.filter(body=>body.section==='accounts').at(-1)));assert.equal(accountQuery.q,'LongPublic');assert.equal(accountQuery.page,1);
 // The global centre is president-only even when a hall account has delegated rights.
 await setup(page,390);await page.evaluate(async()=>{window.pmCapabilities={allowed:true,president:false,permissions:{administrators:true},sections:['overview','halls','accounts']};window.pm.sync();window.pmPaint();await window.pm.load({section:'halls'});});
 assert.equal(await page.locator('[data-pm-action]').count(),0);assert.equal(await page.locator('[data-pm-form]').count(),0);assert.equal(await page.locator('[data-pm-dialog]').count(),0);
 // Native modal stays mounted across unrelated redraws; focus, draft and scroll survive.
 await setup(page,390);await section(page,'streamers');await page.locator('[data-pm-action="credentials"]').click();const password=page.locator('[data-pm-form="credentials"] [name="password"]');await password.fill('keep-this-draft');await password.focus();
 await page.evaluate(()=>{const dialog=document.querySelector('[data-pm-dialog]');window.originalDialog=dialog;window.pmPaint();});
 assert.equal(await page.evaluate(()=>document.querySelector('[data-pm-dialog]')===window.originalDialog),true);assert.equal(await password.inputValue(),'keep-this-draft');assert.equal(await password.evaluate(input=>input===document.activeElement),true);
 await page.evaluate(()=>window.pmFailure='setStreamerAccount');await submit(page,'credentials');assert.equal(await page.locator('[data-pm-dialog] .pm-dialog-error').innerText(),'fixture failure');assert.equal(await password.inputValue(),'keep-this-draft');assert.equal(await page.locator('section.platform-management>.error').count(),0);
 const closeBefore=await page.locator('.pm-dialog-header [data-pm-action="close-editor"]').boundingBox();await page.locator('.pm-dialog-body').evaluate(body=>body.scrollTop=body.scrollHeight);const closeAfter=await page.locator('.pm-dialog-header [data-pm-action="close-editor"]').boundingBox();assert.equal(closeBefore.y,closeAfter.y,'close button is outside inner scroll');
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-pm-dialog]').count(),0);assert.equal(await page.evaluate(()=>window.pm.state().editor),null);
 // Account selection is an internal view, with one dialog and preserved parent draft.
 await page.locator('[data-pm-action="create-streamer"]').click();await page.keyboard.press('Escape');await section(page,'halls');await page.locator('[data-pm-action="create-space"]').click();await page.locator('[data-pm-form="create-space"] [name="name"]').fill('Parent draft');await page.locator('[data-pm-action="lookup-accounts"]').click();assert.equal(await page.locator('dialog[open]').count(),1);assert.equal(await page.locator('[data-pm-form="create-space"]').count(),0);await page.locator('[data-pm-action="close-lookup"]').click();assert.equal(await page.locator('[data-pm-form="create-space"] [name="name"]').inputValue(),'Parent draft');assert.equal(await page.locator('dialog[open]').count(),1);
 // Deletion review is readable and never renders an executable permanent-delete action.
 await page.keyboard.press('Escape');await section(page,'cleanup');await page.locator('[data-pm-action="dependencies-direct"]').click();await page.locator('.pm-dependency-list').waitFor();assert.equal(await page.locator('[data-pm-dialog] pre').count(),0);assert.equal(await page.locator('[data-pm-action="delete-streamer"]').count(),0);assert.ok((await page.locator('[data-pm-dialog]').innerText()).includes('目前不能直接永久刪除'));
 console.log('platform management clear/write, editor, account-target, picker and scoped-capability checks passed');
}finally{await browser.close();server.close();}
