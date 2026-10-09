import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const archiveMigration='202610090012_player_archive.sql',nativeSpace='space-archive',nativeRoom='archive-room';
const directoryKeys=new Set(['playerId','name','ids','names','certification','test','storedCredits','archived','archiveAt','restoreAt']);

async function fixture(t){
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql',
  '202609280001_manager_passwords.sql','202609250002_private_chat.sql','202609260001_board.sql','202609260002_board_integrity.sql'])await db.exec(migration(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1)",[{schemaVersion:3,streamers:[
  {id:'papa',slug:'papa',display_name:'Legacy Room',active:true},{id:'michelle',slug:'michelle',display_name:'Other Legacy',active:true}],streamerSettings:{papa:{},michelle:{}}}]);
 for(const [id,name] of [['P1','Legacy Alpha'],['P2','Legacy Beta'],['P3','Legacy Gamma'],['L1','Legacy Only']])
  await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,{playerId:id,name,ids:['IDneedle-'+id],names:['Former Needle '+id],
   certification:'verified',test:false,password:'retained legacy password '+id,note:'retained private legacy note',futurePrivate:{keep:['private history']}}]);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)||/^2026100800(?:0[1-9]|10)_/.test(f)).sort())await db.exec(migration(file));
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100700\d\d_/.test(f)||/^20261008001[1-4]_/.test(f)||/^2026100900(?:0[1-9]|10|11)_/.test(f)).sort())await db.exec(migration(file));
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const president=await account(),ordinary=await account(),subjects={};
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[president]);
 await q("insert into papa_spaces(id,slug,display_name) values($1,'archive','Archive Space'),('space-archive-foreign','archive-foreign','Foreign')",[nativeSpace]);
 for(const [id,space] of [[nativeRoom,nativeSpace],['archive-other',nativeSpace],['archive-foreign','space-archive-foreign']])await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,space]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [nativeRoom,'archive-other','archive-foreign']){meta.streamers.push({id,slug:id,display_name:id,active:true});meta.streamerSettings[id]={radio_enabled:true,current_space:'radio'};}
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 for(const id of ['P1','P2','P3']){
  const subject=await account();subjects[id]=subject;
  await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[subject,id]);
  await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player')",[subject]);
  const member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[subject,nativeSpace]))[0].id;
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',[nativeSpace,id,subject,member,
   {playerId:id,name:'Native '+{P1:'Alpha',P2:'Beta',P3:'Gamma'}[id],ids:['Native-IDneedle-'+id],names:['Native Former Needle '+id],
    certification:'native-verified',test:false,note:'retained private native note',futurePrivate:{keep:['private native history']}}]);
 }
 for(const id of ['P1','PF']){
  const subject=await account(),member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-archive-foreign','player') returning id",[subject]))[0].id;
  await q("insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values('space-archive-foreign',$1,$2,$3,$4)",[id,subject,member,{playerId:id,name:'Foreign '+id,note:'foreign private note'}]);
 }
 for(const [room,space] of [['papa','space-001'],['michelle','space-001'],[nativeRoom,nativeSpace],['archive-other',nativeSpace],['archive-foreign','space-archive-foreign']]){
  for(const [kind,suffix,data] of [
   ['songs','song',{songId:room+'-song',title:'Source song',artist:'Artist',lyrics:'retained private lyrics',privateNotes:'retained private catalog note'}],
   ['queue','closed',{id:room+'-closed',playerId:'P1',songId:room+'-song',title:'Closed snapshot',artist:'Artist',status:'completed',kind:'saved',venue:'radio',items:[{songId:room+'-song',performances:2}],privateHistory:'retained closed history'}],
   ['ledger','credits',{id:room+'-credits',playerId:'P1',amount:10,privateHistory:'retained credit history'}],
   ['ledger','radio',{id:room+'-radio',playerId:'P1',amount:6,storage_pool:'radio'}],
   ['ledger','negative',{id:room+'-negative',playerId:'P2',amount:-2}],
   ['crowns','crown',{id:room+'-crown',playerId:'P1',title:'Retained crown',note:'private crown note'}],
   ['cards','card',{id:room+'-card',playerId:'P1',title:'Retained card',note:'private card note'}],
   ['wishes','wish',{id:room+'-wish',playerId:'P1',title:'Retained wish'}]
  ])await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[kind,room+'-'+suffix,{...data,streamer_id:room}]);
  if(space!=='space-archive-foreign'){
   await q('insert into papa_player_extra_quotas(streamer_id,player_id,space_id,extra_quota,updated_by) values($1,\'P1\',$2,3,$3)',[room,space,president]);
   await q("insert into papa_song_favorites(account_id,space_id,player_id,streamer_id,song_id) values($1,$2,'P1',$3,$4)",[subjects.P1,space,room,room+'-song']);
  }
 }
 await q("insert into papa_v2_entities(kind,id,data) values('queue','foreign-waiting',$1)",[{id:'foreign-waiting',streamer_id:'archive-foreign',playerId:'P1',status:'waiting'}]);
 for(const [index,role,space,subject] of [[1,'player','space-001',subjects.P1],[2,'player',nativeSpace,subjects.P1],[3,'president',null,president]]){
  const installation='00000000-0000-4000-8000-00000000000'+index;
  await q("insert into papa_installations(id,platform) values($1,'web')",[installation]);
  const device=(await q('insert into papa_device_sessions(installation_id,account_id,session_kind,role,space_id,refresh_hash,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval \'30 days\') returning id',
   [installation,subject,role==='player'?'player':'manager',role,space,String(index).repeat(64)]))[0].id;
  await q('insert into papa_v2_sessions(token_hash,player_id,role,account_id,device_session_id,expires_at) values($1,$2,$3,$4,$5,now()+interval \'1 day\')',
   [String(index+3).repeat(64),role==='player'?'P1':'__admin__',role==='player'?'player':'super_admin',subject,device]);
 }
 const beforeDirectory=(await q("select pg_get_functiondef('papa_player_management_page(text,text,text,text,integer,integer)'::regprocedure) definition"))[0].definition;
 await db.exec(beforeDirectory.replace('FUNCTION public.papa_player_management_page(','FUNCTION public.papa_player_management_page_before012('));
 const context=(space='space-001',subject=president,role='super_admin')=>({role,account_id:subject,space_id:space,streamer_id:null,action:'ignored caller action',player_id:'ignored caller player'});
 const revision=async()=>Number((await q('select revision from papa_v2_revision where id=1'))[0].revision);
 const archive=async(space='space-001',id='P1',desired=true,actor=context(space),expected=undefined)=>rpc('papa_player_archive',[space,id,expected===undefined?await revision():expected,actor,desired]);
 const player=async(space='space-001',id='P1')=>space==='space-001'?
  (await q("select to_jsonb(entity) row from papa_v2_entities entity where kind='players' and id=$1 and space_id is null",[id]))[0]?.row:
  (await q('select to_jsonb(profile) row from papa_space_player_profiles profile where space_id=$1 and player_id=$2',[space,id]))[0]?.row;
 const business=async(excludedSpace='',excludedPlayer='')=>{
  const result={entities:await q("select to_jsonb(entity) row from papa_v2_entities entity where not ($1='space-001' and kind='players' and id=$2) order by kind,id",[excludedSpace,excludedPlayer]),
   profiles:await q('select to_jsonb(profile) row from papa_space_player_profiles profile where not (space_id=$1 and player_id=$2) order by space_id,player_id',[excludedSpace,excludedPlayer])};
  for(const [table,order] of [['papa_accounts','id'],['papa_account_legacy_players','account_id'],['papa_space_memberships','id'],['papa_platform_roles','account_id'],
   ['papa_manager_account_links','manager_key'],['papa_installations','id'],['papa_device_sessions','id'],['papa_v2_sessions','token_hash'],
   ['papa_song_favorites','account_id,space_id,player_id,streamer_id,song_id'],['papa_player_extra_quotas','streamer_id,player_id'],
   ['papa_catalog_candidates','streamer_id,song_id'],['papa_notifications','id'],['papa_push_jobs','id']])
   result[table]=await q('select to_jsonb(source) row from '+table+' source order by '+order);
  return result;
 };
 const events=()=>q("select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,actor_account_id,actor_streamer_id,actor_display_name_snapshot,target_player_id,target_player_name_snapshot,space_id,before_data,after_data from papa_events where action in ('playerArchive','playerRestore') order by id");
 const directory=(space='space-001',room='papa',archived=false,mode='all',query='',limit=20,offset=0)=>rpc('papa_player_management_page_v2',[space,room,mode,query,limit,offset,archived]);
 const before={business:await business(),events:await events(),revision:await revision()};await db.exec(migration(archiveMigration));
 assert.deepEqual({business:await business(),events:await events(),revision:await revision()},before,'installing archive support changes no business or authentication data');
 return {db,q,rpc,president,ordinary,subjects,context,revision,archive,player,business,events,directory};
}

for(const [space,room,name,stored] of [['space-001','papa','Legacy Alpha',10],[nativeSpace,nativeRoom,'Native Alpha',6]])
 test(space+' archive and restore preserve the complete original player, history, credits, rights, favorites and authentication',async t=>{
 const {archive,player,business,events,revision,directory,rpc,president}=await fixture(t),source=await player(space),protectedRows=await business(space,'P1'),oldRevision=await revision();
 const result=await archive(space);assert.deepEqual(result,{revision:oldRevision+1,playerId:'P1',archived:true,changed:true});
 const archived=await player(space);assert.deepEqual(archived.data,{...source.data,archived:true,archiveAt:archived.data.archiveAt,archiveBy:president});
 assert.equal(typeof archived.data.archiveAt,'string');assert.equal(archived.data.archiveBy,president);
 assert.deepEqual(await business(space,'P1'),protectedRows,'no identity, credit, history, badge, device, favorite, quota or foreign row is changed');
 if(space!== 'space-001')for(const key of ['space_id','player_id','account_id','membership_id'])assert.equal(archived[key],source[key]);
 const audit=await events();assert.equal(audit.length,1);const event=audit[0];
 assert.equal(event.action,'playerArchive');assert.equal(event.streamer_id,'platform');assert.equal(event.space_id,space);
 assert.equal(event.actor_role,'president');assert.equal(event.actor_account_id,president);assert.equal(event.actor_player_id,null);assert.equal(event.actor_streamer_id,null);
 assert.equal(event.actor_display_name_snapshot,'PA Party總裁');assert.equal(event.target_player_id,'P1');assert.equal(event.target_player_name_snapshot,name);
 assert.deepEqual(event.before_data,{playerId:'P1',name,archived:false});assert.deepEqual(event.after_data,{playerId:'P1',name,archived:true});
 assert.doesNotMatch(JSON.stringify(audit),/password|private|futurePrivate|Former Needle|IDneedle|ignored caller/);
 const readback=await rpc('papa_space_player_rows',[space]);assert.equal(readback.find(row=>row.id==='P1').data.archived,true,'retained player remains readable by the original scoped reader');
 assert.equal((await directory(space,room)).rows.some(row=>row.playerId==='P1'),false);
 const archivePage=await directory(space,room,true);assert.equal(archivePage.total,1);assert.equal(archivePage.rows[0].storedCredits,stored);assert.equal(archivePage.rows[0].archived,true);
 const backup=await rpc('papa_president_full_backup',[president]);
 const backedPlayer=space==='space-001'?backup.rows.find(row=>row.kind==='players'&&row.id==='P1').data:
  backup.architecture.tables.papa_space_player_profiles.find(row=>row.space_id===space&&row.player_id==='P1').data;
 assert.deepEqual(backedPlayer,archived.data,'original full backup preserves source credentials/private fields plus recoverable archive metadata');
 const restoredResult=await archive(space,'P1',false);assert.deepEqual(restoredResult,{revision:oldRevision+2,playerId:'P1',archived:false,changed:true});
 const restored=await player(space);assert.deepEqual(restored.data,{...archived.data,archived:false,restoreAt:restored.data.restoreAt,restoreBy:president});
 assert.equal(typeof restored.data.restoreAt,'string');assert.equal(restored.data.archiveAt,archived.data.archiveAt);assert.equal(restored.data.archiveBy,president);
 assert.equal((await directory(space,room,true)).total,0);assert.equal((await directory(space,room)).rows.find(row=>row.playerId==='P1').archived,false);
 assert.equal((await events()).length,2);assert.equal((await events())[1].action,'playerRestore');assert.deepEqual(await business(space,'P1'),protectedRows);
});

test('pending and waiting requests block archive across own-Space rooms but closed, other-player and foreign-Space history do not',async t=>{
 const {q,archive,revision,player,business,events}=await fixture(t);
 for(const [space,room] of [['space-001','michelle'],[nativeSpace,'archive-other']])for(const status of ['pending','waiting']){
  const id=room+'-'+status,data={id,streamer_id:room,playerId:'P1',status};
  await q("insert into papa_v2_entities(kind,id,data) values('queue',$1,$2)",[id,data]);
  const before={revision:await revision(),player:await player(space),business:await business(),events:await events()};
  await assert.rejects(archive(space),/PLAYER_ARCHIVE_PENDING_QUEUE/);
  assert.deepEqual({revision:await revision(),player:await player(space),business:await business(),events:await events()},before);
  await q("update papa_v2_entities set data=jsonb_set(data,'{status}','\"completed\"') where kind='queue' and id=$1",[id]);
 }
 await q("insert into papa_v2_entities(kind,id,data) values('queue','other-player-pending',$1)",[{id:'other-player-pending',streamer_id:'papa',playerId:'P2',status:'pending'}]);
 assert.equal((await archive()).changed,true);assert.equal((await archive(nativeSpace)).changed,true,'same ID in foreign waiting rows is not the target native profile');
 assert.equal((await archive('space-001','P1',false)).changed,true,'restore does not interrupt or erase any workflow');
});

test('revision conflicts and repeated desired states produce no extra metadata, audit or revision, and simultaneous writes share the original lock',async t=>{
 const {archive,context,revision,player,business,events}=await fixture(t),initial=await revision(),before=await business();
 assert.deepEqual(await archive('space-001','P1',false),{revision:initial,playerId:'P1',archived:false,changed:false});assert.deepEqual(await business(),before);
 await assert.rejects(archive('space-001','P1',true,context(),initial+1),/VERSION_CONFLICT/);assert.equal((await events()).length,0);
 assert.equal((await archive()).revision,initial+1);const saved={player:await player(),revision:await revision(),events:await events(),business:await business()};
 assert.deepEqual(await archive(),{revision:initial+1,playerId:'P1',archived:true,changed:false});
 assert.deepEqual({player:await player(),revision:await revision(),events:await events(),business:await business()},saved);
 await assert.rejects(archive('space-001','P1',true,context(),initial),/VERSION_CONFLICT/);
 await archive('space-001','P1',false);const expected=await revision();
 const concurrent=await Promise.allSettled([archive('space-001','P1',true,context(),expected),archive('space-001','P2',true,context(),expected)]);
 assert.equal(concurrent.filter(row=>row.status==='fulfilled').length,1);assert.equal(concurrent.filter(row=>row.status==='rejected').length,1);
 assert.match(concurrent.find(row=>row.status==='rejected').reason.message,/VERSION_CONFLICT/);assert.equal(await revision(),expected+1);
});

test('audit projection precedes canonical snapshots and an audit error rolls back archive/restore, source timestamps and revision',async t=>{
 const {db,archive,business,events,revision}=await fixture(t);await archive();await archive(nativeSpace);
 const before={business:await business(),events:await events(),revision:await revision()};
 await db.exec("create function fixture_reject_archive_audit() returns trigger language plpgsql as $$begin if new.action in ('playerArchive','playerRestore') then if (select count(1) from jsonb_object_keys(new.before_data))<>3 or (select count(1) from jsonb_object_keys(new.after_data))<>3 or new.target_player_name_snapshot is distinct from new.after_data->>'name' or new.actor_role<>'president' or new.actor_account_id is null then raise exception 'FIXTURE_PROJECTION_ORDER';end if;raise exception 'FIXTURE_ARCHIVE_AUDIT_FAILED';end if;return new;end$$;create trigger zz_fixture_archive_audit before insert on papa_events for each row execute function fixture_reject_archive_audit();");
 for(const space of ['space-001',nativeSpace]){
  await assert.rejects(archive(space,'P1',false),/FIXTURE_ARCHIVE_AUDIT_FAILED/);await assert.rejects(archive(space,'P2',true),/FIXTURE_ARCHIVE_AUDIT_FAILED/);
  assert.deepEqual({business:await business(),events:await events(),revision:await revision()},before);
 }
});

test('only a verified active president Account can archive exact legacy/native targets; browser access and invalid inputs are denied',async t=>{
 const {db,q,rpc,archive,context,president,ordinary,subjects,business,events,revision}=await fixture(t),before={business:await business(),events:await events(),revision:await revision()};
 for(const actor of [null,{},JSON.stringify('invalid'),{...context(),role:'player'},{...context(),role:'streamer_admin'},context('space-001',ordinary),
  context('space-001',subjects.P1),{...context(),account_id:null},{...context(),account_id:'not-a-uuid'},context(nativeSpace),{...context(),streamer_id:'papa'}])
  await assert.rejects(archive('space-001','P1',true,actor),/PLAYER_ARCHIVE_ACTOR_INVALID/);
 for(const [space,id] of [[nativeSpace,'L1'],[nativeSpace,'PF'],['space-001','PF'],[nativeSpace,'missing']])await assert.rejects(archive(space,id),/PLAYER_ARCHIVE_TARGET_INVALID/);
 for(const args of [['space-001',null,0,context(),true],['space-001','x'.repeat(201),0,context(),true],['space-001','P1',null,context(),true],
  ['space-001','P1',-1,context(),true],['space-001','P1',0,context(),null]])await assert.rejects(rpc('papa_player_archive',args),/PLAYER_ARCHIVE_INPUT_INVALID/);
 for(const space of [null,'missing',''])await assert.rejects(archive(space,'P1',true,context(space)),/PLAYER_ARCHIVE_SCOPE_INVALID/);
 await q('update papa_accounts set disabled_at=now() where id=$1',[president]);await assert.rejects(archive(),/PLAYER_ARCHIVE_ACTOR_INVALID/);
 await q('update papa_accounts set disabled_at=null where id=$1',[president]);
 const grantedAt=(await q('select granted_at::text granted_at from papa_platform_roles where account_id=$1',[president]))[0].granted_at;
 await q("delete from papa_platform_roles where account_id=$1",[president]);await assert.rejects(archive(),/PLAYER_ARCHIVE_ACTOR_INVALID/);
 await q("insert into papa_platform_roles(account_id,role,granted_at) values($1,'president',$2)",[president,grantedAt]);
 await q("update papa_spaces set status='suspended' where id=$1",[nativeSpace]);await assert.rejects(archive(nativeSpace),/PLAYER_ARCHIVE_SCOPE_INVALID/);
 await q("update papa_spaces set status='active' where id=$1",[nativeSpace]);
 const expected=await revision();
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(archive('space-001','P1',true,context(),expected),/permission denied/);
  await assert.rejects(rpc('papa_player_management_page_v2',['space-001','papa','all']),/permission denied/);await db.exec('reset role');
 }
 assert.equal((await q("select has_function_privilege('service_role','papa_player_archive_event_summary()','execute') allowed"))[0].allowed,false);
 assert.deepEqual({business:await business(),events:await events(),revision:await revision()},before);
 await db.exec('set role service_role');assert.equal((await archive('space-001','P1',true,context('space-001',president,'admin'),expected)).changed,true);await db.exec('reset role');
});

test('the single directory query filters archive state before count/search/page and retains current-pool stored balances',async t=>{
 const {rpc,archive,directory,business,q}=await fixture(t);
 for(const [space,room] of [['space-001','papa'],[nativeSpace,nativeRoom]]){
  const oldArgs=[space,room,'all','',20,0],original=await rpc('papa_player_management_page_before012',oldArgs),ordinary=await rpc('papa_player_management_page',oldArgs);
  assert.deepEqual({...ordinary,rows:ordinary.rows.map(({archived,...row})=>row)},original,'ordinary unarchived directory preserves the original projection and one grouped balance');
  await archive(space,'P1');await archive(space,'P2');
  const baseline=await business(),normal=await rpc('papa_player_management_page',oldArgs),first=await directory(space,room,true,'all','needle',1),second=await directory(space,room,true,'all','NEEDLE',1,1);
  assert.equal(normal.rows.some(row=>['P1','P2'].includes(row.playerId)),false);assert.equal(normal.total,original.total-2);
  assert.equal(first.total,2);assert.equal(second.total,2);assert.equal(first.pageLimit,1);assert.equal(second.pageOffset,1);
  assert.deepEqual([first.rows[0].playerId,second.rows[0].playerId],['P1','P2']);assert.deepEqual((await directory(space,room,true,'all','needle',1,2)).rows,[]);
  for(const row of [...first.rows,...second.rows]){assert.ok(Object.keys(row).every(key=>directoryKeys.has(key)));assert.equal(row.archived,true);assert.equal(typeof row.archiveAt,'string');}
  assert.doesNotMatch(JSON.stringify([first,second]),/password|private|archiveBy|restoreBy|account_id|membership_id|history/);
  const stored=await directory(space,room,true,'stored');assert.deepEqual(stored.rows.map(row=>[row.playerId,row.storedCredits]),[['P1',space==='space-001'?10:6]]);
  assert.deepEqual(await business(),baseline,'directory reads do not modify retained archived records');
  await archive(space,'P1',false);assert.equal((await directory(space,room,true)).total,1);assert.equal((await directory(space,room)).rows.find(row=>row.playerId==='P1').archived,false);
 }
 await assert.rejects(directory('space-001','papa',null),/PLAYER_MANAGEMENT_PAGE_INVALID/);
 await assert.rejects(directory(nativeSpace,'papa',true),/PLAYER_MANAGEMENT_SCOPE_INVALID/);
 const wrapper=(await q("select pg_get_functiondef('papa_player_management_page(text,text,text,text,integer,integer)'::regprocedure) definition"))[0].definition;
 assert.match(wrapper,/papa_player_management_page_v2\(/);assert.doesNotMatch(wrapper,/papa_v2_entities|credits as/);
});
