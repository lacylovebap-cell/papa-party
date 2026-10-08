import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {empty,mutate,DEFAULTS} from '../src/core.js';
import {stateEntries} from '../src/state-patch.js';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const space='registry-native',room='registry-room',at='2026-10-09T01:00:00Z';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql',
  '202609250001_roles_and_notification_scope.sql','202609280001_manager_passwords.sql'])await db.exec(migration(name));
 const legacy=mutate(empty(),{type:'song',data:{title:'Legacy song',artist:'Artist',lyrics:'legacy-private-lyrics'}},{role:'admin'},at);
 legacy.players=[{playerId:'P1',name:'Legacy Player',ids:[],password:'legacy-secret'}];
 legacy.migrationIssues=['private legacy issue'];
 for(const entry of stateEntries(legacy))await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[entry.kind,entry.id,entry.data]);
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql',
  '202610070003_verified_identity_binding.sql','202610070004_audit_actor_snapshots.sql',
  '202610070009_scoped_read_snapshot.sql'])await db.exec(migration(name));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 await db.exec(migration('202610070013_space_player_profiles.sql'));
 const audit=migration('202610080012_communication_space.sql');
 for(const name of ['papa_communication_player_name','papa_native_meta_audit_projection','papa_event_actor_snapshot']){
  const start=audit.indexOf('function '+name+'('),statement=audit.lastIndexOf('create ',start);
  await db.exec(audit.slice(statement,audit.indexOf('$$;',start)+3));
 }
 await db.exec(migration('202610090003_streamer_registry.sql'));
 await q("insert into papa_spaces(id,slug,display_name) values($1,'registry-native','Native Registry')",[space]);
 await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[room,space]);
 let meta=(await q("select data from papa_v2_entities where kind='meta'"))[0].data;
 meta.streamers.push({id:room,slug:room,display_name:'Native Room',active:true,privateDescriptor:'preserve-native-private'});
 meta.streamerSettings[room]={...structuredClone(DEFAULTS),manual:'native-private-settings',tags:['Native']};
 meta.streamerSettings.papa.manual='legacy-private-settings';meta.privatePlatformField='platform-secret';
 await q("update papa_v2_entities set data=$1 where kind='meta'",[meta]);
 await q("insert into papa_v2_entities(kind,id,data) values('songs','NS',$1)",[{songId:'NS',streamer_id:room,title:'Native song',lyrics:'native-private-lyrics'}]);
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const president=await account(),manager=await account(),player=await account();
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1),($2,$3)",[president,'streamer:'+room,manager]);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,'streamer_admin',$3)",[manager,space,room]);
 const membership=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[player,space]))[0].id;
 await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
  [space,'P1',player,membership,{playerId:'P1',name:'Native Player',note:'native-profile-private'}]);
 const rev=async()=>Number((await q('select revision from papa_v2_revision'))[0].revision);
 const context={role:'super_admin',account_id:president,space_id:space,streamer_id:room,action:'streamer'};
 const commit=(replacement,settings={},ctx=context,scope=space,expected=null)=>rpc('papa_streamer_registry_commit',[expected,scope,replacement,settings,ctx]);
 const stable=async()=>({entities:await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),
  profiles:await q('select space_id,player_id,account_id,membership_id,data from papa_space_player_profiles order by player_id'),
  maps:await q('select streamer_id,space_id from papa_space_streamers order by streamer_id'),
  revision:await rev(),events:await q('select * from papa_events order by id'),
  notices:await q('select * from papa_notifications order by id')});
 return {db,q,rpc,president,manager,player,rev,context,commit,stable};
}

test('registry snapshot is president verified metadata with canonical Space mappings and only selected settings',async t=>{
 const {db,rpc,president,manager,stable}=await fixture(t),before=await stable();
 const result=await rpc('papa_streamer_registry_snapshot',[room,president]);
 assert.equal(result.canonicalRoom,room);assert.equal(result.canonicalSpace.id,space);
 assert.deepEqual(result.rows.map(r=>r.kind),['meta','settings']);
 const meta=result.rows[0].data;
 assert.deepEqual(Object.keys(meta.streamerSettings),[room]);
 assert.equal(meta.streamers.find(r=>r.id===room).spaceId,space);
 assert.equal(meta.streamers.some(r=>r.id==='papa'),false);
 for(const privateText of ['platform-secret','legacy-private-settings','legacy-secret','native-profile-private','native-private-lyrics','legacy-private-lyrics'])
  assert.equal(JSON.stringify(result).includes(privateText),false);
 await assert.rejects(rpc('papa_streamer_registry_snapshot',[room,manager]),/STREAMER_REGISTRY_ACTOR_INVALID/);
 await assert.rejects(rpc('papa_streamer_registry_snapshot',[room,null]),/STREAMER_REGISTRY_ACTOR_INVALID/);
 await assert.rejects(rpc('papa_streamer_registry_snapshot',['unknown',president]),/STREAMER_REGISTRY_ROOM_INVALID/);
 await db.exec('set role anon');await assert.rejects(rpc('papa_streamer_registry_snapshot',[room,president]),/permission denied/);await db.exec('reset role');
 assert.deepEqual(await stable(),before);
});

test('new native room maps before the legacy meta trigger and commits one audit without copying private data',async t=>{
 const {q,rpc,president,rev,commit,stable}=await fixture(t),before=await stable();
 const replacement={id:'new-native',slug:'new-native',display_name:'New Native',active:true,spaceId:space};
 const settings={...structuredClone(DEFAULTS),tags:[]};
 assert.equal(Number(await commit(replacement,settings,undefined,undefined,await rev())),before.revision+1);
 const after=await stable();
 assert.deepEqual(after.entities.filter(e=>e.kind!=='meta'),before.entities.filter(e=>e.kind!=='meta'));
 assert.deepEqual(after.profiles,before.profiles);assert.deepEqual(after.notices,before.notices);
 const meta=after.entities.find(e=>e.kind==='meta').data;
 const previous=before.entities.find(e=>e.kind==='meta').data;
 assert.deepEqual(meta.streamerSettings.papa,previous.streamerSettings.papa);
 assert.deepEqual(meta.streamerSettings[room],previous.streamerSettings[room]);
 assert.deepEqual(meta.streamerSettings['new-native'],settings);
 assert.equal(meta.privatePlatformField,'platform-secret');
 assert.equal(after.maps.find(m=>m.streamer_id==='new-native').space_id,space);
 assert.equal(after.events.length,before.events.length+1);
 assert.equal(after.events.at(-1).space_id,space);assert.equal(after.events.at(-1).streamer_id,'new-native');
 assert.equal(JSON.stringify(after.events.at(-1)).includes('legacy-private-settings'),false);
 assert.equal((await rpc('papa_streamer_registry_snapshot',['new-native',president])).canonicalSpace.id,space);
 await q("insert into papa_v2_entities(kind,id,data) values('songs','NEW_S',$1)",[{songId:'NEW_S',streamer_id:'new-native',title:'New song'}]);
 assert.equal((await q("select space_id from papa_v2_entities where id='NEW_S'"))[0].space_id,space);
});

test('editing an existing descriptor preserves settings, private fields, entities and immutable mapping',async t=>{
 const {q,rev,commit,stable}=await fixture(t),before=await stable();
 const old=before.entities.find(e=>e.kind==='meta').data.streamers.find(r=>r.id===room);
 await commit({...old,spaceId:space,display_name:'Edited Native',slug:'edited-native',active:false},{manual:'must not be used'},undefined,undefined,await rev());
 const after=await stable(),metadata=after.entities.find(e=>e.kind==='meta').data;
 assert.equal(metadata.streamers.find(r=>r.id===room).display_name,'Edited Native');
 assert.equal(metadata.streamers.find(r=>r.id===room).privateDescriptor,old.privateDescriptor);
 assert.deepEqual(metadata.streamerSettings,before.entities.find(e=>e.kind==='meta').data.streamerSettings);
 assert.deepEqual(after.entities.filter(e=>e.kind!=='meta'),before.entities.filter(e=>e.kind!=='meta'));
 assert.deepEqual(after.profiles,before.profiles);assert.deepEqual(after.maps,before.maps);
 assert.equal(after.events.length,before.events.length+1);
 await assert.rejects(commit({...old,spaceId:'space-001'}, {},undefined,undefined,await rev()),/STREAMER_REGISTRY_DESCRIPTOR_INVALID/);
 const legacy=metadata.streamers.find(r=>r.id==='papa');
 await assert.rejects(commit({...legacy,spaceId:space},{},undefined,undefined,await rev()),/STREAMER_REGISTRY_SCOPE_INVALID/);
 assert.equal((await q('select space_id from papa_space_streamers where streamer_id=$1',[room]))[0].space_id,space);
});

test('bad actors, stale revision, duplicate slugs and private-field edits fail atomically, including audit failure',async t=>{
 const {db,q,manager,president,rev,context,commit,stable}=await fixture(t),before=await stable();
 const replacement={id:'safe-new',slug:'safe-new',display_name:'Safe'};
 await assert.rejects(commit(replacement,{},context,space,before.revision-1),/VERSION_CONFLICT/);
 await assert.rejects(commit(replacement,{}, {...context,account_id:manager},space,await rev()),/STREAMER_REGISTRY_ACTOR_INVALID/);
 await assert.rejects(commit(replacement,{}, {...context,space_id:'space-001'},space,await rev()),/STREAMER_REGISTRY_ACTOR_INVALID/);
 await assert.rejects(commit({...replacement,slug:'papa'},{},context,space,await rev()),/STREAMER_REGISTRY_DUPLICATE/);
 await assert.rejects(commit({...replacement,privatePassword:'forged'},{},context,space,await rev()),/STREAMER_REGISTRY_DESCRIPTOR_INVALID/);
 const old=before.entities.find(e=>e.kind==='meta').data.streamers.find(r=>r.id===room);
 await assert.rejects(commit({...old,privateDescriptor:'changed'},{},context,space,await rev()),/STREAMER_REGISTRY_DESCRIPTOR_INVALID/);
 await db.exec("create function fail_registry_audit() returns trigger language plpgsql as $$begin raise exception 'registry audit failure';end $$;create trigger fail_registry_audit before insert on papa_events for each row execute function fail_registry_audit();");
 await assert.rejects(commit(replacement,{},context,space,await rev()),/registry audit failure/);
 assert.deepEqual(await stable(),before,'new mapping, meta, revision and events all roll back');
 await q('update papa_accounts set disabled_at=now() where id=$1',[president]);
 await assert.rejects(commit(replacement,{},context,space,await rev()),/STREAMER_REGISTRY_ACTOR_INVALID/);
 const revision=await rev();
 await db.exec('set role authenticated');await assert.rejects(commit(replacement,{},context,space,revision),/permission denied/);await db.exec('reset role');
});
