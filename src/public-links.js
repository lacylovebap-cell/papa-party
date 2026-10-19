import {canonicalPublicHome,parsePublicRoutePath} from './public-route-location.js';
import {pageLocation} from './streamer-navigation.js?v=10.19-WEB.1';

const text=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value);
const slug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const sections=new Set(['home','book','common-book','center','gallery','admin']);
const publicFields=['version','kind','spaceId','streamerId','streamerSlug','canonicalPath','configured','layout','spaceCode','code','revision'];
export const PUBLIC_SITE_ORIGIN='https://paparty.app';

// Route metadata chooses a destination and local preference partition only.
// It never supplies a login, membership or manager permission.
export function readPublicRouteContext({document=globalThis.document,href=globalThis.location?.href,mountUrl}={}){
 let value;try{value=JSON.parse(document.querySelector('#public-route-data')?.textContent||'null');}catch{return null;}
 if(value?.version!==1||!['hall','streamer'].includes(value.kind)||!text(value.spaceId)||!sections.has(value.section)||value.configured!==true)return null;
 if(value.kind==='streamer'&&(!text(value.streamerId)||!slug(value.streamerSlug))||value.kind==='hall'&&(value.streamerId!=null||value.section!=='home'))return null;
 let home;try{home=canonicalPublicHome(new URL(href).origin,value.canonicalPath);}catch{return null;}
 if(!home)return null;
 const parsed=parsePublicRoutePath(href,{mountUrl});
 if(!parsed.eligible||!parsed.candidates.some(candidate=>candidate.homepagePath.toLowerCase()===value.canonicalPath.toLowerCase()&&candidate.section===value.section))return null;
 return Object.freeze({version:1,kind:value.kind,spaceId:value.spaceId,streamerId:value.streamerId??null,streamerSlug:value.streamerSlug??null,canonicalPath:value.canonicalPath,canonicalHome:home,section:value.section});
}

export function publicApplicationHref(href,context,mountUrl){
 if(!context||context.kind!=='streamer')return href;
 const source=new URL(href),target=new URL('v2.html',mountUrl||source.origin+'/');
 target.search=source.search;target.searchParams.set('streamer',context.streamerSlug);
 target.searchParams.delete('space');target.searchParams.delete('spaceId');
 if(context.spaceId!=='space-001')target.searchParams.set('spaceId',context.spaceId);
 const prefix=context.canonicalPath.replace(/\/$/,''),tail=source.pathname.toLowerCase().startsWith(prefix.toLowerCase()+'/')?source.pathname.slice(prefix.length+1):'';
 const section=source.pathname.replace(/\/$/,'').toLowerCase()===prefix.toLowerCase()?'home':sections.has(tail)?tail:context.section;
 target.hash=sections.has(source.hash.slice(1))?source.hash.slice(1):section;
 return target.href;
}

export function publicApplicationPage(href,context,mountUrl,fallbackTab){return pageLocation(publicApplicationHref(href,context,mountUrl),fallbackTab);}

function scopeOf(input){
 const kind=input?.kind||'streamer',spaceId=input?.spaceId,streamerId=kind==='hall'?null:input?.streamerId;
 if(!['hall','streamer'].includes(kind)||!text(spaceId)||kind==='streamer'&&!text(streamerId))throw Error('公開網址的主播或空間尚未確認');
 return {kind,spaceId,streamerId};
}
function verifiedInfo(value,scope){
 if(value?.version!==1||value.kind!==scope.kind||value.spaceId!==scope.spaceId||(value.streamerId??null)!==scope.streamerId||typeof value.configured!=='boolean')throw Error('公開網址範圍尚未確認');
 if(value.configured&&(!canonicalPublicHome(PUBLIC_SITE_ORIGIN,value.canonicalPath)||scope.kind==='streamer'&&!slug(value.streamerSlug)))throw Error('公開網址尚未確認');
 return Object.fromEntries(publicFields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
}

/** Bounded, on-demand public metadata cache; no polling, subscriptions or profile reads. */
export function createPublicLinkClient({api,now=Date.now,ttl=60000}={}){
 const cache=new Map(),pending=new Map();let generation=0;
 async function info(input,{force=false}={}){
  const scope=scopeOf(input),key=JSON.stringify(scope),hit=cache.get(key);
  if(!force&&hit&&now()-hit.at<ttl)return {...hit.value};
  if(pending.has(key))return pending.get(key);
  const turn=generation,request=Promise.resolve().then(()=>{if(turn!==generation)throw Error('首頁或登入身分已變更，請重新開啟分享');return api({op:'publicRouteInfo',...scope});}).then(value=>{
   if(turn!==generation)throw Error('首頁或登入身分已變更，請重新開啟分享');
   const result=verifiedInfo(value,scope);cache.set(key,{at:now(),value:result});if(cache.size>32)cache.delete(cache.keys().next().value);return {...result};
  }).finally(()=>{if(pending.get(key)===request)pending.delete(key);});
  pending.set(key,request);return request;
 }
 return {info,shareUrl(value){if(value?.configured!==true)throw Error('此首頁的專屬網址尚未啟用');const url=canonicalPublicHome(PUBLIC_SITE_ORIGIN,value.canonicalPath);if(!url)throw Error('公開網址尚未確認');return url;},invalidate(){generation++;cache.clear();pending.clear();}};
}
