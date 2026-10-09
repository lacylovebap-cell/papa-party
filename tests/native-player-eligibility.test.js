import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const pageMigration='202610090013_native_player_eligibility.sql';
const space='eligibility-space',foreignSpace='eligibility-foreign',room='eligibility-room';
const rowKeys=['accountId','membershipId','spaceId','role','status','createdAt','displayLabel'];

async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql'])await db.exec(migration(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1),('settings','1','{}')",[{
  schemaVersion:3,streamers:[{id:'papa',slug:'papa',display_name:'Legacy',active:true}],streamerSettings:{papa:{}}}]);
 for(const [id,name] of [['LEGACY-A','Alpha Verified'],['SAME-NAME','Alpha Verified'],['INVALID-LABEL',{private:'not a display string'}]])
  await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,{playerId:id,name,ids:['private-login-'+id],names:['private-alias'],
   password:'fixture-password',note:'fixture-private-note',history:['fixture-private-history']}]);
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
 for(const name of ['202610080013_native_room_transactions.sql','202610090003_streamer_registry.sql','202610090006_native_player_provision.sql'])await db.exec(migration(name));
 await q('insert into papa_spaces(id,slug,display_name) values($1,$1,$1),($2,$2,$2)',[space,foreignSpace]);
 for(const [id,scope] of [[room,space],['eligibility-foreign-room',foreignSpace]])await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,scope]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [room,'eligibility-foreign-room']){meta.streamers.push({id,slug:id,display_name:id,active:true});meta.streamerSettings[id]={};}
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const member=async(subject,scope=space,role='player',streamer=null,status='active')=>(await q(
  'insert into papa_space_memberships(account_id,space_id,role,streamer_id,status) values($1,$2,$3,$4,$5) returning id',
  [subject,scope,role,streamer,status]))[0].id;
 const candidate=async(scope=space)=>{const accountId=await account(),membershipId=await member(accountId,scope);return {accountId,membershipId};};
 const president=await account(),subjects={};
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[president]);
 for(const key of ['labeled','plain','foreignProfile','dualRole','missingLegacy','invalidLabel','sameName','disabled','suspended','profiled','archivedProfile'])subjects[key]=await candidate();
 subjects.president={accountId:president,membershipId:await member(president)};
 subjects.foreignOnly=await candidate(foreignSpace);subjects.legacyOnly=await candidate('space-001');
 subjects.streamerOnly={accountId:await account()};subjects.streamerOnly.membershipId=await member(subjects.streamerOnly.accountId,space,'streamer_admin',room);
 subjects.spaceAdminOnly={accountId:await account()};subjects.spaceAdminOnly.membershipId=await member(subjects.spaceAdminOnly.accountId,space,'space_admin');
 await member(subjects.dualRole.accountId,space,'streamer_admin',room);
 await member(subjects.dualRole.accountId,foreignSpace,'streamer_admin','eligibility-foreign-room');
 await q("insert into papa_manager_account_links(manager_key,account_id) values($1,$2)",['streamer:'+room,subjects.dualRole.accountId]);
 for(const [key,id] of [['labeled','LEGACY-A'],['missingLegacy','NO-SUCH-LEGACY'],['invalidLabel','INVALID-LABEL']])
  await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[subjects[key].accountId,id]);
 await q('update papa_accounts set disabled_at=now() where id=$1',[subjects.disabled.accountId]);
 await q("update papa_space_memberships set status='suspended' where id=$1",[subjects.suspended.membershipId]);
 for(const [scope,id,key,extra] of [[space,'PROFILE','profiled',{}],[space,'ARCHIVED','archivedProfile',{archived:true}],
  [foreignSpace,'FOREIGN-PROFILE','foreignProfile',{}]]){
  const subject=subjects[key],membership=scope===space?subject.membershipId:await member(subject.accountId,scope);
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
   [scope,id,subject.accountId,membership,{playerId:id,name:'Foreign or existing private profile name',ids:['profile-login'],note:'fixture-profile-private',history:['fixture-history'],...extra}]);
 }
 await q("insert into papa_installations(id,platform,app_version) values('00000000-0000-4000-8000-000000000001','web','retained')");
 const device=(await q("insert into papa_device_sessions(installation_id,account_id,session_kind,role,space_id,refresh_hash,expires_at) values('00000000-0000-4000-8000-000000000001',$1,'player','player',$2,$3,now()+interval '1 day') returning id",
  [subjects.plain.accountId,space,'a'.repeat(64)]))[0].id;
 await q("insert into papa_v2_sessions(token_hash,player_id,login_id,expires_at,account_id,device_session_id,role) values($1,'retained-identity','private-login',now()+interval '1 day',$2,$3,'player')",['b'.repeat(64),subjects.plain.accountId,device]);
 const revision=async()=>Number((await q('select revision from papa_v2_revision where id=1'))[0].revision);
 const context=(scope=space,subject=president)=>({role:'super_admin',account_id:subject,space_id:scope,streamer_id:null});
 const page=async(query='',limit=20,offset=0,scope=space,actor=context(scope))=>rpc('papa_native_player_eligibility_page',[scope,actor,query,limit,offset]);
 const original=async()=>({entities:await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),
  accounts:await q('select id,created_at,disabled_at from papa_accounts order by id'),
  bindings:await q('select account_id,legacy_player_id,verified_at from papa_account_legacy_players order by account_id'),
  managers:await q('select manager_key,account_id,created_at from papa_manager_account_links order by manager_key'),
  members:await q('select id,account_id,space_id,role,streamer_id,status,created_at from papa_space_memberships order by id'),
  roles:await q('select account_id,role,granted_at from papa_platform_roles order by account_id'),
  profiles:await q('select space_id,player_id,account_id,membership_id,data,updated_at from papa_space_player_profiles order by space_id,player_id'),
  sessions:await q('select token_hash,player_id,login_id,expires_at,account_id,device_session_id,role from papa_v2_sessions order by token_hash'),
  devices:await q('select id,account_id,space_id,refresh_hash,rotation,revoked_at from papa_device_sessions order by id'),
  installations:await q('select id,platform,app_version,created_at,last_seen_at from papa_installations order by id'),
  events:await q('select id,streamer_id,entity_kind,entity_id,action,before_data,after_data from papa_events order by id'),
  notices:await q('select id,streamer_id,recipient,body from papa_notifications order by id'),
  push:await q('select id,status from papa_push_jobs order by id'),revision:await revision()});
 const before=await original();await db.exec(migration(pageMigration));assert.deepEqual(await original(),before,'migration writes no original business or identity row');
 return {db,q,rpc,page,context,account,member,candidate,president,subjects,revision,original};
}

test('eligibility is exact active player Membership authority, scoped to unprofiled native Accounts with lean verified labels',async t=>{
 const {page,subjects,original}=await fixture(t),before=await original(),result=await page();
 const eligible=['labeled','plain','foreignProfile','dualRole','missingLegacy','invalidLabel','sameName','president'];
 assert.equal(result.total,eligible.length);assert.equal(result.pageLimit,20);assert.equal(result.pageOffset,0);assert.equal(result.revision,before.revision);
 assert.deepEqual(result.rows.map(r=>r.accountId).sort(),eligible.map(key=>subjects[key].accountId).sort());
 for(const row of result.rows){
  assert.deepEqual(Object.keys(row).sort(),rowKeys.toSorted());assert.equal(row.spaceId,space);assert.equal(row.role,'player');assert.equal(row.status,'active');
  assert.equal(typeof row.createdAt,'string');assert.equal(row.membershipId,subjects[eligible.find(key=>subjects[key].accountId===row.accountId)].membershipId);
  assert.equal(row.displayLabel,row.accountId===subjects.labeled.accountId?'Alpha Verified':'已驗證玩家 '+row.accountId.slice(0,8));
 }
 assert.doesNotMatch(JSON.stringify(result),/password|private|history|login|refresh|token|Foreign or existing/i);
 const foreign=await page('',20,0,foreignSpace);
 assert.deepEqual(foreign.rows.map(r=>r.accountId),[subjects.foreignOnly.accountId]);
 assert.deepEqual(await original(),before,'eligibility never provisions, audits, revises, or changes sessions');
});

test('safe literal search counts before bounded stable pagination and never searches private or inferred names',async t=>{
 const {q,page,candidate,subjects,original}=await fixture(t);
 for(const [id,label] of [['SECOND','Alpha Second'],['LITERAL','Alpha literal_%'],['LONG','Z'.repeat(250)]]){
  const subject=await candidate();await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,{playerId:id,name:label,password:'private-search-needle',ids:['private-search-needle'],names:['private-search-needle']}]);
  await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[subject.accountId,id]);
 }
 const before=await original(),all=await page('ALPHA',50),first=await page('alpha',1),second=await page('alpha',1,1),third=await page('alpha',1,2);
 assert.equal(all.total,3);assert.deepEqual(first.rows.concat(second.rows,third.rows),all.rows);
 assert.equal(second.total,3);assert.equal(second.pageOffset,1);assert.equal(second.pageLimit,1);
 assert.deepEqual((await page('alpha',2,3)).rows,[]);assert.equal((await page('alpha',2,3)).total,3);
 assert.equal((await page('_%')).total,1);assert.equal((await page('private-search-needle')).total,0);assert.equal((await page('Foreign or existing')).total,0);
 assert.deepEqual((await page(subjects.plain.accountId)).rows.map(r=>r.accountId),[subjects.plain.accountId]);
 assert.deepEqual((await page(subjects.plain.membershipId.toUpperCase())).rows.map(r=>r.membershipId),[subjects.plain.membershipId]);
 assert.equal((await page('Z'.repeat(100))).rows[0].displayLabel.length,200);
 const largeOffset=await page('',50,10000000);assert.equal(largeOffset.pageOffset,10000000);assert.deepEqual(largeOffset.rows,[]);
 assert.deepEqual(await original(),before);
});

test('President Account guard and exact active nonlegacy Space deny forged roles, ambient actor authority and browser execution',async t=>{
 const {db,q,rpc,page,context,president,subjects,original}=await fixture(t),before=await original();
 assert.ok((await page()).total>0,'valid explicit context works without an actor GUC');
 await q("select set_config('papa.actor_context',$1,false)",[JSON.stringify(context())]);
 for(const actor of [null,{},JSON.stringify('invalid'),{...context(),account_id:null},{...context(),account_id:'bad-uuid'},
  {...context(),role:null},{...context(),role:'player'},{...context(),role:'streamer_admin'},context(space,subjects.plain.accountId),
  context(space,subjects.dualRole.accountId),context(foreignSpace),{...context(),space_id:null}])
  await assert.rejects(page('',20,0,space,actor),/PLAYER_ELIGIBILITY_ACTOR_INVALID/);
 await q("select set_config('papa.actor_context','',false)");
 for(const scope of [null,'','missing','space-001'])await assert.rejects(page('',20,0,scope,context(scope)),/PLAYER_ELIGIBILITY_SCOPE_INVALID/);
 await q('update papa_accounts set disabled_at=now() where id=$1',[president]);await assert.rejects(page(),/PLAYER_ELIGIBILITY_ACTOR_INVALID/);
 await q('update papa_accounts set disabled_at=null where id=$1',[president]);
 await q("update papa_platform_roles set role='president' where account_id=$1",[president]);
 const role=(await q('select granted_at::text stamp from papa_platform_roles where account_id=$1',[president]))[0].stamp;
 await q('delete from papa_platform_roles where account_id=$1',[president]);await assert.rejects(page(),/PLAYER_ELIGIBILITY_ACTOR_INVALID/);
 await q("insert into papa_platform_roles(account_id,role,granted_at) values($1,'president',$2)",[president,role]);
 const link=(await q("select created_at::text stamp from papa_manager_account_links where manager_key='president'"))[0].stamp;
 await q("delete from papa_manager_account_links where manager_key='president'");await assert.rejects(page(),/PLAYER_ELIGIBILITY_ACTOR_INVALID/);
 await q("insert into papa_manager_account_links(manager_key,account_id,created_at) values('president',$1,$2)",[president,link]);
 await q("update papa_spaces set status='suspended' where id=$1",[space]);await assert.rejects(page(),/PLAYER_ELIGIBILITY_SCOPE_INVALID/);
 await q("update papa_spaces set status='active' where id=$1",[space]);
 assert.deepEqual(await original(),before);
 for(const args of [[space,context(),null,20,0],[space,context(),'q'.repeat(101),20,0],[space,context(),'',0,0],
  [space,context(),'',51,0],[space,context(),'',null,0],[space,context(),'',20,-1],[space,context(),'',20,10000001],[space,context(),'',20,null]])
  await assert.rejects(rpc('papa_native_player_eligibility_page',args),/PLAYER_ELIGIBILITY_PAGE_INVALID/);
 const signature='public.papa_native_player_eligibility_page(text,jsonb,text,integer,integer)';
 for(const role of ['anon','authenticated']){
  assert.equal((await q('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature]))[0].allowed,false);
  await db.exec('set role '+role);try{await assert.rejects(page(),/permission denied/);}finally{await db.exec('reset role');}
 }
 assert.equal((await q('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',[signature]))[0].allowed,true);
 await db.exec('set role service_role');try{assert.ok((await page()).total>0);}finally{await db.exec('reset role');}
 assert.deepEqual(await original(),before);
});

test('an explicit eligibility choice feeds the unchanged original006 transaction and disappears only after its successful profile commit',async t=>{
 const {q,rpc,page,context,subjects,revision,original}=await fixture(t);
 const selection=await page(subjects.plain.accountId),selected=selection.rows[0],before=await original(),expected=selection.revision;
 assert.equal(expected,await revision());
 const playerId='EXPLICIT-CHOICE',binding={player_id:playerId,account_id:selected.accountId,membership_id:selected.membershipId};
 const changes=[{kind:'players',id:playerId,data:{playerId,name:'Explicit new profile',ids:[],names:[],note:'New private business note'}}];
 const actor={...context(),streamer_id:room,action:'playersImport'};
 const commit=()=>rpc('papa_room_admin_commit_with_player_bindings',[expected,changes,[],actor,[],room,[binding]]);
 await q("update papa_space_memberships set status='suspended' where id=$1",[selected.membershipId]);
 assert.equal((await page(selected.accountId)).total,0);const suspended=await original();
 await assert.rejects(commit(),/ROOM_PLAYER_BINDING_INVALID/);assert.deepEqual(await original(),suspended);
 await q("update papa_space_memberships set status='active' where id=$1",[selected.membershipId]);
 assert.deepEqual(await original(),before);assert.equal(Number(await commit()),expected+1);
 const afterPage=await page(selected.accountId);assert.equal(afterPage.total,0,'committed same-Space profiles are no longer eligible');assert.equal(afterPage.revision,expected+1);
 const profile=(await q('select account_id,membership_id,data from papa_space_player_profiles where space_id=$1 and player_id=$2',[space,playerId]))[0];
 assert.equal(profile.account_id,selected.accountId);assert.equal(profile.membership_id,selected.membershipId);assert.deepEqual(profile.data,changes[0].data);
 const after=await original();
 for(const key of ['entities','accounts','bindings','managers','members','roles','sessions','devices','installations','notices','push'])assert.deepEqual(after[key],before[key],key+' stays unchanged');
 assert.deepEqual(after.profiles.filter(r=>r.player_id!==playerId),before.profiles);assert.equal(after.revision,expected+1);
 assert.equal(after.events.length,before.events.length+1,'one original profile audit; no eligibility event or duplicate transaction');
 const audit=after.events.at(-1);assert.equal(audit.entity_kind,'players');assert.equal(audit.entity_id,playerId);assert.equal(audit.after_data.name,'Explicit new profile');
});
