// Isolated browser fixture. No production network, accounts or business writes.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeInstallSource,decodeInstallSource} from '../src/pwa-install-source.js';
const root=fileURLToPath(new URL('../',import.meta.url)),port=8864;
const homes=[{kind:'hall',spaceId:'space-001',streamerId:null,name:'聲瑪',spaceName:'聲瑪',streamerSlug:null,canonicalPath:'/sm',homePath:'/sm',active:true},{kind:'streamer',spaceId:'space-001',streamerId:'papa',name:'怕怕',spaceName:'聲瑪',streamerSlug:'papa',canonicalPath:'/pa',homePath:'/pa',active:true},{kind:'streamer',spaceId:'space-001',streamerId:'michelle',name:'米雪',spaceName:'聲瑪',streamerSlug:'michelle',canonicalPath:'/michelle',homePath:'/michelle',active:true}];
const find=source=>homes.find(r=>r.kind===source?.kind&&r.spaceId===source.spaceId&&r.streamerId===(source.streamerId||null))||null;
const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:'+port);
 if(url.pathname==='/fixture-api'&&req.method==='POST'){
  let raw='';for await(const chunk of req)raw+=chunk;if(raw.length>3000)return json(res,{error:'Fixture request too large'},400);const body=JSON.parse(raw);
  if(body.op==='publicAppHome')return json(res,find(body));
  if(body.op==='publicAppHomes'){const rows=homes.filter(r=>(body.kind==='all'||body.kind===r.kind)&&(!body.q||(r.name+r.spaceName).includes(body.q)));return json(res,{items:rows,page:1,pageSize:12,total:rows.length,totalPages:1});}
  return json(res,{error:'Local fixture operation unavailable'},400);
 }
 if(url.pathname==='/src/config.js'){res.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'});return res.end('export const API="http://127.0.0.1:'+port+'/fixture-api";export const PUBLISHABLE_KEY="fixture-only";');}
 if(url.pathname==='/manifest.webmanifest'){const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.webmanifest'),'utf8')),source=decodeInstallSource(url.searchParams.get('install'));manifest.start_url='./app.html'+(find(source)?'?install='+encodeInstallSource(source):'');return json(res,manifest);}
 const home=homes.find(r=>r.homePath===url.pathname);
 if(home){
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="manifest" href="manifest.webmanifest"><link rel="stylesheet" href="src/style.css"><link rel="stylesheet" href="src/theme.css"><main><section class="card"><p>本機驗證 · 全部是假資料</p><h1>'+home.name+'首頁</h1><p id="saved"></p><nav><a href="/pa">瀏覽怕怕</a> · <a href="/michelle">瀏覽米雪</a> · <a href="/app.html?install='+encodeInstallSource(homes[1])+'">重新啟動 APP</a></nav><div id="settings"></div></section></main><script type="module">import {createAppHomeSettings} from "./src/pwa-start-ui.js";import {readHome} from "./src/pwa-start.js";const row='+JSON.stringify(home)+';const ui=createAppHomeSettings({environment:{document,localStorage,navigator:{standalone:true},location,history},mountUrl:location.origin+"/"});ui.update(null,location.href,{source:row,name:row.name,spaceName:row.spaceName});document.querySelector("#settings").innerHTML=ui.button();document.querySelector("[data-pwa-start]").onclick=()=>ui.show();const p=readHome(localStorage);document.querySelector("#saved").textContent="已儲存預設："+(p?.name||"尚未設定");</script>');
 }
 let relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'app.html';const file=path.resolve(root,relative);if(!file.startsWith(root)||relative.includes('..'))return json(res,{error:'outside fixture'},403);
 let content;try{content=await fs.readFile(file);}catch{return json(res,{error:'fixture not found'},404);}
 if(relative==='app.html')content=Buffer.from(content.toString().replace('<body>','<body><p style="text-align:center">本機驗證 · 全部是假資料</p>'));
 res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(content);
}catch(error){json(res,{error:error.message},500);}}).listen(port,'127.0.0.1',()=>console.log('Isolated PWA fixture: http://127.0.0.1:'+port+'/app.html'));
