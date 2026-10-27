// Page-sized, read-only image projection. Never load a room snapshot or settings object.
const lobbyImageRoomId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value);
const lobbyImageHttps=value=>{
 if(typeof value!=='string'||!value||value.length>2048||/[\u0000-\u0020\u007f]/.test(value))return '';
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.href.length<=2048?url.href:'';}catch{return '';}
};

export function lobbyImageProjectionPath(ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>20||new Set(ids).size!==ids.length||ids.some(id=>!lobbyImageRoomId(id)))throw Error('公開主播圖片範圍不正確');
 const fields=['kind'];
 // Quoted keys keep a numeric legacy ID an object key rather than an array index.
 ids.forEach((id,index)=>{
  const root='data->streamerSettings->"'+id+'"',banner=root+'->theme->images->banner->>';
  fields.push('i'+index+'_mode:'+root+'->home->>imageMode','i'+index+'_url:'+root+'->home->>imageUrl');
  // Published theme banner and its separate hall-card crop (scalars only).
  fields.push('i'+index+'_tu:'+banner+'url','i'+index+'_tx:'+banner+'hallX','i'+index+'_ty:'+banner+'hallY','i'+index+'_to:'+banner+'hallOpacity');
 });
 if(ids.includes('papa'))fields.push('legacy_mode:data->home->>imageMode','legacy_url:data->home->>imageUrl');
 return '/rest/v1/papa_v2_entities?kind=in.(meta,settings)&id=eq.1&select='+encodeURIComponent(fields.join(','))+'&limit=2';
}

export function lobbyHeroImage(room,projection={}){
 const themed=lobbyImageHttps(projection.themeUrl);
 if(themed)return themed;
 if(projection.mode==='none')return '';
 if(projection.mode==='custom')return lobbyImageHttps(projection.url);
 return lobbyImageHttps(room?.banner_url)||(room?.slug==='papa'?'assets/papa-singer-hero.jpg':'');
}

const lobbyPercent=(value,fallback)=>{const n=Number(value);return value!==null&&value!==undefined&&value!==''&&Number.isFinite(n)?Math.round(Math.max(0,Math.min(100,n))):fallback;};
// Hall-card crop from the streamer's published theme; null keeps the old look.
export function lobbyHeroFocus(projection={}){
 if(![projection.themeUrl,projection.hallX,projection.hallY,projection.hallOpacity].some(v=>v!==null&&v!==undefined))return null;
 return {x:lobbyPercent(projection.hallX,50),y:lobbyPercent(projection.hallY,35),opacity:lobbyPercent(projection.hallOpacity,22)};
}
export function createLobbyImageReader({api,now=Date.now}){
 const cache=new Map(),pending=new Map();
 async function projection(ids){
  if(!ids.length)return new Map();
  const key=JSON.stringify(ids),hit=cache.get(key);
  if(hit&&now()-hit.at<60000)return hit.value;
  if(!pending.has(key))pending.set(key,(async()=>{
   const value=new Map();
   try{
    const rows=await api(lobbyImageProjectionPath(ids));
    if(!Array.isArray(rows)||rows.length>2||rows.some(row=>!row||!['meta','settings'].includes(row.kind))||new Set(rows.map(row=>row.kind)).size!==rows.length)throw Error('公開主播圖片尚未確認');
    const meta=rows.find(row=>row.kind==='meta'),legacy=rows.find(row=>row.kind==='settings');
    ids.forEach((id,index)=>{
     // Existing schema-3 home settings win even after reset to null/default.
     const row=meta||id==='papa'&&legacy;
     if(row)value.set(id,{mode:meta?row['i'+index+'_mode']:row.legacy_mode,url:meta?row['i'+index+'_url']:row.legacy_url,
      ...(meta?{themeUrl:row['i'+index+'_tu'],hallX:row['i'+index+'_tx'],hallY:row['i'+index+'_ty'],hallOpacity:row['i'+index+'_to']}:{})});
    });
   }catch{/* Images are optional. A temporary read failure cannot hide the public directory. */}
   cache.set(key,{at:now(),value});if(cache.size>12)cache.delete(cache.keys().next().value);
   return value;
  })().finally(()=>pending.delete(key)));
  return pending.get(key);
 }
 return async function readLobbyImages(rows){
  if(!Array.isArray(rows)||rows.length>20)throw Error('公開主播圖片範圍不正確');
  const ids=[...new Set(rows.map(row=>row.id).filter(lobbyImageRoomId))].sort(),images=await projection(ids);
  return rows.map(row=>{const p=images.get(row.id),focus=lobbyHeroFocus(p);return {id:row.id,slug:row.slug,display_name:row.display_name,heroImage:lobbyHeroImage(row,p),...(focus?{heroFocus:focus}:{})};});
 };
}
