import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {NOTICE_TYPES,noticePushWindow,noticeChannels,queueNoticeCurrent} from '../src/notification-rules.js';
const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8');
const code=source.slice(source.indexOf('async function deliverPush(){'),source.indexOf('async function signalNotices(')).replaceAll(':any','');
async function run({type='message',status=201,attempts=1,device=true,allowed=true,recipient='P1',created_at=new Date().toISOString(),read_at=null}={}){
 const writes=[],sent=[];
 const n={id:'n',streamer_id:'room-a',streamer_name:'A',recipient:'P1',type,body:'synthetic',created_at,read_at};
 const job={id:7,notice_id:'n',subscription_id:'s',lease:'lease',attempts};
 const sub={recipient,streamer_id:'room-a',device_session_id:device?'device':null,session_hash:'synthetic',subscription:{}};
 const api=async(path,body,method)=>{
  if(method==='PATCH'||path==='/rest/v1/papa_notifications'){writes.push({path,body,method});return [];}
  if(path.endsWith('papa_claim_push'))return [job];
  if(path.endsWith('papa_streamer_directory'))return [{id:'room-a',slug:'fixture'}];
  if(path.includes('papa_notifications?'))return [n];
  if(path.includes('papa_push_subscriptions?'))return [sub];
  if(path.includes('papa_notice_preferences?'))return [{preferences:{pushEnabled:true,types:{[type]:{push:true}}}}];
  if(path.endsWith('papa_device_push_recipient'))return allowed;
  if(path.endsWith('papa_verified_session_actor'))return allowed?{role:'player',playerId:'P1'}:null;
  throw Error('unexpected '+path);
 };
 const ctx=vm.createContext({api,noticeKeys:async()=>({publicKey:'test',privateKey:'test'}),noticePushWindow,noticeChannels,queueNoticeCurrent,canonicalNoticeLink:()=>({}),webNoticePath:()=>'/fixture',webpush:{generateRequestDetails:(sub,payload,options)=>{sent.push({payload:JSON.parse(payload),options});return {endpoint:'https://example.test',headers:{},body:''};}},fetch:async()=>({status,ok:status>=200&&status<300}),AbortSignal,Date});
 await vm.runInContext(code+';deliverPush()',ctx);
 return {writes,sent};
}
test('actual worker dispatches all 16 categories with notice/delivery identities and bounded TTL',async()=>{
 for(const type of Object.keys(NOTICE_TYPES)){const r=await run({type});assert.equal(r.sent.length,1,type);assert.equal(r.sent[0].payload.id,'n');assert.equal(r.sent[0].payload.deliveryId,'7');assert.ok(r.sent[0].options.TTL<=86400);assert.equal(r.writes[0].body.status,'sent');assert.match(r.writes[0].path,/lease=eq.lease/);}
});
test('legacy and device authorization, scope, read status and expiry suppress inappropriate sends',async()=>{
 assert.equal((await run({device:false})).sent.length,1);
 for(const options of [{allowed:false},{recipient:'other'},{read_at:new Date().toISOString()},{created_at:'2020-01-01T00:00:00Z'}]){const r=await run(options);assert.equal(r.sent.length,0);assert.equal(r.writes[0].body.status,'skipped');assert.ok(r.writes[0].body.last_error);}
});
test('expired subscription retains records; retries are leased and bounded',async()=>{
 for(const status of [404,410]){const r=await run({status});assert.equal(r.writes.length,1);assert.equal(r.writes[0].body.status,'failed');assert.equal(r.writes[0].method,'PATCH');assert.equal(r.writes[0].body.last_error,'subscription_expired_'+status);}
 assert.equal((await run({status:503})).writes[0].body.status,'pending');
 const final=await run({status:503,attempts:5});assert.equal(final.writes[0].body.status,'failed');assert.equal(final.writes[1].body.type,'delivery');
});
