const NATIVE_PROVISION_PAGE_LIMIT=20;
const NATIVE_PROVISION_FIELDS=['name','ids','names','certification','note'];
const nativeProvisionObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const nativeProvisionError=message=>new Error(message);
function nativeProvisionId(value,max=200){
 return typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
}
function nativeProvisionUuid(value){
 return typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)?value.toLowerCase():null;
}
function nativeProvisionFreeze(value){
 if(value&&typeof value==='object'){for(const item of Object.values(value))nativeProvisionFreeze(item);Object.freeze(value);}
 return value;
}
function nativeProvisionPage(response,scope,page){
 if(!nativeProvisionObject(response)||!Array.isArray(response.rows)||response.rows.length>NATIVE_PROVISION_PAGE_LIMIT
  ||!Number.isSafeInteger(response.total)||response.total<response.rows.length
  ||!Number.isSafeInteger(response.revision)||response.revision<0
  ||response.rows.length&&response.total<page*NATIVE_PROVISION_PAGE_LIMIT+response.rows.length
  ||response.pageLimit!==undefined&&response.pageLimit!==NATIVE_PROVISION_PAGE_LIMIT
  ||response.pageOffset!==undefined&&response.pageOffset!==page*NATIVE_PROVISION_PAGE_LIMIT)
  throw nativeProvisionError('可綁定玩家清單資料不正確');
 const accounts=new Set(),memberships=new Set(),rows=Array.from(response.rows,row=>{
  const accountId=nativeProvisionUuid(row?.accountId),membershipId=nativeProvisionUuid(row?.membershipId);
  if(!nativeProvisionObject(row)||!accountId||!membershipId||row.spaceId!==scope.spaceId
   ||row.role!=='player'||row.status!=='active'||typeof row.displayLabel!=='string'||!row.displayLabel.trim()||row.displayLabel.length>200
   ||typeof row.createdAt!=='string'||row.createdAt.length>100||!Number.isFinite(Date.parse(row.createdAt))
   ||accounts.has(accountId)||memberships.has(membershipId))throw nativeProvisionError('可綁定玩家資料不正確');
  accounts.add(accountId);memberships.add(membershipId);
  return {accountId,membershipId,spaceId:scope.spaceId,role:'player',status:'active',createdAt:row.createdAt,displayLabel:row.displayLabel};
 });
 return {rows,total:response.total,revision:response.revision};
}
function nativeProvisionFields(data){
 if(!nativeProvisionObject(data)||Object.keys(data).some(key=>!NATIVE_PROVISION_FIELDS.includes(key))
  ||typeof data.name!=='string'||!data.name.trim()||data.name.length>200)
  throw nativeProvisionError('請填有效的玩家名稱與基本資料');
 const fields={name:data.name.trim()};
 for(const key of NATIVE_PROVISION_FIELDS.slice(1))if(Object.hasOwn(data,key)){
  if(typeof data[key]!=='string'||data[key].length>1000)throw nativeProvisionError('玩家基本資料欄位不正確');
  fields[key]=data[key];
 }
 return fields;
}
function nativeProvisionResult(response,revision,name){
 if(!nativeProvisionObject(response)||response.revision!==revision+1||!Number.isSafeInteger(response.revision)
  ||!Array.isArray(response.created)||response.created.length!==1||!nativeProvisionObject(response.created[0])
  ||!nativeProvisionId(response.created[0].playerId)||response.created[0].name!==name)
  throw nativeProvisionError('玩家建檔結果不正確，請重新讀取可綁定清單');
 return {revision:response.revision,created:[{playerId:response.created[0].playerId,name}]};
}

// A single bounded eligibility page and an explicit choice feed the existing
// provisioning API. Neither labels nor business IDs infer Account authority.
export function createNativePlayerProvisioner({api,context,onChange=()=>{}}){
 if(typeof api!=='function'||typeof context!=='function'||typeof onChange!=='function')throw nativeProvisionError('玩家建檔控制器設定不正確');
 const fresh=(q='',page=0)=>({q,page,rows:[],total:0,revision:null,loading:false,saving:false,error:null,selectedAccountId:null,result:null});
 let view=fresh(),scope=null,generation=0,cacheKey=null,pendingRead=null;
 const snapshot=()=>nativeProvisionFreeze(structuredClone(view));
 let notified=JSON.stringify(snapshot());
 function notify(){const next=snapshot(),key=JSON.stringify(next);if(key!==notified){notified=key;onChange(next);}}
 function invalidate(){generation++;cacheKey=null;pendingRead=null;}
 function syncContext(){
  const value=context(),accountId=nativeProvisionUuid(value?.accountId);
  const next=value?.active===true&&value.role==='super_admin'&&accountId&&nativeProvisionId(value.spaceId)
   &&value.spaceId!=='space-001'&&nativeProvisionId(value.roomId)
   ?{accountId,spaceId:value.spaceId,roomId:value.roomId,role:value.role}:null;
  const key=next?JSON.stringify([next.role,next.accountId,next.spaceId,next.roomId]):null;
  if(key!==(scope?.key??null)){invalidate();view=fresh();scope=next?{...next,key}:null;}
  return scope;
 }
 const state=()=>{syncContext();return snapshot();};
 function requireScope(){syncContext();if(!scope)throw nativeProvisionError('請先登入總裁並選擇可建檔的新空間');}
 function requireIdle(){if(view.saving)throw nativeProvisionError('玩家建檔中，請等待完成');}
 function setQuery(query){
  requireScope();requireIdle();if(typeof query!=='string'||query.length>100)throw nativeProvisionError('玩家搜尋內容不正確');
  const q=query.trim();if(q!==view.q||view.page!==0){invalidate();view=fresh(q);}
  notify();return snapshot();
 }
 function setPage(page){
  requireScope();requireIdle();if(!Number.isSafeInteger(page)||page<0||page*NATIVE_PROVISION_PAGE_LIMIT>10000000)throw nativeProvisionError('可綁定清單頁碼不正確');
  if(page!==view.page){invalidate();view=fresh(view.q,page);}notify();return snapshot();
 }
 function selectAccount(accountId){
  requireScope();requireIdle();const id=accountId===null?null:nativeProvisionUuid(accountId);
  if(accountId!==null&&(!id||view.loading||!Number.isSafeInteger(view.revision)||!view.rows.some(row=>row.accountId===id)))
   throw nativeProvisionError('請明確選擇目前清單中的可綁定帳號');
  if(view.selectedAccountId!==id){view.selectedAccountId=id;view.error=null;}notify();return snapshot();
 }
 function load({force=false}={}){
  requireScope();requireIdle();if(typeof force!=='boolean')throw nativeProvisionError('重新讀取設定不正確');
  const key=JSON.stringify([scope.key,view.q,view.page,NATIVE_PROVISION_PAGE_LIMIT]);
  if(pendingRead?.key===key)return pendingRead.promise;
  if(!force&&cacheKey===key)return Promise.resolve(snapshot());
  const capturedScope=scope,current=view,requestGeneration=generation;
  const active=()=>{syncContext();return generation===requestGeneration&&view===current&&scope?.key===capturedScope.key;};
  const payload={op:'nativePlayerEligibility',spaceId:scope.spaceId,query:view.q,page:view.page,limit:NATIVE_PROVISION_PAGE_LIMIT,management:true};
  const promise=Promise.resolve().then(()=>active()?api(payload):null).then(response=>{
   if(!active())return null;
   Object.assign(current,nativeProvisionPage(response,capturedScope,current.page),{loading:false,error:null});cacheKey=key;pendingRead=null;
   notify();return snapshot();
  }).catch(error=>{
   if(!active())return null;
   Object.assign(current,{loading:false,error:String(error?.message||'讀取可綁定玩家失敗').slice(0,500)});cacheKey=key;pendingRead=null;
   notify();return snapshot();
  });
  Object.assign(current,fresh(current.q,current.page),{loading:true});pendingRead={key,promise};notify();return promise;
 }
 function provision(data){
  requireScope();requireIdle();
  let fields,selected;
  try{
   fields=nativeProvisionFields(data);selected=view.rows.find(row=>row.accountId===view.selectedAccountId);
   if(view.loading||!selected||!Number.isSafeInteger(view.revision)||view.revision<0||view.revision>=Number.MAX_SAFE_INTEGER)
    throw nativeProvisionError('請先讀取清單並明確選擇可綁定帳號');
  }catch(error){view.error=error.message;notify();throw error;}
  const capturedScope=scope,current=view,requestGeneration=generation,revision=view.revision;
  const active=()=>{syncContext();return generation===requestGeneration&&view===current&&scope?.key===capturedScope.key;};
  const payload={op:'nativePlayerProvision',streamer:scope.roomId,spaceId:scope.spaceId,revision,
   rows:[{accountId:selected.accountId,membershipId:selected.membershipId,...fields}],management:true};
  const promise=Promise.resolve().then(()=>active()?api(payload):null).then(response=>{
   if(!active())return null;
   const result=nativeProvisionResult(response,revision,fields.name);
   invalidate();view={...fresh(current.q,current.page),result};notify();return nativeProvisionFreeze(structuredClone(result));
  }).catch(error=>{
   if(!active())return null;
   // A transport error may follow a committed write. Require a fresh explicit
   // eligibility read before retrying, rather than reusing its old revision.
   invalidate();view={...fresh(current.q,current.page),error:String(error?.message||'玩家建檔失敗').slice(0,500)};notify();throw error;
  });
  current.saving=true;current.error=null;current.result=null;notify();return promise;
 }
 function reset(){invalidate();view=fresh();syncContext();notify();return snapshot();}
 return Object.freeze({state,setQuery,setPage,selectAccount,load,provision,reset});
}
