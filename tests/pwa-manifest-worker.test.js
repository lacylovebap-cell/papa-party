import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPublicRouteWorker} from '../ops/public-route-worker.mjs';
import {encodeInstallSource,decodeInstallSource} from '../src/pwa-install-source.js';
const manifest=JSON.parse(await readFile(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const origin='https://paparty.app',api='https://registry.example.test/functions/v1/party-api';
const env={ASSET_ORIGIN:'https://assets.example.test/project/',API:api,PUBLISHABLE_KEY:'sb_publishable_test_public_key_123'};
const source={v:1,kind:'streamer',spaceId:'future-space',streamerId:'streamer-123'};
function fixture({home=body=>({...body,version:1,active:true,configured:true,streamerSlug:'safe-slug',name:'public',canonicalPath:'/qq.ABC'}),template=manifest}={}){
 const calls=[],worker=createPublicRouteWorker({fetch:async(input,options={})=>{
  const url=new URL(input),headers=new Headers(options.headers);calls.push({url:url.href,...options,headers});
  if(url.href===api){const value=await home(JSON.parse(options.body));return value instanceof Response?value:Response.json(value);}
  assert.equal(url.href,env.ASSET_ORIGIN+'manifest.webmanifest');return Response.json(template,{headers:{'content-type':'application/manifest+json','set-cookie':'must-not-copy','etag':'static'}});
 }});
 return {calls,request:(suffix='',method='GET')=>worker.fetch(new Request(origin+'/manifest.webmanifest'+suffix,{method,headers:{Cookie:'private',Authorization:'secret'}}),env)};
}
test('static manifest now launches in the APP chooser while preserving one existing application identity',()=>{
 assert.equal(manifest.id,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./app.html');assert.equal(manifest.name,'PA Party');assert.equal(manifest.icons.length,3);
});
test('verified install source is carried by manifest start_url across isolated iOS storage; identity stays shared',async()=>{
 for(const target of [source,{v:1,kind:'hall',spaceId:'another-space',streamerId:null}]){
  const f=fixture(),response=await f.request('?install='+encodeInstallSource(target)),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.id,manifest.id);assert.equal(result.scope,manifest.scope);assert.equal(result.name,manifest.name);assert.deepEqual(result.icons,manifest.icons);
  const start=new URL(result.start_url,origin+'/manifest.webmanifest');assert.equal(start.pathname,'/app.html');assert.deepEqual(decodeInstallSource(start.searchParams.get('install')),target);
  assert.equal(f.calls.length,2);const lookup=JSON.parse(f.calls[0].body);assert.deepEqual(lookup,{op:'publicAppHome',v:1,kind:target.kind,spaceId:target.spaceId,streamerId:target.streamerId});
  for(const call of f.calls){assert.equal(call.headers.has('cookie'),false);assert.equal(call.headers.has('authorization'),false);}
  assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('etag'),null);assert.match(response.headers.get('content-type'),/application\/manifest\+json/);
 }
});
test('active old public streamer without pretty URL retains its stable installation source',async()=>{
 const f=fixture({home:body=>({...body,active:true,configured:false,canonicalPath:null,streamerSlug:'legacy-streamer',homePath:'/v2.html?streamer=legacy-streamer'})});
 const response=await f.request('?install='+encodeInstallSource(source)),result=await response.json();assert.deepEqual(decodeInstallSource(new URL(result.start_url,origin).searchParams.get('install')),source);
});
test('missing, malformed or repeated install source returns APP chooser without a metadata lookup',async()=>{
 for(const suffix of ['', '?install=bad!', '?install='+encodeInstallSource(source)+'&install='+encodeInstallSource(source),'?token=private&install=bad']){
  const f=fixture({home:()=>assert.fail('invalid source must not lookup')}),response=await f.request(suffix);assert.equal(response.status,200);assert.equal((await response.json()).start_url,'./app.html');assert.equal(f.calls.length,1);
 }
});
test('inactive, foreign, incomplete or spoofed scope cannot become an installed homepage',async()=>{
 for(const home of [()=>null,body=>({...body,active:false,streamerSlug:'valid'}),body=>({...body,active:true,spaceId:'wrong',streamerSlug:'valid'}),body=>({...body,active:true,streamerId:'wrong',streamerSlug:'valid'}),body=>({...body,active:true,streamerSlug:'../private'}),body=>({...body,active:true,kind:'hall',streamerId:null})]){
  const f=fixture({home}),response=await f.request('?install='+encodeInstallSource(source));assert.equal(response.status,200);assert.equal((await response.json()).start_url,'./app.html');assert.equal(f.calls.length,2);
 }
});
test('HEAD resolves identity and original manifest safely, never returns a body or obsolete content length',async()=>{
 const f=fixture(),response=await f.request('?install='+encodeInstallSource(source),'HEAD');assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(response.headers.get('content-length'),null);assert.equal(f.calls.at(-1).method,'GET');
});
test('failed public source lookup or modified shared identity cannot silently install a different application',async()=>{
 const failed=fixture({home:()=>new Response('bad',{status:503})});assert.equal((await failed.request('?install='+encodeInstallSource(source))).status,503);
 for(const template of [{...manifest,id:'/different-app'},{...manifest,scope:'/private/'},{...manifest,icons:null}]){const f=fixture({template});assert.equal((await f.request()).status,503);}
});

test('pretty pages expose the verified source manifest before application scripts or business loading',async()=>{
 const target={version:1,configured:true,kind:'streamer',spaceId:'space-001',streamerId:'papa',streamerSlug:'papa',canonicalPath:'/pa',matchedPath:'/pa'},calls=[];
 const worker=createPublicRouteWorker({fetch:async(url,options={})=>{calls.push(String(url));if(String(url)===api){const body=JSON.parse(options.body);assert.equal(body.op,'publicRouteResolve');return Response.json(body.path==='/pa'?target:null);}return new Response('<html><head><link rel="manifest" href="manifest.webmanifest"><script src="src/app.js"></script></head><body></body></html>',{headers:{'content-type':'text/html'}});}});
 const response=await worker.fetch(new Request(origin+'/pa/book'),env),html=await response.text();assert.equal(response.status,200);
 const tag=html.match(/<link rel="manifest" href="([^"]+)">/);assert.ok(tag);assert.equal((html.match(/rel="manifest"/g)||[]).length,1);assert.ok(html.indexOf(tag[0])<html.indexOf('<script src='));
 assert.deepEqual(decodeInstallSource(new URL(tag[1],origin).searchParams.get('install')),{v:1,kind:'streamer',spaceId:'space-001',streamerId:'papa'});assert.ok(calls.filter(u=>u===api).length<=2);
});
