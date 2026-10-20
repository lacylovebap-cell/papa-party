// Actual workerd execution via Cloudflare's Miniflare. Every outbound request is a
// local fixture; no production API, origin, credentials, DNS, or deployment access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {encodeInstallSource,decodeInstallSource} from '../src/pwa-install-source.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'.local-public-route-validation/worker-runtime/package.json'));
const {Miniflare}=require('miniflare');
const runtimeVersion=require('miniflare/package.json').version;
const workerdVersion=require('workerd/package.json').version;
const scriptPath=path.join(root,'ops/public-route-worker.bundle.mjs');
const script=await readFile(scriptPath);
const origin='https://paparty.app';
const api='https://registry.example.test/functions/v1/party-api';
const publicKey='sb_publishable_local_fixture_not_a_real_key';
const html='<!doctype html><html><head><title>Local fixture</title></head><body><main>original shell</main><script type="module" src="src/app.js"></script></body></html>';
const manifest=JSON.parse(await readFile(path.join(root,'manifest.webmanifest'),'utf8'));
const metadata=(matchedPath,canonicalPath='/pa',extra={})=>({version:1,kind:'streamer',spaceId:'space-001',streamerId:'streamer-stable',streamerSlug:'papa',canonicalPath,matchedPath,isAlias:matchedPath!==canonicalPath,code:'pa',spaceCode:'sm',revision:1,configured:true,layout:'flat',...extra});
const calls=[];
const bindings={ASSET_MODE:'route-origin',ROUTE_ORIGIN_CONFIRMED:'true',API:api,PUBLISHABLE_KEY:publicKey};
const mf=new Miniflare({
 modules:true,scriptPath,compatibilityDate:'2026-07-30',bindings,
 outboundService:async request=>{
  const url=new URL(request.url),headers=new Headers(request.headers),method=request.method;
  calls.push({url:url.href,method,range:headers.get('range'),cookie:headers.has('cookie'),authorization:headers.has('authorization')});
  assert.equal(headers.has('cookie'),false);assert.equal(headers.has('authorization'),false);
  if(url.href===api){
   assert.equal(method,'POST');assert.equal(headers.get('apikey'),publicKey);
   const body=await request.json();
   if(body.op==='publicAppHome'){
    assert.equal(body.v,1);assert.equal(body.spaceId,'space-001');
    if(body.kind==='hall')return Response.json({active:true,kind:'hall',spaceId:body.spaceId,streamerId:null});
    if(body.streamerId==='streamer-stable'||body.streamerId==='legacy-stable')return Response.json({active:true,kind:'streamer',spaceId:body.spaceId,streamerId:body.streamerId,streamerSlug:'papa',configured:body.streamerId==='streamer-stable'});
    return Response.json(null);
   }
   assert.equal(body.op,'publicRouteResolve');
   let result=null;
   if(body.path==='/pa')result=metadata('/pa');
   if(body.path==='/old')result=metadata('/old');
   if(body.path==='/sm')result=metadata('/sm','/sm',{kind:'hall',streamerId:null,streamerSlug:null});
   return Response.json(result);
  }
  if(url.origin!==origin)throw Error('External network access blocked: '+url.origin);
  assert.equal(headers.has('apikey'),false);
  if(url.pathname==='/manifest.webmanifest'){assert.equal(url.search,'');assert.equal(method,'GET');return Response.json(manifest,{headers:{'content-type':'application/manifest+json','etag':'manifest-static','set-cookie':'fixture-private'}});}
  if(url.pathname==='/assets/video.mp4'){
   assert.equal(headers.get('range'),'bytes=2-5');
   return new Response(method==='HEAD'?null:'2345',{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 2-5/10','accept-ranges':'bytes','etag':'range-etag','set-cookie':'fixture-private'}});
  }
  if(['/','/app.html','/v2.html','/lobby.html','/src/app.js'].includes(url.pathname))return new Response(method==='HEAD'?null:html,{headers:{'content-type':url.pathname.endsWith('.js')?'text/javascript':'text/html','etag':'shell-etag','set-cookie':'fixture-private'}});
  return new Response(method==='HEAD'?null:'local fixture not found',{status:404,headers:{'content-type':'text/html'}});
 }
});
const checks=[];
async function check(name,fn){const start=calls.length;await fn();checks.push({name,passed:true,outboundRequests:calls.length-start});}
const request=(pathname,options={})=>mf.dispatchFetch(origin+pathname,{...options,redirect:'manual'});
const apiCount=()=>calls.filter(item=>item.url===api).length;
try{
 await mf.ready;
 await check('canonical HTTP 200 uses original shell and safe stable-ID metadata',async()=>{
  const r=await request('/pa',{headers:{Cookie:'private fixture',Authorization:'Bearer local-fixture'}});assert.equal(r.status,200);
  const body=await r.text();assert.match(body,/<base href="\/">/);assert.match(body,/original shell/);
  const data=JSON.parse(/id="public-route-data">([^<]*)<\/script>/.exec(body)[1]);assert.equal(data.spaceId,'space-001');assert.equal(data.streamerId,'streamer-stable');assert.equal(data.section,'home');assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('etag'),null);assert.match(r.headers.get('cache-control'),/no-store/);
 });
 await check('alias one-hop HTTP 308 preserves subpage and safe query',async()=>{
  const r=await request('/old/admin?adminTab=players&player=P1&tab=achievements&token=private');assert.equal(r.status,308);assert.equal(r.headers.get('location'),origin+'/pa/admin?adminTab=players&player=P1&tab=achievements');assert.equal(await r.text(),'');
 });
 await check('canonical child page HTTP 200 keeps selected page',async()=>{
  const r=await request('/pa/book');assert.equal(r.status,200);assert.match(await r.text(),/"section":"book"/);
 });
 await check('hall uses original lobby shell',async()=>{
  const r=await request('/sm');assert.equal(r.status,200);assert.match(await r.text(),/"kind":"hall"/);assert.equal(calls.at(-1).url,origin+'/lobby.html');
 });
 await check('HEAD canonical and alias responses contain no body',async()=>{
  const r=await request('/pa',{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');assert.equal(calls.at(-1).method,'HEAD');assert.equal(calls.at(-1).url,origin+'/v2.html');
  const alias=await request('/old/book',{method:'HEAD'});assert.equal(alias.status,308);assert.equal(await alias.text(),'');assert.equal(alias.headers.get('location'),origin+'/pa/book');
 });
 await check('root and static bypass registry; private headers and query stay local',async()=>{
  const before=apiCount();for(const pathname of ['/','/app.html?install=public-id','/v2.html?streamer=papa&token=private','/src/app.js?v=10.19-WEB.1&token=private']){const r=await request(pathname,{headers:{Cookie:'private'}});assert.equal(r.status,200);await r.text();assert.equal(r.headers.get('set-cookie'),null);}assert.equal(apiCount(),before);assert.equal(calls.at(-1).url,origin+'/src/app.js?v=10.19-WEB.1');
 });
 await check('Range survives original media HTTP 206',async()=>{
  const before=apiCount(),r=await request('/assets/video.mp4',{headers:{Range:'bytes=2-5'}});assert.equal(r.status,206);assert.equal(await r.text(),'2345');assert.equal(r.headers.get('content-range'),'bytes 2-5/10');assert.equal(r.headers.get('accept-ranges'),'bytes');assert.equal(r.headers.get('etag'),'range-etag');assert.equal(r.headers.get('set-cookie'),null);assert.equal(apiCount(),before);
 });
 await check('unknown route retains original 404 with bounded lookups',async()=>{
  const before=apiCount(),r=await request('/unknown/book');assert.equal(r.status,404);assert.equal(await r.text(),'local fixture not found');assert.equal(apiCount()-before,2);
 });
 await check('POST fails closed without outbound calls',async()=>{
  const before=calls.length,r=await request('/pa',{method:'POST',body:'local fixture'});assert.equal(r.status,405);assert.equal(await r.text(),'METHOD_NOT_ALLOWED');assert.equal(calls.length,before);
 });
 await check('source manifests keep shared id and scope while carrying exact public stable IDs',async()=>{
  for(const source of [{v:1,kind:'streamer',spaceId:'space-001',streamerId:'streamer-stable'},{v:1,kind:'hall',spaceId:'space-001',streamerId:null}]){
   const before=apiCount(),r=await request('/manifest.webmanifest?install='+encodeInstallSource(source),{headers:{Cookie:'must-not-forward',Authorization:'private'}});assert.equal(r.status,200);
   const result=await r.json(),start=new URL(result.start_url,origin+'/manifest.webmanifest');assert.equal(result.id,manifest.id);assert.equal(result.scope,manifest.scope);assert.equal(result.name,manifest.name);assert.deepEqual(result.icons,manifest.icons);assert.equal(start.pathname,'/app.html');assert.deepEqual(decodeInstallSource(start.searchParams.get('install')),source);assert.equal(apiCount()-before,1);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('etag'),null);
  }
 });
 await check('active legacy streamers without custom routes retain the same stable source',async()=>{
  const source={v:1,kind:'streamer',spaceId:'space-001',streamerId:'legacy-stable'},r=await request('/manifest.webmanifest?install='+encodeInstallSource(source));assert.equal(r.status,200);const result=await r.json();assert.deepEqual(decodeInstallSource(new URL(result.start_url,origin).searchParams.get('install')),source);
 });
 await check('unknown source becomes APP chooser and malformed tokens never query metadata',async()=>{
  const source={v:1,kind:'streamer',spaceId:'space-001',streamerId:'not-public'},r=await request('/manifest.webmanifest?install='+encodeInstallSource(source));assert.equal(r.status,200);assert.equal((await r.json()).start_url,'./app.html');
  const before=apiCount();for(const pathname of ['/manifest.webmanifest','/manifest.webmanifest?install=invalid!','/manifest.webmanifest?install=one&install=two']){const response=await request(pathname);assert.equal(response.status,200);assert.equal((await response.json()).start_url,'./app.html');}assert.equal(apiCount(),before);
 });
 await check('manifest HEAD verifies source and identity without returning body or stale entity headers',async()=>{
  const source={v:1,kind:'streamer',spaceId:'space-001',streamerId:'streamer-stable'},r=await request('/manifest.webmanifest?install='+encodeInstallSource(source),{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');assert.equal(r.headers.get('content-length'),null);assert.equal(r.headers.get('etag'),null);assert.equal(calls.at(-1).method,'GET');
 });
 await mf.setOptions({modules:true,scriptPath,compatibilityDate:'2026-07-30',bindings:{...bindings,ROUTE_ORIGIN_CONFIRMED:'false'}});
 await check('unconfirmed origin safely fails HTTP 503 without any outbound call',async()=>{
  const before=calls.length,r=await request('/pa');assert.equal(r.status,503);assert.equal(await r.text(),'PUBLIC_ROUTE_CONFIGURATION_REQUIRED');assert.equal(calls.length,before);
 });
 const result={schemaVersion:1,environment:'isolated local workerd; all outbound requests intercepted by local fixtures',productionWrites:false,node:process.version,miniflare:runtimeVersion,workerd:workerdVersion,compatibilityDate:'2026-07-30',bundleSha256:createHash('sha256').update(script).digest('hex'),checksPassed:checks.length,checks,limitations:['Cloudflare account Route/DNS forwarding is not simulated by Miniflare. Actual zone route and TLS/origin verification remain deployment preflight tasks.']};
 await writeFile(path.join(root,'ops/pwa-public-route-workerd-result-20261020.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({checksPassed:checks.length,miniflare:runtimeVersion,workerd:workerdVersion,bundleSha256:result.bundleSha256}));
}finally{await mf.dispose();}
