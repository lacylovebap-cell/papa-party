// President-only platform provisioning, account directory, readiness and safe
// deletion. The subject is always the Edge-verified Account; request bodies never
// choose an actor. Passwords go only to the SQL credential function: they are
// never logged, echoed, stored in Audit or returned.
export const MANAGEMENT_PROVISION_MESSAGES={
 STREAMER_REGISTRY_DUPLICATE:'登入代碼已被其他主播使用，請換一個',
 STREAMER_REGISTRY_METADATA_INVALID:'主播資料尚未確認，請重新整理後再試',
 STREAMER_REGISTRY_SETTINGS_INVALID:'主播設定格式錯誤',
 INDEPENDENT_SINGLE_STREAMER:'獨立主播空間只能有一位主播',
 STREAMER_LOGIN_WEAK_PASSWORD:'密碼需為 4～72 個字元',
 STREAMER_LOGIN_SAME_AS_PRESIDENT:'主播密碼不能與總裁密碼相同',
 STREAMER_LOGIN_PASSWORD_REQUIRED:'第一次建立登入帳號需要設定密碼',
 STREAMER_LOGIN_FAILED:'登入設定失敗，請稍後再試',
 STREAMER_SCOPE_INVALID:'找不到此主播，或主播不屬於此空間',
 STREAMER_DELETED:'此主播已刪除',
 SPACE_DELETED:'此空間已刪除',
 SPACE_NOT_FOUND:'找不到此空間，可能已刪除',
 DELETE_PREVIEW_STALE:'資料剛有變動，請重新檢查後再刪除',
 DELETE_NAME_MISMATCH:'輸入的名稱與要刪除的對象不符',
 DELETE_DEPENDENCIES_PRESENT:'仍有重要資料，不能永久刪除',
 OPERATION_CONFLICT:'這筆操作內容已變更，請關閉視窗後重新操作',
 MANAGEMENT_PAYLOAD_INVALID:'管理資料格式不正確',
 MANAGEMENT_QUERY_INVALID:'管理查詢格式不正確',
};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SLUG=/^[a-z0-9][a-z0-9-]{0,39}$/;
const id=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
const name=(value,max=100)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const optionalText=(value,max)=>value===undefined||value===null||typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value);
const page=value=>Number.isSafeInteger(value)&&value>=1&&value<=100000;
const query=value=>typeof value==='string'&&value.length<=100;
// A new (non-聲瑪) Space starts blank (user decision 2026-10-28, pricing spec 2.2):
// no live price, save-song plans, crown cards or request limit copied from 聲瑪.
// 聲瑪's own new streamers keep the current 聲瑪 defaults.
export function blankRoomSettings(){
 return {status:'空閒中',hourlyLimit:0,opening:'',audition:0,livePrice:0,liveDouble:0,crownDouble:0,tiers:[],plans:[],tags:[],manual:''};
}
export function validPassword(value){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length<4||new TextEncoder().encode(value).length>72||/[\u0000-\u001f\u007f]/u.test(value))throw Error('密碼需為 4～72 個字元，且不可包含控制字元');
 return value;
}
export function createManagementProvision({api,defaults,adminUser=null,uuid=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}){
 const requirePresident=who=>{if(who?.role!=='super_admin'||!UUID.test(who?.accountId||''))throw Error('僅限平台總裁');return who.accountId;};
 const operation=b=>{if(typeof b.operationId!=='string'||!UUID.test(b.operationId))throw Error('管理操作格式不正確');return b.operationId;};
 const rpc=(fn,args)=>api('/rest/v1/rpc/'+fn,args);
 function descriptor(input,existing){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('主播資料格式錯誤');
  const allowed=['id','display_name','slug','home_title','subtitle','active'];
  if(Object.keys(input).some(key=>!allowed.includes(key)))throw Error('主播資料格式錯誤');
  if(!name(input.display_name))throw Error('請填主播名稱（最多 100 字）');
  const slug=typeof input.slug==='string'?input.slug.trim():'';
  if(!SLUG.test(slug))throw Error('登入代碼請使用小寫英文、數字或減號，最多 40 字，開頭需為英數');
  if(!optionalText(input.home_title,100)||!optionalText(input.subtitle,200)||input.active!==undefined&&typeof input.active!=='boolean')throw Error('主播資料格式錯誤');
  const display=input.display_name.trim(),t=now();
  if(existing){
   if(!id(input.id))throw Error('主播資料格式錯誤');
   return {id:input.id,slug,display_name:display,home_title:String(input.home_title||display),subtitle:String(input.subtitle||''),...(input.active===undefined?{}:{active:input.active})};
  }
  if(input.id!==undefined)throw Error('主播資料格式錯誤');
  return {id:uuid(),slug,display_name:display,home_title:String(input.home_title||display),subtitle:String(input.subtitle||''),description:'',avatar_url:'',banner_url:'',active:input.active!==false,created_at:t,updated_at:t};
 }
 return {
  async accounts(b,who){
   const subject=requirePresident(who);
   if(!query(b.q)||!page(b.page))throw Error('管理查詢格式不正確');
   return rpc('papa_management_account_list',{subject,search_text:b.q,requested_page:b.page});
  },
  async provision(b,who){
   const subject=requirePresident(who),op=operation(b),pw=validPassword(b.password);
   if(!['independent','streamer'].includes(b.mode)||b.loginEnabled!==undefined&&typeof b.loginEnabled!=='boolean')throw Error('管理操作格式不正確');
   if(pw&&b.loginEnabled===undefined)throw Error('請選擇是否允許此主播登入');
   const editing=b.mode==='streamer'&&b.descriptor?.id!==undefined;
   const room=descriptor(b.descriptor,editing);
   const payload={mode:b.mode,room,...(b.loginEnabled===undefined?{}:{loginEnabled:b.loginEnabled})};
   if(b.mode==='independent'){
    if(!name(b.spaceName))throw Error('請填獨立主播空間名稱（最多 100 字）');
    if(b.spaceId!==undefined)throw Error('獨立主播不需要選擇所屬廳');
    payload.spaceName=b.spaceName.trim();payload.settings=blankRoomSettings();
   }else{
    if(!id(b.spaceId))throw Error('請先選擇空間');
    payload.spaceId=b.spaceId;
    if(!editing)payload.settings=b.spaceId==='space-001'?{...structuredClone(defaults),tags:[]}:blankRoomSettings();
    if(b.expectedRevision!==undefined){if(!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0)throw Error('管理操作格式不正確');payload.expectedRevision=b.expectedRevision;}
   }
   return rpc('papa_management_provision_streamer',{subject,operation:op,payload,password:pw,auth_user:adminUser||null});
  },
  async login(b,who){
   const subject=requirePresident(who),op=operation(b),pw=validPassword(b.password);
   if(!id(b.spaceId)||!id(b.streamerId)||typeof b.enabled!=='boolean')throw Error('主播資料格式錯誤');
   return rpc('papa_management_streamer_login',{subject,operation:op,payload:{spaceId:b.spaceId,streamerId:b.streamerId,enabled:b.enabled},password:pw,auth_user:adminUser||null});
  },
  async loginStatus(b,who){
   const subject=requirePresident(who);
   if(!id(b.spaceId)||!id(b.streamerId))throw Error('主播資料格式錯誤');
   const result=await rpc('papa_management_streamer_login_status',{subject,requested_space:b.spaceId,requested_streamer:b.streamerId});
   if(typeof result?.exists!=='boolean'||typeof result?.enabled!=='boolean')throw Error('主播登入狀態尚未確認');
   return result;
  },
  async readiness(b,who){
   const subject=requirePresident(who);
   if(!id(b.spaceId))throw Error('管理查詢格式不正確');
   return rpc('papa_management_space_readiness',{subject,requested_space:b.spaceId});
  },
  async deleteReview(b,who){
   const subject=requirePresident(who);
   if(!id(b.spaceId)||b.streamerId!=null&&!id(b.streamerId))throw Error('管理查詢格式不正確');
   return rpc('papa_management_delete_review',{subject,requested_space:b.spaceId,requested_streamer:b.streamerId||null});
  },
  async remove(b,who){
   const subject=requirePresident(who),op=operation(b);
   if(!id(b.spaceId)||b.streamerId!=null&&!id(b.streamerId)||typeof b.confirmationToken!=='string'||!/^[a-f0-9]{32}$/.test(b.confirmationToken)
    ||typeof b.confirmedName!=='string'||b.confirmedName.length>100)throw Error('刪除確認資料不正確');
   return rpc('papa_management_delete',{subject,operation:op,payload:{spaceId:b.spaceId,...(b.streamerId?{streamerId:b.streamerId}:{}),
    confirmationToken:b.confirmationToken,confirmedName:b.confirmedName}});
  },
 };
}
