import {createServer} from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const server=createServer((req,res)=>{const name=req.url.split('?')[0].slice(1);if(name.startsWith('src/')||name.startsWith('assets/')){try{res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'image/png');res.end(fs.readFileSync(name));}catch{res.statusCode=404;res.end();}}else res.end('<html><head>'+['style','mobile','theme','theme-v2','theme-studio'].map(x=>`<link rel="stylesheet" href="/src/${x}.css">`).join('')+'</head><body></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{for(const width of [1280,390]){
const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
await page.evaluate(async()=>{const {openThemeStudio}=await import('/src/theme-studio.js');window.saved=null;openThemeStudio({room:{id:'fixture',display_name:'測試'},settings:{},defaultBanner:'/assets/pa-party-approved.png',toast:()=>{},saveStreamer:async x=>window.saved=x,api:async()=>({streamer:{features:['theme_streamer_basic','theme_streamer_images','theme_streamer_publish']}})});});
await page.locator('[data-color="bannerMask"]').waitFor();
for(const [key,color] of [['bannerMask','#123456'],['bannerTitle','#ffffff'],['bannerText','#ffccaa']]){await page.locator(`[data-color="${key}"]`).evaluate((el,c)=>{el.value=c;el.dispatchEvent(new Event('input',{bubbles:true}));},color);}
await page.waitForTimeout(350);
const preview=page.frameLocator('[data-ts-frame]');
assert.equal(await preview.locator('.hero-overlay h2').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
assert.equal(await preview.locator('.hero-overlay .status-note').evaluate(el=>getComputedStyle(el).color),'rgb(255, 204, 170)');
assert.match(await preview.locator('.integrated-hero').evaluate(el=>getComputedStyle(el,':after').backgroundImage),/18, 52, 86/);
await page.locator('[data-ts="draft"]').click();await page.waitForFunction(()=>window.saved);assert.equal(await page.evaluate(()=>saved.themeDraft.colors.bannerMask),'#123456');
await page.locator('[data-color-auto="bannerMask"]').click();await page.locator('[data-ts="draft"]').click();assert.equal(await page.evaluate(()=>saved.themeDraft.colors.bannerMask),undefined);
assert.deepEqual(errors,[]);console.log('PASS studio preview, draft and reset at '+width);await page.close();}
const source=fs.readFileSync('src/app.js','utf8');const label=source.match(/button\(('\+'\+p.units.*?),'plan',String\(i\)\)/)[1];
const render=new Function('p','h','return '+label);for(const n of [2,3,6])assert.equal(render({units:n,name:n+' 首'},x=>x),'+'+n+' 首');assert.equal(render({units:10,name:'🥇 金牌歌單'},x=>x),'+10 首 · 🥇 金牌歌單');console.log('PASS ledger labels; plan handler still assigns p.units');
}finally{await browser.close();server.close();}
