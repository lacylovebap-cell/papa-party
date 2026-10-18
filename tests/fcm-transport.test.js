import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFcmTransport} from '../supabase/functions/party-api/fcm-transport.js';

const time=Date.parse('2026-10-18T00:00:00Z'),projectId='pa-party-fixture';
const registrationToken='fixture-private-registration-123456789',accessToken='fixture-private-access-123456789';
const target={version:1,spaceId:'space-001',streamerId:'room-1',streamerSlug:'papa',section:'center',
 entityType:'message',entityId:'entity-1',notificationId:'notice-1'};
const input=()=>({registrationToken,target:{...target},notificationId:'notice-1'});
const typed=code=>({error:{message:'private provider detail '+registrationToken+' '+accessToken,
 details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:code}]}});
const accepted=()=>Response.json({name:'projects/'+projectId+'/messages/fixture-accepted'});
function fixture(options={}){
 const calls=[],credentials=[];
 const transport=createFcmTransport({projectId,now:()=>time,
  getAccessToken:async arg=>{credentials.push(arg);return {accessToken,expiresAt:time+60000};},
  fetch:async(url,init)=>{calls.push({url,init});return accepted();},...options});
 return {transport,calls,credentials};
}
function privateFree(value){assert.doesNotMatch(JSON.stringify(value),/fixture-private|private provider|Bearer|credential-secret|stack-secret/);}

test('one explicit send projects only canonical navigation and generic notification, without background work',async()=>{
 const f=fixture();await Promise.resolve();assert.equal(f.calls.length,0);assert.equal(f.credentials.length,0);
 const response=await f.transport.send({...input(),topic:'all',condition:'all',endpoint:'https://evil.invalid',
  title:'private title',body:'private business body',snapshot:{private:'snapshot'},data:{secret:'private'}});
 assert.deepEqual(response,{status:'accepted',reason:'provider_accepted'});privateFree(response);
 assert.equal(f.calls.length,1);assert.equal(f.credentials.length,1);
 const {url,init}=f.calls[0];assert.equal(url,'https://fcm.googleapis.com/v1/projects/'+projectId+'/messages:send');
 assert.equal(init.redirect,'error');assert.equal(init.method,'POST');assert.ok(init.signal instanceof AbortSignal);
 assert.equal(init.signal,f.credentials[0].signal);assert.equal(init.headers.Authorization,'Bearer '+accessToken);
 const sent=JSON.parse(init.body);assert.deepEqual(Object.keys(sent),['message']);
 assert.deepEqual(Object.keys(sent.message),['token','notification','data']);assert.equal(sent.message.token,registrationToken);
 assert.deepEqual(sent.message.notification,{title:'PA Party',body:'你有一則新通知，請開啟 PA Party 查看。'});
 assert.deepEqual(sent.message.data,{target:JSON.stringify(target),notificationId:'notice-1'});
 assert.doesNotMatch(init.body,/private title|business body|snapshot|evil|topic|condition/);
 await Promise.resolve();await Promise.resolve();assert.equal(f.calls.length,1);
});

test('invalid configuration, registration, canonical identity and UTF-8 size never fetch or request credentials',async()=>{
 for(const patch of [{projectId:'evil/project'},{projectId:'https://evil.invalid'},{projectId:'UPPERCASE'},
  {projectId:'short'},{fetch:undefined},{getAccessToken:undefined},{timeoutMs:0},{timeoutMs:30001}]){
  const f=fixture(patch);assert.equal((await f.transport.send(input())).status,'configuration');assert.equal(f.calls.length,0);assert.equal(f.credentials.length,0);
 }
 for(const patch of [null,{},...['short',' leading-token-123456','trailing-token-123456 ','whitespace\ttoken-12345',
  'control\u0080token-123456','zero\u200bwidth-token-12345','x'.repeat(4097)].map(value=>({registrationToken:value})),
  {target:{...target,section:'admin-other'}},{target:{...target,notificationId:null}},{notificationId:'mismatch'},
  {registrationToken:'x'.repeat(1500),target:{...target,streamerId:'界'.repeat(128),streamerSlug:'界'.repeat(128),spaceId:'界'.repeat(128),entityId:'界'.repeat(256),notificationId:'界'.repeat(128)},notificationId:'界'.repeat(128)}]){
  const f=fixture(),value=patch===null?null:{...input(),...patch};
  if(patch&&Object.keys(patch).length===0)delete value.target;
  assert.equal((await f.transport.send(value)).status,'invalid_payload');assert.equal(f.calls.length,0);assert.equal(f.credentials.length,0);
 }
});

test('input is snapshotted before waiting for a short-lived credential, and expired credentials never dispatch',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve),f=fixture({getAccessToken:()=>pending}),payload=input();
 const sending=f.transport.send(payload);payload.registrationToken='changed-private-destination';payload.target.streamerId='other-room';payload.notificationId='other-notice';
 release({accessToken,expiresAt:time+60000});assert.equal((await sending).status,'accepted');
 const message=JSON.parse(f.calls[0].init.body).message;assert.equal(message.token,registrationToken);assert.deepEqual(JSON.parse(message.data.target),target);
 for(const supplied of [null,accessToken,{accessToken,expiresAt:time},{accessToken:'bad\ntoken-123456789',expiresAt:time+60000},
  {accessToken,expiresAt:time+3600001},{accessToken,expiresAt:Infinity}]){
  const other=fixture({getAccessToken:async()=>supplied}),response=await other.transport.send(input());
  assert.equal(response.status,'auth');assert.equal(other.calls.length,0);privateFree(response);
 }
 let clockReads=0;const expired=fixture({now:()=>clockReads++?time+60000:time}),response=await expired.transport.send(input());
 assert.equal(response.reason,'expired_credential');assert.equal(expired.calls.length,0);
});

test('credential, network and redirect failures return only fixed safe classifications',async()=>{
 for(const [patch,status,reason] of [
  [{getAccessToken:async()=>{throw Error('credential-secret '+accessToken);}},'auth','credential_unavailable'],
  [{fetch:async()=>{throw Error('stack-secret '+registrationToken);}},'unknown','transport_failure'],
  [{fetch:async()=>new Response('private provider detail',{status:302,headers:{Location:'https://evil.invalid'}})},'unknown','redirect_refused'],
  [{fetch:async()=>({status:200,redirected:true,url:'https://evil.invalid'})},'unknown','redirect_refused'],
 ]){
  const f=fixture(patch),response=await f.transport.send(input());assert.deepEqual(response,{status,reason});privateFree(response);
 }
});

test('bounded deadline covers hanging credentials, fetch and response body without a late send',async()=>{
 // The hold only keeps Node alive for AbortSignal.timeout's unreferenced deadline.
 const hold=setTimeout(()=>{},1000);
 try{
  let late;const stalled=new Promise(resolve=>late=resolve),credential=fixture({timeoutMs:15,getAccessToken:()=>stalled});
  assert.deepEqual(await credential.transport.send(input()),{status:'unknown',reason:'timeout'});
  late({accessToken,expiresAt:time+60000});await Promise.resolve();await Promise.resolve();assert.equal(credential.calls.length,0);
  for(const fetch of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){}}),{status:200})]){
   const f=fixture({timeoutMs:15,fetch}),response=await f.transport.send(input());assert.deepEqual(response,{status:'unknown',reason:'timeout'});privateFree(response);
  }
 }finally{clearTimeout(hold);}
});

test('only typed UNREGISTERED with 404 is invalid registration; generic 400/404 never disable a token',async()=>{
 const cases=[
  [404,typed('UNREGISTERED'),'invalid_registration','provider_unregistered'],
  [404,{error:{status:'UNREGISTERED',message:'UNREGISTERED'}},'unknown','unclassified_provider_response'],
  [404,{error:{details:[{'@type':'not-fcm',errorCode:'UNREGISTERED'}]}},'unknown','unclassified_provider_response'],
  [404,typed('INVALID_ARGUMENT'),'unknown','unclassified_provider_response'],
  [400,typed('INVALID_ARGUMENT'),'invalid_payload','provider_payload_rejected'],
  [400,typed('UNREGISTERED'),'invalid_payload','provider_payload_rejected'],
  [401,typed('UNREGISTERED'),'auth','provider_authentication_rejected'],
  [403,typed('SENDER_ID_MISMATCH'),'configuration','sender_project_mismatch'],
  [403,typed('UNREGISTERED'),'auth','provider_permission_rejected']];
 for(const [code,body,status,reason] of cases){
  const f=fixture({fetch:async()=>Response.json(body,{status:code})}),response=await f.transport.send(input());
  assert.deepEqual(response,{status,reason});privateFree(response);
 }
});

test('429 and 5xx return Retry-After suggestions without retrying or sleeping',async()=>{
 for(const [code,header,expected] of [[429,null,60000],[429,'1',60000],[429,'120',120000],
  [429,'Sun, 18 Oct 2026 00:03:00 GMT',180000],[503,'10',10000],[500,null,null],
  [502,'invalid',null],[503,'Sun, 18 Oct 2026 00:00:00 GMT',0],[429,'-1',60000]]){
  let requests=0;const f=fixture({fetch:async()=>{requests++;return new Response('private provider '+registrationToken,
   {status:code,headers:header?{'Retry-After':header}:{}});}}),response=await f.transport.send(input());
  assert.deepEqual(response,{status:'retryable',reason:code===429?'provider_rate_limited':'provider_unavailable',retryAfterMs:expected});
  assert.equal(requests,1);privateFree(response);await Promise.resolve();assert.equal(requests,1);
 }
});

test('malformed, oversized or hostile provider bodies never escape the adapter',async()=>{
 for(const response of [new Response('private provider detail '+accessToken,{status:200}),
  Response.json({name:'projects/another-project/messages/private provider detail'},{status:200}),
  Response.json({name:'projects/'+projectId+'/messages/'+'x'.repeat(20000)+registrationToken},{status:200}),
  new Response('UNREGISTERED '+registrationToken+'x'.repeat(20000),{status:404}),
  Response.json({error:{message:accessToken}},{status:418})]){
  const f=fixture({fetch:async()=>response}),value=await f.transport.send(input());assert.equal(value.status,'unknown');privateFree(value);
 }
 const source=fs.readFileSync(new URL('../supabase/functions/party-api/fcm-transport.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\b(?:setTimeout|setInterval|waitUntil|console|process\.env|Deno\.env)\b/);
});

test('early status returns cancel unread provider streams safely, while success consumes and releases its stream',async()=>{
 for(const status of [302,400,401,413,429,500,503]){
  let cancelled=0;
  const stream=new ReadableStream({cancel(){cancelled++;return Promise.reject(Error('private provider '+accessToken));}});
  const f=fixture({fetch:async()=>new Response(stream,{status})}),response=await f.transport.send(input());
  assert.equal(cancelled,1,'unread status '+status+' must release its stream');
  assert.equal(stream.locked,false);privateFree(response);
 }
 let cancelled=0;
 const stream=new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode(JSON.stringify({name:'projects/'+projectId+'/messages/consumed'})));controller.close();
 },cancel(){cancelled++;}});
 const f=fixture({fetch:async()=>new Response(stream,{status:200})});
 assert.deepEqual(await f.transport.send(input()),{status:'accepted',reason:'provider_accepted'});
 assert.equal(stream.locked,false);assert.equal(cancelled,0,'fully consumed success has no remaining body to cancel');
});
