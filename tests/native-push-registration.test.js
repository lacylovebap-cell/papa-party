import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const migration='202610170002_native_push_registration.sql';
const hash=n=>n.toString(16).padStart(64,'0');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(statement,args=[])=>(await db.query(statement,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args))[0].value;
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);');
 const base=sql('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql',
  '202609250001_roles_and_notification_scope.sql','202609280001_manager_passwords.sql'])await db.exec(sql(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1)",[{streamers:[
  {id:'papa',slug:'papa',active:true},{id:'michelle',slug:'michelle',active:true}]}]);
 for(const id of ['P1','P2'])await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,{playerId:id,name:id,ids:[id+'-login']}]);
 await q("insert into papa_streamer_accounts(streamer_id,password_hash,enabled) values('papa','fixture',true),('michelle','fixture',true)");
 await q("insert into papa_president_accounts(account_key,password_hash) values('president:legacy','fixture')");
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql',
  '202610070003_verified_identity_binding.sql','202610070005_device_push_contract.sql',
  '202610070006_device_access_lifecycle.sql','202610070009_scoped_read_snapshot.sql',
  '202610070010_web_device_push_bridge.sql'])await db.exec(sql(name));
 const directory=sql('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 for(const name of ['202610070013_space_player_profiles.sql','202610070014_device_space_identity.sql',
  '202610090001_device_space_switch.sql'])await db.exec(sql(name));
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const player=await account(),other=await account(),manager=await account(),president=await account();
 await q("insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,'P1'),($2,'P2')",[player,other]);
 const member=async(subject,space='space-001',role='player',room=null)=>(await q(
  'insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,$3,$4) returning id',
  [subject,space,role,room]))[0].id;
 const playerMember=await member(player);await member(other);const managerMember=await member(manager,'space-001','streamer_admin','papa');
 await q("insert into papa_manager_account_links(manager_key,account_id) values('streamer:papa',$1),('president',$2)",[manager,president]);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_spaces(id,slug,display_name) values('space-native-test','native-test','Native test')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('native-room','space-native-test')");
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 meta.streamers.push({id:'native-room',slug:'native-room',active:true});
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const nativeMember=await member(player,'space-native-test');
 await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
  ['space-native-test','P-NATIVE',player,nativeMember,{playerId:'P-NATIVE',name:'Native test'}]);
 let serial=10;
 const start=async({subject=player,platform='android',role='player',space='space-001',room=null,installation=crypto.randomUUID()}={})=>{
  const refresh=++serial,identity=await rpc('papa_start_device_session',[
   subject,installation,platform,'native-push-test',role,space,room,hash(refresh),'']);
  return {...identity,subject,refresh};
 };
 const register=(device,destination='fixture-native-token-A',permission='granted',transport='fcm')=>rpc('papa_register_native_push',
  [device.subject,device.sessionId,transport,destination,permission]);
 const disable=(device,id,transport='fcm')=>rpc('papa_disable_native_push',[device.subject,device.sessionId,id,transport]);
 const rows=()=>q('select * from papa_device_push_registrations order by id');
 const unchangedData=async()=>({business:await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),
  notifications:await q('select * from papa_notifications order by id'),events:await q('select * from papa_events order by id'),
  web:await q('select * from papa_push_subscriptions order by id'),jobs:await q('select * from papa_push_jobs order by id'),
  deliveries:await q('select * from papa_device_notification_deliveries order by id')});
 const before=await unchangedData();await db.exec(sql(migration));assert.deepEqual(await unchangedData(),before);
 return {db,q,rpc,player,other,manager,president,playerMember,managerMember,nativeMember,start,register,disable,rows,unchangedData};
}

function publicResult(result,id,permission,enabled,changed){
 assert.deepEqual(result,{registrationId:id,permission,enabled,changed});
 assert.deepEqual(Object.keys(result).sort(),['changed','enabled','permission','registrationId']);
 assert.doesNotMatch(JSON.stringify(result),/fixture-native|refresh|destination|credentials|accountId|sessionId/);
}

test('native registration reuses the existing binding, rotates atomically and disables only the selected device',async t=>{
 const f=await fixture(t),{db,q,start,register,disable,rows}=f;
 const before=await f.unchangedData(),android=await start(),second=await start(),desktop=await start({platform:'desktop'});
 const first=await register(android),id=first.registrationId;
 publicResult(first,id,'granted',true,true);
 const initial=(await rows()).find(row=>row.id===id);
 assert.deepEqual(initial.credentials,{});assert.equal(initial.device_session_id,android.sessionId);
 await t.test('same-value repeated calls have no row writes or duplicate binding',async()=>{
  const repeated=await Promise.all(Array.from({length:12},()=>register(android)));
  for(const result of repeated)publicResult(result,id,'granted',true,false);
  assert.deepEqual((await rows()).find(row=>row.id===id),initial);
  assert.equal((await rows()).length,1);
 });
 await t.test('token rotation retains registration id and original creation time',async()=>{
  publicResult(await register(android,'fixture-native-token-B'),id,'granted',true,true);
  const rotated=(await rows()).find(row=>row.id===id);
  assert.equal(rotated.destination,'fixture-native-token-B');assert.deepEqual(rotated.created_at,initial.created_at);
  assert.equal((await rows()).length,1);
 });
 await t.test('permission changes disable and re-enable the same binding without a second notification stream',async()=>{
  for(const permission of ['prompt','denied','unsupported']){
   publicResult(await register(android,'fixture-native-token-B',permission),id,permission,false,true);
   const saved=(await rows()).find(row=>row.id===id);
   assert.equal(saved.enabled,false);assert.equal(saved.permission_state,permission);
   publicResult(await register(android,'fixture-native-token-B',permission),id,permission,false,false);
  }
  publicResult(await register(android,'fixture-native-token-B'),id,'granted',true,true);
 });
 const secondResult=await register(second,'fixture-native-token-second');
 const desktopResult=await register(desktop,'fixture-desktop-token','granted','desktop_os');
 await t.test('precise disable is idempotent and preserves other installations and transport bindings',async()=>{
  const others=(await rows()).filter(row=>row.id!==id);
  publicResult(await disable(android,id),id,'granted',false,true);
  const disabled=(await rows()).find(row=>row.id===id);
  publicResult(await disable(android,id),id,'granted',false,false);
  assert.deepEqual((await rows()).find(row=>row.id===id),disabled);
  assert.deepEqual((await rows()).filter(row=>row.id!==id),others);
  assert.equal(others.length,2);
  await assert.rejects(disable(android,secondResult.registrationId),/BINDING_MISMATCH/);
  await assert.rejects(disable(android,desktopResult.registrationId),/BINDING_MISMATCH/);
  publicResult(await register(android,'fixture-native-token-B'),id,'granted',true,true);
 });
 await t.test('a real failing update trigger rolls back token, permissions and metadata together',async()=>{
  const stable=await rows();
  await db.exec(`create function native_push_fixture_fail() returns trigger language plpgsql as $$
   begin raise exception 'FIXTURE_NATIVE_WRITE_FAILED';end $$;
   create trigger native_push_fixture_fail after update on papa_device_push_registrations
   for each row execute function native_push_fixture_fail();`);
  await assert.rejects(register(android,'fixture-native-token-failing','denied'),/FIXTURE_NATIVE_WRITE_FAILED/);
  assert.deepEqual(await rows(),stable);
  await db.exec('drop trigger native_push_fixture_fail on papa_device_push_registrations;drop function native_push_fixture_fail();');
 });
 assert.deepEqual(await f.unchangedData(),before,'registration must not write business, Audit, Web push, jobs or device deliveries');
 assert.equal((await q('select count(*)::int n from papa_device_push_registrations'))[0].n,3);
});

test('native registration validates platform and opaque input without leaking destinations',async t=>{
 const {start,register,disable,rpc,rows,manager,president}=await fixture(t);
 const android=await start(),desktop=await start({platform:'desktop'}),web=await start({platform:'web'}),ios=await start({platform:'ios'});
 await t.test('Android FCM and desktop OS registrations accept verified player, manager and president actors',async()=>{
  for(const [device,transport] of [[android,'fcm'],[desktop,'desktop_os'],
   [await start({subject:manager,role:'streamer_admin',room:'papa'}),'fcm'],
   [await start({subject:president,platform:'desktop',role:'president',space:null}),'desktop_os']]){
   const result=await register(device,'fixture-native-'+device.sessionId,'granted',transport);
   publicResult(result,result.registrationId,'granted',true,true);
  }
 });
 await t.test('wrong OS, unsupported transport, null selector and invalid opaque token fail without writes',async()=>{
  const baseline=await rows();
  for(const [device,transport] of [[android,'desktop_os'],[desktop,'fcm'],[web,'fcm'],[ios,'fcm']])
   await assert.rejects(register(device,'fixture-native-invalid','granted',transport),/PLATFORM_MISMATCH/);
  for(const transport of [null,'web_push','apns','desktop',''])
   await assert.rejects(register(android,'fixture-native-invalid','granted',transport),/ACTOR_INVALID/);
  for(const destination of [null,'','short',' padded-token','padded-token ','fixture\ntoken','fixture\ttoken','fixture\u0000token','t'.repeat(4097)]){
   await assert.rejects(register(android,destination),error=>{
    assert.match(error.message,/REGISTRATION_INVALID|invalid byte sequence/);
    assert.doesNotMatch(error.message,/padded-token|fixture|t{30}/);return true;
   });
  }
  for(const permission of [null,'','allowed','true'])await assert.rejects(register(android,'fixture-native-valid',permission),/REGISTRATION_INVALID/);
  await assert.rejects(rpc('papa_register_native_push',[null,android.sessionId,'fcm','fixture-native-valid','granted']),/ACTOR_INVALID/);
  await assert.rejects(rpc('papa_register_native_push',[android.subject,null,'fcm','fixture-native-valid','granted']),/ACTOR_INVALID/);
  await assert.rejects(disable(android,null),/BINDING_INVALID/);
  assert.deepEqual(await rows(),baseline);
 });
});

test('native registration rechecks current Account, membership, room, role and session authority',async t=>{
 const f=await fixture(t),{q,rpc,start,register,disable,rows,player,other,manager,president,playerMember,managerMember}=f;
 const checks=[
  ['revoked session',{},async d=>q('update papa_device_sessions set revoked_at=clock_timestamp() where id=$1',[d.sessionId]),null,/SESSION_INACTIVE/],
  ['expired session',{},async d=>q("update papa_device_sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1",[d.sessionId]),null,/SESSION_INACTIVE/],
  ['disabled Account',{},async()=>q('update papa_accounts set disabled_at=clock_timestamp() where id=$1',[player]),async()=>q('update papa_accounts set disabled_at=null where id=$1',[player]),/SCOPE_INACTIVE/],
  ['suspended Membership',{},async()=>q("update papa_space_memberships set status='suspended' where id=$1",[playerMember]),async()=>q("update papa_space_memberships set status='active' where id=$1",[playerMember]),/SCOPE_INACTIVE/],
  ['removed Membership',{},async()=>q('delete from papa_space_memberships where id=$1',[playerMember]),async()=>q("insert into papa_space_memberships(id,account_id,space_id,role) values($1,$2,'space-001','player')",[playerMember,player]),/SCOPE_INACTIVE/],
  ['suspended Space',{},async()=>q("update papa_spaces set status='suspended' where id='space-001'"),async()=>q("update papa_spaces set status='active' where id='space-001'"),/SCOPE_INACTIVE/],
  ['disabled streamer',{subject:manager,role:'streamer_admin',room:'papa'},async()=>q("update papa_streamer_accounts set enabled=false where streamer_id='papa'"),async()=>q("update papa_streamer_accounts set enabled=true where streamer_id='papa'"),/SESSION_INACTIVE|SCOPE_INACTIVE/],
  ['suspended streamer Membership',{subject:manager,role:'streamer_admin',room:'papa'},async()=>q("update papa_space_memberships set status='suspended' where id=$1",[managerMember]),async()=>q("update papa_space_memberships set status='active' where id=$1",[managerMember]),/SCOPE_INACTIVE/],
  ['removed manager binding',{subject:manager,role:'streamer_admin',room:'papa'},async()=>q("delete from papa_manager_account_links where manager_key='streamer:papa'"),async()=>q("insert into papa_manager_account_links(manager_key,account_id) values('streamer:papa',$1)",[manager]),/SCOPE_INACTIVE/],
  ['removed president role',{subject:president,role:'president',space:null},async()=>q('delete from papa_platform_roles where account_id=$1',[president]),async()=>q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]),/SCOPE_INACTIVE/],
 ];
 for(const [name,options,change,restore,pattern] of checks)await t.test(name+' cannot register, rotate or disable a binding',async()=>{
  const device=await start(options),result=await register(device,'fixture-native-'+name.replaceAll(' ','-'));
  await change(device);const baseline=await rows();
  await assert.rejects(register(device,'fixture-native-replacement'),pattern);
  await assert.rejects(disable(device,result.registrationId),pattern);
  assert.deepEqual(await rows(),baseline);if(restore)await restore();
 });
 await t.test('a valid other Account or guessed session ID cannot borrow the selected device',async()=>{
  const device=await start(),result=await register(device),baseline=await rows();
  await assert.rejects(rpc('papa_register_native_push',[other,device.sessionId,'fcm','fixture-native-other','granted']),/SESSION_INACTIVE/);
  await assert.rejects(rpc('papa_disable_native_push',[other,device.sessionId,result.registrationId,'fcm']),/SESSION_INACTIVE/);
  await assert.rejects(rpc('papa_register_native_push',[player,crypto.randomUUID(),'fcm','fixture-native-guess','granted']),/SESSION_INACTIVE/);
  assert.deepEqual(await rows(),baseline);
 });
});

test('real Space switch invalidates the old immutable native binding without moving or deleting it',async t=>{
 const f=await fixture(t),{q,rpc,start,register,disable,rows}=f;
 const device=await start(),registered=await register(device),before=await f.unchangedData();
 const switched=await rpc('papa_switch_device_space',[device.sessionId,hash(device.refresh),'native-test','native-room',hash(1000)]);
 assert.notEqual(switched.sessionId,device.sessionId);assert.equal(switched.spaceId,'space-native-test');
 assert.equal((await q('select revoked_at is not null revoked from papa_device_sessions where id=$1',[device.sessionId]))[0].revoked,true);
 const old=(await rows()).find(row=>row.id===registered.registrationId);
 await assert.rejects(register(device,'fixture-native-old-context'),/SESSION_INACTIVE/);
 await assert.rejects(disable(device,registered.registrationId),/SESSION_INACTIVE/);
 const next={...switched,subject:device.subject},newResult=await register(next);
 assert.notEqual(newResult.registrationId,registered.registrationId);
 assert.deepEqual((await rows()).find(row=>row.id===registered.registrationId),old);
 await assert.rejects(disable(next,registered.registrationId),/BINDING_MISMATCH/);
 assert.deepEqual(await f.unchangedData(),before);
});

test('native registration uses wall-clock expiry and metadata inside long-running transactions',async t=>{
 const {db,q,start,register,rows}=await fixture(t);
 const expired=await start();
 await db.exec('begin');
 try{
  await q("update papa_device_sessions set expires_at=clock_timestamp()+interval '100 milliseconds' where id=$1",[expired.sessionId]);
  await pause(180);
  assert.equal((await q('select expires_at>transaction_timestamp() stale,expires_at<=clock_timestamp() expired from papa_device_sessions where id=$1',[expired.sessionId]))[0].stale,true);
  await db.exec('savepoint expired_registration');
  await assert.rejects(register(expired),/SESSION_INACTIVE/);
  await db.exec('rollback to savepoint expired_registration');
  assert.equal((await rows()).length,0);
 }finally{await db.exec('rollback');}
 const active=await start();
 await db.exec('begin');
 try{
  await pause(25);const result=await register(active),id=result.registrationId;
  const time=(await q('select created_at>transaction_timestamp() created_after_start,updated_at>transaction_timestamp() updated_after_start from papa_device_push_registrations where id=$1',[id]))[0];
  assert.deepEqual(time,{created_after_start:true,updated_after_start:true});
  const before=(await rows()).find(row=>row.id===id);await pause(15);
  publicResult(await register(active),id,'granted',true,false);assert.deepEqual((await rows()).find(row=>row.id===id),before);
  await register(active,'fixture-native-time-rotation');
  assert.equal((await q('select updated_at>$2::timestamptz newer from papa_device_push_registrations where id=$1',[id,before.updated_at]))[0].newer,true);
 }finally{await db.exec('rollback');}
 await t.test('expiry introduced during the write rolls back the entire operation at the final wall-clock check',async()=>{
  await db.exec(`create function native_push_expire_fixture() returns trigger language plpgsql as $$
   begin update papa_device_sessions set expires_at=clock_timestamp()-interval '1 second' where id=new.device_session_id;return new;end $$;
   create trigger native_push_expire_fixture after insert on papa_device_push_registrations
   for each row execute function native_push_expire_fixture();`);
  const before=(await q('select expires_at from papa_device_sessions where id=$1',[active.sessionId]))[0];
  await assert.rejects(register(active),/SESSION_INACTIVE/);assert.equal((await rows()).length,0);
  assert.deepEqual((await q('select expires_at from papa_device_sessions where id=$1',[active.sessionId]))[0],before);
 });
});

test('native registration RPCs are service-only and preserve existing RLS and no-token API shape',async t=>{
 const {db,q,rpc,start,register,disable}=await fixture(t),device=await start();
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  try{
   await assert.rejects(register(device),/permission denied/);
   await assert.rejects(disable(device,crypto.randomUUID()),/permission denied/);
   await assert.rejects(rpc('papa_require_native_push_actor',[device.subject,device.sessionId,'fcm']),/permission denied/);
   await assert.rejects(q('select * from papa_device_push_registrations'),/permission denied/);
   await assert.rejects(q('select * from papa_device_notification_deliveries'),/permission denied/);
  }finally{await db.exec('reset role');}
 }
 await db.exec('set role service_role');
 try{
  const result=await register(device);publicResult(result,result.registrationId,'granted',true,true);
  publicResult(await disable(device,result.registrationId),result.registrationId,'granted',false,true);
  await assert.rejects(rpc('papa_require_native_push_actor',[device.subject,device.sessionId,'fcm']),/permission denied/);
 }finally{await db.exec('reset role');}
 const rls=await q("select relname,relrowsecurity from pg_class where relname in ('papa_device_push_registrations','papa_device_notification_deliveries') order by relname");
 assert.equal(rls.length,2);assert.ok(rls.every(row=>row.relrowsecurity));
 const source=sql(migration);
 assert.doesNotMatch(source,/create\s+table|create\s+policy|\bcron\.|insert\s+into\s+(?:public\.)?(?:papa_notifications|papa_events|papa_device_notification_deliveries)|alter\s+table/i);
});
