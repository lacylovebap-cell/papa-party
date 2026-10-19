export const PREFERENCE_KEY='papa.pwa.start.v1';
export const PROMPT_KEY='papa.pwa.start.asked.v1';
const routes=new Set(['home','book','common-book','center','gallery','admin']);
export const installed=env=>!!(env?.matchMedia?.('(display-mode: standalone)')?.matches||env?.navigator?.standalone===true);
const safe=s=>typeof s==='string'&&/^[\w-]{1,128}$/.test(s);
export function pagePreference(href,mount,room=null){
 const u=new URL(href),base=new URL(mount);
 if(u.origin!==base.origin||u.username||u.password)return null;
 if([base.pathname,new URL('index.html',base).pathname].includes(u.pathname)&&!u.search&&(!u.hash||['#features','#experience','#audience','#plans'].includes(u.hash)))return {version:1,kind:'portal',path:base.pathname};
 if(u.pathname===new URL('lobby.html',base).pathname)return {version:1,kind:'lobby',path:new URL('lobby.html',base).pathname};
 if(u.pathname!==new URL('v2.html',base).pathname||!room||room.active===false||!safe(room.id)||!safe(room.spaceId)||!safe(room.slug)||u.searchParams.get('streamer')!==room.slug||!routes.has(u.hash.slice(1)))return null;
 // Only a server-confirmed room and normal page controls are persisted.
 const next=new URL('v2.html',base);next.searchParams.set('streamer',room.slug);
 if(room.spaceId!=='space-001')return null; // existing native Space activation guard
 for(const key of ['adminTab','tab','queue']){const v=u.searchParams.get(key);if(v&&/^[a-z-]{1,32}$/.test(v))next.searchParams.set(key,v);}
 next.hash=u.hash;
 return {version:1,kind:'room',path:next.pathname+next.search+next.hash,spaceId:room.spaceId,streamerId:room.id,slug:room.slug};
}
export function readPreference(storage,mount){
 try{const raw=JSON.parse(storage.getItem(PREFERENCE_KEY));if(raw?.version!==1||typeof raw.path!=='string'||raw.path.length>1024)return null;
 const canonical=pagePreference(new URL(raw.path,mount).href,mount,raw.kind==='room'?{id:raw.streamerId,spaceId:raw.spaceId,slug:raw.slug,active:true}:null);
 return canonical&&canonical.kind===raw.kind&&canonical.path===raw.path?canonical:null;
 }catch{return null;}
}
export function launchPlan({href,mount,standalone,referrer='',navigationType='navigate',preference=null}){
 const u=new URL(href),base=new URL(mount);
 if(!standalone||u.origin!==base.origin||![base.pathname,new URL('index.html',base).pathname].includes(u.pathname))return null;
 const explicit=u.searchParams.get('appLaunch')==='1'&&[...u.searchParams.keys()].every(k=>k==='appLaunch')&&!u.hash;
 // Old installed manifests use /#home. Reload/back/internal navigation must
 // never be treated as a fresh icon launch. External targets always win.
 const legacy=!u.search&&u.hash==='#home';
 if(!explicit&&!legacy)return null;
 // A bare old /#home can also be an externally opened link. Browsers do not
 // reliably expose that distinction. Never override an ambiguous old target.
 const chosen=legacy?null:preference;
 const target=new URL(chosen?.path||base.pathname,base);
 if(chosen?.kind==='room')target.searchParams.set('pwaDefault','1');
 return {target:target.href,portal:target.pathname===base.pathname&&!target.search&&!target.hash};
}
