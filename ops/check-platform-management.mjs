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
  window.pmCalls=[];window.pmActor='president';window.pmFailure=null;window.pmDeferred=null;window.pmRelease=null;
  const api=async body=>{window.pmCalls.push(structuredClone(body));if(window.pmFailure===body.op){window.pmFailure=null;throw Error('fixture failure');}if(window.pmDeferred===body.op){window.pmDeferred=null;await new Promise(resolve=>window.pmRelease=resolve);}
   if(body.op==='platformManagementDirectory'){const rows=body.section==='overview'?[]:body.section==='halls'?[hall]:body.section==='accounts'?[{id:member,name:longName,managerKey:'streamer:test-streamer'}]:[streamer];return {rows,total:rows.length,page:1,pages:1,registryRevision:7,summary:{halls:1,independent:0,streamers:1,managers:2,unclassified:0}};}
   if(body.op==='platformManagementDetail')return {space:hall,memberships:[membership],total:1,page:body.page,pages:1,canManageMemberships:true,...(body.streamerId?{streamer:{descriptor:streamer.descriptor,archivedAt:null}}:{})};
   if(body.op==='platformStreamerCredentials')return {exists:true,enabled:false};
   if(body.op==='platformManagementDependencies')return {songs:0,players:0,ledger:0,audit:4,safeToDelete:false};
   return {ok:true};
  };
  const root=document.querySelector('#app');let controller;
  const paint=()=>{root.innerHTML=controller.html();controller.bind(root);};
  controller=createPlatformManagement({api,identity:()=>window.pmActor,escape,changed:paint,confirm:()=>true});window.pm=controller;window.pmPaint=paint;
  await controller.load({section:'halls'});
 },{owner,member,longName});
 await page.waitForFunction(()=>[...document.querySelectorAll('link')].every(link=>link.sheet));
}
async function noOverflow(page,width,label){
 const layout=await page.locator('.platform-management').evaluate(root=>({document:document.documentElement.scrollWidth,body:document.body.scrollWidth,card:root.getBoundingClientRect().right,buttons:[...root.querySelectorAll('button')].filter(button=>button.getBoundingClientRect().height>0).map(button=>({text:button.textContent,height:button.getBoundingClientRect().height}))}));
 assert.ok(layout.document<=width&&layout.body<=width&&layout.card<=width,JSON.stringify({width,label,...layout}));
 assert.ok(layout.buttons.every(button=>button.height>=44),JSON.stringify({width,label,short:layout.buttons.filter(button=>button.height<44)}));
}
const payload=(page,op)=>page.evaluate(op=>window.pmCalls.filter(body=>body.op===op).at(-1),op);
const submit=async(page,type)=>{await page.locator(`[data-pm-form="${type}"]`).evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>!window.pm.state().saving);};
const section=(page,id)=>page.locator(`[data-pm-action="section"][data-pm-id="${id}"]`).click();
try{
 const page=await browser.newPage();
 for(const width of [320,375,390,430,768,1024,1440]){
  await setup(page,width);await noOverflow(page,width,'hall directory');
  await page.locator('[data-pm-action="create-space"]').click();const create=page.locator('[data-pm-form="create-space"]');
  await create.locator('[name="name"]').fill('New '+longName);await create.locator('[name="ownerAccountId"]').fill(owner);await create.locator('[name="kind"]').selectOption('hall');await noOverflow(page,width,'create hall');
  await page.evaluate(()=>window.pmFailure='platformManageSpace');await submit(page,'create-space');assert.equal(await create.locator('[name="name"]').inputValue(),'New '+longName,'failed write preserves new hall input');
  const failed=await payload(page,'platformManageSpace');await submit(page,'create-space');const created=await payload(page,'platformManageSpace');assert.equal(created.operationId,failed.operationId,'explicit retry preserves idempotency key');assert.deepEqual(created.payload,{name:'New '+longName,kind:'hall',ownerAccountId:owner});
  await page.locator('[data-pm-action="detail"]').click();const edit=page.locator('[data-pm-form="edit-space"]');await edit.locator('[name="name"]').fill('Renamed '+longName);await noOverflow(page,width,'hall details');await submit(page,'edit-space');
  assert.deepEqual((await payload(page,'platformManageSpace')).payload,{spaceId:'hall-Q',revision:41,name:'Renamed '+longName});
  await page.locator('[data-pm-action="detail"]').click();await page.locator('[data-pm-action="edit-membership"]').click();const grant=page.locator('[data-pm-form="membership"]');assert.equal(await grant.locator('[name="permissions"][value="songs"]').isChecked(),true,'legacy effective songs permission stays selected');assert.equal(await grant.locator('[name="permissions"][value="queue"]').isChecked(),true,'legacy effective queue permission stays selected');
  await grant.locator('[name="role"]').selectOption('streamer_admin');await grant.locator('[name="streamerId"]').fill('streamer-1');await noOverflow(page,width,'membership');await submit(page,'membership');
  assert.deepEqual((await payload(page,'platformManageSpace')).payload,{spaceId:'hall-Q',revision:41,accountId:member,role:'streamer_admin',streamerId:'streamer-1',status:'active',permissions:['songs','queue']});
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
 console.log('platform management clear/write races passed');
}finally{await browser.close();server.close();}
