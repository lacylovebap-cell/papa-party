import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicRouteWorker} from '../ops/public-route-worker.mjs';

const env={ASSET_ORIGIN:'https://assets.example.test/project/',API:'https://registry.example.test/functions/v1/party-api',PUBLISHABLE_KEY:'sb_publishable_test_public_key_123'};
const origin='https://paparty.app';
const meta=(path,canonicalPath='/pa',extra={})=>({version:1,kind:'streamer',spaceId:'space-001',streamerId:'streamer-stable',streamerSlug:'papa',canonicalPath,matchedPath:path,isAlias:path!==canonicalPath,code:'pa',spaceCode:'sm',revision:1,configured:true,layout:'flat',...extra});
const html='<!doctype html><html><head><meta charset="utf-8"><title>PA</title></head><body><main>original template</main><script type="module" src="src/app.js"></script></body></html>';
function fixture({registry=path=>meta(path),asset=()=>null}={}){
 const calls=[];
 const worker=createPublicRouteWorker({fetch:async(input,options={})=>{
  const url=new URL(input),headers=new Headers(options.headers);calls.push({url:url.href,...options,headers});
  let response;
  if(url.origin==='https://registry.example.test')response=await registry(JSON.parse(options.body).path,options);
  else response=await asset(url,options);
  if(!(response instanceof Response))response=url.origin==='https://registry.example.test'?Response.json(response):new Response(options.method==='HEAD'?null:html,{status:200,headers:{'content-type':'text/html','cache-control':'public, max-age=500','set-cookie':'private-cookie','content-length':'12','etag':'old-etag','x-private-token':'must-drop'}});
  if(!response.url)Object.defineProperty(response,'url',{value:url.href});return response;
 }});
 const request=(path='/',options={},bindings=env)=>worker.fetch(new Request(origin+path,options),bindings);
 return {worker,request,calls,get registryCalls(){return calls.filter(x=>x.url.startsWith('https://registry.example.test'));},get assetCalls(){return calls.filter(x=>x.url.startsWith('https://assets.example.test'));}};
}

test('canonical GET returns original shell HTTP200 with safe base and projected stable-ID metadata',async()=>{
 const f=fixture({registry:path=>meta(path,'/pa',{privateAudit:'hidden',code:'</script><script>bad()</script>'})});
 const r=await f.request('/pa',{headers:{Cookie:'session=private',Authorization:'Bearer secret','x-private':'secret'}}),body=await r.text();
 assert.equal(r.status,200);assert.equal(f.registryCalls.length,1);assert.equal(f.assetCalls[0].url,env.ASSET_ORIGIN+'v2.html');
 assert.match(body,/<base href="\/">/);assert.match(body,/original template/);assert.match(body,/src="src\/app.js"/);
 const data=JSON.parse(/id="public-route-data">([^<]*)<\/script>/.exec(body)[1]);assert.equal(data.streamerId,'streamer-stable');assert.equal(data.spaceId,'space-001');assert.equal(data.section,'home');assert.equal('privateAudit' in data,false);assert.ok(body.includes('\\u003c/script>'));
 for(const request of f.calls){assert.equal(request.headers.has('cookie'),false);assert.equal(request.headers.has('authorization'),false);assert.equal(request.redirect,'manual');}
 assert.equal(f.assetCalls[0].headers.has('apikey'),false);assert.equal(f.registryCalls[0].headers.get('apikey'),env.PUBLISHABLE_KEY);
 assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('x-private-token'),null);assert.equal(r.headers.get('etag'),null);assert.equal(r.headers.get('content-length'),null);assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.equal(r.headers.get('Cloudflare-CDN-Cache-Control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
});
test('aliases 308 directly to latest canonical while keeping exact subpage and only safe query',async()=>{
 const f=fixture({registry:path=>path==='/OLD'?meta(path,'/NEW520'):null});
 const r=await f.request('/OLD/admin?adminTab=players&player=P1&tab=achievements&token=secret&notificationId=N&spaceId=wrong');
 assert.equal(r.status,308);const target=new URL(r.headers.get('location'));assert.equal(target.pathname,'/NEW520/admin');assert.equal(target.searchParams.get('adminTab'),'players');assert.equal(target.searchParams.get('player'),'P1');assert.equal(target.searchParams.get('tab'),'achievements');
 for(const key of ['token','notificationId','spaceId'])assert.equal(target.searchParams.has(key),false);assert.equal(f.registryCalls.length,2);assert.equal(f.assetCalls.length,0);assert.match(r.headers.get('cache-control'),/no-store/);
});
test('canonical dirty query is cleaned once; legal login intent survives without becoming authority',async()=>{
 const f=fixture();const r=await f.request('/pa?portalLogin=player&token=secret&notificationId=N');assert.equal(r.status,308);assert.equal(r.headers.get('location'),origin+'/pa?portalLogin=player');
 const follow=await f.request('/pa?portalLogin=player');assert.equal(follow.status,200);const text=await follow.text();assert.equal(text.includes('portalLogin'),false,'UI intent remains URL only, not identity metadata');
 const duplicated=await f.request('/pa?portalLogin=player&portalLogin=admin');assert.equal(duplicated.status,308);assert.equal(duplicated.headers.get('location'),origin+'/pa');
});
test('hall preserves bounded search/page filters and returns only hall shell; no fake streamer identity',async()=>{
 const f=fixture({registry:path=>meta(path,'/sm',{kind:'hall',streamerId:null,streamerSlug:null})});
 const r=await f.request('/sm?portalLogin=admin&q=test&page=2&roomQ=papa&roomPage=3&token=secret');
 assert.equal(r.status,308);const u=new URL(r.headers.get('location'));assert.equal(u.searchParams.get('q'),'test');assert.equal(u.searchParams.get('roomPage'),'3');assert.equal(u.searchParams.get('portalLogin'),'admin');assert.equal(u.searchParams.has('token'),false);
 const follow=await f.worker.fetch(new Request(u),env);assert.equal(follow.status,200);const body=await follow.text();assert.ok(body.includes('"kind":"hall"'));assert.ok(body.includes('"streamerId":null'));assert.equal(f.assetCalls.at(-1).url,env.ASSET_ORIGIN+'lobby.html');
});
test('root and reserved/static/media requests bypass registry and map only configured project mount',async()=>{
 for(const path of ['/','/app.html?install=public-stable-token','/index.html?entryLogin=player','/v2.html?streamer=papa','/login','/api','/assets/video.mp4','/video.webm','/logo.png','/src/app.js?v=10.19-WEB.1&token=secret']){
  const f=fixture({registry:()=>assert.fail('static must not lookup registry')});const r=await f.request(path,{headers:{range:'bytes=0-100',cookie:'session'}});assert.equal(r.status,200,path);assert.equal(f.registryCalls.length,0);const target=new URL(f.assetCalls[0].url);assert.equal(target.origin,'https://assets.example.test');assert.ok(target.pathname.startsWith('/project/'));assert.equal(target.searchParams.has('token'),false);assert.equal(f.assetCalls[0].headers.get('range'),'bytes=0-100');assert.equal(r.headers.get('set-cookie'),null);
  if(path.includes('?v='))assert.equal(target.searchParams.get('v'),'10.19-WEB.1');
 }
});
test('unknown valid route tries at most two indexed paths then preserves asset 404',async()=>{
 const f=fixture({registry:()=>null,asset:()=>new Response('unknown static page',{status:404,headers:{'content-type':'text/html'}})});const r=await f.request('/unknown/book');assert.equal(r.status,404);assert.equal(await r.text(),'unknown static page');assert.deepEqual(f.registryCalls.map(x=>JSON.parse(x.body).path),['/unknown/book','/unknown']);assert.equal(f.assetCalls[0].url,env.ASSET_ORIGIN+'unknown/book');
});
test('a registered dot-code that resembles a file extension remains valid after static 404',async()=>{
 const f=fixture({registry:path=>meta(path,'/qq.MP4'),asset:url=>url.pathname.endsWith('/qq.MP4')?new Response('no static file',{status:404}):null});
 const r=await f.request('/qq.MP4');assert.equal(r.status,200);assert.equal(f.registryCalls.length,1);assert.deepEqual(f.assetCalls.map(x=>new URL(x.url).pathname),['/project/qq.MP4','/project/v2.html']);assert.match(await r.text(),/public-route-data/);
});
test('HEAD resolves registry but uses asset HEAD and returns no body; HEAD aliases stay bodyless 308',async()=>{
 const f=fixture();const r=await f.request('/pa',{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');assert.equal(f.registryCalls[0].method,'POST');assert.equal(f.assetCalls[0].method,'HEAD');assert.equal(r.headers.get('content-length'),null);
 const g=fixture({registry:path=>meta(path,'/new')});const alias=await g.request('/old',{method:'HEAD'});assert.equal(alias.status,308);assert.equal(await alias.text(),'');assert.equal(g.assetCalls.length,0);
});
test('POST is never proxied to registry or asset origin',async()=>{
 const f=fixture();const r=await f.request('/pa',{method:'POST',body:'private'});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'GET, HEAD');assert.equal(f.calls.length,0);
});
test('current-host asset origin, cross-origin request and non-public API credential fail closed',async()=>{
 const f=fixture();assert.equal((await f.request('/pa',{}, {...env,ASSET_ORIGIN:origin+'/project/'})).status,503);assert.equal(f.calls.length,0);
 assert.equal((await f.worker.fetch(new Request('https://evil.test/pa'),env)).status,503);assert.equal(f.calls.length,0);
 for(const bindings of [{...env,PUBLISHABLE_KEY:'sb_secret_private'},{...env,API:origin+'/functions/v1/party-api'},{...env,ASSET_ORIGIN:'http://assets.example.test/'}])assert.equal((await f.request('/pa',{},bindings)).status,503);
 assert.equal(f.calls.length,0);
});
test('asset redirects never recurse to current host and cross-origin registry responses are rejected',async()=>{
 const f=fixture({asset:()=>Response.redirect(origin+'/pa',301)});const r=await f.request('/pa');assert.equal(r.status,503);assert.equal(f.assetCalls.length,1);assert.equal(r.headers.get('location'),null);
 const crossed=fixture({registry:()=>{const r=Response.json(meta('/pa'));Object.defineProperty(r,'url',{value:'https://evil.test/data'});return r;}});assert.equal((await crossed.request('/pa')).status,503);assert.equal(crossed.assetCalls.length,0);
});
test('invalid metadata, upstream errors, oversized or cross-origin-script shells do not return apparent success',async()=>{
 for(const registry of [()=>meta('/other'),()=>meta('/pa','//evil.test/path'),()=>new Response('bad',{status:500}),()=>new Response('x'.repeat(16385),{headers:{'content-type':'application/json'}})]){const f=fixture({registry});assert.equal((await f.request('/pa')).status,503);assert.equal(f.assetCalls.length,0);}
 for(const content of [html.replace('src/app.js','https://evil.test/bad.js'),'x'.repeat(262145),'<html><body>missing head</body></html>']){const f=fixture({asset:()=>new Response(content,{headers:{'content-type':'text/html'}})});assert.equal((await f.request('/pa')).status,503);}
});
test('explicit route-origin mode uses same-zone Request only behind the confirmed Route/DNS origin',async()=>{
 const calls=[],worker=createPublicRouteWorker({fetch:async(input,options={})=>{
  const request=input instanceof Request?input:new Request(input,options);calls.push(request);
  if(new URL(request.url).origin==='https://registry.example.test')return Response.json(meta(JSON.parse(await request.text()).path));
  assert.ok(input instanceof Request,'route-origin must fetch a Request object to the configured same-zone origin');
  assert.equal(new URL(request.url).origin,origin);assert.equal(request.headers.has('cookie'),false);assert.equal(request.headers.has('authorization'),false);assert.equal(request.redirect,'manual');
  return new Response(request.method==='HEAD'?null:html,{headers:{'content-type':'text/html'}});
 }}),bindings={API:env.API,PUBLISHABLE_KEY:env.PUBLISHABLE_KEY,ASSET_MODE:'route-origin',ROUTE_ORIGIN_CONFIRMED:'true'};
 const canonical=await worker.fetch(new Request(origin+'/pa',{headers:{Cookie:'private',Authorization:'secret'}}),bindings);
 assert.equal(canonical.status,200);assert.equal(calls.at(-1).url,origin+'/v2.html');assert.match(await canonical.text(),/public-route-data/);
 const root=await worker.fetch(new Request(origin+'/'),bindings);assert.equal(root.status,200);assert.equal(calls.at(-1).url,origin+'/');
 const head=await worker.fetch(new Request(origin+'/pa',{method:'HEAD'}),bindings);assert.equal(head.status,200);assert.equal(calls.at(-1).method,'HEAD');assert.equal(await head.text(),'');
 const count=calls.length;
 for(const bad of [{...bindings,ROUTE_ORIGIN_CONFIRMED:'false'},{...bindings,ROUTE_ORIGIN_CONFIRMED:undefined},{...bindings,ASSET_ORIGIN:env.ASSET_ORIGIN},{...bindings,ASSET_MODE:'guess'}])assert.equal((await worker.fetch(new Request(origin+'/pa'),bad)).status,503);
 assert.equal((await worker.fetch(new Request('https://worker.workers.dev/pa'),bindings)).status,503);assert.equal(calls.length,count);
});
