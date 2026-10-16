import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {fixture} from './medal-management-fixture.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const manager={role:'streamer_admin',space_id:'space-001',actor_streamer_id:'papa',account_id:A},president={...manager,role:'super_admin'};
const call=async(f,name,args)=>(await f.q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args))[0].v;
const setup=async t=>{const f=await fixture(t);for(const n of ['202610160003_medal_progress_and_certification.sql','202610160004_medal_management_accounts.sql','202610160005_medal_evidence.sql','202610160006_medal_revocation_player_dice.sql'])await f.db.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));return f;};
const list=(f,actor,view,code='cleaner')=>call(f,'papa_achievement_management',['space-001','papa',actor,view,code,'',0]);
const grant=(f,actor=manager,code='cleaner',s='space-001',r='papa',p='P1')=>call(f,'papa_achievement_manual_grant',[s,r,actor,p,code,'核對以前真實達成',null]);
const evidence=async(f,actor=manager,code='cleaner')=>{const recipient=(await list(f,actor,'recipients',code)).rows[0];return (await list(f,{...actor,management_subject:recipient.playerKey},'evidence',code)).rows;};
const revoke=(f,actor,key,code='cleaner',reason='核對來源不符合規則')=>call(f,'papa_achievement_revoke',['space-001','papa',actor,code,key,reason]);
const auditCount=async f=>(await f.q("select count(*)::int n from papa_events where action='achievement_revoked'"))[0].n;

test('manual revocation keeps original acquisition and Audit, removes held/rank/count effects and is idempotent; recertification is separate',async t=>{
 const f=await setup(t);await grant(f);const original=(await f.q('select * from papa_achievement_awards'))[0];
 const row=(await evidence(f))[0];assert.match(row.awardKey,/^[a-f0-9]{32}$/);assert.equal(row.playerName,'one');
 const beforeRev=(await f.q('select revision from papa_v2_revision'))[0].revision;
 assert.deepEqual(await revoke(f,manager,row.awardKey),{ok:true,alreadyRevoked:false});
 const after=(await f.q('select * from papa_achievement_awards'))[0];for(const field of ['acquired_at','expires_at','source_event_id','manual_verified','certification_reason','period'])assert.deepEqual(after[field],original[field],field);
 assert.equal(after.active,false);assert.equal(after.revoked_by,A);assert.ok(after.revocation_event_id);assert.equal(await auditCount(f),1);
 assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,beforeRev+1);
 assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where code='cleaner'"))[0].n,0);
 assert.equal((await list(f,manager,'catalog')).rows.find(x=>x.code==='cleaner').recipientCount,0);
 assert.equal((await list(f,manager,'recipients')).rows[0].revoked,true);
 assert.equal((await list(f,manager,'candidates')).rows[0].earned,false);
 const page=await call(f,'papa_achievement_page',['space-001','papa','P1',manager]),badge=page.rows.find(x=>x.code==='cleaner');
 assert.equal(badge.qualified,false);assert.equal(badge.recorded,true);assert.equal(badge.revoked,true);assert.equal(badge.currentActive,false);assert.equal(page.unlocked,0);assert.match(badge.managementEvidenceKey,/^[a-f0-9]{32}$/);
 assert.deepEqual(await revoke(f,manager,row.awardKey),{ok:true,alreadyRevoked:true});assert.equal(await auditCount(f),1);assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,beforeRev+1);
 await grant(f);assert.equal((await f.q('select count(*)::int n from papa_achievement_awards'))[0].n,2);const rows=await evidence(f);assert.equal(rows.filter(x=>x.revokedAt).length,1);assert.equal(rows.filter(x=>x.currentActive).length,1);
 assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where code='cleaner'"))[0].n,1);
});

test('streamer cannot revoke another room or global, player cannot revoke; president can, with only the exact acquisition affected',async t=>{
 const f=await setup(t);await grant(f);await grant(f,{...president,space_id:'space-002'},'cleaner','space-002','other','P2');await grant(f,president,'love10');
 const rows=await evidence(f,president),other=rows.find(x=>x.streamerName==='Other');
 await assert.rejects(revoke(f,manager,other.awardKey),/REVOCATION_STALE/);
 await assert.rejects(revoke(f,{...manager,role:'player',player_id:'P1'},rows[0].awardKey),/MANAGER_REQUIRED/);
 const global=(await evidence(f,president,'love10'))[0];await assert.rejects(revoke(f,manager,global.awardKey,'love10'),/SUPER_REQUIRED/);
 await assert.rejects(revoke(f,manager,rows[0].awardKey,'cleaner','短'),/REVOCATION_INVALID/);assert.equal(await auditCount(f),0);
 await revoke(f,president,other.awardKey);assert.equal((await evidence(f,manager))[0].currentActive,true);
 await revoke(f,president,global.awardKey,'love10');assert.equal((await evidence(f,president,'love10'))[0].currentActive,false);
 const old=(await f.q("select * from papa_global_badge_awards where code='love10'"))[0];await grant(f,president,'love10');
 const cert=(await f.q("select before_data from papa_events where action='achievement_manual_certified' and entity_id='love10' order by id desc limit 1"))[0];
 assert.equal(cert.before_data.source_event_id,old.source_event_id);assert.equal(cert.before_data.revocation_reason,old.revocation_reason);assert.equal((await evidence(f,president,'love10'))[0].currentActive,true);
 await assert.rejects(revoke(f,president,global.awardKey,'love10'),/REVOCATION_STALE/);
 for(const role of ['anon','authenticated'])assert.equal((await f.q("select has_function_privilege($1,'papa_achievement_revoke(text,text,jsonb,text,text,text)','execute') v",[role]))[0].v,false);
});

test('automatic revoke blocks old replay and retries, later real eligibility uses a separate existing-table row, leaving other awards untouched',async t=>{
 const f=await setup(t),at=new Date(Date.now()-3600000),expiry=new Date(at.getTime()+7*86400000),event=(await f.q("insert into papa_events(action,entity_kind) values('source','queue') returning id"))[0].id;
 const change={id:'P22',code:'cleaner',playerId:'P1',active:true,period:'lifetime',eventKey:'Q:1',acquiredAt:at.toISOString(),expiresAt:expiry.toISOString()};
 await call(f,'papa_badge_apply',['space-001','papa',[change],event]);await grant(f,manager,'sung50');const row=(await evidence(f))[0];
 await revoke(f,manager,row.awardKey);const rev=(await f.q('select revision from papa_v2_revision'))[0].revision;
 await Promise.all([revoke(f,manager,row.awardKey),revoke(f,manager,row.awardKey)]);assert.equal(await auditCount(f),1);
 await call(f,'papa_badge_apply',['space-001','papa',[change],event]);assert.equal((await f.q("select active from papa_achievement_awards where code='cleaner'"))[0].active,false);
 assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,rev);
 const future=new Date(Date.now()+1),next={...change,eventKey:'Q2:1',acquiredAt:future.toISOString(),expiresAt:new Date(future.getTime()+7*86400000).toISOString()};
 await call(f,'papa_badge_apply',['space-001','papa',[next],event]);assert.equal((await f.q("select count(*)::int n from papa_achievement_awards where code='cleaner'"))[0].n,2);
 assert.equal((await f.q("select count(*)::int n from papa_achievement_awards where code='cleaner' and revoked_at is not null"))[0].n,1);
 assert.equal((await f.q("select active from papa_achievement_awards where code='sung50'"))[0].active,true);
});

test('dice progress counts only player draw and cross_draw, not proxy, streamer or self; rules and Audit rows remain unchanged by migration',async t=>{
 const f=await fixture(t);for(const n of ['202610160003_medal_progress_and_certification.sql','202610160004_medal_management_accounts.sql','202610160005_medal_evidence.sql'])await f.db.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 await grant(f);const tables=['papa_achievement_awards','papa_global_badge_awards','papa_events','papa_v2_entities','papa_v2_revision','papa_space_memberships'];
 const snapshot=async()=>Promise.all(tables.map(table=>f.q("select coalesce(jsonb_agg(x order by x::text),'[]') rows from(select to_jsonb(t)-'revoked_at'-'revoked_by'-'revocation_reason'-'revocation_event_id' x from "+table+" t) selected")));
 const before=await snapshot();const definitions=await f.q('select code,name,emoji,lifetime,default_visibility from papa_achievement_catalog order by code');
 await f.db.exec(fs.readFileSync('supabase/migrations/202610160006_medal_revocation_player_dice.sql','utf8'));assert.deepEqual(await snapshot(),before);assert.deepEqual(await f.q('select code,name,emoji,lifetime,default_visibility from papa_achievement_catalog order by code'),definitions);
 const at=new Date(Date.now()-3600000).toISOString();for(const [i,source] of ['draw','cross_draw','proxy_draw','streamer_draw','self','cross_self'].entries())await f.put('Q'+i,{streamer_id:'papa',playerId:'P1',title:'歌',artist:'歌手',kind:'live',source,selfProvided:true,status:'completed',at,acceptedAt:at,completedAt:at});
 await f.put('SELF',{streamer_id:'papa',playerId:'P1',kind:'self',title:'歌',artist:'歌手',source:'draw',status:'completed',at,completedAt:at});
 const p=await call(f,'papa_badge_progress',['space-001','papa','P1',new Date().toISOString()]);assert.equal(p.dice20.current,2);assert.equal(p.dice_repeat.current,2);assert.equal(p.coincidence.current,2);
});

test('a failed correction rolls back both Audit and holding; revoking one acquisition keeps another legitimate acquisition',async t=>{
 const f=await setup(t);await grant(f);const first=(await evidence(f))[0];
 await f.db.exec("create function fail_correction() returns trigger language plpgsql as $$begin if new.revoked_at is not null then raise exception 'SIMULATED_FAILURE';end if;return new;end$$;create trigger test_fail before update on papa_achievement_awards for each row execute function fail_correction();");
 await assert.rejects(revoke(f,manager,first.awardKey),/SIMULATED_FAILURE/);assert.equal(await auditCount(f),0);assert.equal((await evidence(f))[0].currentActive,true);
 await f.db.exec('drop trigger test_fail on papa_achievement_awards');
 await f.q("insert into papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,changed_at,source_event_id,manual_verified,expires_at,rule_version) select space_id,streamer_id,player_id,code,'another-legitimate-acquisition',active,acquired_at-interval '1 second',changed_at,source_event_id,manual_verified,expires_at,rule_version from papa_achievement_awards");
 await revoke(f,manager,first.awardKey);const page=await call(f,'papa_achievement_page',['space-001','papa','P1',manager]);assert.equal(page.rows.find(r=>r.code==='cleaner').currentActive,true);assert.equal(page.rows.find(r=>r.code==='cleaner').revoked,false);
 assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where code='cleaner'"))[0].n,1);
});

test('actual Account/membership authority rejects role and room forgery before revocation writes',async t=>{
 const f=await setup(t);await grant(f);const key=(await evidence(f))[0].awardKey;
 await f.db.exec(`alter table papa_space_memberships add column id uuid default gen_random_uuid();alter table papa_space_memberships add column streamer_id text;
 alter table papa_space_player_profiles add column membership_id uuid;
 create table papa_manager_account_links(account_id uuid,manager_key text);create table papa_platform_roles(account_id uuid,role text);
 insert into papa_accounts values('${B}',null);insert into papa_manager_account_links values('${A}','streamer:papa');insert into papa_platform_roles values('${A}','president');
 insert into papa_space_memberships(account_id,space_id,role,status,streamer_id) values('${A}','space-001','streamer_admin','active','papa');`);
 await f.db.exec('drop function papa_notice_category_scope(text,text,jsonb,text)');
 for(const [file,name] of [['202610080012_communication_space.sql','papa_communication_player_exists'],['202610080012_communication_space.sql','papa_communication_context'],['202610120002_message_center_categories.sql','public.papa_notice_category_scope']]){
  const source=fs.readFileSync('supabase/migrations/'+file,'utf8'),escaped=name.replaceAll('.','\\.');await f.db.exec(source.match(new RegExp('create function '+escaped+'\\([\\s\\S]*?\\$\\$;'))[0].replace('create function','create or replace function'));
 }
 await assert.rejects(revoke(f,{...president,account_id:B},key),/ACTOR_INVALID/);
 await assert.rejects(revoke(f,{...manager,actor_streamer_id:'other'},key),/ACTOR_INVALID/);
 await f.q("update papa_space_memberships set status='suspended' where account_id=$1 and role='streamer_admin'",[A]);
 await assert.rejects(revoke(f,manager,key),/ACTOR_INVALID/);assert.equal(await auditCount(f),0);
 await revoke(f,president,key);assert.equal(await auditCount(f),1);
});
