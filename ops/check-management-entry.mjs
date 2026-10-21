import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const root=process.cwd(),errors=[],ops=[];
const server=createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]).replace(/^\//,'');const file=path.resolve(root,name||'v2.html');if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('papa-v2-player',JSON.stringify({token:'player:synthetic-only',role:'player',accountId:'22222222-2222-4222-8222-222222222222'})));
 await page.route('https://zwhcgqwbtummydapuori.supabase.co/**',async route=>{
  const body=route.request().postDataJSON()||{};ops.push(body.op);
  const result=body.op==='platformManagementSession'?{version:1,allowed:true,president:false,permissions:{streamers:false,administrators:true,reports:false},sections:['overview','halls','accounts']}:
   body.op==='platformManagementDirectory'?{rows:[],page:1,pages:1,total:0,registryRevision:1,summary:{halls:1,streamers:1,managers:1}}:{};
  await route.fulfill({json:result});
 });
 const url='http://127.0.0.1:'+server.address().port+'/v2.html?streamer=papa&spaceId=space-001&tab=platform#center';await page.goto(url);
 await page.getByRole('heading',{name:'平台管理中心',exact:true}).waitFor();await page.locator('[data-pm-action="section"][data-pm-id="halls"]').waitFor();
 assert.equal(await page.locator('[data-pm-action="create-space"]').count(),0);
 assert.equal(await page.locator('[data-pm-action="section"][data-pm-id="streamers"]').count(),0);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('papa-v2-player')).role),'player');
 assert.equal(ops.filter(op=>op==='platformManagementSession').length,1);assert.ok(!ops.includes('read'),'metadata management must not download business state');
 await page.reload();await page.locator('[data-pm-action="section"][data-pm-id="halls"]').waitFor();assert.equal(new URL(page.url()).searchParams.get('tab'),'platform');assert.deepEqual(errors,[]);
 console.log('Full application scoped management entry and reload passed; no business snapshot requested');
}finally{await browser.close();server.close();}
