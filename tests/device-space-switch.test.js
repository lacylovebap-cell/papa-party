import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const hash=n=>n.toString(16).padStart(64,'0');
const nativeSpace='space-switch-test',nativeSlug='switch-test',nativeRoom='switch-room';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(statement,args=[])=>(await db.query(statement,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);');
 const base=sql('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql',
  '202609250001_roles_and_notification_scope.sql','202609280001_manager_passwords.sql'])await db.exec(sql(name));
 await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',['meta','1',{
  streamers:[{id:'papa',slug:'papa',display_name:'Legacy room',active:true}],streamerSettings:{papa:{private:'legacy-private-settings'}},migrationIssues:['legacy-private-issues']}]);
 await q("insert into papa_v2_entities(kind,id,data) values('players','P1',$1)",[{playerId:'P1',name:'Legacy private player',ids:['legacy-login'],password:'legacy-private-password'}]);
 await q("insert into papa_streamer_accounts(streamer_id,password_hash,enabled) values('papa','verified-fixture',true)");
 await q("insert into papa_president_accounts(account_key,password_hash) values('president:legacy','verified-fixture')");
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql',
  '202610070003_verified_identity_binding.sql','202610070005_device_push_contract.sql',
  '202610070006_device_access_lifecycle.sql','202610070009_scoped_read_snapshot.sql',
  '202610070010_web_device_push_bridge.sql'])await db.exec(sql(name));
 const directory=sql('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 await db.exec(sql('202610070013_space_player_profiles.sql'));await db.exec(sql('202610070014_device_space_identity.sql'));
 await db.exec(sql('202610090001_device_space_switch.sql'));
 await q("insert into papa_spaces(id,slug,display_name) values($1,$2,'Native switch space'),('space-switch-empty','switch-empty','Empty native space')",[nativeSpace,nativeSlug]);
 await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[nativeRoom,nativeSpace]);
 const meta=(await q("select data from papa_v2_entities where kind='meta'"))[0].data;
 meta.streamers.push({id:nativeRoom,slug:'native-room-slug',display_name:'Native room',active:true});
 await q("update papa_v2_entities set data=$1 where kind='meta'",[meta]);
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const player=await account(),other=await account(),manager=await account(),president=await account();
 await q("insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,'P1')",[player]);
 const member=async(subject,space,role='player',streamer=null)=>(await q('insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,$3,$4) returning id',[subject,space,role,streamer]))[0].id;
 const legacyMember=await member(player,'space-001'),nativeMember=await member(player,nativeSpace),otherMember=await member(other,nativeSpace);
 await member(player,'space-switch-empty');await member(manager,'space-001','streamer_admin','papa');
 for(const [id,subject,membership] of [['P-NATIVE',player,nativeMember],['P1',other,otherMember]])
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
   [nativeSpace,id,subject,membership,{playerId:id,name:'Native private '+id,ids:['native-login'],note:'native-private-profile'}]);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('streamer:papa',$1),('president',$2)",[manager,president]);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 const install=crypto.randomUUID();
 const start=async(subject=player,role='player',space='space-001',streamer=null,refresh=1,installation=install)=>rpc('papa_start_device_session',
  [subject,installation,'web','switch-qa',role,space,streamer,hash(refresh),role==='player'?'legacy-login':'']);
 const refresh=(id,old,next,access)=>rpc('papa_refresh_device_access',[id,old===null?null:hash(old),next===null?null:hash(next),access===null?null:hash(access)]);
 const old=await start();await refresh(old.sessionId,1,2,3);
 await q('insert into papa_push_subscriptions(streamer_id,recipient,endpoint,subscription,session_hash,device_session_id) values($1,$2,$3,$4,$5,$6)',
  ['papa','P1','https://push.test/device-switch',{},hash(3),old.sessionId]);
 await q('insert into papa_device_push_registrations(device_session_id,transport,destination,credentials) values($1,$2,$3,$4)',
  [old.sessionId,'web_push','https://push.test/native-registration',{p256dh:'fixture-key',auth:'fixture-auth'}]);
 const switchSpace=(session=old.sessionId,current=2,slug=nativeSlug,room=nativeRoom,next=10)=>rpc('papa_switch_device_space',
  [session,current===null?null:hash(current),slug,room,next===null?null:hash(next)]);
 const preferences=(session,current)=>rpc('papa_read_device_space_preferences',[session,current===null?null:hash(current)]);
 const stable=async()=>({sessions:await q('select * from papa_device_sessions order by id'),installations:await q('select * from papa_installations order by id'),
  access:await q('select * from papa_v2_sessions order by token_hash'),preferences:await q('select * from papa_device_space_preferences order by account_id,installation_id,session_kind'),
  push:await q('select * from papa_push_subscriptions order by id'),registrations:await q('select * from papa_device_push_registrations order by id')});
 return {db,q,rpc,player,other,manager,president,legacyMember,nativeMember,install,old,start,refresh,switchSpace,preferences,stable};
}

test('Space switch issues a new immutable account-bound session and revokes old access/push through original start guards',async t=>{
 const {q,rpc,player,old,refresh,switchSpace,preferences}=await fixture(t);
 const business=await q('select kind,id,data,space_id from papa_v2_entities order by kind,id');
 const profiles=await q('select * from papa_space_player_profiles order by space_id,player_id');
 const switched=await switchSpace();
 assert.notEqual(switched.sessionId,old.sessionId);assert.equal(switched.role,'player');assert.equal(switched.kind,'player');
 assert.equal(switched.spaceId,nativeSpace);assert.equal(switched.playerId,'P-NATIVE','another Account using legacy P1 in native Space is not selected');
 assert.equal(switched.spaceSlug,nativeSlug);assert.equal(switched.selectedSpace.id,nativeSpace);assert.equal(switched.selectedStreamerId,nativeRoom);assert.equal(switched.streamerId,null,'player device scope never becomes streamer scope');
 assert.equal(switched.homeSpace.id,'space-001');assert.equal(switched.lastSpace.id,nativeSpace);
 const prior=(await q('select * from papa_device_sessions where id=$1',[old.sessionId]))[0];
 assert.equal(prior.space_id,'space-001');assert.equal(prior.account_id,player);assert.equal(prior.refresh_hash,hash(2));assert.ok(prior.revoked_at);
 assert.equal(await rpc('papa_verified_session_actor',[hash(3),'papa']),null);
 assert.equal(await rpc('papa_device_push_recipient',[old.sessionId,'papa','P1']),false);
 assert.equal((await q('select count(*)::int n from papa_push_subscriptions where device_session_id=$1',[old.sessionId]))[0].n,0);
 assert.equal(await preferences(old.sessionId,2),null);assert.equal(await switchSpace(old.sessionId,2,nativeSlug,null,11),null);
 assert.equal(await refresh(old.sessionId,2,12,13),null);
 const refreshed=await refresh(switched.sessionId,10,14,15);
 assert.equal(refreshed.playerId,'P-NATIVE');assert.equal(refreshed.loginId,'');assert.equal(refreshed.homeSpace.id,'space-001');assert.equal(refreshed.lastSpace.id,nativeSpace);
 assert.equal(refreshed.selectedSpace.streamerId,nativeRoom);assert.equal(refreshed.spaceSlug,nativeSlug);
 const actor=await rpc('papa_verified_session_actor',[hash(15),nativeRoom]);assert.equal(actor.accountId,player);assert.equal(actor.playerId,'P-NATIVE');
 assert.equal(await rpc('papa_verified_session_actor',[hash(15),'papa']),null);
 assert.equal(await rpc('papa_device_push_recipient',[switched.sessionId,nativeRoom,'P-NATIVE']),true);
 assert.equal(await rpc('papa_device_push_recipient',[switched.sessionId,nativeRoom,'P1']),false);
 await assert.rejects(q('update papa_device_sessions set space_id=$1 where id=$2',['space-001',switched.sessionId]),/SESSION_SCOPE_IMMUTABLE/);
 const back=await switchSpace(switched.sessionId,14,'papa-party',null,16);
 assert.equal(back.playerId,'P1');assert.equal(back.spaceId,'space-001');assert.equal(back.homeSpace.id,'space-001');assert.equal(back.lastSpace.id,'space-001');
 assert.deepEqual(await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),business);
 assert.deepEqual(await q('select * from papa_space_player_profiles order by space_id,player_id'),profiles);
});

test('switch credentials, target identities and suspended scopes deny atomically without fallback or borrowed-installation authority',async t=>{
 const {db,q,rpc,player,other,old,start,nativeMember,legacyMember,switchSpace,preferences,stable}=await fixture(t);
 let baseline=await stable();
 const reject=async(action,pattern=/INVALID|REQUIRED/)=>{await assert.rejects(action(),pattern);assert.deepEqual(await stable(),baseline);};
 for(const slug of [null,'','missing-space'])await reject(()=>switchSpace(old.sessionId,2,slug,null,10));
 for(const room of ['','missing-room','papa'])await reject(()=>switchSpace(old.sessionId,2,nativeSlug,room,10));
 await reject(()=>switchSpace(old.sessionId,null,nativeSlug,null,10));await reject(()=>switchSpace(old.sessionId,2,nativeSlug,null,null));
 await reject(()=>switchSpace(old.sessionId,2,nativeSlug,null,2));
 await reject(()=>rpc('papa_switch_device_space',[old.sessionId,'bad',nativeSlug,null,hash(10)]));
 assert.equal(await switchSpace(old.sessionId,99,nativeSlug,null,10),null);assert.deepEqual(await stable(),baseline);
 assert.equal(await preferences(old.sessionId,null),null);assert.equal(await preferences(old.sessionId,99),null);
 await reject(()=>switchSpace(old.sessionId,2,'switch-empty',null,10));
 await reject(()=>start(other,'player',nativeSpace,null,10),/INSTALLATION_ACCOUNT_CONFLICT/);
 await q("update papa_space_memberships set status='suspended' where id=$1",[nativeMember]);baseline=await stable();
 await reject(()=>switchSpace());assert.equal(await preferences(old.sessionId,2).then(value=>value.lastSpace),null);
 await q("update papa_space_memberships set status='active' where id=$1",[nativeMember]);
 await q("update papa_spaces set status='suspended' where id=$1",[nativeSpace]);baseline=await stable();await reject(()=>switchSpace());
 await q("update papa_spaces set status='active' where id=$1",[nativeSpace]);
 await q('update papa_accounts set disabled_at=now() where id=$1',[player]);baseline=await stable();await reject(()=>switchSpace());assert.equal(await preferences(old.sessionId,2),null);
 await q('update papa_accounts set disabled_at=null where id=$1',[player]);
 await q("update papa_space_memberships set status='suspended' where id=$1",[legacyMember]);baseline=await stable();await reject(()=>switchSpace());assert.equal(await preferences(old.sessionId,2),null);
 await q("update papa_space_memberships set status='active' where id=$1",[legacyMember]);
 await db.exec('set role anon');await assert.rejects(switchSpace(),/permission denied/);await assert.rejects(preferences(old.sessionId,2),/permission denied/);
 await assert.rejects(q('select * from papa_device_space_preferences'),/permission denied/);await db.exec('reset role');
});

test('null refresh/logout credentials fail closed and competing refresh/switch calls preserve one original installation slot',async t=>{
 const {q,rpc,old,refresh,switchSpace,stable}=await fixture(t);
 const before=await stable();
 for(const args of [[old.sessionId,null,hash(10)],[old.sessionId,hash(2),null]])
  await assert.rejects(rpc('papa_rotate_device_session',args),/INVALID_REFRESH_HASH/);
 await assert.rejects(refresh(old.sessionId,null,10,11),/INVALID_REFRESH_HASH/);
 await assert.rejects(refresh(old.sessionId,2,10,null),/ACCESS_HASH_INVALID/);
 assert.equal(await rpc('papa_revoke_device_with_refresh',[old.sessionId,null]),false);
 assert.equal(await rpc('papa_revoke_device_with_refresh',[old.sessionId,hash(99)]),false);
 assert.equal(await refresh(old.sessionId,99,10,11),null);assert.deepEqual(await stable(),before);
 const results=await Promise.all([switchSpace(old.sessionId,2,nativeSlug,null,10),switchSpace(old.sessionId,2,nativeSlug,null,11)]);
 assert.equal(results.filter(Boolean).length,1);assert.equal((await q("select count(*)::int n from papa_device_sessions where installation_id=$1 and session_kind='player' and revoked_at is null",[old.installationId]))[0].n,1);
 const winner=results.find(Boolean),credential=results[0]?10:11;
 const raced=await Promise.all([refresh(winner.sessionId,credential,12,13),switchSpace(winner.sessionId,credential,'papa-party',null,14)]);
 assert.equal(raced.filter(Boolean).length,1,'a credential can be consumed by refresh or switch only once');
 assert.equal((await q("select count(*)::int n from papa_device_sessions where installation_id=$1 and session_kind='player' and revoked_at is null",[old.installationId]))[0].n,1);
});

test('a real delegated registration failure rolls back old revocation, access/push routes and preferences',async t=>{
 const {q,other,old,start,switchSpace,stable}=await fixture(t);
 await start(other,'player',nativeSpace,null,10,crypto.randomUUID());
 const before=await stable();
 await assert.rejects(switchSpace(old.sessionId,2,nativeSlug,null,10),/unique constraint/);
 assert.deepEqual(await stable(),before);
 assert.equal((await q('select revoked_at from papa_device_sessions where id=$1',[old.sessionId]))[0].revoked_at,null);
 assert.equal((await q('select count(*)::int n from papa_v2_sessions where device_session_id=$1',[old.sessionId]))[0].n,1);
 assert.equal((await q('select count(*)::int n from papa_push_subscriptions where device_session_id=$1',[old.sessionId]))[0].n,1);
});

test('role-bound home/last metadata is revalidated and president selection never scopes a global device',async t=>{
 const {q,rpc,player,manager,president,nativeMember,old,start,refresh,switchSpace,preferences}=await fixture(t);
 const nativeInstall=crypto.randomUUID(),native=await start(player,'player',nativeSpace,null,20,nativeInstall);
 const legacy=await switchSpace(native.sessionId,20,'papa-party',null,21);
 assert.equal(legacy.homeSpace.id,nativeSpace);assert.equal(legacy.lastSpace.id,'space-001');
 await q("update papa_space_memberships set status='suspended' where id=$1",[nativeMember]);
 const filtered=await preferences(legacy.sessionId,21);assert.equal(filtered.homeSpace,null);assert.equal(filtered.lastSpace.id,'space-001');
 await q("update papa_space_memberships set status='active' where id=$1",[nativeMember]);
 const admin=await start(manager,'streamer_admin','space-001','papa',22);
 await assert.rejects(switchSpace(admin.sessionId,22,nativeSlug,nativeRoom,23),/ROOM_INVALID/);
 const sameRoom=await switchSpace(admin.sessionId,22,'papa-party','papa',23);
 assert.equal(sameRoom.role,'streamer_admin');assert.equal(sameRoom.streamerId,'papa');assert.equal(sameRoom.spaceId,'space-001');
 assert.equal((await q('select revoked_at from papa_device_sessions where id=$1',[old.sessionId]))[0].revoked_at,null,'manager switching leaves the independent player slot active');
 const global=await start(president,'president',null,null,24,crypto.randomUUID());
 const selected=await switchSpace(global.sessionId,24,nativeSlug,nativeRoom,25);
 assert.equal(selected.role,'president');assert.equal(selected.spaceId,null);assert.equal(selected.streamerId,null);assert.equal(selected.playerId,null);assert.equal(selected.selectedSpace.id,nativeSpace);
 const access=await refresh(selected.sessionId,25,26,27);
 assert.equal(access.spaceId,null);assert.equal(access.selectedSpace.id,nativeSpace);assert.equal(access.lastSpace.id,nativeSpace);
 const actor=await rpc('papa_verified_session_actor',[hash(27),'papa']);assert.equal(actor.role,'super_admin');assert.equal(actor.spaceId,null);
 const stored=(await q('select * from papa_device_space_preferences where account_id=$1',[president]))[0];
 assert.equal(stored.last_space_id,nativeSpace);assert.equal(JSON.stringify(stored).includes('private'),false);
 await q("delete from papa_platform_roles where account_id=$1",[president]);
 assert.equal(await preferences(selected.sessionId,26),null);await assert.rejects(switchSpace(selected.sessionId,26,'papa-party',null,28),/IDENTITY_INVALID/);
});
