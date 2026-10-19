import {parsePublicRoutePath,canonicalPublicHome,publicPageDestination} from './public-route-location.js?v=10.19-WEB.2';
import {pageLocation} from './streamer-navigation.js?v=10.19-WEB.2';
import {lobbyQuery,lobbyLocation} from './public-lobby.js?v=10.19-WEB.2';

const metadataFields=['version','kind','spaceId','streamerId','streamerSlug','canonicalPath','matchedPath','isAlias','code','spaceCode','revision','configured','layout'];
const templateLoads=new WeakMap();
const slashTrim=value=>value.replace(/\/$/,'');
const stableId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\u0000-\u001f\u007f-\u009f]/u.test(value);
const streamerSlug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);

function publicMetadata(value,candidate,origin){
 if(!value||typeof value!=='object'||value.version!==1||value.configured!==true||!['hall','streamer'].includes(value.kind)||!stableId(value.spaceId))return null;
 if(value.kind==='streamer'&&(!stableId(value.streamerId)||!streamerSlug(value.streamerSlug))||value.kind==='hall'&&(value.streamerId!==null||value.streamerSlug!==null))return null;
 if(typeof value.canonicalPath!=='string')return null;
 const canonical=canonicalPublicHome(origin,value.canonicalPath);
 if(!canonical||new URL(canonical).pathname!==value.canonicalPath)return null;
 if(typeof value.matchedPath!=='string'||slashTrim(value.matchedPath).toLowerCase()!==candidate.homepagePath.toLowerCase())return null;
 const metadata={};
 for(const key of metadataFields){const field=value[key];if(field===null||['string','number','boolean'].includes(typeof field))metadata[key]=field;}
 return metadata;
}

/** Keep only each public page's bounded navigation state and a login UI intent. */
export function publicRouteDestination(href,metadata,view={}){
 let current,home;
 try{current=new URL(href);home=canonicalPublicHome(current.origin,metadata?.canonicalPath);}catch{return null;}
 if(!home||!['hall','streamer'].includes(metadata?.kind))return null;
 if(metadata.kind==='hall'){
  if(view.route&&view.route!=='home')return null;
  const url=new URL(home);url.search=current.search;
  return lobbyLocation(url.href,lobbyQuery(current.href));
 }
 const selected=view.selectedPlayer,boundedView={...view,selectedPlayer:typeof selected==='string'&&selected.length>0&&selected.length<=200&&!/[\s\u0000-\u001f\u007f-\u009f]/u.test(selected)?selected:null};
 const destination=publicPageDestination(current.href,home,boundedView);
 if(!destination)return null;
 const url=new URL(destination),intent=current.searchParams.getAll('portalLogin');
 if(intent.length===1&&['player','admin'].includes(intent[0]))url.searchParams.set('portalLogin',intent[0]);
 return url.href;
}

/** At most two indexed alias lookups; never derive stable IDs from the path. */
export async function resolvePublicPage(href,{mountUrl,resolve}={}){
 const parsed=parsePublicRoutePath(href,{mountUrl});
 if(!parsed.eligible||typeof resolve!=='function')return null;
 const current=new URL(href,mountUrl);
 for(const candidate of parsed.candidates){
  const value=await resolve(candidate.homepagePath);
  if(value===null||value===undefined)continue;
  const metadata=publicMetadata(value,candidate,current.origin);
  if(!metadata)throw new Error('PUBLIC_ROUTE_RESPONSE_INVALID');
  if(metadata.kind==='hall'&&candidate.section!=='home')continue;
  const location=new URL(current.href),path=slashTrim(current.pathname);
  // Former hash links remain valid; an explicit /book or /admin tail wins.
  if(path.toLowerCase()!==candidate.homepagePath.toLowerCase())location.hash=candidate.section;
  else if(candidate.section!=='home')location.hash=candidate.section;
  if(metadata.kind==='hall')location.hash='home';
  const view=pageLocation(location.href),section=view.route;
  const destination=publicRouteDestination(current.href,metadata,view);
  if(!destination)throw new Error('PUBLIC_ROUTE_DESTINATION_INVALID');
  return {metadata,section,view,destination};
 }
 return null;
}

function templateMount(href,mountUrl){
 const current=new URL(href),mount=new URL(mountUrl||'/',current);
 if(!['https:','http:'].includes(mount.protocol)||mount.origin!==current.origin||mount.username||mount.password||mount.search||mount.hash)throw new Error('PUBLIC_ROUTE_TEMPLATE_ORIGIN');
 if(!mount.pathname.endsWith('/'))mount.pathname+='/';
 return mount;
}
function executable(script){
 const type=(script.getAttribute('type')||'').toLowerCase();
 return !type||['module','text/javascript','application/javascript'].includes(type);
}
async function runTemplateScripts(document,base,timeoutMs){
 for(const old of [...document.querySelectorAll('script')]){
  if(!executable(old))continue;
  const script=document.createElement('script');
  for(const attr of [...old.attributes])script.setAttribute(attr.name,attr.value);
  const src=old.getAttribute('src');
  if(src)script.setAttribute('src',new URL(src,base).href);
  script.textContent=old.textContent;
  if(src||script.getAttribute('type')==='module'){
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('PUBLIC_ROUTE_SCRIPT_TIMEOUT')),timeoutMs);
    script.onload=()=>{clearTimeout(timer);resolve();};
    script.onerror=()=>{clearTimeout(timer);reject(new Error('PUBLIC_ROUTE_SCRIPT_FAILED'));};
    old.replaceWith(script);
   });
  }else old.replaceWith(script);
 }
}

/** Load the existing same-origin shell in place so refresh retains its pretty URL. */
export function loadPublicTemplate(result,{window=globalThis.window,document=globalThis.document,fetch=globalThis.fetch,mountUrl,DOMParser=globalThis.DOMParser,scriptTimeoutMs=15000}={}){
 if(!result?.metadata||!window?.location?.href||!document||typeof fetch!=='function'||typeof DOMParser!=='function')return Promise.reject(new Error('PUBLIC_ROUTE_TEMPLATE_ENVIRONMENT'));
 const previous=templateLoads.get(document);
 if(previous){
  if(previous.destination!==result.destination)return Promise.reject(new Error('PUBLIC_ROUTE_TEMPLATE_ALREADY_LOADED'));
  return previous.promise;
 }
 const promise=(async()=>{
  const current=new URL(window.location.href),mount=templateMount(current.href,mountUrl);
  if(!publicMetadata(result.metadata,{homepagePath:result.metadata.matchedPath},current.origin))throw new Error('PUBLIC_ROUTE_RESPONSE_INVALID');
  const expected=publicRouteDestination(current.href,result.metadata,result.view);
  if(!expected||expected!==result.destination||!['hall','streamer'].includes(result.metadata.kind))throw new Error('PUBLIC_ROUTE_DESTINATION_INVALID');
  const template=new URL(result.metadata.kind==='hall'?'lobby.html':'v2.html',mount);
  const response=await fetch(template.href,{credentials:'omit',headers:{Accept:'text/html'},cache:'force-cache'});
  if(!response.ok)throw new Error('PUBLIC_ROUTE_TEMPLATE_FAILED');
  if(response.url&&new URL(response.url).origin!==current.origin)throw new Error('PUBLIC_ROUTE_TEMPLATE_ORIGIN');
  const contentType=response.headers?.get?.('content-type');
  if(contentType&&!/^text\/html(?:;|$)/i.test(contentType))throw new Error('PUBLIC_ROUTE_TEMPLATE_CONTENT_TYPE');
  const html=await response.text();
  if(html.length>262144)throw new Error('PUBLIC_ROUTE_TEMPLATE_TOO_LARGE');
  const parsed=new DOMParser().parseFromString(html,'text/html');
  if(!parsed?.documentElement||!parsed.head||!parsed.body)throw new Error('PUBLIC_ROUTE_TEMPLATE_INVALID');
  for(const script of parsed.querySelectorAll('script[src]')){
   const source=new URL(script.getAttribute('src'),mount);
   if(source.origin!==current.origin||!['https:','http:'].includes(source.protocol))throw new Error('PUBLIC_ROUTE_TEMPLATE_SCRIPT_ORIGIN');
  }
  for(const element of parsed.querySelectorAll('base, #public-route-data'))element.remove();
  const base=parsed.createElement('base');base.setAttribute('href',mount.pathname);parsed.head.prepend(base);
  const data=parsed.createElement('script');data.setAttribute('id','public-route-data');data.setAttribute('type','application/json');
  const metadata={};for(const key of metadataFields)if(Object.hasOwn(result.metadata,key))metadata[key]=result.metadata[key];
  data.textContent=JSON.stringify({...metadata,section:result.section}).replace(/</g,'\\u003c');parsed.head.append(data);
  const root=document.importNode(parsed.documentElement,true);
  window.history.replaceState(null,'',result.destination);
  document.replaceChild(root,document.documentElement);
  await runTemplateScripts(document,mount,scriptTimeoutMs);
  return {...result,templateUrl:template.href};
 })();
 // Cache failures as well: partially executed app modules must never run twice.
 templateLoads.set(document,{destination:result.destination,promise});
 return promise;
}
