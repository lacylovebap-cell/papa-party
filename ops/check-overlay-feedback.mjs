import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');

export async function checkOverlayFeedback(){
 const server=createServer((req,res)=>{
  const resource=req.url.split('?')[0];
  if(/^\/src\/[a-z-]+\.(css|js)$/.test(resource)){
   res.setHeader('Content-Type',resource.endsWith('.css')?'text/css':'text/javascript');
   res.end(fs.readFileSync(path.join(root,resource)));return;
  }
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="zh-Hant"><meta name="viewport" content="width=device-width,initial-scale=1"><body></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const results=[];
 try{
  for(const width of [320,1024])for(const fallback of [false,true]){
   const page=await browser.newPage({viewport:{width,height:800}});
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.evaluate(async fallback=>{
    if(fallback){HTMLElement.prototype.showPopover=undefined;HTMLElement.prototype.hidePopover=undefined;}
    for(const file of ['style','mobile','theme']){const link=document.createElement('link');link.rel='stylesheet';link.href='/src/'+file+'.css';document.head.append(link);}
    const style=document.createElement('style');style.textContent='dialog{width:calc(100vw - 24px)!important;height:calc(100dvh - 24px)!important;max-height:calc(100dvh - 24px)!important;overflow:hidden}dialog::backdrop{background:#000c}';document.head.append(style);
    document.body.innerHTML='<button id="background">背景操作</button><div id="toast"></div><dialog id="first"><label>玩家<input id="first-input"></label><button id="dice" type="button">抽歌</button></dialog><dialog id="second"><label>另一個視窗<input id="second-input"></label></dialog>';
    const {installOverlayFeedback}=await import('/src/overlay-feedback.js');
    window.feedback=installOverlayFeedback({document,window,duration:350});
    window.sameFeedback=installOverlayFeedback({document,window})===window.feedback;
    document.getElementById('dice').onclick=()=>window.feedback.notify('抽到《測試歌》－測試歌手');
    document.getElementById('first').showModal();document.getElementById('first-input').focus();
   },fallback);
   await page.locator('#overlay-feedback-styles').waitFor({state:'attached'});
   await page.waitForFunction(()=>[...document.styleSheets].some(sheet=>sheet.href?.includes('overlay-feedback.css')));
   assert.equal(await page.evaluate(()=>window.sameFeedback),true,'reinstallation reuses the single notification controller');
   await page.locator('#dice').click();
   assert.equal(await page.locator('#toast').textContent(),'抽到《測試歌》－測試歌手');
   assert.equal(await page.locator('#toast').getAttribute('role'),'status');
   assert.equal(await page.locator('#toast').getAttribute('aria-live'),'polite');
   // A pointer-events probe verifies real native top-layer ordering rather
   // than merely checking display:block. The default never blocks controls.
   const checkStack=()=>page.evaluate(()=>{
    const toast=document.getElementById('toast'),r=toast.getBoundingClientRect(),focused=document.activeElement.id;
    toast.style.pointerEvents='auto';const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);toast.style.pointerEvents='';
    return {top:top===toast,left:r.left,right:r.right,bottom:r.bottom,focused,parent:toast.parentElement.id,pointerEvents:getComputedStyle(toast).pointerEvents,popover:toast.matches(':popover-open')};
   });
   let layout=await checkStack();
   assert.equal(layout.top,true,JSON.stringify({width,fallback,layout}));
   assert.ok(layout.left>=0&&layout.right<=width&&layout.bottom<=800,JSON.stringify(layout));
   assert.equal(layout.pointerEvents,'none');assert.equal(layout.focused,'dice','notification does not steal focus');
   if(fallback)assert.equal(layout.parent,'first');else assert.equal(layout.popover,true);
   await page.evaluate(()=>{document.getElementById('second').showModal();document.getElementById('second-input').focus();});
   await page.waitForFunction(fallback=>fallback?document.getElementById('toast').parentElement.id==='second':document.getElementById('toast').matches(':popover-open'),fallback);
   layout=await checkStack();assert.equal(layout.top,true,'message remains above a later modal');assert.equal(layout.focused,'second-input');
   await page.evaluate(()=>{document.getElementById('second').close();window.feedback.notify('返回原視窗');});
   layout=await checkStack();assert.equal(layout.top,true);if(fallback)assert.equal(layout.parent,'first');
   await page.evaluate(()=>document.getElementById('first').innerHTML='<p>同一個視窗更新內容</p>');
   await page.waitForFunction(()=>window.feedback.element.isConnected&&window.feedback.element.parentElement.id==='first');
   layout=await checkStack();assert.equal(layout.top,true,'replacing dialog content cannot discard an active notification');
   // A very long title still fits a narrow viewport and is rendered as text.
   await page.evaluate(()=>window.feedback.notify('<img src=x onerror=alert(1)> '+('長歌名沒有空格'.repeat(30))));
   assert.equal(await page.locator('#toast img').count(),0);
   layout=await checkStack();assert.ok(layout.left>=0&&layout.right<=width);assert.equal(layout.top,true);
   await page.evaluate(()=>{document.getElementById('first').close();window.feedback.notify('第一則');});
   await page.waitForTimeout(240);await page.evaluate(()=>window.feedback.notify('最新一則'));
   await page.waitForTimeout(140);assert.equal(await page.locator('#toast').isVisible(),true,'old timeout cannot hide a newer message');
   await page.waitForTimeout(250);assert.equal(await page.locator('#toast').isVisible(),false,'message expires after the replacement timeout');
   await page.evaluate(()=>window.feedback.notify('清理測試'));await page.evaluate(()=>window.feedback.destroy());
   assert.equal(await page.locator('#toast').isVisible(),false);assert.equal(await page.locator('#toast').count(),1);
   assert.equal(await page.evaluate(()=>document.getElementById('toast').parentElement===document.body),true);
   assert.equal(await page.evaluate(()=>window.__paOverlayFeedback===undefined),true);
   results.push({width,mode:fallback?'dialog fallback':'native popover',passed:true});
   await page.close();
  }
  return results;
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))console.log(JSON.stringify(await checkOverlayFeedback()));
