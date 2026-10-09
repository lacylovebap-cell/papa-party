import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const guardMigration='202610090014_native_player_platform_ids.sql';
const space='platform-id-space',foreignSpace='platform-id-foreign',room='platform-id-room';
const at='2026-10-09T04:00:00Z';
const player=(id,data={})=>({kind:'players',id,data:{playerId:id,name:'Profile '+id,...data}});

async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql'])await db.exec(migration(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1),('settings','1','{}'),('players','LEGACY',$2)",[
  {schemaVersion:3,streamers:[{id:'papa',slug:'papa',display_name:'Legacy',active:true}],streamerSettings:{papa:{}}},
  {playerId:'LEGACY',name:'Legacy profile',ids:['foreign-id'],password:'legacy-secret',note:'legacy private note'}]);
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql','202610070003_verified_identity_binding.sql',
  '202610070004_audit_actor_snapshots.sql','202610070009_scoped_read_snapshot.sql'])await db.exec(migration(name));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 for(const name of ['202610070011_room_operational_commit.sql','202610070013_space_player_profiles.sql','202610070015_room_admin_commit.sql'])await db.exec(migration(name));
 const audit=migration('202610080012_communication_space.sql');
 for(const name of ['papa_communication_player_name','papa_native_meta_audit_projection','papa_event_actor_snapshot']){
  const start=audit.indexOf('function '+name+'('),statement=audit.lastIndexOf('create ',start);assert.ok(start>=0);
  await db.exec(audit.slice(statement,audit.indexOf('$$;',start)+3));
 }
 for(const name of ['202610080013_native_room_transactions.sql','202610090003_streamer_registry.sql',
  '202610090006_native_player_provision.sql','202610090013_native_player_eligibility.sql'])await db.exec(migration(name));
 await q('insert into papa_spaces(id,slug,display_name) values($1,$1,$1),($2,$2,$2)',[space,foreignSpace]);
 for(const [id,scope] of [[room,space],['platform-id-sibling',space],['platform-id-other-room',foreignSpace]])
  await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,scope]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [room,'platform-id-sibling','platform-id-other-room']){meta.streamers.push({id,slug:id,display_name:id,active:true});meta.streamerSettings[id]={};}
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const member=async(subject,scope=space,role='player',streamer=null)=>(await q(
  'insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,$3,$4) returning id',[subject,scope,role,streamer]))[0].id;
 const candidate=async(id,scope=space)=>{const accountId=await account(),membershipId=await member(accountId,scope);
  return {player_id:id,account_id:accountId,membership_id:membershipId};};
 const profile=async(id,ids,extra={},scope=space)=>{const binding=await candidate(id,scope);
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
   [scope,id,binding.account_id,binding.membership_id,{playerId:id,name:'Profile '+id,ids,names:['Retained alias'],note:'Retained private business note',...extra}]);
  return binding;};
 const existing=await profile('EXISTING',['Shared']),archived=await profile('ARCHIVED',['archived-id'],{archived:true}),
  second=await profile('SECOND',['second-id']),foreign=await profile('FOREIGN',['foreign-id'],{},foreignSpace);
 const admin=await account(),adminMembership=await member(admin,space,'streamer_admin',room),president=await account();
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1),($2,$3)",[president,'streamer:'+room,admin]);
 const ctx={role:'streamer_admin',account_id:admin,actor_streamer_id:room,streamer_id:room,space_id:space,action:'playersImport'};
 const revision=async()=>Number((await q('select revision from papa_v2_revision where id=1'))[0].revision);
 const commit=async(changes,bindings=[],options={})=>rpc('papa_room_admin_commit_with_player_bindings',[
  options.expected??await revision(),changes,options.removed||[],options.context||ctx,options.notices||[],options.room||room,bindings]);
 const stable=async()=>({entities:await q('select * from papa_v2_entities order by kind,id'),
  profiles:await q('select * from papa_space_player_profiles order by space_id,player_id'),
  accounts:await q('select * from papa_accounts order by id'),members:await q('select * from papa_space_memberships order by id'),
  links:await q('select * from papa_manager_account_links order by manager_key'),roles:await q('select * from papa_platform_roles order by account_id'),
  sessions:await q('select * from papa_v2_sessions order by token_hash'),events:await q('select * from papa_events order by id'),
  notices:await q('select * from papa_notifications order by id'),push:await q('select * from papa_push_jobs order by id'),revision:await revision()});
 // Prime the original PL/pgSQL delegation plans before replacing the native
 // entry, so tests also catch a renamed implementation accidentally bypassed.
 await db.exec('begin');await commit([player('EXISTING',{name:'Warm original entry'})]);await db.exec('rollback');
 const before=await stable();await db.exec(migration(guardMigration));assert.deepEqual(await stable(),before,'migration changes no source business or identity data');
 return {db,q,rpc,ctx,admin,adminMembership,president,existing,archived,second,foreign,candidate,commit,revision,stable};
}

test('native platform IDs use full effective Space profiles, including archived players, and reject a conflicting provision batch atomically',async t=>{
 const f=await fixture(t),first=await f.candidate('NEW-A'),second=await f.candidate('NEW-B'),baseline=await f.stable();
 const ledger={kind:'ledger',id:'initial-credit',data:{id:'initial-credit',streamer_id:room,playerId:'NEW-A',amount:5,at}};
 const notice={id:'00000000-0000-4000-8000-000000000014',streamer_id:room,streamer_name:room,recipient:'NEW-A',type:'credit',level:1,body:'Initial balance',entity_id:'NEW-A',created_at:at};
 const reject=async(changes,bindings,error=/PLATFORM_ID_CONFLICT/)=>{
  await assert.rejects(f.commit(changes,bindings,{notices:[notice]}),error);assert.deepEqual(await f.stable(),baseline);
 };
 await reject([player('NEW-A',{ids:[' Shared ']}),ledger],[first]);
 await reject([player('NEW-A',{ids:['\tarchived-id\u00a0']}),ledger],[first]);
 await reject([player('NEW-A',{ids:['batch-id']}),player('NEW-B',{ids:[' batch-id ']}),ledger],[first,second]);
 await reject([player('EXISTING',{ids:['batch-id']}),player('NEW-A',{ids:['batch-id']}),ledger],[first]);
 await reject([player('EXISTING',{ids:['second-id']})],[],/PLATFORM_ID_CONFLICT/);
 assert.equal((await f.q('select count(*)::int n from papa_space_player_profiles where space_id=$1',[space]))[0].n,3);
});

test('case-sensitive own IDs, ignored markers and an atomic ID transfer retain identities, original audit, notices and private data',async t=>{
 const f=await fixture(t),bound=await f.candidate('NEW'),baseline=await f.stable(),expected=await f.revision();
 const changes=[player('EXISTING',{ids:['Shared',' Shared ','',' 未知 ','\u3000'],name:'Edited own profile'}),
  player('NEW',{ids:['shared','foreign-id','未知',''],names:[],note:'New private business note'}),
  {kind:'ledger',id:'opening',data:{id:'opening',streamer_id:room,playerId:'NEW',amount:3,at}}];
 const notice={id:'00000000-0000-4000-8000-000000000015',streamer_id:room,streamer_name:room,recipient:'NEW',type:'credit',level:1,body:'Initial balance',entity_id:'NEW',created_at:at};
 assert.equal(Number(await f.commit(changes,[bound],{notices:[notice]})),expected+1);
 const after=await f.stable(),old=after.profiles.find(p=>p.space_id===space&&p.player_id==='EXISTING'),added=after.profiles.find(p=>p.space_id===space&&p.player_id==='NEW');
 assert.equal(old.account_id,f.existing.account_id);assert.equal(old.membership_id,f.existing.membership_id);
 assert.equal(old.data.note,'Retained private business note');assert.deepEqual(old.data.names,['Retained alias']);assert.deepEqual(old.data.ids,changes[0].data.ids);
 assert.equal(added.account_id,bound.account_id);assert.equal(added.membership_id,bound.membership_id);assert.deepEqual(added.data,changes[1].data);
 for(const key of ['accounts','members','links','roles','sessions','push'])assert.deepEqual(after[key],baseline[key],key+' unchanged');
 assert.deepEqual(after.profiles.filter(p=>p.space_id===foreignSpace),baseline.profiles.filter(p=>p.space_id===foreignSpace));
 assert.deepEqual(after.entities.filter(e=>e.kind==='players'||e.space_id==='space-001'),baseline.entities.filter(e=>e.kind==='players'||e.space_id==='space-001'));
 assert.equal(after.revision,expected+1);assert.equal(after.events.filter(e=>e.entity_kind==='players').length,baseline.events.filter(e=>e.entity_kind==='players').length+2);
 assert.equal(after.notices.length,1);assert.equal(after.entities.find(e=>e.kind==='ledger'&&e.id==='opening').data.amount,3);
 assert.equal(Number(await f.commit([player('SECOND',{ids:[]}),player('NEW',{ids:['second-id']})])),expected+2,'check whole merged batch rather than each patch against old IDs');
 const transferred=await f.stable();assert.deepEqual(transferred.profiles.find(p=>p.player_id==='SECOND').data.ids,[]);
 assert.deepEqual(transferred.profiles.find(p=>p.player_id==='NEW').data.ids,['second-id']);
 assert.equal(Number(await f.commit([player('NEW',{name:'Name-only edit'})])),expected+3,'omitted IDs retain existing IDs');
 assert.deepEqual((await f.stable()).profiles.find(p=>p.player_id==='NEW').data.ids,['second-id']);
});

test('malformed ID arrays or elements reject without partial writes and original revision and Membership guards remain effective',async t=>{
 const f=await fixture(t),bound=await f.candidate('NEW'),baseline=await f.stable();
 for(const ids of [null,'one-id',{},1,[1],[null],[true],[{}],[['nested']]]){
  await assert.rejects(f.commit([player('NEW',{ids})],[bound]),/PLATFORM_IDS_INVALID/);assert.deepEqual(await f.stable(),baseline);
 }
 await assert.rejects(f.commit([player('NEW',{ids:['ok']})],[bound],{expected:7}),/VERSION_CONFLICT/);assert.deepEqual(await f.stable(),baseline);
 await f.q("update papa_space_memberships set status='suspended' where id=$1",[bound.membership_id]);
 const revoked=await f.stable();await assert.rejects(f.commit([player('NEW',{ids:['ok']})],[bound]),/BINDING_INVALID/);assert.deepEqual(await f.stable(),revoked);
 await f.q("update papa_space_memberships set status='active' where id=$1",[bound.membership_id]);
 await assert.rejects(f.commit([player('NEW',{ids:['ok']})],[bound],{context:{...f.ctx,space_id:foreignSpace}}),/ACTOR_INVALID/);
 await assert.rejects(f.commit([player('NEW',{ids:['ok']})],[bound],{context:{...f.ctx,role:'player',account_id:f.existing.account_id,player_id:'EXISTING'}}),/ACTOR_INVALID/);
 assert.deepEqual(await f.stable(),baseline);
 const archived=baseline.profiles.find(p=>p.player_id==='ARCHIVED');
 await f.q('update papa_space_player_profiles set data=$1 where space_id=$2 and player_id=$3',[{...archived.data,ids:[null]},space,'ARCHIVED']);
 const malformed=await f.stable();
 await assert.rejects(f.commit([player('EXISTING',{name:'Unrelated edit'})]),/PLATFORM_IDS_INVALID/);assert.deepEqual(await f.stable(),malformed);
 assert.equal(Number(await f.commit([player('ARCHIVED',{ids:['archived-id']})])),malformed.revision+1,'effective valid replacement repairs an old malformed array');
});

test('every native profile-write entry reaches the guard while direct private execution and browser roles stay denied',async t=>{
 const f=await fixture(t),baseline=await f.stable(),duplicate=[player('EXISTING',{ids:['archived-id']})];
 await assert.rejects(f.rpc('papa_room_admin_commit',[0,duplicate,[],f.ctx,[],room]),/PLATFORM_ID_CONFLICT/);
 await assert.rejects(f.rpc('papa_room_native_commit',[0,duplicate,[],f.ctx,[],room,false]),/PLATFORM_ID_CONFLICT/);
 assert.deepEqual(await f.stable(),baseline);
 const privateSignature='public.papa_room_native_commit_platform_ids_original(bigint,jsonb,jsonb,jsonb,jsonb,text,boolean)',
  nativeSignature='public.papa_room_native_commit(bigint,jsonb,jsonb,jsonb,jsonb,text,boolean)',
  bindingSignature='public.papa_room_admin_commit_with_player_bindings(bigint,jsonb,jsonb,jsonb,jsonb,text,jsonb)';
 for(const role of ['anon','authenticated','service_role']){
  for(const signature of [privateSignature,nativeSignature])assert.equal((await f.q('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature]))[0].allowed,false);
  await f.db.exec('set role '+role);
  try{await assert.rejects(f.rpc('papa_room_native_commit_platform_ids_original',[0,duplicate,[],f.ctx,[],room,false]),/permission denied/);}
  finally{await f.db.exec('reset role');}
 }
 for(const role of ['anon','authenticated']){
  assert.equal((await f.q('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,bindingSignature]))[0].allowed,false);
  await f.db.exec('set role '+role);try{await assert.rejects(f.commit([player('EXISTING',{ids:['ok']})],[],{expected:0}),/permission denied/);}
  finally{await f.db.exec('reset role');}
 }
 assert.equal((await f.q('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',[bindingSignature]))[0].allowed,true);
 const presidentContext={...f.ctx,role:'super_admin',account_id:f.president,actor_streamer_id:null};
 await f.db.exec('set role service_role');try{
  assert.equal(Number(await f.commit([player('EXISTING',{name:'President edit'})],[],{expected:0,context:presidentContext})),1);
 }finally{await f.db.exec('reset role');}
 const self={role:'player',account_id:f.existing.account_id,player_id:'EXISTING',space_id:space,streamer_id:room,action:'self'};
 assert.equal(Number(await f.rpc('papa_room_admin_commit',[1,[player('EXISTING',{name:'Own name'})],[],self,[],room])),2);
 const beforeForbidden=await f.stable();
 await assert.rejects(f.rpc('papa_room_admin_commit',[2,[player('EXISTING',{ids:['unused']})],[],self,[],room]),/ACTOR_INVALID/);assert.deepEqual(await f.stable(),beforeForbidden);
 const queue={kind:'queue',id:'Q',data:{id:'Q',streamer_id:room,playerId:'EXISTING',kind:'self',status:'waiting',at,title:'Self-provided song'}};
 assert.equal(Number(await f.rpc('papa_room_operational_commit',[2,[queue],[],{...self,action:'request'},[],room])),3);
 assert.equal((await f.stable()).entities.find(e=>e.kind==='queue'&&e.id==='Q').data.title,'Self-provided song');
});
