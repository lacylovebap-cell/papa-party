import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {savedQuota} from '../src/core.js';
import {venuePolicyBalance} from '../src/venue-policy.js';

const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const nativeSpace='bulk-native-space',nativeRoom='bulk-native-room',foreignSpace='bulk-foreign-space';
const signatures=['papa_song_favorites_set_batch(text,text,jsonb,text[],boolean)',
 'papa_player_streamer_summary(text,jsonb,integer,integer)','papa_player_song_choices(text,text,jsonb,text,text[],integer,integer,boolean)'];

async function fixture(t){
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql'])await db.exec(migration(name));
 const legacyRooms=[{id:'papa',slug:'legacy-slug',display_name:'Busy',active:true},{id:'idle-room',slug:'idle',display_name:'Idle',active:true},
  {id:'preparing-room',slug:'preparing',display_name:'Preparing',active:true},{id:'paused-room',slug:'paused',display_name:'Paused',active:true},
  {id:'inactive-room',slug:'inactive',display_name:'Inactive',active:false}];
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1),('settings','1',$2)",[
  {schemaVersion:3,streamers:legacyRooms,streamerSettings:{papa:{status:'忙碌中',radio_enabled:true,current_space:'radio'},
   'idle-room':{status:'空閒中'},'preparing-room':{status:'準備中'},'paused-room':{status:'暫停點歌'},'inactive-room':{status:'空閒中'}}},
  {status:'空閒中',hourlyLimit:2}]);
 for(const id of ['P1','P2'])await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,
  {playerId:id,name:'Legacy '+id,ids:['login-'+id],names:[],password:'original private password',note:'original private player note'}]);
 for(const name of ['202610010001_shared_catalog.sql','202610010007_catalog_language_filters.sql','202610010009_validated_room_lyrics.sql',
  '202610070001_space_foundation.sql','202610070002_device_sessions.sql','202610070003_verified_identity_binding.sql',
  '202610070004_audit_actor_snapshots.sql','202610070009_scoped_read_snapshot.sql'])await db.exec(migration(name));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 await db.exec(migration('202610070013_space_player_profiles.sql'));
 const communication=migration('202610080012_communication_space.sql');
 for(const name of ['papa_communication_player_name','papa_communication_player_exists','papa_native_meta_audit_projection','papa_event_actor_snapshot']){
  const start=communication.indexOf('function '+name+'('),statement=communication.lastIndexOf('create ',start);
  await db.exec(communication.slice(statement,communication.indexOf('$$;',start)+3));
 }
 const favorites=migration('202610090009_song_favorites.sql');await db.exec(favorites.slice(0,favorites.indexOf('-- Extend the established'))+'commit;');
 const quotas=migration('202610090004_player_extra_quota.sql');
 await db.exec(quotas.slice(quotas.indexOf('create table public.papa_player_extra_quotas'),quotas.indexOf('create function')));
 const compatibility=migration('202610090015_quota_native_compatibility.sql');
 await db.exec(compatibility.slice(0,compatibility.indexOf('-- Preserve the released session-based signature'))+'commit;');
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const player=await account(),other=await account(),unbound=await account(),members={};
 for(const [id,subject] of [['P1',player],['P2',other]]){
  await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[subject,id]);
  members['legacy-'+id]=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player') returning id",[subject]))[0].id;
 }
 await q('insert into papa_spaces(id,slug,display_name) values($1,$1,$1),($2,$2,$2)',[nativeSpace,foreignSpace]);
 for(const [room,space] of [[nativeRoom,nativeSpace],['bulk-native-paused',nativeSpace],['bulk-foreign-room',foreignSpace]])
  await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[room,space]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const [id,status] of [[nativeRoom,'空閒中'],['bulk-native-paused','暫停點歌'],['bulk-foreign-room','空閒中']]){
  meta.streamers.push({id,slug:id,display_name:id,active:true});meta.streamerSettings[id]={status,radio_enabled:true,current_space:'radio'};
 }
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 for(const [id,subject] of [['P1',player],['P2',other]]){
  const member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[subject,nativeSpace]))[0].id;
  members['native-'+id]=member;await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
   [nativeSpace,id,subject,member,{playerId:id,name:'Native '+id,ids:['native-'+id],names:[],note:'native private profile note'}]);
 }
 const family=(await q("insert into papa_catalog_families(title) values('Original family') returning id"))[0].id;
 const variant=(await q("insert into papa_catalog_variants(family_id,title,artist,language_id,performer_type_id,version_label) values($1,'Shared title','Shared artist','mandarin','female','Original version') returning id",[family]))[0].id;
 const originalSongs={};
 for(const room of ['papa',nativeRoom,'idle-room','bulk-foreign-room'])for(let i=0;i<55;i++){
  const id=room+'-S'+i,data={songId:id,streamer_id:room,title:'Original '+i,artist:'Original artist',tags:i===0||i===2?['A','B']:i===1?['A']:['Other'],
   new:i===0,creditCost:i===0||i===2?0.5:1,shortMode:i===0?'pair':'repeat',pairSongIds:i===0?[room+'-S2','idle-room-S0',room+'-S54']:[],
   hidden:i===54,deleted:i===53,active:i!==52,available:i!==51,disabled:i===50,lyrics:'never output private lyric needle',
   privateNotes:'private catalog note',futurePrivate:{body:'private future source'},_order:i};
  originalSongs[id]=data;await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,data]);
  if(i===0||i===1)await q('insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values($1,$2,$3,papa_catalog_source_hash($4))',
   [room,id,variant,i===0?data:{...data,title:'Stale source title'}]);
 }
 const current=(await q('select now()::text value'))[0].value,old=(await q("select (now()-interval '2 hours')::text value"))[0].value;
 const taipei=(await q("select to_char(now() at time zone 'Asia/Taipei','YYYY-MM-DD HH24:MI:SS') value"))[0].value;
 for(const [room,space] of [['papa','space-001'],[nativeRoom,nativeSpace]]){
  await q("insert into papa_player_extra_quotas(streamer_id,player_id,space_id,extra_quota,updated_by) values($1,'P1',$2,5,'original label')",[room,space]);
  for(const [suffix,amount,pool] of [['legacy',10,undefined],['radio',6,'radio'],['other-player',99,'radio']])
   await q("insert into papa_v2_entities(kind,id,data) values('ledger',$1,$2)",[room+'-'+suffix,{id:room+'-'+suffix,streamer_id:room,playerId:suffix==='other-player'?'P2':'P1',amount,...(pool?{storage_pool:pool}:{}),note:'private ledger history'}]);
  for(const [suffix,data] of [['done',{kind:'saved',status:'completed',creditCost:2,at:old,quota_effective_at:current,venue:'shengma'}],
   ['wait',{kind:'saved',status:'waiting',creditCost:0.5,at:taipei,venue:'radio'}],
   ['test',{kind:'saved',status:'completed',creditCost:1,at:current,test:true,selfProvided:true}],
   ['pending-live',{kind:'live',status:'pending',creditCost:99,at:current}],['old',{kind:'saved',status:'waiting',creditCost:9,at:old}],
   ['cancelled',{kind:'saved',status:'cancelled',creditCost:99,at:current}],['bad-date',{kind:'saved',status:'completed',creditCost:99,at:'invalid'}],
   ['other-player',{kind:'saved',status:'waiting',creditCost:99,at:current,playerId:'P2'}]])
   await q("insert into papa_v2_entities(kind,id,data) values('queue',$1,$2)",[room+'-'+suffix,{id:room+'-'+suffix,streamer_id:room,playerId:'P1',...data,title:suffix==='other-player'?'another player title':'own waiting title',privateHistory:['private keep source']}]);
 }
 const actor=(room='papa',space='space-001',subject=player,id='P1')=>({role:'player',account_id:subject,space_id:space,streamer_id:room,player_id:id});
 const batch=(ids,desired=true,context=actor())=>rpc('papa_song_favorites_set_batch',[context.space_id,context.streamer_id,context,ids,desired]);
 const summary=(context=actor(),limit=20,offset=0)=>rpc('papa_player_streamer_summary',[context.space_id,context,limit,offset]);
 const choices=(context=actor(),query='',tags=[],limit=20,offset=0,random=false)=>rpc('papa_player_song_choices',[context.space_id,context.streamer_id,context,query,tags,limit,offset,random]);
 const allFavorites=()=>q('select to_jsonb(f) row from papa_song_favorites f order by account_id,space_id,streamer_id,song_id');
 const events=()=>q("select id,streamer_id,entity_id,action,actor_role,actor_account_id,actor_player_id,actor_display_name_snapshot,target_player_name_snapshot,space_id,before_data,after_data from papa_events where entity_kind='song_favorites' order by id");
 const business=async()=>{
  const result={};for(const [table,order] of [['papa_v2_entities','kind,id'],['papa_v2_revision','id'],['papa_accounts','id'],['papa_space_memberships','id'],
   ['papa_account_legacy_players','account_id'],['papa_space_player_profiles','space_id,player_id'],['papa_v2_sessions','token_hash'],
   ['papa_player_extra_quotas','streamer_id,player_id'],['papa_catalog_song_links','streamer_id,song_id'],['papa_catalog_variants','id'],
   ['papa_notifications','id'],['papa_push_jobs','id']])result[table]=await q('select to_jsonb(source) row from '+table+' source order by '+order);
  return result;
 };
 const baseline={business:await business(),favorites:await allFavorites(),events:await events()};
 await db.exec(migration('202610100019_player_bulk_tools.sql'));assert.deepEqual({business:await business(),favorites:await allFavorites(),events:await events()},baseline);
 await db.exec(migration('202610120003_common_first_quota_summary.sql'));assert.deepEqual({business:await business(),favorites:await allFavorites(),events:await events()},baseline);
 return {db,q,rpc,player,other,unbound,members,actor,batch,summary,choices,allFavorites,events,business,originalSongs,current,variant};
}

test('own queue page is read-only, bounded, owner/Space scoped, current-room first and safe for inactive-room cancellation',async t=>{
 const f=await fixture(t),before=await f.business(),events=await f.events();
 await f.db.exec(migration('202610120006_player_own_queue_page.sql'));assert.deepEqual(await f.business(),before);assert.deepEqual(await f.events(),events);
 const page=(context=f.actor(),sort='newest',limit=20,offset=0)=>f.rpc('papa_player_queue_page',[context.space_id,context,sort,limit,offset]);
 const initial=await page();assert.equal(initial.total,3);assert.ok(initial.rows.every(row=>row.streamerId==='papa'));assert.doesNotMatch(JSON.stringify(initial),/private|password|another player/);
 await f.q("insert into papa_v2_entities(kind,id,data) values('queue','inactive-own',$1),('queue','idle-own',$2)",[
  {id:'inactive-own',streamer_id:'inactive-room',playerId:'P1',kind:'saved',status:'waiting',title:'Inactive',at:f.current,lyrics:'private lyrics'},
  {id:'idle-own',streamer_id:'idle-room',playerId:'P1',kind:'live',status:'pending',title:'Idle',at:f.current,privateHistory:['private source']}]);
 const all=await page();assert.equal(all.total,5);assert.ok(all.rows.slice(0,3).every(row=>row.streamerId==='papa'));assert.equal(all.rows.find(row=>row.id==='inactive-own').active,false);
 const first=await page(f.actor(),'oldest',1,0),second=await page(f.actor(),'oldest',1,1);assert.notEqual(first.rows[0].id,second.rows[0].id);assert.equal(first.total,5);
 assert.equal((await page(f.actor('papa','space-001',f.other,'P2'))).total,1);
 assert.ok((await page(f.actor(nativeRoom,nativeSpace))).rows.every(row=>row.streamerId===nativeRoom));
 for(const context of [f.actor('papa','space-001',f.unbound),f.actor('papa','space-001',f.player,'P2'),f.actor('papa',nativeSpace),{...f.actor(),role:'admin'}])await assert.rejects(page(context),/SONG_FAVORITES_(ACTOR|SCOPE)_INVALID/);
 for(const args of [['invalid',20,0],['newest',21,0],['newest',20,-1]])await assert.rejects(page(f.actor(),...args),/PLAYER_QUEUE_PAGE_INVALID/);
 for(const role of ['anon','authenticated']){
  await f.db.exec('set role '+role);await assert.rejects(page(),/permission denied/);await f.db.exec('reset role');
 }
 assert.doesNotMatch(JSON.stringify(all),/private|lyrics|account|membership|ledger|other-player/);assert.deepEqual(await f.events(),events);
});

test('carry read migration changes quota eligibility without rewriting formal records or permissions',async t=>{
 const f=await fixture(t),before=await f.summary(),get=result=>result.rows.find(row=>row.streamerId==='papa');
 const compat=migration('202610090015_quota_native_compatibility.sql'),start=compat.indexOf('create function public.papa_extra_quota_snapshot_metadata(snapshot jsonb,requested_room text,allowed_space text,quota_player text)');
 await f.db.exec(compat.slice(start,compat.indexOf('-- Preserve the released three-argument',start)>start?compat.indexOf('-- Preserve the released three-argument',start):compat.indexOf('create or replace function public.papa_extra_quota_snapshot_metadata',start)));
 const old='2020-01-01T00:00:00Z';
 for(const [id,flag] of [['carry-live',true],['ordinary-live',false],['invalid-flag','true']])
  await f.q("insert into papa_v2_entities(kind,id,data) values('queue',$1,$2)",[id,{id,streamer_id:'papa',playerId:'P1',kind:'live',status:'completed',at:old,quota_effective_at:f.current,quota_carried:flag,creditCost:1}]);
 assert.equal(get(await f.summary()).personalRemaining,get(before).personalRemaining);
 const protectedRows=await f.business(),events=await f.q('select to_jsonb(e) row from papa_events e order by id');
 const acl=()=>f.q("select oid::regprocedure::text signature,proacl from pg_proc where oid in ('public.papa_extra_quota_snapshot_metadata(jsonb,text,text,text)'::regprocedure,'public.papa_player_streamer_summary(text,jsonb,integer,integer)'::regprocedure) order by 1");
 const permissions=await acl();await f.db.exec(migration('202610120005_queue_hour_carry.sql'));
 assert.deepEqual(await f.business(),protectedRows);assert.deepEqual(await f.q('select to_jsonb(e) row from papa_events e order by id'),events);assert.deepEqual(await acl(),permissions);
 assert.equal(get(await f.summary()).personalRemaining,get(before).personalRemaining-1);
 for(const [data,expected] of [[{kind:'saved'},true],[{kind:'live',status:'completed',quota_carried:true},true],[{kind:'live',status:'waiting',quota_carried:true},false],[{kind:'live',status:'completed',quota_carried:'true'},false],[{},false]])
  assert.equal((await f.q('select papa_queue_uses_quota($1) eligible',[data]))[0].eligible,expected);
 const rows=(await f.q("select data from papa_v2_entities where kind='queue' and data->>'streamer_id'='papa'")).map(r=>r.data);
 const core=savedQuota({queue:rows,currentStreamer:{id:'papa'},settings:{hourlyLimit:2},extraQuotas:[{streamer_id:'papa',player_id:'P1',extra_quota:5,enabled:true}]},f.current,'P1');
 assert.equal(get(await f.summary()).personalRemaining,core.extraRemaining);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await f.q("select has_function_privilege($1,'public.papa_queue_uses_quota(jsonb)','EXECUTE') allowed",[role]))[0].allowed,false);
 await f.q("insert into papa_player_extra_quotas(streamer_id,player_id,space_id,extra_quota,updated_by) values('papa','P2','space-001',2,'local fixture')");
 const snapshot={rows:[{kind:'meta',id:'1',data:{streamers:[{id:'papa',active:true}]}},{kind:'players',id:'P2',data:{playerId:'P2'}},{kind:'queue',id:'carry-P2',data:{streamer_id:'papa',playerId:'P2',kind:'live',status:'completed',quota_carried:true}}]};
 const enriched=await f.rpc('papa_extra_quota_snapshot_metadata',[snapshot,'papa','space-001',null]);
 assert.deepEqual(enriched.extraQuotas,[{streamer_id:'papa',player_id:'P2',extra_quota:2,enabled:true}]);
});

for(const [space,room,name] of [['space-001','papa','Legacy P1'],[nativeSpace,nativeRoom,'Native P1']])test(room+' favorites batch is own-bound, idempotent, one summarized audit and independent of accounting/source data',async t=>{
 const f=await fixture(t),context=f.actor(room,space),ids=[room+'-S0',room+'-S1',room+'-S2'],protectedRows=await f.business();
 assert.deepEqual(await f.batch(ids,true,context),{changed:true,rows:ids.map(songId=>({songId,favorite:true}))});
 const saved=await f.allFavorites(),audit=await f.events();assert.equal(saved.length,3);assert.equal(audit.length,1);
 assert.equal(audit[0].actor_account_id,context.account_id);assert.equal(audit[0].actor_role,'player');assert.equal(audit[0].actor_player_id,'P1');
 assert.equal(audit[0].actor_display_name_snapshot,name);assert.equal(audit[0].target_player_name_snapshot,name);assert.equal(audit[0].space_id,space);
 assert.deepEqual(audit[0].after_data.songs.map(row=>row.songSnapshot),[{title:'Shared title',artist:'Shared artist'},
  {title:'Original 1',artist:'Original artist'},{title:'Original 2',artist:'Original artist'}]);
 assert.doesNotMatch(JSON.stringify(audit),/private|password|lyrics|futurePrivate|source_hash/);
 const noops=await Promise.all([f.batch(ids,true,context),f.batch([...ids].reverse(),true,context)]);assert.ok(noops.every(row=>row.changed===false));
 assert.deepEqual(await f.allFavorites(),saved);assert.deepEqual(await f.events(),audit);assert.deepEqual(await f.business(),protectedRows);
 await f.rpc('papa_song_favorite_set',[space,room,context,room+'-S3',true]);
 await f.batch([room+'-S0',room+'-S3'],false,context);assert.equal((await f.events()).length,3);
 assert.deepEqual(await f.business(),protectedRows);assert.equal((await f.allFavorites()).length,4,'unfavorite retains preference rows for recovery');
 assert.equal((await f.batch(ids,false,f.actor(room,space,f.other,'P2'))).changed,false,'another verified player does not mutate this owner');
});

test('batch validates all songs before writes, preserves hidden/deleted favorites and rolls back preference/audit changes together',async t=>{
 const f=await fixture(t),snapshot=async()=>({business:await f.business(),favorites:await f.allFavorites(),events:await f.events()});
 const before=await snapshot();
 for(const ids of [['papa-S0','papa-S54'],['papa-S0','papa-S53'],['papa-S0','bulk-native-room-S0'],['papa-S0','missing']]){
  await assert.rejects(f.batch(ids),/SONG_FAVORITES_SONG_INVALID/);assert.deepEqual(await snapshot(),before);
 }
 await f.batch(['papa-S0','papa-S1']);const source=(await f.q("select data from papa_v2_entities where kind='songs' and id='papa-S0'"))[0].data;
 await f.q("update papa_v2_entities set data=data||'{\"hidden\":true}' where kind='songs' and id='papa-S0'");
 await f.q("delete from papa_v2_entities where kind='songs' and id='papa-S1'");
 assert.equal((await f.batch(['papa-S0','papa-S1'],false)).changed,true);const retained=await f.allFavorites();assert.equal(retained.length,2);assert.ok(retained.every(row=>row.row.is_favorite===false));
 await f.q("update papa_v2_entities set data=$1 where kind='songs' and id='papa-S0'",[source]);
 await f.db.exec("create function fixture_reject_favorite_batch_audit() returns trigger language plpgsql as $$begin if new.action='favoriteBatchSet' then raise exception 'FIXTURE_BATCH_AUDIT_FAILED';end if;return new;end$$;create trigger zz_fixture_favorite_batch before insert on papa_events for each row execute function fixture_reject_favorite_batch_audit();");
 const protectedRows=await snapshot();await assert.rejects(f.batch(['papa-S0','papa-S2']),/FIXTURE_BATCH_AUDIT_FAILED/);assert.deepEqual(await snapshot(),protectedRows);
});

test('own streamer summary counts/grouped weighted quotas match Core, isolate Space/player, sort status and never expose source bodies',async t=>{
 const f=await fixture(t),protectedRows=await f.business();
 for(const [space,room] of [['space-001','papa'],[nativeSpace,nativeRoom]]){
  const context=f.actor(room,space),result=await f.summary(context),row=result.rows.find(row=>row.streamerId===room);
  assert.equal(row.storedCredits,6);assert.equal(row.waitingCount,3);assert.equal(row.personalRemaining,3.5);assert.equal(row.waitingTitle,'own waiting title');
  const queue=(await f.q("select data from papa_v2_entities where kind='queue' and space_id=$1 and data->>'streamer_id'=$2",[space,room])).map(row=>row.data);
  const ledger=(await f.q("select data from papa_v2_entities where kind='ledger' and space_id=$1 and data->>'streamer_id'=$2",[space,room])).map(row=>row.data);
  const core={currentStreamer:{id:room},settings:{hourlyLimit:2},queue,ledger,extraQuotas:[{streamer_id:room,player_id:'P1',extra_quota:5,enabled:true}]};
  assert.equal(row.personalRemaining,savedQuota(core,f.current,'P1').extraRemaining);assert.equal(row.storedCredits,venuePolicyBalance(core,'P1','radio'));
  assert.ok(result.rows.every(row=>Object.keys(row).sort().join(',')==='name,personalRemaining,slug,status,storedCredits,streamerId,waitingCount,waitingTitle'));
  assert.ok(result.rows.every(row=>row.streamerId!=='inactive-room'&&row.streamerId!=='bulk-foreign-room'));
  assert.deepEqual(result.rows.map(row=>row.status),space==='space-001'?['idle','preparing','busy','paused']:['idle','paused']);
  const first=await f.summary(context,1,0),second=await f.summary(context,1,1);assert.equal(first.total,result.total);assert.deepEqual(first.rows.concat(second.rows),result.rows.slice(0,2));
  const other=await f.summary(f.actor(room,space,f.other,'P2'));assert.equal(other.rows.find(row=>row.streamerId===room).storedCredits,99);assert.equal(other.rows.find(row=>row.streamerId===room).personalRemaining,0);
  assert.doesNotMatch(JSON.stringify(result),/another player title|private|password|account|membership|history|quota_effective|creditCost/);
 }
 assert.deepEqual(await f.business(),protectedRows);assert.equal((await f.events()).length,0);
});

test('visible song choices apply query and AND tags before count/page, share current catalog metadata and return bounded safe pair/tag options',async t=>{
 const f=await fixture(t),protectedRows=await f.business();
 for(const [space,room] of [['space-001','papa'],[nativeSpace,nativeRoom]]){
  const context=f.actor(room,space),all=await f.choices(context);assert.equal(all.total,50);assert.equal(all.rows.length,20);
  assert.deepEqual(all.tagOptions,['A','B','Other','新練']);
  const first=await f.choices(context,'',['A','B'],1,0),second=await f.choices(context,'',['A','B'],1,1);
  assert.equal(first.total,2);assert.equal(second.total,2);assert.deepEqual([first.rows[0].songId,second.rows[0].songId],[room+'-S0',room+'-S2']);
  assert.deepEqual(first.tagOptions,all.tagOptions,'options are from all visible rows before the selected filters');
  assert.equal(first.rows[0].title,'Shared title');assert.deepEqual(first.rows[0].pairSongIds,[room+'-S2']);
  assert.deepEqual(first.rows[0].pairOptions,[{songId:room+'-S2',title:'Original 2',artist:'Original artist'}]);assert.equal(first.rows[0].creditCost,0.5);
  assert.deepEqual((await f.choices(context,'Shared artist')).rows.map(row=>row.songId),[room+'-S0']);
  assert.equal((await f.choices(context,'Original 1')).rows.some(row=>row.songId===room+'-S1'),true,'stale catalog source links preserve the local name');
  assert.equal((await f.choices(context,'private')).total,0);assert.equal((await f.choices(context,'',['新練'])).total,1);
  assert.deepEqual((await f.choices(context,'',['A','B'],1,2)).rows,[]);
  for(let i=0;i<4;i++){
   const random=await f.choices(context,'',['A','B'],1,0,true);assert.equal(random.total,2);assert.equal(random.rows.length,1);assert.ok([room+'-S0',room+'-S2'].includes(random.rows[0].songId));
  }
  assert.doesNotMatch(JSON.stringify(all),/private|lyrics|account|membership|history|source_hash|futurePrivate/);
  assert.ok(all.rows.every(row=>Object.keys(row).sort().join(',')==='artist,creditCost,pairOptions,pairSongIds,shortMode,songId,tags,title'));
 }
 assert.deepEqual(await f.business(),protectedRows);
});

test('all new tools reject forged identities, inactive/cross scopes and browser callers; desired-state bounds and single APIs remain intact',async t=>{
 const f=await fixture(t),protectedRows=await f.business(),saved=await f.allFavorites();
 for(const context of [f.actor('papa','space-001',f.unbound),f.actor('papa','space-001',f.player,'P2'),{...f.actor(),role:'super_admin'},
  {...f.actor(),account_id:'invalid'},f.actor('papa',nativeSpace),f.actor('inactive-room')]){
  await assert.rejects(f.batch(['papa-S0'],true,context),/SONG_FAVORITES_(ACTOR|SCOPE)_INVALID/);
  await assert.rejects(f.summary(context),/SONG_FAVORITES_(ACTOR|SCOPE)_INVALID/);
  await assert.rejects(f.choices(context),/SONG_FAVORITES_(ACTOR|SCOPE)_INVALID/);
 }
 for(const ids of [null,[],['papa-S0','papa-S0'],['papa-S0',null],[''],[' papa-S0'],Array(51).fill('papa-S0')])await assert.rejects(f.batch(ids),/SONG_FAVORITES_INPUT_INVALID/);
 for(const [limit,offset] of [[0,0],[51,0],[20,-1],[20,10000001]])await assert.rejects(f.summary(f.actor(),limit,offset),/PLAYER_STREAMER_PAGE_INVALID/);
 for(const [query,tags,limit,offset,random] of [['q'.repeat(101),[],20,0,false],['',[],21,0,false],['',[],1,1,true],['',[],20,0,true],['',[null],20,0,false]])
  await assert.rejects(f.choices(f.actor(),query,tags,limit,offset,random),/PLAYER_SONG_CHOICES_INPUT_INVALID/);
 await f.q('update papa_accounts set disabled_at=now() where id=$1',[f.player]);await assert.rejects(f.summary(),/SONG_FAVORITES_ACTOR_INVALID/);
 await f.q('update papa_accounts set disabled_at=null where id=$1',[f.player]);
 await f.q("update papa_space_memberships set status='suspended' where id=$1",[f.members['legacy-P1']]);await assert.rejects(f.batch(['papa-S0']),/SONG_FAVORITES_ACTOR_INVALID/);
 await f.q("update papa_space_memberships set status='active' where id=$1",[f.members['legacy-P1']]);
 for(const browser of ['anon','authenticated']){
  for(const signature of signatures)assert.equal((await f.q('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[browser,'public.'+signature]))[0].allowed,false);
  await f.db.exec('set role '+browser);try{
   await assert.rejects(f.batch(['papa-S0']),/permission denied/);await assert.rejects(f.summary(),/permission denied/);await assert.rejects(f.choices(),/permission denied/);
  }finally{await f.db.exec('reset role');}
 }
 assert.deepEqual(await f.business(),protectedRows);assert.deepEqual(await f.allFavorites(),saved);
 const ids=Array.from({length:50},(_,i)=>'papa-S'+i);assert.equal((await f.batch(ids)).rows.length,50);assert.equal((await f.events()).length,1);
 assert.equal((await f.rpc('papa_song_favorite_set',['space-001','papa',f.actor(),'papa-S0',true])).changed,false,'original single API sees the batch state');
 for(const signature of signatures)assert.equal((await f.q('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',['public.'+signature]))[0].allowed,true);
 assert.equal((await f.q("select has_function_privilege('service_role','public.papa_player_quota_time(jsonb)','EXECUTE') allowed"))[0].allowed,false);
});

test('large public tag and pair option sets stay bounded, and invalid own pool metadata cannot understate credits',async t=>{
 const f=await fixture(t),pairs=Array.from({length:60},(_,i)=>'papa-PAIR'+i);
 for(const id of pairs)await f.q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,
  {songId:id,streamer_id:'papa',title:id,artist:'Pair artist',tags:[],creditCost:0.5}]);
 const source=(await f.q("select data from papa_v2_entities where kind='songs' and id='papa-S0'"))[0].data;
 await f.q("update papa_v2_entities set data=$1 where kind='songs' and id='papa-S0'",[
  {...source,pairSongIds:pairs,tags:Array.from({length:150},(_,i)=>'Unique'+String(i).padStart(3,'0'))}]);
 const protectedRows=await f.business(),choices=await f.choices(f.actor(),'',['Unique000']);
 assert.equal(choices.total,1);assert.equal(choices.rows[0].pairOptions.length,50);assert.equal(choices.rows[0].pairSongIds.length,50);
 assert.equal(choices.tagOptions.length,100);assert.ok(choices.tagOptions.includes('新練'));
 assert.ok(choices.tagOptions.every(tag=>typeof tag==='string'&&tag.length<=100));assert.deepEqual(await f.business(),protectedRows);
 await f.q("insert into papa_v2_entities(kind,id,data) values('ledger','bad-own-pool',$1)",[
  {id:'bad-own-pool',streamer_id:'papa',playerId:'P1',amount:1,storage_pool:'unknown'}]);
 await assert.rejects(f.summary(),/PLAYER_STREAMER_DATA_INVALID/);
 assert.equal((await f.summary(f.actor('papa','space-001',f.other,'P2'))).rows.find(row=>row.streamerId==='papa').storedCredits,99);
});
