import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const releasedQuota=execFileSync('git',['show','origin/main:supabase/migrations/202610090004_player_extra_quota.sql'],{encoding:'utf8'});
const compatibility=migration('202610090015_quota_native_compatibility.sql');
const space='quota-native',room='quota-native-room',other='quota-native-other',foreignSpace='quota-foreign',foreign='quota-foreign-room';
const tokens={president:'1'.repeat(64),manager:'2'.repeat(64),player:'3'.repeat(64)},at='2026-10-09T12:00:00Z';

async function fixture(t,apply=true){
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select public.'+name+'('+args.map((value,i)=>'$'+(i+1)+
  (name==='papa_manage_player_extra_quota'&&i===5?'::'+(typeof value==='object'?'jsonb':'text'):'')).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql',
  '202609280001_manager_passwords.sql','202609250002_private_chat.sql','202609260001_board.sql','202609260002_board_integrity.sql'])await db.exec(migration(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1),('settings','1',$2)",[{
  schemaVersion:3,streamers:[{id:'papa',slug:'papa-home',display_name:'Legacy Papa',active:true},
   {id:'michelle',slug:'michelle-home',display_name:'Legacy Michelle',active:true},{id:'dormant',slug:'dormant-home',display_name:'Dormant',active:false}],
  streamerSettings:{papa:{hourlyLimit:2},michelle:{},dormant:{}},privatePlatform:'retained private metadata'},
  {hourlyLimit:2,privateSettings:'retained private setting'}]);
 for(let i=1;i<=4;i++)await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",['P'+i,{playerId:'P'+i,name:'Legacy '+i,
  password:'retained legacy password',note:'retained legacy private note',ids:['legacy-'+i],names:['Former legacy'],futurePrivate:{history:['retained']}}]);
 for(const [kind,id,data] of [['songs','LS',{songId:'LS',streamer_id:'papa',title:'Legacy Song',artist:'Artist',lyrics:'original private legacy lyrics',privateNotes:'private song note'}],
  ['queue','LQ',{id:'LQ',streamer_id:'papa',songId:'LS',playerId:'P2',kind:'saved',status:'completed',completedAt:at,quota_effective_at:at}],
  ['ledger','LL',{id:'LL',streamer_id:'papa',playerId:'P1',amount:10,note:'original credit history'}]])await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[kind,id,data]);
 for(const file of fs.readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)||/^2026100800(?:0[1-9]|10)_/.test(f)).sort())await db.exec(migration(file));
 await q("insert into papa_streamer_accounts(streamer_id,password_hash,enabled) values('papa','retained legacy manager hash',true)");
 for(const [hash,id,role,scope] of [[tokens.president,'__admin__',null,null],[tokens.manager,'__streamer__:papa','streamer_admin','papa'],[tokens.player,'P1','player',null]])
  await q("insert into papa_v2_sessions(token_hash,player_id,login_id,role,streamer_id,expires_at) values($1,$2,'retained login',$3,$4,now()+interval '1 day')",[hash,id,role,scope]);
 // Reproduce the released table and real session RPC before any foundation.
 await db.exec(releasedQuota);
 const revision=async()=>Number((await q('select revision from papa_v2_revision where id=1'))[0].revision);
 const legacy=async(scope='papa',player='P1',extra=3,enabled=true,token=tokens.manager,expected)=>rpc('papa_manage_player_extra_quota',
  [expected??await revision(),scope,player,extra,enabled,token]);
 await legacy();await legacy('papa','P2',2);await legacy('papa','P4',0,true);await legacy('michelle','P1',7,true,tokens.president);
 await legacy('dormant','P1',4,true,tokens.president);
 const oldRows=await q('select streamer_id,player_id,space_id,extra_quota,enabled,updated_at::text stamp,updated_by from papa_player_extra_quotas order by streamer_id,player_id');
 for(const file of fs.readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(f=>/^2026100700\d\d_/.test(f)||/^20261008001[1-4]_/.test(f)).sort())await db.exec(migration(file));
 await q('insert into papa_spaces(id,slug,display_name) values($1,$1,$1),($2,$2,$2)',[space,foreignSpace]);
 for(const [id,scope] of [[room,space],[other,space],[foreign,foreignSpace]])await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,scope]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [room,other,foreign]){meta.streamers.push({id,slug:id+'-slug',display_name:'Room '+id,active:true});meta.streamerSettings[id]={hourlyLimit:2};}
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const member=async(subject,scope,role='player',streamer=null)=>(await q('insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,$3,$4) returning id',[subject,scope,role,streamer]))[0].id;
 const president=await account(),admin=await account(),subjects={};
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[president]);
 const adminMembership=await member(admin,space,'streamer_admin',room);
 for(const [scope,id] of [[space,'P1'],[space,'P2'],[space,'P3'],[foreignSpace,'P1'],[foreignSpace,'PF']]){
  const subject=await account(),membership=await member(subject,scope);subjects[scope+'/'+id]={account:subject,membership};
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',[scope,id,subject,membership,
   {playerId:id,name:'Profile '+scope+' '+id,ids:['native-'+id],names:[],note:'retained native private note',futurePrivate:{history:['retained native']}}]);
 }
 for(const [scope,id] of [[room,'N'],[other,'O'],[foreign,'F']]){
  await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id+'S',{songId:id+'S',streamer_id:scope,title:'Song '+id,artist:'Artist',lyrics:'private native lyric '+id,privateNotes:'private native song note'}]);
  await q("insert into papa_v2_entities(kind,id,data) values('queue',$1,$2)",[id+'Q',{id:id+'Q',streamer_id:scope,playerId:scope===foreign?'P1':'P2',songId:id+'S',kind:'saved',status:'waiting',test:true,selfProvided:true,at,acceptedAt:at}]);
 }
 const context=(scope=space,streamer=room,subject=admin,role='streamer_admin')=>({role,account_id:subject,space_id:scope,streamer_id:streamer,actor_streamer_id:streamer});
 const manage=async(scope=room,player='P1',extra=5,enabled=true,actor=context(),expected)=>rpc('papa_manage_player_extra_quota',[expected??await revision(),scope,player,extra,enabled,actor]);
 const snapshot=async(scope=room,allowed=space,player='P1')=>rpc('papa_v2_scoped_read_snapshot_with_quota',[scope,allowed,player]);
 const rows=()=>q('select streamer_id,player_id,space_id,extra_quota,enabled,updated_at::text stamp,updated_by,updated_by_account from papa_player_extra_quotas order by streamer_id,player_id');
 const source=async()=>({entities:await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),
  profiles:await q('select space_id,player_id,account_id,membership_id,data,updated_at from papa_space_player_profiles order by space_id,player_id'),
  accounts:await q('select id,created_at,disabled_at from papa_accounts order by id'),members:await q('select id,account_id,space_id,role,streamer_id,status from papa_space_memberships order by id'),
  sessions:await q('select token_hash,player_id,login_id,role,streamer_id,expires_at,account_id,device_session_id from papa_v2_sessions order by token_hash'),
  bindings:await q('select account_id,legacy_player_id,verified_at from papa_account_legacy_players order by account_id'),
  managers:await q('select streamer_id,password_hash,enabled,updated_at from papa_streamer_accounts order by streamer_id'),
  notices:await q('select id,streamer_id,recipient,body from papa_notifications order by id'),push:await q('select id,status from papa_push_jobs order by id')});
 const events=()=>q('select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_account_id,space_id,target_player_id,target_player_name_snapshot,before_data,after_data from papa_events order by id');
 const before={source:await source(),events:await events(),revision:await revision()};
 if(apply){await db.exec(compatibility);assert.deepEqual({source:await source(),events:await events(),revision:await revision()},before);
  assert.deepEqual((await rows()).map(({updated_by_account,...row})=>row),oldRows);assert.ok((await rows()).every(row=>row.updated_by_account===null));}
 return {db,q,rpc,revision,legacy,oldRows,rows,source,events,context,manage,snapshot,president,admin,adminMembership,subjects};
}

test('released quota rows, precise timestamps and legacy labels survive additive compatibility; both verified and session APIs remain atomic',async t=>{
 const {q,legacy,manage,context,president,rows,oldRows,revision,events,source}=await fixture(t),before=await source();
 const actor=context('space-001','papa',president,'super_admin'),initial=await revision(),oldEvents=await events();
 assert.equal(Number(await manage('papa','P1',6,true,actor)),initial+1);
 let own=(await rows()).find(row=>row.streamer_id==='papa'&&row.player_id==='P1');assert.equal(own.updated_by,'__streamer__:papa');assert.equal(own.updated_by_account,president);
 assert.equal((await events()).at(-1).actor_account_id,president);assert.equal((await events()).at(-1).target_player_name_snapshot,'Legacy 1');
 const unchanged={rows:await rows(),events:await events(),revision:await revision()};assert.equal(Number(await manage('papa','P1',6,true,actor)),initial+1);
 assert.deepEqual({rows:await rows(),events:await events(),revision:await revision()},unchanged);
 await q("select set_config('papa.actor_context',$1,false)",[JSON.stringify(actor)]);
 assert.equal(Number(await legacy('papa','P1',6)),initial+1);assert.equal((await rows()).find(row=>row.streamer_id==='papa'&&row.player_id==='P1').updated_by_account,president,'legacy no-op retains correct Account provenance');
 assert.equal(Number(await legacy('papa','P1',8)),initial+2);own=(await rows()).find(row=>row.streamer_id==='papa'&&row.player_id==='P1');
 assert.equal(own.updated_by,'__streamer__:papa');assert.equal(own.updated_by_account,null);assert.equal((await events()).at(-1).actor_account_id,null,'ambient Account context cannot attribute a legacy session');
 await q("select set_config('papa.actor_context','',false)");
 assert.equal((await events()).length,oldEvents.length+2);assert.deepEqual(await source(),before);
 assert.deepEqual((await rows()).filter(row=>row.streamer_id!=='papa'||row.player_id!=='P1').map(({updated_by_account,...row})=>row),oldRows.filter(row=>row.streamer_id!=='papa'||row.player_id!=='P1'));
});

test('native grants and snapshots use exact Space identity, bounded current-room saved participants, target-only active-room rights and original lean projection',async t=>{
 const {rpc,manage,context,president,rows,snapshot,source,events}=await fixture(t),before=await source();
 await manage();await manage(room,'P2',2);await manage(room,'P3',9);await manage(other,'P1',4,true,context(space,other,president,'super_admin'));
 await manage(foreign,'P1',11,true,context(foreignSpace,foreign,president,'super_admin'));
 const own=await snapshot(room+'-slug');assert.deepEqual(own.extraQuotas.map(r=>r.player_id),['P1','P2']);assert.ok(own.extraQuotas.every(r=>r.streamer_id===room));
 assert.deepEqual(own.extraQuotaRights,{P1:[{streamer_id:other,streamer_name:'Room '+other,extra_quota:4},{streamer_id:room,streamer_name:'Room '+room,extra_quota:5}]});
 assert.doesNotMatch(JSON.stringify({caps:own.extraQuotas,rights:own.extraQuotaRights}),/updated_by|account|private|legacy|foreign/);
 const defaultRead=await rpc('papa_v2_scoped_read_snapshot_in_space',[room,space]);assert.deepEqual(defaultRead.extraQuotas.map(r=>r.player_id),['P2']);assert.deepEqual(defaultRead.extraQuotaRights,{});
 assert.equal(JSON.stringify(own.rows).includes('private native lyric'),false);assert.equal(JSON.stringify(own.rows).includes('retained legacy password'),false);
 const selectedSong=await rpc('papa_v2_room_write_snapshot_with_quota',[room,['NS'],space,'P1']);assert.equal(selectedSong.rows.find(r=>r.kind==='songs'&&r.id==='NS').data.lyrics,'private native lyric N');
 const foreignRead=await snapshot(foreign,foreignSpace);assert.equal(foreignRead.extraQuotaRights.P1[0].extra_quota,11);assert.ok(foreignRead.extraQuotas.every(r=>r.streamer_id===foreign));
 const legacyRead=await rpc('papa_v2_quota_snapshot',[true,'papa-home','P1']);assert.deepEqual(legacyRead.extraQuotas.map(r=>r.player_id),['P1','P2']);assert.ok(legacyRead.extraQuotas.every(r=>r.space_id==='space-001'));
 assert.deepEqual(legacyRead.extraQuotaRights.P1.map(r=>r.extra_quota).sort((a,b)=>a-b),[3,7],'matching native player ID never joins legacy rights');
 await assert.rejects(rpc('papa_v2_quota_snapshot',[true,room,'P1']),/UNKNOWN_STREAMER_SPACE/);
 await assert.rejects(snapshot(room,foreignSpace),/UNKNOWN_STREAMER_SPACE/);await assert.rejects(snapshot(foreign,space),/UNKNOWN_STREAMER_SPACE/);
 await assert.rejects(rpc('papa_v2_room_write_snapshot_with_quota',[room,['FS'],space,'P1']),/ROOM_WRITE_SCOPE_INVALID/);
 const fresh=(await rows()).find(r=>r.streamer_id===room&&r.player_id==='P1');assert.equal(fresh.updated_by_account,(await events()).findLast(e=>e.streamer_id===room&&e.entity_id==='P1').actor_account_id);assert.equal(fresh.updated_by,fresh.updated_by_account);
 assert.deepEqual(await source(),before);
});

test('native Account/membership/President guards, legacy/native boundaries, revision conflicts, bounds and browser/private-delegate denial hold',async t=>{
 const {db,q,rpc,manage,legacy,context,admin,adminMembership,president,subjects,source,events,rows,revision}=await fixture(t);
 const before={source:await source(),events:await events(),rows:await rows(),revision:await revision()};
 for(const actor of [null,{},context(foreignSpace),context(space,other),{...context(),account_id:'invalid'},
  context(space,room,subjects[space+'/P1'].account,'player'),context(space,room,subjects[space+'/P1'].account,'super_admin')])
  await assert.rejects(manage(room,'P1',5,true,actor),/ROOM_WRITE_ACTOR_INVALID/);
 await assert.rejects(manage(room,'PF'),/EXTRA_QUOTA_PLAYER_INVALID/);await assert.rejects(manage(room,'P1',-1),/EXTRA_QUOTA_INVALID/);
 await assert.rejects(manage(room,'P1',100001),/EXTRA_QUOTA_INVALID/);await assert.rejects(manage(room,'P1',5,true,context(),before.revision+1),/VERSION_CONFLICT/);
 await assert.rejects(legacy(room,'P1',3,true,tokens.president),/EXTRA_QUOTA_ROOM_INVALID/);await assert.rejects(legacy('papa','P1',3,true,tokens.player),/EXTRA_QUOTA_ACTOR_INVALID/);
 await q('update papa_accounts set disabled_at=now() where id=$1',[admin]);await assert.rejects(manage(),/ROOM_WRITE_ACTOR_INVALID/);await q('update papa_accounts set disabled_at=null where id=$1',[admin]);
 await q("update papa_space_memberships set status='suspended' where id=$1",[adminMembership]);await assert.rejects(manage(),/ROOM_WRITE_ACTOR_INVALID/);await q("update papa_space_memberships set status='active' where id=$1",[adminMembership]);
 await q('update papa_accounts set disabled_at=now() where id=$1',[president]);await assert.rejects(manage(room,'P1',5,true,context(space,room,president,'super_admin')),/ROOM_WRITE_ACTOR_INVALID/);await q('update papa_accounts set disabled_at=null where id=$1',[president]);
 await q("update papa_spaces set status='suspended' where id=$1",[space]);await assert.rejects(manage(),/ROOM_WRITE_ACTOR_INVALID/);await assert.rejects(rpc('papa_v2_scoped_read_snapshot_with_quota',[room,space,'P1']),/UNKNOWN_STREAMER_SPACE/);await q("update papa_spaces set status='active' where id=$1",[space]);
 assert.deepEqual({source:await source(),events:await events(),rows:await rows(),revision:await revision()},before);
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);try{
   await assert.rejects(rpc('papa_manage_player_extra_quota_legacy_session',[before.revision,'papa','P1',5,true,tokens.manager]),/permission denied/);
   await assert.rejects(rpc('papa_scoped_snapshot_before_extra_quota',[room,space]),/permission denied/);
   if(role!=='service_role'){await assert.rejects(manage(room,'P1',5,true,context(),before.revision),/permission denied/);await assert.rejects(legacy('papa','P1',5,true,tokens.manager,before.revision),/permission denied/);}
  }finally{await db.exec('reset role');}
 }
 assert.deepEqual({source:await source(),events:await events(),rows:await rows(),revision:await revision()},before);
});

test('one safe canonical audit is transactional with Account attribution, quota and original revision, including concurrent saves',async t=>{
 const {db,q,manage,legacy,context,president,source,events,rows,revision}=await fixture(t);await manage();
 const before={source:await source(),events:await events(),rows:await rows(),revision:await revision()};
 const event=(await events()).at(-1);assert.equal(event.space_id,space);assert.equal(event.target_player_name_snapshot,'Profile '+space+' P1');assert.equal(event.actor_account_id,(await rows()).find(r=>r.streamer_id===room).updated_by_account);
 assert.doesNotMatch(JSON.stringify(event),/password|token|refresh|futurePrivate|private note/);
 await db.exec("create function fixture_quota_audit_fail() returns trigger language plpgsql as $$begin if new.action='extraQuota' then raise exception 'FIXTURE_QUOTA_AUDIT_FAILED';end if;return new;end$$;create trigger zz_fixture_quota_audit_fail before insert on papa_events for each row execute function fixture_quota_audit_fail();");
 await assert.rejects(manage(room,'P1',8),/FIXTURE_QUOTA_AUDIT_FAILED/);await assert.rejects(manage(room,'P2',4),/FIXTURE_QUOTA_AUDIT_FAILED/);await assert.rejects(legacy('papa','P1',8),/FIXTURE_QUOTA_AUDIT_FAILED/);
 assert.deepEqual({source:await source(),events:await events(),rows:await rows(),revision:await revision()},before);
 await db.exec('drop trigger zz_fixture_quota_audit_fail on papa_events');
 const concurrent=await Promise.allSettled([manage(room,'P1',8,true,context(),before.revision),manage(other,'P1',9,true,context(space,other,president,'super_admin'),before.revision)]);
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.match(concurrent.find(r=>r.status==='rejected').reason.message,/VERSION_CONFLICT/);assert.equal(await revision(),before.revision+1);
 assert.equal((await events()).length,before.events.length+1);assert.deepEqual(await source(),before.source);
 const accountRow=(await q('select account_id from papa_space_memberships where streamer_id=$1',[room]))[0];assert.ok(accountRow.account_id);
});

test('compatibility verifies the precise legacy CHECK and canonical legacy room mapping before accepting an upgrade',async t=>{
 const {db,q,oldRows}=await fixture(t,false);
 await db.exec("alter table papa_player_extra_quotas drop constraint papa_player_extra_quotas_space_id_check;alter table papa_player_extra_quotas add constraint papa_player_extra_quotas_space_id_check check(space_id in ('space-001','other'));");
 await assert.rejects(db.exec(compatibility),/EXTRA_QUOTA_COMPAT_SCHEMA_INVALID/);await db.exec('rollback');
 assert.deepEqual(await q('select streamer_id,player_id,space_id,extra_quota,enabled,updated_at::text stamp,updated_by from papa_player_extra_quotas order by streamer_id,player_id'),oldRows);
 assert.equal((await q("select count(*)::int n from information_schema.columns where table_name='papa_player_extra_quotas' and column_name='updated_by_account'"))[0].n,0);
 await db.exec("alter table papa_player_extra_quotas drop constraint papa_player_extra_quotas_space_id_check;alter table papa_player_extra_quotas add constraint papa_player_extra_quotas_space_id_check check(space_id='space-001');delete from papa_space_streamers where streamer_id='dormant';");
 await assert.rejects(db.exec(compatibility),/violates foreign key constraint/);await db.exec('rollback');
 assert.equal((await q("select count(*)::int n from pg_constraint where conrelid='papa_player_extra_quotas'::regclass and conname='papa_player_extra_quotas_space_id_check'"))[0].n,1);
 assert.equal((await q("select count(*)::int n from information_schema.columns where table_name='papa_player_extra_quotas' and column_name='updated_by_account'"))[0].n,0);
 assert.deepEqual(await q('select streamer_id,player_id,space_id,extra_quota,enabled,updated_at::text stamp,updated_by from papa_player_extra_quotas order by streamer_id,player_id'),oldRows);
});
