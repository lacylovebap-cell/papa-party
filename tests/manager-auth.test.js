import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

// Use the real handler and role resolver while replacing only the database/network boundary.
const root=new URL('../',import.meta.url),read=f=>fs.readFileSync(new URL(f,root),'utf8');
const source=[read('src/home-settings.js'),read('src/core.js'),read('src/access-policy.js'),read('src/notification-rules.js'),read('supabase/functions/party-api/index.ts')]
 .map(s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
function server(authUser=''){
 let handler;
 const c=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,webpush:{},Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://example.supabase.co':key==='PAPA_ADMIN_USER_ID'?authUser:'service-test'},serve:h=>handler=h},EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('Unexpected network');}});
 vm.runInContext(stripTypeScriptTypes(source),c);
 vm.runInContext(`
  var calls=[],responses={},sessionRows=[],allowed=true;
  api=async(path,body)=>{
   calls.push({path,body});
   if(path.includes('papa_v2_sessions?'))return sessionRows;
   if(path.includes('papa_streamer_accounts?')&&path.includes('enabled=eq.true'))return [{streamer_id:'papa',enabled:true}];
   if(path.endsWith('papa_manager_login'))return allowed;
   if(path.endsWith('papa_change_manager_password')||path.endsWith('papa_manage_streamer_login'))return responses.change||{ok:true};
   throw Error('Unexpected database access '+path);
  };
  load=async()=>upgradePlatform(empty());
 `,c);
 return {c,async request(body){const response=await handler({method:'POST',json:async()=>body});return {status:response.status,data:await response.json()};},calls(){return JSON.parse(vm.runInContext('JSON.stringify(calls)',c));},set(code){vm.runInContext(code,c);}};
}
test('president login never forwards a chosen streamer or accepts a client role',async()=>{
 for(const authUser of ['', 'b84a30c4-cb31-4318-814a-d72f1572f553']){
  const s=server(authUser),r=await s.request({op:'adminLogin',password:'example-password',streamer:'other',role:'streamer_admin'});
  assert.equal(r.status,200);assert.equal(r.data.role,'super_admin');assert.match(r.data.token,/^admin:/);assert.equal(r.data.streamerId,undefined);assert.equal(r.data.expiresIn,43200);
  const [call]=s.calls();assert.equal(call.path,'/rest/v1/rpc/papa_manager_login');assert.deepEqual({...call.body,session_hash:'hash'},{kind:'president',room:null,password:'example-password',auth_user:authUser||null,session_hash:'hash'});assert.match(call.body.session_hash,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(r.data).includes('example-password'),false);
 }
});
test('streamer login resolves its room server-side and cannot elevate itself',async()=>{
 const s=server(),r=await s.request({op:'streamerLogin',password:'own-password',streamer:'papa',role:'super_admin',streamerId:'other'});
 assert.equal(r.status,200);assert.equal(r.data.role,'streamer_admin');assert.equal(r.data.streamerId,'papa');assert.match(r.data.token,/^streamer:/);
 const call=s.calls().find(x=>x.path.endsWith('papa_manager_login'));assert.equal(call.body.kind,'streamer');assert.equal(call.body.room,'papa');
 s.set('allowed=false');const denied=await s.request({op:'streamerLogin',password:'president-password',streamer:'papa'});assert.equal(denied.status,400);assert.equal(denied.data.token,undefined);
});
test('manager password changes require an active manager session and bind role and room to that session',async()=>{
 const s=server();
 let r=await s.request({op:'changeManagerPassword',currentPassword:'current',newPassword:'new-password'});assert.equal(r.status,400);assert.equal(s.calls().length,0);
 s.set("sessionRows=[{player_id:'P1',login_id:'1',role:'player'}]");r=await s.request({op:'changeManagerPassword',token:'player:test',currentPassword:'current',newPassword:'new-password'});assert.equal(r.status,400);assert.equal(s.calls().some(x=>x.path.endsWith('papa_change_manager_password')),false);
 s.set("calls=[];sessionRows=[{player_id:'__streamer__:papa',role:'streamer_admin',streamer_id:'papa'}]");
 r=await s.request({op:'changeManagerPassword',token:'streamer:test',streamer:'other',kind:'president',currentPassword:'current',newPassword:'new-password'});
 assert.equal(r.status,200);assert.deepEqual(r.data,{ok:true,signOut:true});const call=s.calls().find(x=>x.path.endsWith('papa_change_manager_password'));
 assert.equal(call.body.kind,'streamer');assert.equal(call.body.room,'papa');assert.equal(call.body.current_password,'current');assert.match(call.body.session_hash,/^[a-f0-9]{64}$/);
});
test('president self-service is independent of currently viewed streamer, errors contain no credentials',async()=>{
 const s=server();s.set("sessionRows=[{player_id:'__admin__',role:'super_admin'}];responses.change={ok:false,reason:'same_as_streamer'}");
 const r=await s.request({op:'changeManagerPassword',token:'admin:test',streamer:'other',currentPassword:'private-old',newPassword:'private-new'});
 assert.equal(r.status,400);assert.match(r.data.error,/不能與任一主播/);assert.equal(JSON.stringify(r.data).includes('private-'),false);
 const call=s.calls().find(x=>x.path.endsWith('papa_change_manager_password'));assert.equal(call.body.kind,'president');assert.equal(call.body.room,null);
 s.set("responses.change={ok:false,reason:'rate_limit'}");const limited=await s.request({op:'changeManagerPassword',token:'admin:test',currentPassword:'a',newPassword:'b'});assert.match(limited.data.error,/15 分鐘/);
});
test('a streamer cannot reset another account; the president setter forwards collision checking',async()=>{
 const s=server();s.set("sessionRows=[{player_id:'__streamer__:papa',role:'streamer_admin',streamer_id:'papa'}]");
 let r=await s.request({op:'setStreamerAccount',token:'streamer:test',streamer:'papa',password:'password'});assert.equal(r.status,400);assert.equal(s.calls().some(x=>x.path.endsWith('papa_manage_streamer_login')),false);
 s.set("sessionRows=[{player_id:'__admin__'}];responses.change={ok:false,reason:'same_as_president'}");
 r=await s.request({op:'setStreamerAccount',token:'admin:test',streamer:'papa',password:'same-password',enabled:true});assert.equal(r.status,400);assert.match(r.data.error,/不能與 PA Party總裁密碼相同/);
});
test('Auth JWTs and mismatched token roles cannot bypass PA Party session revocation',async()=>{
 const s=server('auth-user');
 assert.equal(await vm.runInContext("actor('eyJhbGci.payload.signature')",s.c),null);assert.equal(s.calls().length,0);
 s.set("sessionRows=[{player_id:'__admin__',role:'streamer_admin'}]");assert.equal(await vm.runInContext("actor('admin:test')",s.c),null);
 s.set("sessionRows=[{player_id:'__admin__',role:'super_admin'}]");assert.equal(await vm.runInContext("actor('player:test')",s.c),null);
 s.set("sessionRows=[]");assert.equal(await vm.runInContext("actor('admin:test')",s.c),null);
 const r=await s.request({op:'refreshAdmin',refreshToken:'old-external-token'});assert.equal(r.status,400);assert.match(r.data.error,/重新登入/);
});
