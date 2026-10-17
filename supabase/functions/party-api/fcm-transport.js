import {validateNotificationTarget} from '../../../src/notification-target.js';

// Unwired transport only. Callers supply a short-lived credential and decide
// authorization, leases, retries and token invalidation. No scheduling or I/O
// takes place until send is explicitly called.
const FCM_ERROR='type.googleapis.com/google.firebase.fcm.v1.FcmError';
const MAX_BODY_BYTES=3500,MAX_RESPONSE_BYTES=16384;
const encoder=new TextEncoder();
const deadline=Symbol('fcm deadline');
const result=(status,reason,extra={})=>({status,reason,...extra});
const safeToken=value=>typeof value==='string'&&value.length>=16&&value.length<=4096&&!/[\s\p{C}]/u.test(value);
const safeTime=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

function abortable(work,signal){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(fn,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);fn(value);};
  const onAbort=()=>finish(reject,deadline);
  if(signal.aborted){reject(deadline);return;}
  signal.addEventListener('abort',onAbort,{once:true});
  Promise.resolve().then(()=>{if(signal.aborted)throw deadline;return work();})
   .then(value=>finish(resolve,value),error=>finish(reject,error));
 });
}

async function responseJson(response,signal){
 const reader=response.body?.getReader();
 if(!reader)return null;
 let complete=false,size=0;const chunks=[];
 try{
  while(true){
   const next=await abortable(()=>reader.read(),signal);
   if(next.done){complete=true;break;}
   if(!(next.value instanceof Uint8Array))return null;
   size+=next.value.byteLength;if(size>MAX_RESPONSE_BYTES)return null;
   chunks.push(next.value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{return null;}
 }finally{
  if(!complete){try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}
  try{reader.releaseLock();}catch{}
 }
}

function retryAfterMs(value,time){
 if(typeof value!=='string'||value.length>128)return null;
 const text=value.trim();
 if(/^\d+$/.test(text)){
  const milliseconds=Number(text)*1000;
  return Number.isSafeInteger(milliseconds)?milliseconds:null;
 }
 if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text))return null;
 const parsed=Date.parse(text);return Number.isFinite(parsed)?Math.max(0,parsed-time):null;
}

function typedFcmError(body,code){
 return Array.isArray(body?.error?.details)&&body.error.details.some(detail=>
  detail?.['@type']===FCM_ERROR&&detail.errorCode===code);
}

export function createFcmTransport({projectId,getAccessToken,fetch,now=Date.now,timeoutMs=10000}={}){
 const configured=typeof projectId==='string'&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
  &&typeof getAccessToken==='function'&&typeof fetch==='function'&&typeof now==='function'
  &&Number.isInteger(timeoutMs)&&timeoutMs>=10&&timeoutMs<=30000;
 const endpoint=configured?'https://fcm.googleapis.com/v1/projects/'+projectId+'/messages:send':null;
 return Object.freeze({async send(input){
  if(!configured)return result('configuration','invalid_transport_configuration');
  // Snapshot and project before the first await; arbitrary input fields cannot
  // become notification text, FCM options, topics, conditions or destinations.
  let body;
  try{
   const registrationToken=input?.registrationToken,target=validateNotificationTarget(input?.target);
   if(!safeToken(registrationToken)||!target||typeof input.notificationId!=='string'
    ||!target.notificationId||input.notificationId!==target.notificationId)return result('invalid_payload','invalid_notification');
   body=JSON.stringify({message:{token:registrationToken,
    notification:{title:'PA Party',body:'你有一則新通知，請開啟 PA Party 查看。'},
    data:{target:JSON.stringify(target),notificationId:target.notificationId}}});
   if(encoder.encode(body).byteLength>MAX_BODY_BYTES)return result('invalid_payload','payload_too_large');
  }catch{return result('invalid_payload','invalid_notification');}
  const signal=AbortSignal.timeout(timeoutMs);
  let stage='credential',response;
  try{
   const supplied=await abortable(()=>getAccessToken({signal}),signal);
   const accessToken=supplied?.accessToken,expiresAt=supplied?.expiresAt,time=now();
   if(!safeTime(time))return result('configuration','invalid_clock');
   if(!safeToken(accessToken)||!safeTime(expiresAt)||expiresAt<=time||expiresAt-time>3600000)
    return result('auth','invalid_short_lived_credential');
   if(signal.aborted)throw deadline;
   // A second clock check closes the credential-provider/dispatch boundary.
   const dispatchTime=now();
   if(!safeTime(dispatchTime))return result('configuration','invalid_clock');
   if(expiresAt<=dispatchTime)return result('auth','expired_credential');
   stage='dispatch';
   response=await abortable(()=>fetch(endpoint,{method:'POST',redirect:'error',signal,
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+accessToken},body}),signal);
   if(response.redirected||response.status>=300&&response.status<400
    ||response.url&&response.url!==endpoint)return result('unknown','redirect_refused');
   const status=response.status;
   if(status===401)return result('auth','provider_authentication_rejected');
   if(status===400||status===413)return result('invalid_payload','provider_payload_rejected');
   if(status===429||status>=500&&status<=599){
    const retryTime=now();
    if(!safeTime(retryTime))return result('configuration','invalid_clock');
    const suggestion=retryAfterMs(response.headers.get('Retry-After'),retryTime);
    return result('retryable',status===429?'provider_rate_limited':'provider_unavailable',
     {retryAfterMs:status===429?Math.max(60000,suggestion??0):suggestion});
   }
   const parsed=await responseJson(response,signal);
   if(signal.aborted)throw deadline;
   if(status===200){
    const prefix='projects/'+projectId+'/messages/';
    if(typeof parsed?.name==='string'&&parsed.name.startsWith(prefix)
     &&/^[^\s\p{C}]{1,1024}$/u.test(parsed.name.slice(prefix.length)))
     return result('accepted','provider_accepted');
    return result('unknown','invalid_provider_response');
   }
   if(status===404&&typedFcmError(parsed,'UNREGISTERED'))return result('invalid_registration','provider_unregistered');
   if(status===403&&typedFcmError(parsed,'SENDER_ID_MISMATCH'))return result('configuration','sender_project_mismatch');
   if(status===403)return result('auth','provider_permission_rejected');
   return result('unknown','unclassified_provider_response');
  }catch(error){
   if(error===deadline||signal.aborted)return result('unknown','timeout');
   return stage==='credential'?result('auth','credential_unavailable'):result('unknown','transport_failure');
  }finally{
   // Early status returns must not leave an unread provider stream occupying a
   // connection. Cancellation itself is untrusted and must not delay the result.
   try{if(response?.body&&!response.body.locked)Promise.resolve(response.body.cancel()).catch(()=>{});}catch{}
  }
 }});
}
