import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const nativeSpace='batch-archive-space',foreignSpace='batch-archive-foreign';
const batchSignature='public.papa_players_archive(text,text[],bigint,jsonb,boolean)';

async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql'])await db.exec(migration(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1)",[{schemaVersion:3,streamers:[
  {id:'papa',slug:'papa',display_name:'Legacy',active:true},{id:'legacy-other',slug:'legacy-other',display_name:'Other',active:true}],streamerSettings:{papa:{},'legacy-other':{}}}]);
 for(const id of ['P1','P2','P3','L1'])await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,
  {playerId:id,name:'Legacy '+id,ids:['id-'+id],names:['former-'+id],password:'retained-password-'+id,
   note:'private original note',futurePrivate:{history:['retained']}}]);
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql','202610070003_verified_identity_binding.sql',
  '202610070004_audit_actor_snapshots.sql','202610070009_scoped_read_snapshot.sql'])await db.exec(migration(name));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 await db.exec(migration('202610070013_space_player_profiles.sql'));
 const communication=migration('202610080012_communication_space.sql');
 for(const name of ['papa_communication_player_name','papa_native_meta_audit_projection','papa_event_actor_snapshot']){
  const start=communication.indexOf('function '+name+'('),statement=communication.lastIndexOf('create ',start);
  assert.ok(start>=0);await db.exec(communication.slice(statement,communication.indexOf('$$;',start)+3));
 }
 const transactions=migration('202610080013_native_room_transactions.sql'),start=transactions.indexOf('create function papa_capture_space_profile_event()');
 await db.exec(transactions.slice(start,transactions.indexOf('create function papa_room_native_profile_data_safe',start)));
 // The recoverable archive operation does not call these separate tools. Their
 // original schemas are present to prove that their rows survive the batch.
 const favorites=migration('202610090009_song_favorites.sql');
 await db.exec(favorites.slice(favorites.indexOf('create table'),favorites.indexOf('create function')));
 const quotas=migration('202610090004_player_extra_quota.sql');
 await db.exec(quotas.slice(quotas.indexOf('create table public.papa_player_extra_quotas'),quotas.indexOf('create function')));
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const president=await account(),ordinary=await account(),subjects={};
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[president]);
 await q('insert into papa_spaces(id,slug,display_name) values($1,$1,$1),($2,$2,$2)',[nativeSpace,foreignSpace]);
 for(const [room,space] of [['batch-native',nativeSpace],['batch-sibling',nativeSpace],['batch-foreign',foreignSpace]])
  await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[room,space]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of ['batch-native','batch-sibling','batch-foreign']){meta.streamers.push({id,slug:id,display_name:id,active:true});meta.streamerSettings[id]={};}
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 for(const id of ['P1','P2','P3']){
  const subject=await account();subjects[id]=subject;
  await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[subject,id]);
  await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player')",[subject]);
  const member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[subject,nativeSpace]))[0].id;
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
   [nativeSpace,id,subject,member,{playerId:id,name:'Native '+id,ids:['native-'+id],names:['previous native '+id],
    note:'retained native private note',futurePrivate:{history:['original native']}}]);
 }
 for(const id of ['P1','PF']){
  const subject=await account(),member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[subject,foreignSpace]))[0].id;
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
   [foreignSpace,id,subject,member,{playerId:id,name:'Foreign '+id,note:'foreign retained note'}]);
 }
 for(const [room,space] of [['papa','space-001'],['legacy-other','space-001'],['batch-native',nativeSpace],['batch-sibling',nativeSpace],['batch-foreign',foreignSpace]]){
  for(const [kind,data] of [['songs',{songId:room+'-song',title:'Original title',artist:'Original artist',lyrics:'private source lyrics'}],
   ['queue',{id:room+'-queue',playerId:'P1',status:'completed',kind:'saved',history:['private original snapshot']}],
   ['ledger',{id:room+'-ledger',playerId:'P1',amount:10,note:'original ledger note'}],
   ['crowns',{id:room+'-crown',playerId:'P1',note:'original crown'}],['cards',{id:room+'-card',playerId:'P1',note:'original card'}]])
   await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[kind,room+'-'+kind,{...data,streamer_id:room}]);
  if(space==='space-001'){
   await q("insert into papa_player_extra_quotas(streamer_id,player_id,extra_quota,updated_by) values($1,'P1',3,'retained legacy manager label')",[room]);
   await q("insert into papa_song_favorites(account_id,space_id,player_id,streamer_id,song_id) values($1,$2,'P1',$3,$4)",[subjects.P1,space,room,room+'-song']);
  }
 }
 await q("insert into papa_v2_sessions(token_hash,player_id,role,account_id,expires_at) values($1,'P1','player',$2,now()+interval '1 day')",['a'.repeat(64),subjects.P1]);
 const context=(space='space-001',subject=president,role='super_admin')=>({role,account_id:subject,space_id:space,streamer_id:null,player_id:'ignored',action:'ignored'});
 const revision=async()=>Number((await q('select revision from papa_v2_revision where id=1'))[0].revision);
 const archive=async(ids=['P1','P2'],space='space-001',desired=true,options={})=>rpc('papa_players_archive',
  [space,ids,options.expected??await revision(),options.actor??context(space),desired]);
 const player=async(space,id)=>space==='space-001'?(await q("select to_jsonb(e) row from papa_v2_entities e where kind='players' and id=$1 and space_id is null",[id]))[0]?.row:
  (await q('select to_jsonb(p) row from papa_space_player_profiles p where space_id=$1 and player_id=$2',[space,id]))[0]?.row;
 const business=async(excludedSpace='',excludedPlayers=[])=>{
  const result={entities:await q("select to_jsonb(e) row from papa_v2_entities e where not ($1='space-001' and kind='players' and id=any($2::text[])) order by kind,id",[excludedSpace,excludedPlayers]),
   profiles:await q('select to_jsonb(p) row from papa_space_player_profiles p where not(space_id=$1 and player_id=any($2::text[])) order by space_id,player_id',[excludedSpace,excludedPlayers])};
  for(const [table,order] of [['papa_accounts','id'],['papa_account_legacy_players','account_id'],['papa_space_memberships','id'],['papa_platform_roles','account_id'],
   ['papa_manager_account_links','manager_key'],['papa_device_sessions','id'],['papa_v2_sessions','token_hash'],['papa_song_favorites','account_id,space_id,player_id,streamer_id,song_id'],
   ['papa_player_extra_quotas','streamer_id,player_id'],['papa_notifications','id'],['papa_push_jobs','id']])
   result[table]=await q('select to_jsonb(source) row from '+table+' source order by '+order);
  return result;
 };
 const events=()=>q("select id,entity_id,action,actor_role,actor_account_id,actor_player_id,actor_streamer_id,actor_display_name_snapshot,target_player_id,target_player_name_snapshot,space_id,before_data,after_data from papa_events where action in ('playerArchive','playerRestore') order by id");
 await db.exec(migration('202610090012_player_archive.sql'));
 const singleBefore=(await q("select pg_get_functiondef('papa_player_archive(text,text,bigint,jsonb,boolean)'::regprocedure) body"))[0].body;
 const baseline={business:await business(),events:await events(),revision:await revision()};
 await db.exec(migration('202610100017_player_archive_batch.sql'));
 assert.deepEqual({business:await business(),events:await events(),revision:await revision()},baseline,'installing the new API changes no original data');
 assert.equal((await q("select pg_get_functiondef('papa_player_archive(text,text,bigint,jsonb,boolean)'::regprocedure) body"))[0].body,singleBefore);
 return {db,q,rpc,president,ordinary,subjects,context,revision,archive,player,business,events};
}

for(const space of ['space-001',nativeSpace])test(space+' multi-select archive/restore keeps source fields, identity and all related business rows under one revision',async t=>{
 const f=await fixture(t),ids=['P2','P1'],sources=await Promise.all(ids.map(id=>f.player(space,id))),protectedRows=await f.business(space,ids),before=await f.revision();
 assert.deepEqual(await f.archive(ids,space),{revision:before+1,changed:true,players:ids.map(playerId=>({playerId,archived:true}))});
 const archived=await Promise.all(ids.map(id=>f.player(space,id)));
 for(const [i,row] of archived.entries()){
  assert.deepEqual(row.data,{...sources[i].data,archived:true,archiveAt:row.data.archiveAt,archiveBy:f.president});
  assert.equal(typeof row.data.archiveAt,'string');
  for(const key of ['space_id','player_id','account_id','membership_id','kind','id'])if(Object.hasOwn(sources[i],key))assert.equal(row[key],sources[i][key]);
 }
 assert.equal(archived[0].data.archiveAt,archived[1].data.archiveAt);assert.deepEqual(await f.business(space,ids),protectedRows);
 const events=await f.events();assert.equal(events.length,2);
 for(const event of events){
  const name=(space==='space-001'?'Legacy ':'Native ')+event.entity_id;
  assert.equal(event.action,'playerArchive');assert.equal(event.space_id,space);assert.equal(event.actor_role,'president');assert.equal(event.actor_account_id,f.president);
  assert.equal(event.actor_player_id,null);assert.equal(event.actor_streamer_id,null);assert.equal(event.actor_display_name_snapshot,'PA Party總裁');
  assert.equal(event.target_player_id,event.entity_id);assert.equal(event.target_player_name_snapshot,name);
  assert.deepEqual(event.before_data,{playerId:event.entity_id,name,archived:false});assert.deepEqual(event.after_data,{playerId:event.entity_id,name,archived:true});
 }
 assert.doesNotMatch(JSON.stringify(events),/password|private|futurePrivate|ignored|native-P|id-P/);
 const saved={business:await f.business(),events:await f.events(),revision:await f.revision()};
 assert.deepEqual(await f.archive(ids,space),{revision:before+1,changed:false,players:ids.map(playerId=>({playerId,archived:true}))});
 assert.deepEqual({business:await f.business(),events:await f.events(),revision:await f.revision()},saved);
 assert.deepEqual(await f.archive(ids,space,false),{revision:before+2,changed:true,players:ids.map(playerId=>({playerId,archived:false}))});
 for(const [i,id] of ids.entries()){
  const row=await f.player(space,id);assert.deepEqual(row.data,{...archived[i].data,archived:false,restoreAt:row.data.restoreAt,restoreBy:f.president});
 }
 assert.deepEqual(await f.business(space,ids),protectedRows);assert.equal((await f.events()).length,4);
 const single=await f.rpc('papa_player_archive',[space,'P3',before+2,f.context(space),true]);
 assert.equal(single.revision,before+3);assert.equal(single.changed,true,'original single-player API remains usable');
});

test('mixed noops touch only changed targets and revision conflicts/concurrent batches cannot overwrite a newer commit',async t=>{
 const f=await fixture(t),before=await f.revision();
 assert.equal((await f.archive(['P1','P2'],'space-001',false)).changed,false);assert.equal((await f.events()).length,0);
 await f.archive(['P1']);const already=await f.player('space-001','P1');
 assert.equal((await f.archive(['P1','P2'])).revision,before+2);assert.deepEqual(await f.player('space-001','P1'),already);assert.equal((await f.events()).length,2);
 const snapshot={business:await f.business(),events:await f.events(),revision:await f.revision()};
 await assert.rejects(f.archive(['P1','P2'],'space-001',true,{expected:before}),/VERSION_CONFLICT/);
 assert.deepEqual({business:await f.business(),events:await f.events(),revision:await f.revision()},snapshot);
 await f.archive(['P1','P2'],'space-001',false);const expected=await f.revision();
 const outcomes=await Promise.allSettled([f.archive(['P1','P2'],'space-001',true,{expected}),f.archive(['P3'],'space-001',true,{expected})]);
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);assert.match(outcomes.find(result=>result.status==='rejected').reason.message,/VERSION_CONFLICT/);
 assert.equal(await f.revision(),expected+1);
});

test('every target is validated before changes; active queues in any own-Space room block the whole batch and restore retains them',async t=>{
 const f=await fixture(t);
 for(const [space,room] of [['space-001','legacy-other'],[nativeSpace,'batch-sibling']]){
  for(const status of ['pending','waiting']){
   const id=room+'-'+status;
   await f.q("insert into papa_v2_entities(kind,id,data) values('queue',$1,$2)",[id,{id,streamer_id:room,playerId:'P2',status}]);
   const before={business:await f.business(),events:await f.events(),revision:await f.revision()};
   await assert.rejects(f.archive(['P1','P2'],space),/PLAYER_ARCHIVE_PENDING_QUEUE/);
   assert.deepEqual({business:await f.business(),events:await f.events(),revision:await f.revision()},before);
   await f.q("update papa_v2_entities set data=jsonb_set(data,'{status}','\"completed\"') where kind='queue' and id=$1",[id]);
  }
 }
 await f.q("insert into papa_v2_entities(kind,id,data) values('queue','foreign-waiting',$1),('queue','unselected-waiting',$2)",[
  {id:'foreign-waiting',streamer_id:'batch-foreign',playerId:'P1',status:'waiting'},
  {id:'unselected-waiting',streamer_id:'papa',playerId:'P3',status:'waiting'}]);
 assert.equal((await f.archive(['P1','P2'])).changed,true);assert.equal((await f.archive(['P1','P2'],nativeSpace)).changed,true);
 await f.q("insert into papa_v2_entities(kind,id,data) values('queue','restore-retains-queue',$1)",[{id:'restore-retains-queue',streamer_id:'papa',playerId:'P1',status:'waiting'}]);
 const queued=await f.q("select data from papa_v2_entities where kind='queue' and id='restore-retains-queue'");
 assert.equal((await f.archive(['P1','P2'],'space-001',false)).changed,true);
 assert.deepEqual(await f.q("select data from papa_v2_entities where kind='queue' and id='restore-retains-queue'"),queued);
});

test('a later player audit failure rolls back prior updates, all audit rows, timestamps and revision',async t=>{
 const f=await fixture(t);
 await f.db.exec("create function fixture_reject_second_batch_audit() returns trigger language plpgsql as $$begin if new.action in ('playerArchive','playerRestore') then if new.target_player_name_snapshot is distinct from new.after_data->>'name' or new.actor_role<>'president' or (select count(*) from jsonb_object_keys(new.after_data))<>3 then raise exception 'FIXTURE_BAD_SUMMARY';end if;if (select count(*) from papa_events where action in ('playerArchive','playerRestore'))>=1 then raise exception 'FIXTURE_SECOND_AUDIT_FAILED';end if;end if;return new;end$$;create trigger zz_fixture_batch_audit before insert on papa_events for each row execute function fixture_reject_second_batch_audit();");
 for(const space of ['space-001',nativeSpace]){
  const before={business:await f.business(),events:await f.events(),revision:await f.revision()};
  await assert.rejects(f.archive(['P1','P2'],space),/FIXTURE_SECOND_AUDIT_FAILED/);
  assert.deepEqual({business:await f.business(),events:await f.events(),revision:await f.revision()},before);
  assert.equal((await f.q("select coalesce(current_setting('papa.actor_context',true),'') context"))[0].context,'');
 }
});

test('batch bounds, malformed/duplicate IDs, cross-Space targets and forged/disabled/revoked Presidents are rejected without writes',async t=>{
 const f=await fixture(t),snapshot=async()=>({business:await f.business(),events:await f.events(),revision:await f.revision()});
 const before=await snapshot();
 for(const ids of [null,[],['P1','P1'],['P1',null],['P1',''],[' P1'],['P1\n'],['x'.repeat(201)],Array(101).fill('P1')])
  await assert.rejects(f.archive(ids),/PLAYER_ARCHIVE_INPUT_INVALID/);
 for(const [space,ids] of [['space-001',['P1','PF']],[nativeSpace,['P1','L1']],[nativeSpace,['P1','PF']]])
  await assert.rejects(f.archive(ids,space),/PLAYER_ARCHIVE_TARGET_INVALID/);
 for(const actor of [null,{},JSON.stringify('invalid'),{...f.context(),role:'player'},{...f.context(),role:'streamer_admin'},f.context('space-001',f.ordinary),
  f.context('space-001',f.subjects.P1),{...f.context(),account_id:'bad-uuid'},f.context(nativeSpace),{...f.context(),streamer_id:'papa'}])
  await assert.rejects(f.rpc('papa_players_archive',['space-001',['P1','P2'],await f.revision(),actor,true]),/PLAYER_ARCHIVE_ACTOR_INVALID/);
 for(const args of [['space-001',['P1'],null,f.context(),true],['space-001',['P1'],-1,f.context(),true],['space-001',['P1'],await f.revision(),f.context(),null]])
  await assert.rejects(f.rpc('papa_players_archive',args),/PLAYER_ARCHIVE_INPUT_INVALID/);
 for(const scope of [null,'','unknown'])await assert.rejects(f.archive(['P1'],scope),/PLAYER_ARCHIVE_SCOPE_INVALID/);
 await f.q('update papa_accounts set disabled_at=now() where id=$1',[f.president]);await assert.rejects(f.archive(),/PLAYER_ARCHIVE_ACTOR_INVALID/);
 await f.q('update papa_accounts set disabled_at=null where id=$1',[f.president]);
 const role=(await f.q('select granted_at::text stamp from papa_platform_roles where account_id=$1',[f.president]))[0].stamp;
 await f.q('delete from papa_platform_roles where account_id=$1',[f.president]);await assert.rejects(f.archive(),/PLAYER_ARCHIVE_ACTOR_INVALID/);
 await f.q("insert into papa_platform_roles(account_id,role,granted_at) values($1,'president',$2)",[f.president,role]);
 await f.q("update papa_spaces set status='suspended' where id=$1",[nativeSpace]);await assert.rejects(f.archive(['P1'],nativeSpace),/PLAYER_ARCHIVE_SCOPE_INVALID/);
 await f.q("update papa_spaces set status='active' where id=$1",[nativeSpace]);assert.deepEqual(await snapshot(),before);
 for(const browser of ['anon','authenticated']){
  assert.equal((await f.q('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[browser,batchSignature]))[0].allowed,false);
  await f.db.exec('set role '+browser);try{await assert.rejects(f.archive(['P1','P2'],'space-001',true,{expected:before.revision}),/permission denied/);}finally{await f.db.exec('reset role');}
 }
 assert.deepEqual(await snapshot(),before);assert.equal((await f.q('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',[batchSignature]))[0].allowed,true);
 await f.db.exec('set role service_role');try{assert.equal((await f.archive(['P1','P2'],'space-001',true,{expected:before.revision,actor:f.context('space-001',f.president,'admin')})).changed,true);}finally{await f.db.exec('reset role');}
});

test('exactly 100 unique player IDs use one revision and one original safe audit per changed player',async t=>{
 const f=await fixture(t),ids=Array.from({length:100},(_,i)=>'BATCH-'+i);
 for(const id of ids)await f.q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,{playerId:id,name:id,password:'retained-'+id,note:'private retained note'}]);
 const protectedRows=await f.business('space-001',ids),before=await f.revision();
 const result=await f.archive(ids);assert.equal(result.revision,before+1);assert.equal(result.players.length,100);assert.equal((await f.events()).length,100);
 assert.deepEqual(result.players,ids.map(playerId=>({playerId,archived:true})));assert.deepEqual(await f.business('space-001',ids),protectedRows);
 for(const id of ['BATCH-0','BATCH-99'])assert.equal((await f.player('space-001',id)).data.password,'retained-'+id);
});
