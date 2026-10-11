const NATIVE_PROVISION_PAGE_LIMIT=20;
const NATIVE_PROVISION_BATCH_LIMIT=100;
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
function nativeProvisionBatchResult(response,revision,rows){
 if(!nativeProvisionObject(response)||response.revision!==revision+1||!Number.isSafeInteger(response.revision)
  ||!Array.isArray(response.created)||response.created.length!==rows.length)
  throw nativeProvisionError('玩家建檔結果不正確，請重新讀取可綁定清單');
 const ids=new Set(),created=Array.from(response.created,(row,index)=>{
  if(!nativeProvisionObject(row)||!nativeProvisionId(row.playerId)||row.name!==rows[index].name||ids.has(row.playerId))
   throw nativeProvisionError('玩家建檔結果不正確，請重新讀取可綁定清單');
  ids.add(row.playerId);return {playerId:row.playerId,name:row.name};
 });
 return {revision:response.revision,created};
}
const nativeProvisionBatch=()=>({text:'',rows:[],revision:null,activeIndex:null});
function nativeProvisionBatchPreview(text,revision){
 if(typeof text!=='string'||text.length>500000)throw nativeProvisionError('批量玩家資料不正確');
 const lines=text.split(/\r\n|\n|\r/).map((value,index)=>({value,line:index+1})).filter(row=>row.value.trim());
 if(!lines.length||lines.length>NATIVE_PROVISION_BATCH_LIMIT)throw nativeProvisionError('請填 1 至 100 位玩家，每行一位');
 const rows=lines.map(({value,line})=>{
  const columns=value.includes('\t')?value.split('\t'):value.split(/[|｜]/),data=Object.fromEntries(NATIVE_PROVISION_FIELDS.map((field,index)=>[field,(columns[index]??'').trim()]));
  let fields=data,error=null;
  try{if(columns.length!==NATIVE_PROVISION_FIELDS.length)throw nativeProvisionError('每行必須有 5 欄：玩家名稱｜平台 ID｜曾用名｜平台認證｜備註');fields=nativeProvisionFields(data);}
  catch(cause){error=cause.message;}
  return {line,fields,error,skip:false,binding:null};
 });
 const activeIndex=rows.findIndex(row=>!row.error);
 return {text,rows,revision:Number.isSafeInteger(revision)?revision:null,activeIndex:activeIndex<0?null:activeIndex};
}
function nativeProvisionUnbindBatch(batch,revision=null){
 return {...batch,revision,rows:batch.rows.map(row=>({...row,binding:null}))};
}

// A single bounded eligibility page and an explicit choice feed the existing
// provisioning API. Neither labels nor business IDs infer Account authority.
export function createNativePlayerProvisioner({api,context,onChange=()=>{}}){
 if(typeof api!=='function'||typeof context!=='function'||typeof onChange!=='function')throw nativeProvisionError('玩家建檔控制器設定不正確');
 const fresh=(q='',page=0,batch=nativeProvisionBatch())=>({q,page,rows:[],total:0,revision:null,loading:false,saving:false,error:null,selectedAccountId:null,result:null,batch});
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
  const q=query.trim();if(q!==view.q||view.page!==0){invalidate();view=fresh(q,0,view.batch);}
  notify();return snapshot();
 }
 function setPage(page){
  requireScope();requireIdle();if(!Number.isSafeInteger(page)||page<0||page*NATIVE_PROVISION_PAGE_LIMIT>10000000)throw nativeProvisionError('可綁定清單頁碼不正確');
  if(page!==view.page){invalidate();view=fresh(view.q,page,view.batch);}notify();return snapshot();
 }
 function selectAccount(accountId){
  requireScope();requireIdle();const id=accountId===null?null:nativeProvisionUuid(accountId);
  if(accountId!==null&&(!id||view.loading||!Number.isSafeInteger(view.revision)||!view.rows.some(row=>row.accountId===id)))
   throw nativeProvisionError('請明確選擇目前清單中的可綁定帳號');
  if(view.selectedAccountId!==id){view.selectedAccountId=id;view.error=null;}notify();return snapshot();
 }
 function previewBatch(text){
  requireScope();requireIdle();
  try{view.batch=nativeProvisionBatchPreview(text,view.loading?null:view.revision);view.error=null;view.result=null;}
  catch(error){view.batch=nativeProvisionBatch();view.error=error.message;notify();throw error;}
  notify();return snapshot();
 }
 function clearBatch(){requireScope();requireIdle();view.batch=nativeProvisionBatch();view.error=null;view.result=null;notify();return snapshot();}
 function batchRow(index){
  if(!Number.isSafeInteger(index)||index<0||index>=view.batch.rows.length)throw nativeProvisionError('請選擇有效的匯入資料');
  return view.batch.rows[index];
 }
 function chooseBatchRow(index){
  requireScope();requireIdle();const row=batchRow(index);
  if(row.skip||row.error)throw nativeProvisionError('請先修正資料，或選擇未跳過的玩家');
  view.batch.activeIndex=index;view.error=null;notify();return snapshot();
 }
 function skipBatchRow(index,skip){
  requireScope();requireIdle();if(typeof skip!=='boolean')throw nativeProvisionError('跳過玩家設定不正確');
  const row=batchRow(index);row.skip=skip;row.binding=null;
  if(skip&&view.batch.activeIndex===index){const next=view.batch.rows.findIndex(candidate=>!candidate.skip&&!candidate.error);view.batch.activeIndex=next<0?null:next;}
  view.error=null;notify();return snapshot();
 }
 function bindBatchAccount(accountId){
  requireScope();requireIdle();const id=nativeProvisionUuid(accountId),row=batchRow(view.batch.activeIndex);
  const selected=id&&view.rows.find(candidate=>candidate.accountId===id);
  if(row.skip||row.error||view.loading||!selected||!Number.isSafeInteger(view.revision)||view.revision<0||view.batch.revision!==view.revision)
   throw nativeProvisionError('請明確選擇目前清單中的可綁定帳號');
  if(view.batch.rows.some(candidate=>candidate!==row&&candidate.binding&&(candidate.binding.accountId===selected.accountId||candidate.binding.membershipId===selected.membershipId)))
   throw nativeProvisionError('每個帳號與空間成員資格只能綁定一位玩家');
  row.binding={...selected};view.error=null;notify();return snapshot();
 }
 function load({force=false}={}){
  requireScope();requireIdle();if(typeof force!=='boolean')throw nativeProvisionError('重新讀取設定不正確');
  const key=JSON.stringify([scope.key,view.q,view.page,NATIVE_PROVISION_PAGE_LIMIT]);
  if(pendingRead?.key===key)return pendingRead.promise;
  if(!force&&cacheKey===key)return Promise.resolve(snapshot());
  const capturedScope=scope,current=view,requestGeneration=generation;
  const active=()=>{syncContext();return generation===requestGeneration&&view===current&&scope?.key===capturedScope.key;};
  const payload={op:'nativePlayerEligibility',spaceId:scope.spaceId,query:view.q,page:view.page,limit:NATIVE_PROVISION_PAGE_LIMIT,management:true};
  const promise=Promise.resolve().then(()=>active()?api(payload):null).then(async response=>{
   if(!active())return null;
   let page=nativeProvisionPage(response,capturedScope,current.page);
   if(current.batch.revision!==page.revision)current.batch=nativeProvisionUnbindBatch(current.batch,page.revision);
   const lastPage=page.total?Math.floor((page.total-1)/NATIVE_PROVISION_PAGE_LIMIT):0;
   if(page.total&&current.page>lastPage){
    // A valid empty page may have moved beyond the end after another manager
    // changed eligibility. Read the last valid page once; never cache that
    // empty response as if it were the corrected page or chase repeated changes.
    current.page=lastPage;current.total=page.total;
    pendingRead.key=JSON.stringify([capturedScope.key,current.q,current.page,NATIVE_PROVISION_PAGE_LIMIT]);
    const correction=await Promise.resolve().then(()=>active()?api({...payload,page:lastPage}):null);
    if(!active())return null;
    page=nativeProvisionPage(correction,capturedScope,lastPage);
    if(current.batch.revision!==page.revision)current.batch=nativeProvisionUnbindBatch(current.batch,page.revision);
    const correctedLastPage=page.total?Math.floor((page.total-1)/NATIVE_PROVISION_PAGE_LIMIT):0;
    if(page.total&&lastPage>correctedLastPage){current.page=correctedLastPage;current.total=page.total;throw nativeProvisionError('可綁定玩家清單剛更新，請重新讀取');}
   }
   Object.assign(current,page,{loading:false,error:null});if(page.total===0)current.page=0;
   cacheKey=JSON.stringify([capturedScope.key,current.q,current.page,NATIVE_PROVISION_PAGE_LIMIT]);pendingRead=null;
   notify();return snapshot();
  }).catch(error=>{
   if(!active())return null;
   Object.assign(current,{loading:false,error:String(error?.message||'讀取可綁定玩家失敗').slice(0,500)});
   cacheKey=JSON.stringify([capturedScope.key,current.q,current.page,NATIVE_PROVISION_PAGE_LIMIT]);pendingRead=null;
   notify();return snapshot();
  });
  Object.assign(current,fresh(current.q,current.page,current.batch),{loading:true});pendingRead={key,promise};notify();return promise;
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
 function provisionBatch(){
  requireScope();requireIdle();
  let rows;
  try{
   if(view.loading||!Number.isSafeInteger(view.revision)||view.revision<0||view.revision>=Number.MAX_SAFE_INTEGER||view.batch.revision!==view.revision)
    throw nativeProvisionError('請先讀取清單並明確選擇每位玩家的可綁定帳號');
   const chosen=view.batch.rows.filter(row=>!row.skip),accounts=new Set(),memberships=new Set();
   if(!chosen.length||chosen.length>NATIVE_PROVISION_BATCH_LIMIT)throw nativeProvisionError('請選擇 1 至 100 位待匯入玩家');
   rows=chosen.map(row=>{
    const binding=row.binding;
    if(row.error||!binding||binding.spaceId!==scope.spaceId||binding.role!=='player'||binding.status!=='active'
     ||!nativeProvisionUuid(binding.accountId)||!nativeProvisionUuid(binding.membershipId)||accounts.has(binding.accountId)||memberships.has(binding.membershipId))
     throw nativeProvisionError('請修正每筆資料，並明確選擇不同的可綁定帳號');
    accounts.add(binding.accountId);memberships.add(binding.membershipId);
    return {accountId:binding.accountId,membershipId:binding.membershipId,...nativeProvisionFields(row.fields)};
   });
  }catch(error){view.error=error.message;notify();throw error;}
  const capturedScope=scope,current=view,requestGeneration=generation,revision=view.revision;
  const active=()=>{syncContext();return generation===requestGeneration&&view===current&&scope?.key===capturedScope.key;};
  const payload={op:'nativePlayerProvision',streamer:scope.roomId,spaceId:scope.spaceId,revision,rows,management:true};
  const promise=Promise.resolve().then(()=>active()?api(payload):null).then(response=>{
   if(!active())return null;
   const result=nativeProvisionBatchResult(response,revision,rows);
   invalidate();view={...fresh(current.q,current.page),result};notify();return nativeProvisionFreeze(structuredClone(result));
  }).catch(error=>{
   if(!active())return null;
   // Keep the editable preview, but discard every proof and old revision after
   // uncertain writes. Only a fresh read and explicit choices permit retry.
   const message=String(error?.message||'玩家建檔失敗').slice(0,300)+'；請先確認是否已建檔，重新讀取清單並重新選擇帳號後再送出。';
   invalidate();view={...fresh(current.q,current.page,nativeProvisionUnbindBatch(current.batch)),error:message};
   notify();throw nativeProvisionError(message);
  });
  current.saving=true;current.error=null;current.result=null;notify();return promise;
 }
 function reset(){invalidate();view=fresh();syncContext();notify();return snapshot();}
 return Object.freeze({state,setQuery,setPage,selectAccount,load,provision,previewBatch,chooseBatchRow,bindBatchAccount,skipBatchRow,clearBatch,provisionBatch,reset});
}
