import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture} from './medal-management-fixture.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const manager={role:'streamer_admin',space_id:'space-001',actor_streamer_id:'papa',account_id:A};
const president={...manager,role:'super_admin'};
const call=async(f,name,args)=>(await f.q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args))[0].v;
const setup=async t=>{const f=await fixture(t);for(const file of ['202610160003_medal_progress_and_certification.sql','202610160004_medal_management_accounts.sql'])await f.db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));return f;};
const list=(f,actor,view,code='sung50',query='',page=0,s='space-001',r='papa')=>call(f,'papa_achievement_management',[s,r,actor,view,code,query,page]);
const grant=(f,actor,p,code='sung50',s='space-001',r='papa')=>call(f,'papa_achievement_manual_grant',[s,r,actor,p,code,'核對以前達成紀錄',null]);
const add=async(f,account,id,data={},extra='')=>{
 await f.q('insert into papa_accounts values($1,null)',[account]);
 await f.q("insert into papa_space_memberships values($1,'space-001','player','active')",[account]);
 await f.q('insert into papa_account_legacy_players values($1,$2)',[account,id]);
 await f.q("insert into papa_v2_entities values('players',$1,$2,null)",[id,{name:'new player',...data}]);
 if(extra)await f.db.exec(extra);
};

test('all registered candidates use Account identity, public aliases/IDs, bounded pages and exclude invalid accounts without activity reads',async t=>{
 const f=await setup(t);await add(f,B,'NEW',{name:'one',names:['以前暱稱'],ids:['public-567']});
 for(let i=0;i<23;i++)await add(f,`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,'N'+i,{name:'candidate '+i});
 const inactive=[['44444444-4444-4444-8444-444444444441','TEST',{test:true}],['44444444-4444-4444-8444-444444444442','ARCH',{archived:true}],['44444444-4444-4444-8444-444444444443','DIS',{}],['44444444-4444-4444-8444-444444444444','SUSP',{}]];
 for(const [account,id,data] of inactive)await add(f,account,id,data);
 await f.q("update papa_accounts set disabled_at=now() where id=$1",[inactive[2][0]]);await f.q("update papa_space_memberships set status='suspended' where account_id=$1",[inactive[3][0]]);
 await f.q("insert into papa_v2_entities values('players','UNBOUND','{\"name\":\"unregistered\"}',null)");
 for(const query of ['以前暱稱','public-567']){const result=await list(f,manager,'candidates','sung50',query);assert.equal(result.total,1);assert.equal(result.rows[0].playerId,'account:'+B);assert.deepEqual(result.rows[0].publicIds,['public-567']);}
 const page0=await list(f,manager,'candidates'),page1=await list(f,manager,'candidates','sung50','',1);
 assert.equal(page0.total,25);assert.equal(page0.rows.length,20);assert.equal(page1.rows.length,5);
 assert.equal(new Set([...page0.rows,...page1.rows].map(x=>x.playerId)).size,25);
 assert.equal((await list(f,manager,'candidates','sung50','one')).total,2,'same name must never merge different accounts');
 assert.doesNotMatch(JSON.stringify(page0),/notes|password|balance|account_id/);
 assert.equal((await f.q("select count(*)::int n from papa_v2_entities where kind in ('queue','ledger')"))[0].n,0);
});

test('grant without interaction or target-Space profile creates only the existing award and Audit; normal profile later resolves it',async t=>{
 const f=await setup(t);await add(f,B,'NEW',{name:'new player'});
 const before=await f.q('select * from papa_v2_entities order by kind,id'),members=await f.q('select * from papa_space_memberships order by account_id,space_id');
 assert.deepEqual(await grant(f,{...president,space_id:'space-002'},'account:'+B,'sung50','space-002','other'),{ok:true,alreadyRecorded:false});
 assert.deepEqual(await f.q('select * from papa_v2_entities order by kind,id'),before);assert.deepEqual(await f.q('select * from papa_space_memberships order by account_id,space_id'),members);
 const award=(await f.q("select player_id,source_event_id,manual_verified from papa_achievement_awards where code='sung50'"))[0];assert.equal(award.player_id,'account:'+B);assert.equal(award.manual_verified,true);assert.ok(award.source_event_id);
 assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where account_id=$1 and streamer_id='other'",[B]))[0].n,1);
 await f.q("insert into papa_space_memberships values($1,'space-002','player','active')",[B]);await f.q("insert into papa_space_player_profiles values('space-002','NEW2',$1,'{\"name\":\"new local name\"}')",[B]);
 const page=await call(f,'papa_achievement_page',['space-002','other','NEW2',{role:'player',space_id:'space-002',player_id:'NEW2',account_id:B}]);assert.equal(page.rows.find(x=>x.code==='sung50').recorded,true);
 assert.deepEqual(await grant(f,{...president,space_id:'space-002'},'NEW2','sung50','space-002','other'),{ok:true,alreadyRecorded:true});
 assert.equal((await f.q('select count(*)::int n from papa_achievement_awards'))[0].n,1);assert.equal((await f.q('select count(*)::int n from papa_events'))[0].n,1);
 const publicRows=await f.q('select player_name,player_id,condition_text from papa_achievement_public_rows()');assert.equal(publicRows.length,1);assert.equal(publicRows[0].player_id,'NEW2');
});

test('president recipient groups deduplicate Account and lazy room detail preserves expired acquisitions; streamer stays isolated',async t=>{
 const f=await setup(t);
 await grant(f,{...president,certification_at:'2020-01-01T12:00:00Z'},'P1','night');
 await grant(f,{...president,space_id:'space-002'},'P2','night','space-002','other');
 const recipients=await list(f,president,'recipients','night');assert.equal(recipients.total,1);assert.equal(recipients.rows[0].roomCount,2);assert.equal(recipients.rows[0].canViewRooms,true);
 const detail=await list(f,{...president,management_subject:recipients.rows[0].playerKey},'recipientRooms','night');assert.equal(detail.total,2);
 assert.equal(detail.rows.find(x=>x.streamerId==='papa').currentActive,false);assert.equal(detail.rows.find(x=>x.streamerId==='other').currentActive,true);assert.equal(new Date(detail.rows.find(x=>x.streamerId==='papa').acquiredAt).getUTCFullYear(),2020);
 const own=await list(f,manager,'recipients','night');assert.equal(own.total,1);assert.equal(own.rows[0].canViewRooms,false);assert.equal(own.rows[0].currentActive,false);assert.equal(own.rows[0].roomCount,1);
 await assert.rejects(list(f,{...manager,management_subject:recipients.rows[0].playerKey},'recipientRooms','night'),/MANAGEMENT_INVALID/);
 await assert.rejects(list(f,manager,'catalog',null,'',0,'space-001','other'),/ROOM_DENIED/);
 const catalog=await list(f,president,'catalog');assert.equal(catalog.rows.find(x=>x.code==='night').recipientCount,1);assert.equal(catalog.rooms.length,2);
 const ownCatalog=await list(f,manager,'catalog');assert.equal(ownCatalog.rooms.length,1);assert.ok(ownCatalog.rows.every(x=>x.scope==='streamer'));
});

test('global grant uses Account once with no room mirror; mixed invalid batches roll back and aliases cannot double count',async t=>{
 const f=await setup(t);await add(f,B,'NEW');
 await assert.rejects(grant(f,manager,'P1','love10'),/SUPER_REQUIRED/);
 const batch=(ids,actor=president,code='sung50')=>call(f,'papa_achievement_manual_grant_batch',['space-001','papa',actor,ids,code,'核對以前達成紀錄',null]);
 await assert.rejects(batch(['P1','account:'+A]),/BATCH_IDENTITY_INVALID/);await assert.rejects(batch(['P1','bad-player']),/BATCH_IDENTITY_INVALID/);
 assert.equal((await f.q('select count(*)::int n from papa_events'))[0].n,0);
 assert.deepEqual(await batch(['P1','account:'+B]),{ok:true,granted:2,alreadyRecorded:0});assert.deepEqual(await batch(['P1','account:'+B]),{ok:true,granted:0,alreadyRecorded:2});
 const revision=(await f.q('select revision from papa_v2_revision'))[0].revision;
 await grant(f,president,'P1','love10');assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,revision+1);
 assert.deepEqual(await grant(f,{...president,space_id:'space-002'},'P2','love10','space-002','other'),{ok:true,alreadyRecorded:true});
 assert.equal((await f.q("select count(*)::int n from papa_achievement_awards where code='love10'"))[0].n,0);assert.equal((await f.q('select count(*)::int n from papa_global_badge_awards'))[0].n,1);
 const global=await list(f,president,'recipients','love10');assert.equal(global.total,1);assert.equal(global.rows[0].canViewRooms,false);assert.equal(global.rows[0].roomCount,null);
 await assert.rejects(list(f,manager,'recipients','love10'),/MANAGEMENT_INVALID/);
});

test('active manual Account awards suppress automatic duplicates after joining; expiry and original Audit remain intact',async t=>{
 const f=await setup(t);await add(f,B,'NEW');
 await grant(f,{...president,space_id:'space-002'},'account:'+B,'sung50','space-002','other');
 await f.q("insert into papa_space_memberships values($1,'space-002','player','active')",[B]);await f.q("insert into papa_space_player_profiles values('space-002','NEW2',$1,'{\"name\":\"new player\"}')",[B]);
 const badge=(await f.q("select badge_id from papa_achievement_catalog where code='sung50'"))[0];
 const before=await f.q('select * from papa_events order by id');
 await call(f,'papa_badge_apply',['space-002','other',[{id:badge.badge_id,code:'sung50',playerId:'NEW2',active:true,acquiredAt:new Date().toISOString(),expiresAt:null,period:'lifetime'}],null]);
 assert.equal((await f.q('select count(*)::int n from papa_achievement_awards'))[0].n,1);assert.deepEqual(await f.q('select * from papa_events order by id'),before);
 assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where account_id=$1",[B]))[0].n,1);
 await assert.rejects(call(f,'papa_badge_apply',['space-002','other',[{id:badge.badge_id,code:'sung50',playerId:'NEW2',active:true,acquiredAt:'2099-01-01',expiresAt:null}],null]),/CANDIDATE_TIME_INVALID/);
 for(const name of ['papa_medal_profiles()','papa_medal_accounts()','papa_medal_award_rows(text)','papa_badge_account_medal_v4(text,text)'])assert.equal((await f.q("select has_function_privilege('service_role',$1,'execute') v",[name]))[0].v,false);
});

test('expired Account certification stays expired in detail after a genuine automatic renewal, without inflating rank',async t=>{
 const f=await setup(t);await add(f,B,'NEW');
 await grant(f,{...president,space_id:'space-002',certification_at:'2020-01-01T12:00:00Z'},'account:'+B,'night','space-002','other');
 await f.q("insert into papa_space_memberships values($1,'space-002','player','active')",[B]);await f.q("insert into papa_space_player_profiles values('space-002','NEW2',$1,'{\"name\":\"new player\"}')",[B]);
 const at=new Date(),expires=new Date(at.getTime()+86400000),badge=(await f.q("select badge_id from papa_achievement_catalog where code='night'"))[0];
 const sourceId=(await f.q('select id from papa_events order by id limit 1'))[0].id;
 await call(f,'papa_badge_apply',['space-002','other',[{id:badge.badge_id,code:'night',playerId:'NEW2',active:true,acquiredAt:at.toISOString(),expiresAt:expires.toISOString(),period:'lifetime'}],sourceId]);
 assert.equal((await f.q("select count(*)::int n from papa_achievement_awards where code='night'"))[0].n,2);
 const recipients=await list(f,president,'recipients','night'),detail=await list(f,{...president,management_subject:recipients.rows[0].playerKey},'recipientRooms','night');
 assert.equal(recipients.total,1);assert.equal(detail.rows.length,2);assert.equal(detail.rows.find(x=>new Date(x.acquiredAt).getUTCFullYear()===2020).currentActive,false);assert.equal(detail.rows.find(x=>new Date(x.acquiredAt).getUTCFullYear()!==2020).currentActive,true);
 assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where code='night'"))[0].n,1);
 await f.q("update papa_space_player_profiles set data=data||'{\"archived\":true}' where player_id='NEW2'");
 assert.equal((await list(f,{...president,space_id:'space-002'},'candidates','night','new player',0,'space-002','other')).total,0);
 assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where code='night'"))[0].n,0);
});

test('actual database authority rejects forged president, suspended manager and cross-Space/streamer requests before grants',async t=>{
 const f=await setup(t);await add(f,B,'NEW');
 await f.db.exec(`alter table papa_space_memberships add column id uuid default gen_random_uuid();alter table papa_space_memberships add column streamer_id text;
 alter table papa_space_player_profiles add column membership_id uuid;
 create table papa_manager_account_links(account_id uuid,manager_key text);create table papa_platform_roles(account_id uuid,role text);
 insert into papa_manager_account_links values('${A}','streamer:papa');insert into papa_platform_roles values('${A}','president');
 insert into papa_space_memberships(account_id,space_id,role,status,streamer_id) values('${A}','space-001','streamer_admin','active','papa');`);
 await f.db.exec('drop function papa_notice_category_scope(text,text,jsonb,text)');
 for(const [file,name] of [['202610080012_communication_space.sql','papa_communication_player_exists'],['202610080012_communication_space.sql','papa_communication_context'],['202610120002_message_center_categories.sql','public.papa_notice_category_scope']]){
  const source=fs.readFileSync('supabase/migrations/'+file,'utf8'),escaped=name.replaceAll('.','\\.');
  const definition=source.match(new RegExp('create function '+escaped+'\\([\\s\\S]*?\\$\\$;'))[0].replace('create function','create or replace function');await f.db.exec(definition);
 }
 await list(f,manager,'catalog');await list(f,{...president,space_id:'forged'},'catalog');
 await assert.rejects(list(f,{...president,account_id:B},'catalog'),/ACTOR_INVALID/);
 await assert.rejects(list(f,{...manager,actor_streamer_id:'other'},'catalog'),/ACTOR_INVALID/);
 await assert.rejects(grant(f,manager,'P2','sung50','space-002','other'),/ACTOR_INVALID/);
 await assert.rejects(grant(f,manager,'P1','love10'),/SUPER_REQUIRED/);
 await f.q("update papa_space_memberships set status='suspended' where account_id=$1 and role='streamer_admin'",[A]);
 await assert.rejects(grant(f,manager,'P1'),/ACTOR_INVALID/);
 assert.equal((await f.q('select count(*)::int n from papa_events'))[0].n,0);assert.equal((await f.q('select count(*)::int n from papa_achievement_awards'))[0].n,0);
});

test('004 changes only function metadata; existing awards, definitions, memberships, business facts and Audit are byte-for-byte preserved',async t=>{
 const f=await fixture(t);await f.db.exec(fs.readFileSync('supabase/migrations/202610160003_medal_progress_and_certification.sql','utf8'));
 await f.put('Q1',{streamer_id:'papa',playerId:'P1',kind:'live',status:'waiting'});await grant(f,manager,'P1');
 const tables=['papa_achievement_catalog','papa_achievement_awards','papa_global_badge_awards','papa_events','papa_v2_entities','papa_space_memberships','papa_space_player_profiles','papa_account_legacy_players','papa_v2_revision'];
 const snapshot=async()=>Promise.all(tables.map(table=>f.q('select coalesce(jsonb_agg(x order by x::text),\'[]\'::jsonb) rows from(select to_jsonb(t) x from '+table+' t) selected')));
 const before=await snapshot();await f.db.exec(fs.readFileSync('supabase/migrations/202610160004_medal_management_accounts.sql','utf8'));assert.deepEqual(await snapshot(),before);
 const first=await grant(f,manager,'account:'+A);assert.deepEqual(first,{ok:true,alreadyRecorded:true});assert.deepEqual(await snapshot(),before);
 const protectedDefs=await f.q("select code,emoji,condition_text,lifetime,default_visibility from papa_achievement_catalog order by code");assert.ok(protectedDefs.length>50);
});

test('reserved identifier conflict aborts migration atomically rather than reinterpreting existing player identities',async t=>{
 const f=await fixture(t);await f.db.exec(fs.readFileSync('supabase/migrations/202610160003_medal_progress_and_certification.sql','utf8'));
 await f.q("insert into papa_v2_entities values('players','account:existing-id','{\"name\":\"preserve\"}',null)");
 await assert.rejects(f.db.exec(fs.readFileSync('supabase/migrations/202610160004_medal_management_accounts.sql','utf8')),/ACCOUNT_NAMESPACE_CONFLICT/);await f.db.exec('rollback');
 assert.equal((await f.q("select to_regprocedure('public.papa_medal_profiles()') is null v"))[0].v,true);
 assert.equal((await f.q("select count(*)::int n from papa_v2_entities where id='account:existing-id'"))[0].n,1);
});

test('a later automatic timed renewal preserves an expired raw-player manual certificate instead of being blocked or overwriting it',async t=>{
 const f=await setup(t);await grant(f,{...manager,certification_at:'2020-01-01T12:00:00Z'},'P1','night');
 const original=(await f.q("select * from papa_achievement_awards where code='night'"))[0];
 const at=new Date(),expires=new Date(at.getTime()+86400000),badge=(await f.q("select badge_id from papa_achievement_catalog where code='night'"))[0];
 const changes=[{id:badge.badge_id,code:'night',playerId:'P1',active:true,acquiredAt:at.toISOString(),expiresAt:expires.toISOString(),period:'lifetime'}];
 await call(f,'papa_badge_apply',['space-001','papa',changes,original.source_event_id]);await call(f,'papa_badge_apply',['space-001','papa',changes,original.source_event_id]);
 assert.deepEqual((await f.q("select * from papa_achievement_awards where code='night' and period='lifetime'"))[0],original);
 assert.equal((await f.q("select count(*)::int n from papa_achievement_awards where code='night'"))[0].n,2);assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where code='night'"))[0].n,1);
 assert.equal((await f.q("select count(*)::int n from papa_events where action='achievement_awarded'"))[0].n,1);
});
