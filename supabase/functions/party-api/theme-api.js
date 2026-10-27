// Theme operations for streamer and hall homepages.
// Writes happen only on an explicit save/publish/upload; previews never call here.
import {themeValidate,themeNormalize,themeSame,themeImageUrls,themeAsset,THEME_IMAGE_ROLES} from '../../../src/theme-engine.js';
import {THEME_STREAMER_FEATURES,THEME_HALL_FEATURES,themePlanFeatures,themePlanInput,themeSaveRequirements,THEME_LOCKED_MESSAGE} from '../../../src/theme-access.js';

const themeSpaceId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/i.test(value);
const themeRoomId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
// Upload ceilings sit above the compression targets so a detailed picture is
// never forced into visible blur, while still rejecting raw photos.
const themeUploadLimit={background:900*1024,banner:800*1024,card:600*1024,decor:500*1024};
const themeHex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const themeIsWebp=bytes=>bytes.length>12&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';

export function createThemeApi({api,storage,publicBase,isSuper,isManager,managerRoom,now=()=>Date.now()}){
 // Theme files must be this project's own Storage objects, never another host.
 const assetPrefix=publicBase+'/storage/v1/object/public/papa-photos/themes/';
 const ownAssets=theme=>{if(themeImageUrls(theme).some(u=>!u.startsWith(assetPrefix)))throw Error('圖片尚未上傳完成，請重新選擇圖片');};
 async function streamerFeatures(roomId){
  const rows=await api('/rest/v1/papa_streamer_plans?streamer_id=eq.'+encodeURIComponent(roomId)+'&select=plan,status,valid_until,features&limit=1');
  return {plan:rows?.[0]||null,features:themePlanFeatures(rows?.[0],now())};
 }
 async function hallFeatures(spaceId){
  const rows=await api('/rest/v1/papa_space_entitlements?space_id=eq.'+encodeURIComponent(spaceId)+'&feature_key=in.('+THEME_HALL_FEATURES.join(',')+')&enabled=eq.true&select=feature_key');
  return (Array.isArray(rows)?rows:[]).map(r=>r.feature_key).filter(f=>THEME_HALL_FEATURES.includes(f));
 }
 async function canEditHall(who,spaceId){
  if(!themeSpaceId(spaceId))throw Error('廳的範圍不正確');
  if(isSuper(who))return true;
  if(!who?.accountId)return false;
  // Hall identity is checked separately from any streamer plan.
  const rows=await api('/rest/v1/papa_space_memberships?account_id=eq.'+encodeURIComponent(who.accountId)+'&space_id=eq.'+encodeURIComponent(spaceId)+'&role=eq.space_admin&status=eq.active&select=id&limit=1');
  return Array.isArray(rows)&&rows.length===1;
 }
 const deny=missing=>{if(missing.length)throw Error(THEME_LOCKED_MESSAGE);};
 async function hallPolicies(spaceId){
  const rows=await api('/rest/v1/papa_space_policies?space_id=eq.'+encodeURIComponent(spaceId)+'&policy_key=in.(hall_theme,hall_theme_draft)&select=policy_key,value,revision');
  const pick=key=>{const row=(rows||[]).find(r=>r.policy_key===key);return row&&row.value&&Object.keys(row.value).length?{theme:themeNormalize(row.value,{hall:true}),revision:Number(row.revision)}:{theme:null,revision:row?Number(row.revision):0};};
  return {published:pick('hall_theme'),draft:pick('hall_theme_draft')};
 }
  // Published + draft for one streamer, read as a tiny JSON projection rather
 // than the whole room snapshot.
 async function streamerThemes(roomId){
  const key=JSON.stringify(String(roomId));
  const rows=await api('/rest/v1/papa_v2_entities?kind=eq.meta&id=eq.1&select='+encodeURIComponent('t:data->streamerSettings->'+key+'->theme,d:data->streamerSettings->'+key+'->themeDraft')+'&limit=1');
  return {published:rows?.[0]?.t||null,draft:rows?.[0]?.d||null};
 }
 return {
  // Called by the generic settings mutation before the commit. `before` is the
  // stored room settings; `payload` the requested settings change.
  async authorizeStreamerSettings(who,room,before,payload){
   if(!payload||typeof payload!=='object')return;
   const keys=['theme','themeDraft'].filter(k=>Object.hasOwn(payload,k));
   if(!keys.length)return;
   const previous=new Set([...themeImageUrls(before?.theme),...themeImageUrls(before?.themeDraft)]);
   let theme=false,images=false;
   for(const key of keys){
    if(themeSame(before?.[key]??null,payload[key]??null))continue;
    theme=true;
    if(themeImageUrls(payload[key]).some(u=>!previous.has(u)))images=true;
    ownAssets(themeValidate(payload[key],{owner:room.id}));
   }
   if(!theme||isSuper(who))return;
   deny(themeSaveRequirements({theme,images},(await streamerFeatures(room.id)).features));
  },
  async access(who,b){
   const room=await managerRoom(who,b.streamer||'papa'),space=room.spaceId||'space-001',streamer=await streamerFeatures(room.id);
   const hall=await canEditHall(who,space);
   return {streamerId:room.id,spaceId:space,president:isSuper(who),
    streamer:{features:isSuper(who)?[...THEME_STREAMER_FEATURES]:streamer.features,granted:streamer.features},
    hall:{editable:hall,features:hall?(isSuper(who)?[...THEME_HALL_FEATURES]:await hallFeatures(space)):[]}};
  },
  async upload(who,b){
   const role=b.role,target=b.target==='hall'?'hall':'streamer';
   if(!Object.hasOwn(THEME_IMAGE_ROLES,role))throw Error('圖片用途不正確');
   let owner;
   if(target==='hall'){
    if(!await canEditHall(who,b.spaceId))throw Error('只有平台總裁或該廳管理員可以修改廳首頁');
    if(!isSuper(who))deny((await hallFeatures(b.spaceId)).includes('theme_hall_images')?[]:['theme_hall_images']);
    owner=b.spaceId;
   }else{
    if(!isManager(who))throw Error('請先登入管理');
    const room=await managerRoom(who,b.streamer||'papa');owner=room.id;
    if(!isSuper(who))deny((await streamerFeatures(room.id)).features.includes('theme_streamer_images')?[]:['theme_streamer_images']);
   }
   if(b.mime!=='image/webp'||typeof b.image!=='string'||b.image.length>Math.ceil(themeUploadLimit[role]*4/3)+8)throw Error('圖片過大，請重新選擇或降低尺寸');
   const bytes=Uint8Array.from(atob(b.image),c=>c.charCodeAt(0));
   if(!themeIsWebp(bytes)||bytes.length>themeUploadLimit[role])throw Error('請使用壓縮後的圖片');
   // Content-addressed path: the same picture is stored once per owner and is
   // immutable, so browsers and the CDN can cache it for a year.
   const hash=themeHex(await crypto.subtle.digest('SHA-256',bytes)),path='themes/'+(target==='hall'?'h':'s')+'/'+owner+'/'+hash+'.webp';
   const r=await storage('/storage/v1/object/papa-photos/'+path,{method:'POST',headers:{'Content-Type':'image/webp','cache-control':'max-age=31536000','x-upsert':'false'},body:bytes});
   let reused=false;
   if(!r.ok){const text=await r.text().catch(()=>'');if(r.status===409||/Duplicate|already exists/i.test(text))reused=true;else throw Error('圖片上傳失敗，請稍後再試');}
   return {url:publicBase+'/storage/v1/object/public/papa-photos/'+path,bytes:bytes.length,reused};
  },
  // Deletes only files no published theme or draft of this owner refers to.
  async cleanup(who,b){
   const target=b.target==='hall'?'hall':'streamer';let owner,referenced;
   if(target==='hall'){if(!await canEditHall(who,b.spaceId))throw Error('只有平台總裁或該廳管理員可以修改廳首頁');owner=b.spaceId;const p=await hallPolicies(owner);referenced=[...themeImageUrls(p.published.theme),...themeImageUrls(p.draft.theme)];}
   else{const room=await managerRoom(who,b.streamer||'papa');owner=room.id;const t=await streamerThemes(owner);referenced=[...themeImageUrls(t.published),...themeImageUrls(t.draft)];}
   const keep=new Set(referenced.map(u=>themeAsset(u)?.hash).filter(Boolean)),prefix='themes/'+(target==='hall'?'h':'s')+'/'+owner+'/';
   const r=await storage('/storage/v1/object/list/papa-photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix,limit:1000,offset:0})});
   if(!r.ok)throw Error('暫時無法讀取圖片清單');
   const files=(await r.json()).filter(f=>/^[a-f0-9]{64}\.webp$/.test(f?.name||''));
   // A freshly uploaded image may belong to a save still in flight.
   let stale=files.filter(f=>!keep.has(f.name.slice(0,64))&&!(Date.parse(f.created_at)>now()-86400000));
   // Second, site-wide check: a copied streamer or any hall may still use it.
   if(stale.length){const used=new Set(await api('/rest/v1/rpc/papa_theme_assets_in_use',{asset_hashes:stale.map(f=>f.name.slice(0,64))})||[]);stale=stale.filter(f=>!used.has(f.name.slice(0,64)));}
   if(b.dryRun!==false)return {total:files.length,referenced:files.length-stale.length,removable:stale.length,bytes:stale.reduce((n,f)=>n+(Number(f.metadata?.size)||0),0)};
   if(stale.length){const d=await storage('/storage/v1/object/papa-photos',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:stale.map(f=>prefix+f.name)})});if(!d.ok)throw Error('清理失敗，圖片均未變更');}
   return {total:files.length,removed:stale.length};
  },
  async hallPublic(b){
   if(!themeSpaceId(b.spaceId))throw Error('廳的範圍不正確');
   const rows=await api('/rest/v1/papa_space_policies?space_id=eq.'+encodeURIComponent(b.spaceId)+'&policy_key=eq.hall_theme&select=value,revision&limit=1');
   const row=rows?.[0];return {theme:row?.value&&Object.keys(row.value).length?themeNormalize(row.value,{hall:true}):null,revision:row?Number(row.revision):0};
  },
  async hallEdit(who,b){
   if(!await canEditHall(who,b.spaceId))throw Error('只有平台總裁或該廳管理員可以修改廳首頁');
   const policies=await hallPolicies(b.spaceId);
   return {...policies,features:isSuper(who)?[...THEME_HALL_FEATURES]:await hallFeatures(b.spaceId)};
  },
  async hallSave(who,b){
   if(!await canEditHall(who,b.spaceId))throw Error('只有平台總裁或該廳管理員可以修改廳首頁');
   if(!['draft','publish'].includes(b.mode))throw Error('儲存方式不正確');
   const next=themeValidate(b.theme??null,{hall:true,owner:b.spaceId}),current=await hallPolicies(b.spaceId);ownAssets(next);
   const before=b.mode==='publish'?current.published.theme:current.draft.theme;
   if(themeSame(before,next)&&b.mode==='draft')return {saved:false,...current};
   if(!isSuper(who)){
    const previous=new Set([...themeImageUrls(current.published.theme),...themeImageUrls(current.draft.theme)]);
    deny(themeSaveRequirements({theme:true,images:themeImageUrls(next).some(u=>!previous.has(u))},await hallFeatures(b.spaceId),{hall:true}));
   }
   // One RPC: publishing writes the live theme and clears the draft atomically.
   await api('/rest/v1/rpc/papa_theme_hall_save',{requested_space:b.spaceId,save_mode:b.mode,theme_value:next||{},actor_account:who?.accountId||null});
   return {saved:true,...await hallPolicies(b.spaceId)};
  },
  async plans(who,b){
   if(!isSuper(who)||!who.accountId)throw Error('僅限 PA Party總裁');
   const room=await managerRoom(who,b.streamer||'papa'),space=room.spaceId||'space-001';
   if(b.save){
    const plan=themePlanInput(b.plan),hall=Array.isArray(b.hallFeatures)?[...new Set(b.hallFeatures)]:null;
    if(hall&&hall.some(f=>!THEME_HALL_FEATURES.includes(f)))throw Error('廳主題功能代碼不正確');
    await api('/rest/v1/rpc/papa_theme_plan_save',{requested_room:room.id,requested_plan:plan.plan,requested_status:plan.status,requested_valid_until:plan.valid_until,requested_features:plan.features,
     actor_account:who.accountId,hall_space:hall?space:null,hall_features:hall||[]});
   }
   const streamer=await streamerFeatures(room.id);
   return {streamerId:room.id,spaceId:space,plan:streamer.plan,effective:streamer.features,hallFeatures:await hallFeatures(space)};
  }
 };
}
