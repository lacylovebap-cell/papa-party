// The previous key is retained for a non-destructive, server-verified migration.
export const PREFERENCE_KEY='papa.pwa.start.v1';
export const PROMPT_KEY='papa.pwa.start.asked.v1';
export const HOME_KEY='papa.pwa.home.v2';
const identity=v=>typeof v==='string'&&v.length>0&&v.length<=200&&!/[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v);
const label=v=>typeof v==='string'&&!/[\u0000-\u001f\u007f]/.test(v)?v.trim().slice(0,200):'';
export const installed=env=>!!(env?.matchMedia?.('(display-mode: standalone)')?.matches||env?.navigator?.standalone===true);

export function normalizeHome(value){
 if(!value||!['hall','streamer'].includes(value.kind)||!identity(value.spaceId)||value.kind==='streamer'&&!identity(value.streamerId)||value.kind==='hall'&&value.streamerId!=null)return null;
 return {v:1,kind:value.kind,spaceId:value.spaceId,streamerId:value.kind==='hall'?null:value.streamerId};
}
export function readHome(storage){
 try{const raw=JSON.parse(storage?.getItem(HOME_KEY)||'null'),home=normalizeHome(raw);
  return raw?.v===2&&home&&['user','install','legacy'].includes(raw.source)?{...home,v:2,name:label(raw.name),spaceName:label(raw.spaceName),source:raw.source}:null;
 }catch{return null;}
}
export function saveHome(storage,value,{source='user'}={}){
 const home=normalizeHome(value);if(!home||!['user','install','legacy'].includes(source))throw Error('請選擇已開放的廳或主播');
 const record={...home,v:2,name:label(value.name),spaceName:label(value.spaceName),source};
 try{storage.setItem(HOME_KEY,JSON.stringify(record));if(storage.getItem(HOME_KEY)!==JSON.stringify(record))throw Error();}
 catch{throw Error('裝置目前無法儲存預設首頁，請確認瀏覽器允許儲存後重試。');}
 return record;
}

// Retained v1 projection for existing callers. New settings use saveHome and
// never save these paths. Only readLegacyHome migrates their stable IDs.
export function pagePreference(href,mount,room=null){
 let u,base;try{u=new URL(href);base=new URL(mount);}catch{return null;}
 if(u.origin!==base.origin||u.username||u.password)return null;
 if([base.pathname,new URL('index.html',base).pathname].includes(u.pathname)&&!u.search&&(!u.hash||['#features','#experience','#audience','#plans'].includes(u.hash)))return {version:1,kind:'portal',path:base.pathname};
 if(u.pathname===new URL('lobby.html',base).pathname)return {version:1,kind:'lobby',path:new URL('lobby.html',base).pathname};
 if(u.pathname!==new URL('v2.html',base).pathname||!room||room.active===false||!identity(room.id)||!identity(room.spaceId)||typeof room.slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(room.slug)||u.searchParams.get('streamer')!==room.slug||!['home','book','common-book','center','gallery','admin'].includes(u.hash.slice(1)))return null;
 const next=new URL('v2.html',base);next.searchParams.set('streamer',room.slug);
 if(room.spaceId!=='space-001')return null;
 for(const key of ['adminTab','tab','queue']){const value=u.searchParams.get(key);if(value&&/^[a-z-]{1,32}$/.test(value))next.searchParams.set(key,value);}
 next.hash=u.hash;
 return {version:1,kind:'room',path:next.pathname+next.search+next.hash,spaceId:room.spaceId,streamerId:room.id,slug:room.slug};
}

export function readLegacyHome(storage,mount){
 let raw;try{const value=storage?.getItem(PREFERENCE_KEY);if(value==null)return null;raw=JSON.parse(value);}catch{return null;}
 if(raw?.version!==1||typeof raw.path!=='string'||raw.path.length>1024)return null;
 let u,base;try{base=new URL(mount);u=new URL(raw.path,base);}catch{return null;}
 if(u.origin!==base.origin||u.username||u.password)return null;
 if(raw.kind==='portal'&&[base.pathname,new URL('index.html',base).pathname].includes(u.pathname)&&!u.search&&!u.hash)return {home:null,requiresChoice:true};
 if(raw.kind==='lobby'&&u.pathname===new URL('lobby.html',base).pathname&&!u.search&&!u.hash)return {home:{v:1,kind:'hall',spaceId:'space-001',streamerId:null},requiresChoice:false};
 if(raw.kind!=='room'||u.pathname!==new URL('v2.html',base).pathname||u.searchParams.getAll('streamer').length!==1||u.searchParams.get('streamer')!==raw.slug||typeof raw.slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.slug)||[...u.searchParams.keys()].some(k=>!['streamer','adminTab','tab','queue'].includes(k))||!['home','book','common-book','center','gallery','admin'].includes(u.hash.slice(1)))return null;
 const home=normalizeHome({kind:'streamer',spaceId:raw.spaceId,streamerId:raw.streamerId});
 return home?{home,requiresChoice:false}:null;
}
// Compatibility for callers being upgraded together with this module.
export function readPreference(storage,mount){
 try{const raw=JSON.parse(storage?.getItem(PREFERENCE_KEY)||'null');if(raw?.version!==1||typeof raw.path!=='string'||raw.path.length>1024)return null;
  const canonical=pagePreference(new URL(raw.path,mount).href,mount,raw.kind==='room'?{id:raw.streamerId,spaceId:raw.spaceId,slug:raw.slug,active:true}:null);
  return canonical&&canonical.kind===raw.kind&&canonical.path===raw.path?canonical:null;
 }catch{return null;}
}

export function launchPlan({href,mount,standalone,referrer='',navigationType='navigate'}){
 let u,base;try{u=new URL(href);base=new URL(mount);}catch{return null;}
 if(!standalone||u.origin!==base.origin||![base.pathname,new URL('index.html',base).pathname].includes(u.pathname))return null;
 const explicit=u.searchParams.getAll('appLaunch').length===1&&u.searchParams.get('appLaunch')==='1'&&[...u.searchParams.keys()].every(k=>k==='appLaunch')&&!u.hash;
 const legacy=!u.search&&u.hash==='#home';
 const bare=!u.search&&!u.hash&&!referrer;
 // A real external link keeps its destination; old icon launches have no
 // external referrer. Notification/account/page parameters are never copied.
 if(legacy&&referrer){try{if(new URL(referrer).origin!==base.origin)return null;}catch{return null;}}
 if(!explicit&&!legacy&&!bare)return null;
 return {target:new URL('app.html',base).href,portal:false};
}
