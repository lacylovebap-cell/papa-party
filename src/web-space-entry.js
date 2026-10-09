import {requestedSpace,chooseSpaceEntry,spaceDestination} from './space-entry.js?v=10.10-WEB.1';

const managers=new Set(['streamer_admin','super_admin']);
const roles=new Set(['player',...managers]);
const slug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const text=value=>typeof value==='string'&&value.length>0;
const stale=()=>Error('此登入不適用目前頁面');

// Public entry metadata comes from one bounded server result. Room/profile
// data and URL hints cannot add a destination to the permitted set.
function entryResult(result){
 if(!Array.isArray(result?.spaces)||result.spaces.length>50||!Number.isInteger(result.total)||result.total<0||
  result.total<result.spaces.length||typeof result.hasMore!=='boolean'||
  result.membershipCount!==undefined&&(!Number.isInteger(result.membershipCount)||result.membershipCount<0))throw Error('空間資訊不完整，請重試');
 const ids=new Set(),slugs=new Set();
 const spaces=result.spaces.map(row=>{
  if(!text(row?.id)||!slug(row.slug)||typeof row.name!=='string'||!Number.isInteger(row.streamerCount)||row.streamerCount<1||
   !text(row.streamerId)||!slug(row.streamerSlug)||typeof row.streamerName!=='string'||ids.has(row.id)||slugs.has(row.slug))
   throw Error('空間資訊不完整，請重試');
  ids.add(row.id);slugs.add(row.slug);
  return Object.freeze({id:row.id,slug:row.slug,name:row.name,streamerCount:row.streamerCount,
   streamerId:row.streamerId,streamerSlug:row.streamerSlug,streamerName:row.streamerName});
 });
 return {spaces,total:result.total,hasMore:result.hasMore,
  ...(result.membershipCount!==undefined?{membershipCount:result.membershipCount}:{})};
}

export function createWebSpaceEntry({deviceLogin,transport,identity,url,mountUrl}){
 if(!identity?.device||!roles.has(identity.role)||!text(identity.sessionId)||typeof deviceLogin?.access!=='function'||
  typeof deviceLogin.client?.identity!=='function'||typeof deviceLogin.client?.switchSpace!=='function'||typeof transport!=='function')
  throw Error('請先登入裝置');
 const requested=requestedSpace(url,mountUrl),hint=new URL(url).searchParams.get('streamer');
 if(hint!==null&&(!text(hint)||hint.length>200))throw Error('空間網址不正確');
 let current={...identity},permitted=new Map(),pending=Promise.resolve();
 const run=action=>{const next=pending.catch(()=>{}).then(action);pending=next;return next;};

 async function readBinding(expected,token){
  if(!text(token))throw Error('請先重新登入');
  const canonical=await deviceLogin.client.identity(expected.role,{sessionId:expected.sessionId,token});
  if(!canonical||canonical.role!==expected.role||canonical.sessionId!==expected.sessionId||
   (canonical.spaceId||null)!==(expected.spaceId||null)||(canonical.streamerId||null)!==(expected.streamerId||null)||
   expected.playerId&&canonical.playerId!==expected.playerId)throw stale();
  return {identity:{...canonical,device:true},token};
 }
 async function accessBinding(){return readBinding(current,await deviceLogin.access(current));}
 async function request(binding,selected,offset){
  const result=entryResult(await transport({op:'spaceEntry',token:binding.token,
   ...(selected?{slug:selected}:{}),...(hint!==null?{streamer:hint}:{}),limit:50,offset}));
  // A different tab may switch while entry is in flight. Its registration is
  // never adopted by this page, even if the old entry request succeeded.
  binding.identity=(await readBinding(binding.identity,binding.token)).identity;
  return result;
 }
 function remember(result,canonical,selected,usePreferences=true){
  const own=canonical.role==='streamer_admin'&&result.spaces.find(row=>row.id===canonical.spaceId&&row.streamerId===canonical.streamerId);
  if(own)canonical={...canonical,streamerSlug:own.streamerSlug};
  const chosen=chooseSpaceEntry(result,usePreferences?canonical:{},selected);
  const rows=chosen.kind==='destination'?[chosen.space]:chosen.spaces||[];
  permitted=new Map(rows.map(row=>[row.id,row]));current=canonical;
  return {...chosen,...(result.membershipCount!==undefined?{membershipCount:result.membershipCount}:{}),identity:canonical};
 }

 return {
  resolve({offset=0,list=false}={}){return run(async()=>{
   permitted.clear();
   if(!Number.isInteger(offset)||offset<0||offset>10000||typeof list!=='boolean')throw Error('空間分頁不正確');
   const binding=await accessBinding();
   if(list)return remember(await request(binding,null,offset),binding.identity,null,false);
   if(requested)return remember(await request(binding,requested,offset),binding.identity,requested);
   // Home/Last can be outside page one. Each preference is independently
   // revalidated by slug before falling back to a bounded list page.
   if(offset===0){
    const tried=new Set();
    for(const preference of [binding.identity.homeSpace,binding.identity.lastSpace]){
     if(!text(preference?.id)||!slug(preference.slug)||tried.has(preference.slug))continue;
     tried.add(preference.slug);
     const result=await request(binding,preference.slug,0);
     if(result.spaces.some(row=>row.id===preference.id&&row.slug===preference.slug))
      return remember(result,binding.identity,preference.slug);
    }
   }
   return remember(await request(binding,null,offset),binding.identity,null,offset===0);
  });},
  enter(destination){return run(async()=>{
   const row=permitted.get(typeof destination==='string'?destination:destination?.id);
   if(!row||typeof destination!=='string'&&destination!==row)throw Error('請選擇可使用的空間');
   const binding=await accessBinding();
   const selected=binding.identity.selectedSpace;
   const switchNeeded=binding.identity.role==='super_admin'
    ?selected?.id!==row.id||selected?.slug!==row.slug:binding.identity.spaceId!==row.id;
   let canonical=binding.identity;
   if(switchNeeded){
    const token=await deviceLogin.client.switchSpace(canonical.role,{slug:row.slug,streamer:row.streamerId},canonical);
    const expected=await deviceLogin.client.identity(canonical.role,{token});
    if(!expected||!text(token)||expected.role!==canonical.role||
     (canonical.role==='super_admin'?expected.spaceId!==null||expected.streamerId!==null||
      expected.selectedSpace?.id!==row.id||expected.selectedSpace?.slug!==row.slug:expected.spaceId!==row.id))throw stale();
    canonical=(await readBinding({...expected,device:true},token)).identity;
   }
   if(canonical.role==='streamer_admin'){
    if(canonical.spaceId!==row.id||canonical.streamerId!==row.streamerId)throw stale();
    canonical={...canonical,streamerSlug:row.streamerSlug};
   }
   const page=new URL(url).hash==='#admin'&&managers.has(canonical.role)?'admin':'home';
   const destinationUrl=spaceDestination(url,mountUrl,row,{page});
   current=canonical;permitted.clear();
   return {identity:canonical,url:destinationUrl};
  });}
 };
}
