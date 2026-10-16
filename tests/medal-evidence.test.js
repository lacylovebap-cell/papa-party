import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {fixture} from './medal-management-fixture.js';import {roomBadgeChanges} from '../supabase/functions/party-api/badge-state.js';
const A='11111111-1111-4111-8111-111111111111',manager={role:'streamer_admin',space_id:'space-001',actor_streamer_id:'papa',account_id:A},president={...manager,role:'super_admin'};
const call=async(f,name,args)=>(await f.q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args))[0].v;
const setup=async t=>{const f=await fixture(t);for(const name of ['202610160003_medal_progress_and_certification.sql','202610160004_medal_management_accounts.sql','202610160005_medal_evidence.sql'])await f.db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));return f;};
const list=(f,actor,view,code='cleaner',page=0)=>call(f,'papa_achievement_management',['space-001','papa',actor,view,code,'',page]);
const row=(source='draw',extra={})=>({id:'Q1',streamer_id:'papa',playerId:'P1',source,kind:'live',selfProvided:source!=='manual',title:'測試歌',artist:'歌手',at:'2026-10-15T12:00:00Z',acceptedAt:'2026-10-15T12:00:00Z',status:'completed',completedAt:'2026-10-15T12:10:00Z',...extra});

test('new automatic Audit preserves selected trigger evidence; manager detail returns original song even after current queue changes',async t=>{
 const f=await setup(t),q=row('draw',{requestNote:'PRIVATE',password:'SECRET',lyricNotes:'LYRIC'});await f.put(q.id,q);
 const state={players:[{playerId:'P1'}],queue:[],ledger:[]},changes=roomBadgeChanges(state,{...state,queue:[q]},{spaceId:'space-001',roomId:'papa',asOf:q.completedAt}).filter(x=>x.code==='cleaner');assert.equal(changes.length,1);
 const source=(await f.q("insert into papa_events(entity_kind,entity_id,streamer_id,space_id,action,after_data) values('queue','Q1','papa','space-001','queue_complete','{}') returning id"))[0].id;
 await call(f,'papa_badge_apply',['space-001','papa',changes,source]);
 const recipients=await list(f,president,'recipients'),key=recipients.rows[0].playerKey;
 await f.put(q.id,{...q,title:'改名後'});
 const result=await list(f,{...president,management_subject:key},'evidence');assert.equal(result.rows.length,1);const detail=result.rows[0];assert.equal(detail.evidenceType,'recorded');assert.equal(detail.songs[0].title,'測試歌');assert.equal(detail.songs[0].playerDice,true);assert.match(detail.sourceRule,/主播代骰/);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|LYRIC|before_data|after_data|password|requestNote|lyricNotes/);
 const rooms=await list(f,{...president,management_subject:key},'recipientRooms');assert.match(rooms.rows[0].evidenceKey,/^[a-f0-9]{32}$/);
 const exact=await list(f,{...president,management_subject:key,management_evidence:rooms.rows[0].evidenceKey},'evidence');assert.equal(exact.total,1);
 assert.equal((await list(f,{...president,management_subject:key,management_evidence:'f'.repeat(32)},'evidence')).total,0);
});

test('legacy proxy draw remains intact and is labelled a candidate source mismatch; unrecorded triggers are never invented',async t=>{
 const f=await setup(t),q=row('proxy_draw');await f.put(q.id,q);
 const source=(await f.q("insert into papa_events(entity_kind,entity_id,streamer_id,space_id,action,after_data) values('achievement','old-replay','papa','space-001','old_replay','{}') returning id"))[0].id;
 await f.q("insert into papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,changed_at,source_event_id,manual_verified,expires_at,rule_version) values('space-001','papa','P1','cleaner','lifetime',true,$1,now(),$2,false,$1::timestamptz+interval '7 days',2)",[q.completedAt,source]);
 const before=await f.q('select * from papa_achievement_awards');const key=(await list(f,manager,'recipients')).rows[0].playerKey;
 const detail=(await list(f,{...manager,management_subject:key},'evidence')).rows[0];assert.equal(detail.evidenceType,'candidate');assert.equal(detail.songs[0].source,'proxy_draw');assert.equal(detail.songs[0].playerDice,false);assert.equal(detail.songs[0].recorded,false);
 assert.deepEqual(await f.q('select * from papa_achievement_awards'),before);
 await f.q("delete from papa_v2_entities where kind='queue'");const unavailable=(await list(f,{...manager,management_subject:key},'evidence')).rows[0];assert.equal(unavailable.evidenceType,'unavailable');assert.deepEqual(unavailable.songs,[]);
});

test('evidence enforces manager/room permission, hides expired current status and preserves manual reason without fake song proof',async t=>{
 const f=await setup(t);
 await call(f,'papa_achievement_manual_grant',['space-002','other',{...president,space_id:'space-002',certification_at:'2020-01-01T12:00:00Z'},'P2','cleaner','管理者確認以前達成',null]);
 const key=(await list(f,president,'recipients')).rows[0].playerKey;
 assert.equal((await list(f,{...manager,management_subject:key},'evidence')).total,0);
 const detail=(await list(f,{...president,management_subject:key},'evidence')).rows[0];assert.equal(detail.evidenceType,'manual');assert.equal(detail.currentActive,false);assert.match(detail.manualReason,/以前達成/);assert.deepEqual(detail.songs,[]);
 await assert.rejects(list(f,{role:'player',space_id:'space-001',player_id:'P1',account_id:A,management_subject:key},'evidence'),/MANAGER_REQUIRED/);
 await assert.rejects(list(f,{...manager,management_subject:'bad'},'evidence'),/EVIDENCE_INVALID/);
 for(const fn of ['papa_medal_evidence_page(text,text,jsonb,text,text,text,int)','papa_achievement_management_accounts_v5(text,text,jsonb,text,text,text,int)'])assert.equal((await f.q("select has_function_privilege('service_role',$1,'execute') v",[fn]))[0].v,false);
});

test('candidate checks include another player unfinished same-title requests, exclude unrelated streamers and bound pages',async t=>{
 const f=await setup(t),q=row('draw');await f.put(q.id,q);
 await f.q("insert into papa_v2_entities values('players','P3','{\"name\":\"other\"}',null)");
 await f.put('OLD',row('manual',{id:'OLD',playerId:'P3',at:'2026-10-14T12:00:00Z',status:'waiting',completedAt:null}));
 await f.put('FOREIGN',row('manual',{id:'FOREIGN',playerId:'P3',streamer_id:'other',at:'2026-10-13T12:00:00Z',status:'waiting',completedAt:null}),'space-002');
 const source=(await f.q("insert into papa_events(entity_kind,entity_id,streamer_id,space_id,action) values('achievement','old','papa','space-001','old') returning id"))[0].id;
 await f.q("insert into papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,changed_at,source_event_id,manual_verified,expires_at,rule_version) values('space-001','papa','P1','cleaner','lifetime',true,$1,now(),$2,false,$1::timestamptz+interval '7 days',2)",[q.completedAt,source]);
 const key=(await list(f,manager,'recipients')).rows[0].playerKey,actor={...manager,management_subject:key};
 const detail=(await list(f,actor,'evidence')).rows[0];assert.equal(detail.songs[0].earlierTitleRequests,1);assert.equal(detail.songs[0].playerDice,true);
 const page=await list(f,actor,'evidence','cleaner',100);assert.equal(page.total,1);assert.deepEqual(page.rows,[]);await assert.rejects(list(f,actor,'evidence','cleaner',-1),/EVIDENCE_INVALID/);
});
