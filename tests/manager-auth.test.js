import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

// Use the real handler and role resolver while replacing only the database/network boundary.
const root=new URL('../',import.meta.url),read=f=>fs.readFileSync(new URL(f,root),'utf8');
const source=[read('src/home-settings.js'),read('src/core.js'),read('src/state-patch.js'),read('src/access-policy.js'),read('src/notification-rules.js'),read('supabase/functions/party-api/index.ts')]
 .map(s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
function server(authUser=''){
 let handler;
 const c=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,webpush:{},Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://example.supabase.co':key==='PAPA_ADMIN_USER_ID'?authUser:'service-test'},serve:h=>handler=h},EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('Unexpected network');}});
 vm.runInContext(stripTypeScriptTypes(source),c);
 vm.runInContext(`
  var calls=[],responses={},sessionRows=[],allowed=true,CATALOG_OPS=new Set();
  api=async(path,body)=>{
   calls.push({path,body});
   if(path.endsWith('papa_verified_session_actor')){
    const row=sessionRows[0];if(!row)return null;
    if(row.player_id==='__admin__'&&(!row.role||row.role==='super_admin'))return {role:'super_admin',accountId:row.account_id};
    if(row.role==='streamer_admin'&&row.player_id==='__streamer__:'+row.streamer_id)
     return body.requested_room===null||body.requested_room===row.streamer_id?
      {role:'streamer_admin',streamerId:row.streamer_id,spaceId:'space-001',accountId:row.account_id}:null;
    if(row.player_id!=='__admin__'&&row.role!=='streamer_admin')
     return (body.requested_room===null||(row.space_id||'space-001')===(body.requested_room==='other'?'space-002':'space-001'))?
      {role:'player',playerId:row.player_id,loginId:row.login_id,spaceId:row.space_id||'space-001',accountId:row.account_id}:null;
    return null;
   }
   if(path.includes('papa_v2_sessions?'))return sessionRows;
   if(path.includes('papa_push_subscriptions?'))return null;
   if(path==='/rest/v1/papa_v2_sessions')return null;
   if(path.includes('papa_streamer_accounts?')&&path.includes('enabled=eq.true'))return [{streamer_id:'papa',enabled:true}];
   if(path.endsWith('papa_manager_login'))return allowed;
   if(path.endsWith('papa_streamer_directory_in_space'))return upgradePlatform(empty()).streamers;
   if(path.endsWith('papa_start_device_session'))return {sessionId:'12345678-1234-1234-1234-123456789abc',role:body.chosen_role};
   if(path.endsWith('papa_refresh_device_access'))return responses.deviceRefresh===undefined?
    {sessionId:body.chosen_session,role:'player',spaceId:'space-001'}:responses.deviceRefresh;
   if(path.endsWith('papa_revoke_device_with_refresh'))return true;
   if(path.endsWith('papa_switch_device_space'))return responses.deviceSwitch||null;
   if(path.endsWith('papa_read_device_space_preferences'))return responses.devicePreferences||null;
   if(path.endsWith('papa_bind_verified_legacy_session')){
    const manager=calls.findLast(x=>x.path.endsWith('papa_manager_login'));
    return manager?.body.kind==='president'?{role:'president'}:
     manager?.body.kind==='streamer'?{role:'streamer_admin',streamerId:manager.body.room}:
     {role:'player',spaceId:'space-001'};
   }
   if(path.endsWith('papa_change_manager_password')||path.endsWith('papa_manage_streamer_login'))return responses.change||{ok:true};
   if(path.endsWith('papa_account_space_list'))return responses.spaces||[];
   if(path.endsWith('papa_account_space_by_slug'))return responses.space||null;
   if(path.endsWith('papa_account_space_entry'))return responses.entry||{spaces:[],total:0,hasMore:false};
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
  assert.equal(s.calls()[1].body.session_hash,call.body.session_hash);
  assert.equal(JSON.stringify(r.data).includes('example-password'),false);
 }
});

test('Space discovery is account-bound, never enumerates customers anonymously, and does not fall through to a room snapshot',async()=>{
 const s=server();const anonymous=await s.request({op:'spaces',accountId:'forged'});
 assert.equal(anonymous.status,400);assert.equal(s.calls().some(c=>c.path.endsWith('papa_account_space_list')),false);
 s.set("calls=[];sessionRows=[{player_id:'P1',role:'player',account_id:'verified-account',space_id:'space-002'}];responses.spaces=[{id:'space-002',slug:'other',name:'Other'}]");
 const list=await s.request({op:'spaces',token:'device:verified',accountId:'forged',streamer:'papa'});
 assert.equal(list.status,200);assert.deepEqual(list.data.spaces,[{id:'space-002',slug:'other',name:'Other'}]);
 assert.equal(s.calls().find(c=>c.path.endsWith('papa_account_space_list')).body.subject,'verified-account');
 assert.equal(s.calls().find(c=>c.path.endsWith('papa_verified_session_actor')).body.requested_room,null);
 const denied=await s.request({op:'spaceResolve',token:'device:verified',slug:'not-a-membership'});
 assert.equal(denied.status,400);assert.match(denied.data.error,/找不到可使用/);
 s.set("responses.space={id:'space-002',slug:'other',name:'Other'}");
 const allowed=await s.request({op:'spaceResolve',token:'device:verified',slug:'other'});
 assert.equal(allowed.status,200);assert.equal(allowed.data.space.id,'space-002');
 assert.equal(s.calls().some(c=>c.path.endsWith('papa_v2_snapshot')),false);
});

test('explicit device Space switch is one atomic credential RPC, ignores forged identity, and issues no access token',async()=>{
 const s=server(),oldSession='11111111-1111-4111-8111-111111111111',newSession='22222222-2222-4222-8222-222222222222';
 s.set(`load=async()=>{throw Error('business state must not load')};responses.deviceSwitch=${JSON.stringify({sessionId:newSession,role:'player',spaceId:'space-002',streamerId:null,playerId:'P-NATIVE',spaceSlug:'other',selectedSpace:{id:'space-002',slug:'other',name:'Other'},homeSpace:{id:'space-001',slug:'papa',name:'PA Party'},lastSpace:{id:'space-002',slug:'other',name:'Other'}})}`);
 const r=await s.request({op:'deviceSwitchSpace',sessionId:oldSession,refreshToken:'refresh:old',slug:'other',streamer:'room-002',token:'admin:forged',role:'super_admin',accountId:'forged',playerId:'P-WRONG',installationId:'borrowed',spaceId:'wrong'});
 assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.sessionId,newSession);assert.equal(r.data.playerId,'P-NATIVE');assert.equal(r.data.spaceId,'space-002');assert.equal(r.data.role,'player');assert.equal(r.data.token,undefined);assert.match(r.data.refreshToken,/^refresh:/);assert.equal(r.data.homeSpace.id,'space-001');
 const calls=s.calls();assert.equal(calls.length,1);assert.equal(calls[0].path,'/rest/v1/rpc/papa_switch_device_space');
 assert.deepEqual({...calls[0].body,current_refresh_hash:'hash',new_refresh_hash:'new'},{chosen_session:oldSession,current_refresh_hash:'hash',requested_slug:'other',requested_streamer:'room-002',new_refresh_hash:'new'});
 assert.match(calls[0].body.current_refresh_hash,/^[a-f0-9]{64}$/);assert.notEqual(calls[0].body.new_refresh_hash,calls[0].body.current_refresh_hash);assert.equal(JSON.stringify(calls).includes('refresh:old'),false);assert.equal(JSON.stringify(calls).includes('forged'),false);
 s.set(`calls=[];responses.deviceSwitch=${JSON.stringify({sessionId:newSession,role:'president',spaceId:null,streamerId:null,spaceSlug:'other',selectedSpace:{id:'space-002',slug:'other',name:'Other'},selectedStreamerId:'room-002'})}`);
 const president=await s.request({op:'deviceSwitchSpace',sessionId:oldSession,refreshToken:'refresh:old',slug:'other'});
 assert.equal(president.status,200);assert.equal(president.data.role,'super_admin');assert.equal(president.data.spaceId,null);assert.equal(president.data.streamerId,null);assert.equal(president.data.selectedSpace.id,'space-002');assert.equal(president.data.selectedStreamerId,'room-002');
});

test('entry resolves only the verified role and Account with bounded public destinations',async()=>{
 const s=server();assert.equal((await s.request({op:'spaceEntry',slug:'star',accountId:'forged'})).status,400);assert.equal(s.calls().length,0);
 s.set("sessionRows=[{player_id:'P-NATIVE',role:'player',account_id:'verified-account',space_id:'space-002'}];responses.entry={spaces:[{id:'space-002',slug:'star',streamerId:'r2',streamerSlug:'lina',streamerCount:1}],total:1,hasMore:false}");
 const r=await s.request({op:'spaceEntry',token:'device:verified',slug:'star',streamer:'papa',role:'president',chosen_streamer:'papa',accountId:'forged',limit:10000,offset:-1});
 assert.equal(r.status,200);assert.equal(r.data.spaces[0].id,'space-002');
 const call=s.calls().at(-1);assert.equal(call.path,'/rest/v1/rpc/papa_account_space_entry');assert.deepEqual(call.body,{subject:'verified-account',actor_role:'player',chosen_streamer:'papa',requested_slug:'star',requested_hostname:null,page_limit:100,page_offset:0});assert.equal(s.calls()[0].body.requested_room,null);
 assert.equal(s.calls().some(c=>c.path.includes('papa_v2_snapshot')),false);
 const count=s.calls().length;const bad=await s.request({op:'spaceEntry',token:'device:verified',hostname:'../invalid'});assert.equal(bad.status,400);assert.equal(s.calls().length,count+1,'only identity verification happens for invalid URL');
 s.set("calls=[];sessionRows=[{player_id:'__streamer__:michelle',role:'streamer_admin',streamer_id:'michelle',account_id:'verified-manager'}]");
 const manager=await s.request({op:'spaceEntry',token:'device:manager',streamer:'forged-room',role:'president'});
 assert.equal(manager.status,200);assert.equal(s.calls().at(-1).body.chosen_streamer,'michelle');assert.equal(s.calls().at(-1).body.actor_role,'streamer_admin');
});

test('root login directory stays in Space 001 and exposes only public room identity fields',async()=>{
 const s=server();s.set("const entryApi=api;api=async(path,body)=>{if(path.endsWith('papa_streamer_directory_in_space')){calls.push({path,body});return [{id:'papa',slug:'papa',display_name:'怕怕',settings:{private:'hidden'},spaceId:'space-001',password:'hidden'}];}return entryApi(path,body)}");
 const r=await s.request({op:'entryLegacyRooms',streamer:'foreign-room',spaceId:'space-002',accountId:'forged'});
 assert.equal(r.status,200);assert.deepEqual(r.data,{rooms:[{id:'papa',slug:'papa',display_name:'怕怕'}]});assert.equal(s.calls().length,1);assert.deepEqual(s.calls()[0].body,{chosen_space:'space-001'});
});

test('device Space preference reads require refresh credential and invalid switch input never reaches the DB',async()=>{
 const s=server(),sessionId='11111111-1111-4111-8111-111111111111';
 for(const body of [{sessionId,slug:'other'},{sessionId,refreshToken:'refresh:ok',slug:'../../other'},{sessionId,refreshToken:'refresh:ok',slug:'other',streamer:[]},{sessionId,refreshToken:'refresh:'+ 'x'.repeat(201),slug:'other'}]){
  assert.equal((await s.request({op:'deviceSwitchSpace',...body})).status,400);assert.equal(s.calls().length,0);
 }
 s.set("responses.devicePreferences={homeSpace:null,lastSpace:{id:'space-002',slug:'other',name:'Other'}}");
 const prefs=await s.request({op:'deviceSpacePreferences',sessionId,refreshToken:'refresh:ok',token:'device:irrelevant',accountId:'forged'});
 assert.equal(prefs.status,200);assert.equal(prefs.data.homeSpace,null);assert.equal(prefs.data.lastSpace.id,'space-002');assert.equal(s.calls().length,1);assert.equal(s.calls()[0].path,'/rest/v1/rpc/papa_read_device_space_preferences');
 s.set('responses.deviceSwitch=null');const expired=await s.request({op:'deviceSwitchSpace',sessionId,refreshToken:'refresh:old',slug:'other'});
 assert.equal(expired.status,400);assert.equal(expired.data.refreshToken,undefined);assert.match(expired.data.error,/到期/);
 s.set(`responses.deviceRefresh=${JSON.stringify({sessionId,role:'player',spaceId:'space-002',playerId:'P-NATIVE',homeSpace:null,lastSpace:{id:'space-002',slug:'other',name:'Other'}})}`);
 const restored=await s.request({op:'deviceRefresh',sessionId,refreshToken:'refresh:ok'});
 assert.equal(restored.status,200);assert.equal(restored.data.homeSpace,null);assert.equal(restored.data.lastSpace.id,'space-002');assert.equal(s.calls().at(-1).path,'/rest/v1/rpc/papa_refresh_device_access');
});
test('streamer login resolves its room server-side and cannot elevate itself',async()=>{
 const s=server(),r=await s.request({op:'streamerLogin',password:'own-password',streamer:'papa',role:'super_admin',streamerId:'other'});
 assert.equal(r.status,200);assert.equal(r.data.role,'streamer_admin');assert.equal(r.data.streamerId,'papa');assert.match(r.data.token,/^streamer:/);
 const call=s.calls().find(x=>x.path.endsWith('papa_manager_login'));assert.equal(call.body.kind,'streamer');assert.equal(call.body.room,'papa');
 assert.equal(s.calls().find(x=>x.path.endsWith('papa_bind_verified_legacy_session')).body.session_hash,call.body.session_hash);
 s.set('allowed=false');const denied=await s.request({op:'streamerLogin',password:'president-password',streamer:'papa'});assert.equal(denied.status,400);assert.equal(denied.data.token,undefined);
});
test('player password login binds the verified legacy player, never a caller-selected account',async()=>{
 const s=server();s.set("load=async()=>({players:[{playerId:'P1',password:'pw',ids:['login-1']}],streamers:[{id:'papa'}]})");
 const r=await s.request({op:'login',playerId:'P1',password:'pw',loginId:'login-1',accountId:'attacker',spaceId:'other'});
 assert.equal(r.status,200,JSON.stringify(r.data));assert.match(r.data.token,/^player:/);
 const stored=s.calls().find(x=>x.path==='/rest/v1/papa_v2_sessions');
 const bound=s.calls().find(x=>x.path.endsWith('papa_bind_verified_legacy_session'));
 assert.equal(stored.body.player_id,'P1');assert.equal(stored.body.account_id,undefined);
 assert.equal(bound.body.session_hash,stored.body.token_hash);
 assert.equal(JSON.stringify(s.calls()).includes('attacker'),false);
});
test('manager password changes require an active manager session and bind role and room to that session',async()=>{
 const s=server();
 let r=await s.request({op:'changeManagerPassword',currentPassword:'current',newPassword:'new-password'});assert.equal(r.status,400);assert.equal(s.calls().length,0);
 s.set("sessionRows=[{player_id:'P1',login_id:'1',role:'player'}]");r=await s.request({op:'changeManagerPassword',token:'player:test',currentPassword:'current',newPassword:'new-password'});assert.equal(r.status,400);assert.equal(s.calls().some(x=>x.path.endsWith('papa_change_manager_password')),false);
 s.set("calls=[];sessionRows=[{player_id:'__streamer__:papa',role:'streamer_admin',streamer_id:'papa'}]");
 r=await s.request({op:'changeManagerPassword',token:'streamer:test',streamer:'other',kind:'president',currentPassword:'current',newPassword:'new-password'});
 assert.equal(r.status,400);assert.equal(s.calls().some(x=>x.path.endsWith('papa_change_manager_password')),false);
 s.set('calls=[]');
 r=await s.request({op:'changeManagerPassword',token:'streamer:test',streamer:'papa',kind:'president',currentPassword:'current',newPassword:'new-password'});
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
test('ordinary player token cannot complete a queue item or adjust another player’s saved songs',async()=>{
 const s=server();s.set("sessionRows=[{player_id:'P1',role:'player',login_id:'one'}]");
 for(const action of [{type:'queue',data:{id:'q1',operation:'complete'}},
  {type:'ledger',data:{playerId:'P2',amount:2}}]){
  const r=await s.request({op:'mutate',token:'player:test',streamer:'papa',action,revision:0});
  assert.equal(r.status,400,JSON.stringify(r.data));
  assert.match(r.data.error,/登入管理/);
 }
 assert.equal(s.calls().some(x=>x.path.includes('papa_release_b_commit')),false);
});
test('a Space 002 player cannot fall through to the default Space 001 room',async()=>{
 const s=server();s.set("sessionRows=[{player_id:'P2',role:'player',space_id:'space-002'}]");
 const denied=await s.request({op:'changeManagerPassword',token:'player:other',currentPassword:'a',newPassword:'b'});
 assert.equal(denied.status,400);
 const check=s.calls().find(x=>x.path.endsWith('papa_verified_session_actor'));
 assert.equal(check.body.requested_room,'papa');
 assert.equal(s.calls().some(x=>x.path.endsWith('papa_change_manager_password')),false);
 s.set('calls=[]');
 const pending=await s.request({op:'read',token:'player:other',streamer:'other'});
 assert.equal(pending.status,400);
 assert.match(pending.data.error,/尚未開放/);
 assert.equal(s.calls().some(x=>x.path.includes('papa_v2_snapshot')),false,
  'the legacy full snapshot is never loaded for a second Space');
});
test('device lifecycle binds verified identity and rotates tokens without trusting client role',async()=>{
 const s=server(),account='11111111-1111-1111-1111-111111111111';
 s.set(`sessionRows=[{player_id:'P1',role:'player',login_id:'platform-login',account_id:'${account}'}]`);
 const start=await s.request({op:'deviceStart',token:'player:test',installationId:'22222222-2222-2222-2222-222222222222',
  platform:'web',appVersion:'1.0',role:'president',spaceId:'space-evil'});
 assert.equal(start.status,200,JSON.stringify(start.data));
 assert.match(start.data.refreshToken,/^refresh:/);
 const call=s.calls().find(x=>x.path.endsWith('papa_start_device_session'));
 assert.equal(call.body.subject,account);assert.equal(call.body.chosen_role,'player');
 assert.equal(call.body.chosen_space,'space-001');
 assert.equal(call.body.chosen_login_id,'platform-login');
 assert.equal(call.body.new_refresh_hash.length,64);
 const refreshed=await s.request({op:'deviceRefresh',sessionId:start.data.sessionId,refreshToken:start.data.refreshToken});
 assert.equal(refreshed.status,200,JSON.stringify(refreshed.data));
 assert.match(refreshed.data.token,/^device:/);assert.match(refreshed.data.refreshToken,/^refresh:/);
 assert.notEqual(refreshed.data.refreshToken,start.data.refreshToken);
 assert.equal((await vm.runInContext("actor('device:verified')",s.c)).role,'player');
 const logout=await s.request({op:'deviceLogout',sessionId:start.data.sessionId,refreshToken:refreshed.data.refreshToken});
 assert.deepEqual(logout.data,{ok:true});
 const second=server();second.set('responses.deviceRefresh=null');
 const expired=await second.request({op:'deviceRefresh',sessionId:start.data.sessionId,refreshToken:start.data.refreshToken});
 assert.equal(expired.status,400);assert.equal(expired.data.token,undefined);
});
test('logout does not load the business snapshot and durable devices require device logout',async()=>{
 const s=server();s.set("sessionRows=[{player_id:'P1',role:'player'}]");
 const legacy=await s.request({op:'logout',token:'player:session'});
 assert.equal(legacy.status,200);
 assert.equal(s.calls().some(x=>x.path.includes('papa_v2_snapshot')),false);
 s.set('calls=[]');
 const durable=await s.request({op:'logout',token:'device:session'});
 assert.equal(durable.status,400);
 assert.match(durable.data.error,/裝置登出/);
 assert.equal(s.calls().some(x=>x.path.includes('papa_v2_sessions?')),false);
});
