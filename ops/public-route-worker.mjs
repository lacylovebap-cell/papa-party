// REVIEW-ONLY Cloudflare module Worker. No wrangler config or deployment action.
import {API as DEFAULT_API,PUBLISHABLE_KEY as DEFAULT_PUBLIC_KEY} from '../src/config.js';
import {parsePublicRoutePath} from '../src/public-route-location.js';
import {resolvePublicPage} from '../src/public-route-bootstrap.js';
import {decodeInstallSource,encodeInstallSource,normalizeInstallSource} from '../src/pwa-install-source.js';

const ORIGIN='https://paparty.app';
const RESPONSE_HEADERS=['content-type','cache-control','etag','last-modified','accept-ranges','content-range','content-disposition','content-encoding','expires','content-security-policy','x-frame-options'];
const REQUEST_HEADERS=['accept','accept-encoding','range','if-none-match','if-modified-since'];
const STATIC_EXTENSION=/\.(?:m?js|cjs|css|json|map|txt|xml|ico|png|jpe?g|gif|webp|avif|svg|bmp|mp4|webm|mov|mp3|m4a|wav|ogg|woff2?|ttf|otf|pdf|zip)$/i;
const keyIsPublic=value=>typeof value==='string'&&/^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(value);
function publicKey(value){
 if(keyIsPublic(value))return value;
 // Compatibility with a legacy, already-public Supabase anon JWT. Never allow service_role.
 try{const parts=String(value).split('.');if(parts.length===3&&JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon')return value;}catch{}
 throw Error('PUBLIC_ROUTE_PUBLIC_KEY_REQUIRED');
}
function trustedConfig(env,current){
 const expected=new URL(env.PUBLIC_ORIGIN||ORIGIN);
 if(expected.origin!==current.origin||expected.protocol!=='https:'||expected.username||expected.password||expected.pathname!=='/'||expected.search||expected.hash)throw Error('PUBLIC_ROUTE_REQUEST_ORIGIN');
 if(env.ASSET_MODE==='route-origin'){
  // Only for a Cloudflare Route in front of the existing proxied DNS origin.
  // NOT a Worker Custom Domain / workers.dev: those have different fetch routing semantics.
  if(env.ROUTE_ORIGIN_CONFIRMED!=='true'||env.ASSET_ORIGIN&&env.ASSET_ORIGIN!==expected.origin+'/')throw Error('PUBLIC_ROUTE_ROUTE_ORIGIN_UNCONFIRMED');
  return {asset:new URL(expected.origin+'/'),current,origin:expected.origin,mode:'route-origin'};
 }
 if(env.ASSET_MODE&&env.ASSET_MODE!=='external')throw Error('PUBLIC_ROUTE_ASSET_MODE');
 const asset=new URL(env.ASSET_ORIGIN);
 if(asset.protocol!=='https:'||asset.username||asset.password||asset.search||asset.hash||asset.origin===current.origin||/[\\%]/.test(asset.pathname))throw Error('PUBLIC_ROUTE_ASSET_ORIGIN');
 if(!asset.pathname.endsWith('/'))asset.pathname+='/';
 return {asset,current,origin:expected.origin,mode:'external'};
}
function outputHeaders(upstream,{privateResponse=false,rewritten=false}={}){
 const headers=new Headers();
 for(const key of RESPONSE_HEADERS){const value=upstream?.get?.(key);if(value!==null&&value!==undefined)headers.set(key,value);}
 headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
 if(privateResponse){headers.set('Cache-Control','private, no-store, max-age=0');headers.set('CDN-Cache-Control','no-store');headers.set('Cloudflare-CDN-Cache-Control','no-store');headers.set('Vary','Accept');}
 if(rewritten){for(const key of ['etag','last-modified','content-encoding','content-range','accept-ranges','expires'])headers.delete(key);}
 // Set-Cookie, Authorization, API keys, custom/private response headers and stale Content-Length are never copied.
 return headers;
}
function fail(code,status=503,head=false){
 const headers=outputHeaders(null,{privateResponse:true});headers.set('content-type','text/plain; charset=utf-8');
 return new Response(head?null:code,{status,headers});
}
function targetAsset(config,path,query=''){
 const url=new URL(config.asset);url.pathname=config.asset.pathname.replace(/\/$/,'')+'/'+path.replace(/^\//,'');
 // Static release cache keys are allowed; page/auth queries stay in the browser, never the asset origin logs.
 const source=new URLSearchParams(query),v=source.getAll('v');if(v.length===1&&/^[A-Za-z0-9_.-]{1,100}$/.test(v[0]))url.searchParams.set('v',v[0]);
 return url;
}
function requestHeaders(request,{template=false}={}){
 const headers=new Headers();
 for(const name of REQUEST_HEADERS){if(template&&name!=='accept')continue;const value=request.headers.get(name);if(value)headers.set(name,value);}
 if(template)headers.set('Accept','text/html');
 return headers;
}
async function boundedText(response,max){
 if(Number(response.headers.get('content-length'))>max)throw Error('PUBLIC_ROUTE_RESPONSE_TOO_LARGE');
 const reader=response.body?.getReader?.();if(!reader){const text=await response.text();if(new TextEncoder().encode(text).length>max)throw Error('PUBLIC_ROUTE_RESPONSE_TOO_LARGE');return text;}
 const decoder=new TextDecoder();let bytes=0,text='';
 try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>max){await reader.cancel();throw Error('PUBLIC_ROUTE_RESPONSE_TOO_LARGE');}text+=decoder.decode(item.value,{stream:true});}return text+decoder.decode();}
 finally{reader.releaseLock();}
}
async function assetResponse(fetch,request,config,path,{template=false}={}){
 const target=targetAsset(config,path,template?'':config.current.search);
 const options={method:request.method,headers:requestHeaders(request,{template}),redirect:'manual',signal:AbortSignal.timeout(10000)};
 // Official Routes behavior sends this same-zone Request to the DNS-configured
 // application origin, not back through this Route Worker. Explicit mode gate above.
 const response=config.mode==='route-origin'?await fetch(new Request(target.href,options)):await fetch(target.href,options);
 if(response.url&&new URL(response.url).origin!==config.asset.origin)throw Error('PUBLIC_ROUTE_ASSET_RESPONSE_ORIGIN');
 // In particular, GitHub Pages custom-domain redirects back to paparty.app must not recurse.
 if(response.status>=300&&response.status<400&&response.status!==304)throw Error('PUBLIC_ROUTE_ASSET_REDIRECT');
 return response;
}
function publicApi(env,config,fetch){
 const api=new URL(env.API||DEFAULT_API);
 if(api.protocol!=='https:'||api.username||api.password||api.origin===config.origin||api.search||api.hash||api.pathname!=='/functions/v1/party-api')throw Error('PUBLIC_ROUTE_API_ORIGIN');
 const key=publicKey(env.PUBLISHABLE_KEY||DEFAULT_PUBLIC_KEY);
 return async body=>{
  const response=await fetch(api.href,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json',apikey:key,'Cache-Control':'no-store'},body:JSON.stringify(body)});
  if(response.url&&new URL(response.url).origin!==api.origin||!response.ok||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('PUBLIC_ROUTE_LOOKUP_FAILED');
  const raw=await boundedText(response,16384);
  let value;try{value=JSON.parse(raw);}catch{throw Error('PUBLIC_ROUTE_LOOKUP_INVALID');}
  if(value?.error)throw Error('PUBLIC_ROUTE_LOOKUP_FAILED');return value;
 };
}
function resolveApi(env,config,fetch){const lookup=publicApi(env,config,fetch);return path=>lookup({op:'publicRouteResolve',path});}

async function installManifest(fetch,request,config,env,head){
 // A manifest's id/scope stay shared. Only its initial public stable-ID hint is
 // personalized. No browser/account cookies, identities, or mutable URL slugs
 // are copied into either the manifest URL or the eventual launch URL.
 const tokens=config.current.searchParams.getAll('install'),source=tokens.length===1?decodeInstallSource(tokens[0]):null;
 let verified=null;
 if(source){const row=await publicApi(env,config,fetch)({op:'publicAppHome',v:1,kind:source.kind,spaceId:source.spaceId,streamerId:source.streamerId});
  const target=normalizeInstallSource(row);
  if(row?.active===true&&target&&target.kind===source.kind&&target.spaceId===source.spaceId&&target.streamerId===source.streamerId
   &&(source.kind==='hall'||typeof row.streamerSlug==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.streamerSlug)))verified=source;
 }
 const getRequest=head?new Request(request.url,{method:'GET',headers:request.headers}):request;
 const upstream=await assetResponse(fetch,getRequest,config,'manifest.webmanifest',{template:true});
 if(upstream.status!==200||!/^application\/(?:manifest\+)?json(?:;|$)/i.test(upstream.headers.get('content-type')||''))throw Error('APP_MANIFEST_TEMPLATE_FAILED');
 let manifest;try{manifest=JSON.parse(await boundedText(upstream,32768));}catch{throw Error('APP_MANIFEST_TEMPLATE_INVALID');}
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||new URL(manifest.id,config.origin+'/manifest.webmanifest').href!==config.origin+'/'
  ||new URL(manifest.scope,config.origin+'/manifest.webmanifest').href!==config.origin+'/'||typeof manifest.name!=='string'||!Array.isArray(manifest.icons))throw Error('APP_MANIFEST_IDENTITY_INVALID');
 manifest.start_url='./app.html'+(verified?'?install='+encodeInstallSource(verified):'');
 const headers=outputHeaders(upstream.headers,{privateResponse:true,rewritten:true});headers.set('Content-Type','application/manifest+json; charset=utf-8');
 return new Response(head?null:JSON.stringify(manifest),{status:200,headers});
}
function renderTemplate(html,result){
 if(html.length>262144||!/<html\b/i.test(html)||!/<head\b[^>]*>/i.test(html)||!/<\/head\s*>/i.test(html)||!/<body\b/i.test(html))throw Error('PUBLIC_ROUTE_TEMPLATE_INVALID');
 for(const tag of html.matchAll(/<script\b[^>]*>/gi)){
  const src=/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0]);
  if(src){const url=new URL(src[1]??src[2]??src[3],result.destination);if(url.origin!==new URL(result.destination).origin||!['http:','https:'].includes(url.protocol))throw Error('PUBLIC_ROUTE_SCRIPT_ORIGIN');}
 }
 const metadata={...result.metadata,section:result.section},json=JSON.stringify(metadata).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const clean=html.replace(/<base\b[^>]*>/gi,'').replace(/<script\b[^>]*\bid\s*=\s*(['"])public-route-data\1[^>]*>[\s\S]*?<\/script\s*>/gi,'');
 const token=encodeInstallSource({v:1,kind:metadata.kind,spaceId:metadata.spaceId,streamerId:metadata.streamerId}),manifestTag='<link rel="manifest" href="/manifest.webmanifest'+(token?'?install='+token:'')+'">';
 // Put the verified install hint into the initial HTML, before the browser
 // discovers the manifest. This also works before the app's data finishes loading.
 const prepared=clean.replace(/<link\b(?=[^>]*\brel\s*=\s*(['"])manifest\1)[^>]*>/gi,'');
 return prepared.replace(/<head\b[^>]*>/i,head=>head+'<base href="/">'+manifestTag+'<script type="application/json" id="public-route-data">'+json+'</script>');
}

export function createPublicRouteWorker({fetch=globalThis.fetch}={}){
 return {async fetch(request,env={}){
  const head=request.method==='HEAD';
  if(!['GET','HEAD'].includes(request.method)){const response=fail('METHOD_NOT_ALLOWED',405,head);response.headers.set('Allow','GET, HEAD');return response;}
  let current,config;try{current=new URL(request.url);config=trustedConfig(env,current);}catch{return fail('PUBLIC_ROUTE_CONFIGURATION_REQUIRED',503,head);}
  try{
   if(current.pathname==='/manifest.webmanifest')return await installManifest(fetch,request,config,env,head);
   const parsed=parsePublicRoutePath(current.href,{mountUrl:config.origin+'/'});
   let preliminary;
   const passthrough=async()=>{const response=preliminary||await assetResponse(fetch,request,config,current.pathname);return new Response(head?null:response.body,{status:response.status,statusText:response.statusText,headers:outputHeaders(response.headers)});};
   // The platform root, all system/static/media paths, and non-route paths never query the registry.
   if(current.pathname==='/app.html'||!parsed.eligible)return await passthrough();
   // A dot can be either a static extension or a legitimate hall/host code.
   // Prefer an actual existing file, but a missing .MP4/.PNG name may still be a registered homepage.
   if(STATIC_EXTENSION.test(current.pathname)){preliminary=await assetResponse(fetch,request,config,current.pathname);if(preliminary.status!==404)return await passthrough();}
   const result=await resolvePublicPage(current.href,{mountUrl:config.origin+'/',resolve:resolveApi(env,config,fetch)});
   if(!result)return await passthrough();
   const meta=result.metadata;
   if(meta.version!==1||meta.configured!==true||meta.kind==='hall'&&(meta.streamerId!==null||result.section!=='home'))return await passthrough();
   const destination=result.destination,canonical=new URL(destination);
   if(canonical.origin!==current.origin)throw Error('PUBLIC_ROUTE_DESTINATION_ORIGIN');
   if(preliminary?.body)await preliminary.body.cancel();
   if(current.origin+current.pathname+current.search!==canonical.href){
    const headers=outputHeaders(null,{privateResponse:true});headers.set('Location',canonical.href);return new Response(null,{status:308,headers});
   }
   const response=await assetResponse(fetch,request,config,meta.kind==='hall'?'lobby.html':'v2.html',{template:true});
   if(response.status!==200||!/^text\/html(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('PUBLIC_ROUTE_TEMPLATE_FAILED');
   const headers=outputHeaders(response.headers,{privateResponse:true,rewritten:true});headers.set('content-type','text/html; charset=utf-8');
   if(head)return new Response(null,{status:200,headers});
   return new Response(renderTemplate(await boundedText(response,262144),{...result,destination}),{status:200,headers});
  }catch{return fail('PUBLIC_ROUTE_TEMPORARILY_UNAVAILABLE',503,head);}
 }};
}
export default createPublicRouteWorker();
