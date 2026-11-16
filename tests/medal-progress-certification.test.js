import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture} from './medal-management-fixture.js';
import {achievementPanelHtml,achievementDetailsHtml} from '../src/achievements-view.js';
import {roomBadgeChanges,stockBadgeCandidates} from '../supabase/functions/party-api/badge-state.js';
import {medalGrantHtml} from '../src/medal-management.js';
const manager={role:'streamer_admin',space_id:'space-001',actor_streamer_id:'papa',account_id:'11111111-1111-4111-8111-111111111111'};
const president={...manager,role:'super_admin'},player={...manager,role:'player',player_id:'P1'};
const call=async(f,name,args)=>(await f.q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args))[0].v;
const setup=async t=>{const f=await fixture(t);await f.db.exec(fs.readFileSync('supabase/migrations/202610160003_medal_progress_and_certification.sql','utf8'));return f;};
const q=(i,extra={})=>({playerId:'P1',streamer_id:'papa',kind:'live',source:'manual',title:'同名歌',artist:'甲',venue:i%2?'radio':'shengma',
 at:'2026-10-15T12:00:00Z',acceptedAt:'2026-10-15T12:00:00Z',status:'completed',completedAt:'2026-10-15T12:10:00Z',...extra});

test('one scoped server aggregate combines sound/radio, separates streamers, merges global Account and preserves source rows',async t=>{
 const f=await setup(t);
 for(let i=0;i<25;i++)await f.put('Q'+i,q(i));
 await f.put('DICE',q(0,{source:'draw'}));await f.put('TEST',q(0,{test:true}));await f.put('VOID',q(0,{voided_at:'2026-10-15'}));
 await f.put('DUP',q(0,{performance_duplicate_of:'Q0'}));await f.put('FUTURE',q(0,{completedAt:'2099-01-01'}));
 for(let i=0;i<10;i++)await f.put('other'+i,q(i,{playerId:'P2',streamer_id:'other'}),'space-002');
 const before=await f.q('select * from papa_v2_entities order by kind,id');
 const result=await call(f,'papa_badge_progress',['space-001','papa','P1','2026-10-16T04:00:00Z']);
 assert.deepEqual(result.sung50,{current:25,target:50,unit:'首',window:'累積'});
 const eligible=await f.q("select code from papa_badge_global_candidates('space-001','P1','2026-10-16T04:00:00Z') order by code");assert.deepEqual(eligible.map(x=>x.code),['dna30','love10']);
 assert.equal(result.dna30.current,30);assert.equal(result.same10.current,35);assert.equal(result.sung100.current,25);
 const privatePage=await call(f,'papa_achievement_page',['space-001','papa','P1',player]);
 assert.equal(privatePage.rows.find(r=>r.code==='sung50').progress.current,25);assert.equal(privatePage.rows.find(r=>r.code==='destiny').progress,undefined);
 await call(f,'papa_achievement_visibility_set',['space-001','papa',manager,'sung50','after_award']);
 const secretPage=await call(f,'papa_achievement_page',['space-001','papa','P1',player]);assert.equal(secretPage.rows.find(r=>r.code==='sung50').progress,undefined);
 assert.deepEqual(await f.q('select * from papa_v2_entities order by kind,id'),before);
 const icons=await f.q("select code,emoji from papa_achievement_catalog where code in ('sung50','saved_success','saved_failure') order by code");
 assert.deepEqual(icons,[{code:'saved_failure',emoji:'⛔'},{code:'saved_success',emoji:'💖'},{code:'sung50',emoji:'✴'}]);
});

test('progress is visible in cards/details, secret conditions stay hidden, radio scope has an empty placeholder only',()=>{
 const row={code:'sung50',name:'50首兵郎',scope:'streamer',emoji:'✴',visibility:'public',progress:{current:25,target:50,unit:'首'},qualified:false};
 assert.match(achievementPanelHtml([row]),/25\/50/);assert.match(achievementPanelHtml([{...row,progress:{current:25.5,target:50}}]),/25\.5\/50/);assert.match(achievementDetailsHtml(row),/25\/50/);
 for(const hidden of [{...row,visibility:'after_award'},{...row,visibility:'condition_hidden'},{...row,badgeId:'H02',recorded:true}])assert.doesNotMatch(achievementPanelHtml([hidden]),/25\/50/);
 const radio=achievementPanelHtml([row],{scope:'radio'});assert.match(radio,/電台勳章內容待補充/);assert.doesNotMatch(radio,/class="medal-row/);
 assert.match(medalGrantHtml({...row,lifetime:'24h'}),/data-medal-grant/);
 assert.doesNotMatch(medalGrantHtml({...row,scope:'global',lifetime:'permanent',manualAllowed:false}),/data-medal-grant/);
 assert.match(medalGrantHtml({...row,scope:'global',lifetime:'permanent',manualAllowed:true}),/data-medal-grant/);
});

test('only verified president can certify global medals; canonical account dedup and batch rollback preserve Audit',async t=>{
 const f=await setup(t);
 await f.q(`insert into papa_v2_entities values('ledger','L1','{"playerId":"P1","streamer_id":"papa","amount":1,"at":"2026-10-15"}','space-001'),('players','P3','{"name":"unbound"}',null),('ledger','L3','{"playerId":"P3","streamer_id":"papa","amount":1,"at":"2026-10-15"}','space-001')`);
 const grant=(actor,p='P1')=>call(f,'papa_achievement_manual_grant',['space-001','papa',actor,p,'love10','以前達成紀錄核對',null]);
 await assert.rejects(grant(manager),/SUPER_REQUIRED/);await assert.rejects(grant(player),/MANAGER_REQUIRED/);
 await assert.rejects(call(f,'papa_achievement_manual_grant_batch',['space-001','papa',president,['P1','P3'],'love10','以前達成紀錄核對',null]),/ACCOUNT_REQUIRED/);
 assert.equal((await f.q('select count(*)::int n from papa_global_badge_awards'))[0].n,0);
 assert.equal((await f.q('select count(*)::int n from papa_events'))[0].n,0);
 assert.deepEqual(await grant(president),{ok:true,alreadyRecorded:false});assert.deepEqual(await grant(president),{ok:true,alreadyRecorded:true});
 assert.equal((await f.q('select count(*)::int n from papa_global_badge_awards'))[0].n,1);
 assert.equal((await f.q('select count(*)::int n from papa_events'))[0].n,1);
 const catalog=await call(f,'papa_achievement_management',['space-001','papa',president,'catalog',null,'',0]);assert.equal(catalog.rows.find(r=>r.code==='love10').manualAllowed,true);
 const candidate=await call(f,'papa_achievement_management',['space-001','papa',president,'candidates','love10','',0]);assert.equal(candidate.rows.find(r=>r.playerId==='P1').earned,true);
 await assert.rejects(call(f,'papa_achievement_management',['space-001','papa',manager,'candidates','love10','',0]),/MANAGEMENT_INVALID/);
 const page=await call(f,'papa_achievement_page',['space-001','papa','P1',manager]);assert.equal(page.rows.find(r=>r.code==='love10').manualAllowed,false);
});

test('manual historical certification keeps original expiry and dynamic holding rules, without changing business facts',async t=>{
 const f=await setup(t);
 await f.q(`insert into papa_v2_entities values('ledger','L1','{"playerId":"P1","streamer_id":"papa","amount":30,"storage_pool":"shengma","at":"2020-01-01"}','space-001')`);
 const before=await f.q('select * from papa_v2_entities order by kind,id');
 const grant=(code,actor=manager)=>call(f,'papa_achievement_manual_grant',['space-001','papa',actor,'P1',code,'舊紀錄核對達成',null]);
 await grant('night',{...manager,certification_at:'2020-01-01T00:00:00Z'});
 let page=await call(f,'papa_achievement_page',['space-001','papa','P1',player]);let night=page.rows.find(r=>r.code==='night');
 assert.equal(night.recorded,true);assert.equal(night.currentActive,false);assert.equal(new Date(night.expiresAt).toISOString(),'2020-01-02T00:00:00.000Z');
 assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where code='night'"))[0].n,0);
 await grant('stock100');assert.equal((await call(f,'papa_achievement_page',['space-001','papa','P1',player])).rows.find(r=>r.code==='stock100').currentActive,false);
 assert.deepEqual(await f.q('select * from papa_v2_entities order by kind,id'),before);
 await f.q(`insert into papa_v2_entities values('ledger','L2','{"playerId":"P1","streamer_id":"papa","amount":80,"storage_pool":"radio","at":"2020-01-02"}','space-001')`);
 page=await call(f,'papa_achievement_page',['space-001','papa','P1',player]);assert.equal(page.rows.find(r=>r.code==='stock100').currentActive,true);
 assert.equal((await f.q("select count(*)::int n from papa_badge_rank_rows() where code='stock100'"))[0].n,1);
 await assert.rejects(grant('triple',{...manager,certification_at:'2099-01-01T00:00:00Z'}),/CERTIFICATION_TIME_INVALID/);
 assert.equal((await f.q('select count(*)::int n from papa_achievement_awards'))[0].n,2);
});

test('automatic room awards and stock thresholds combine both venues without touching their separate business balances',()=>{
 const queue=Array.from({length:100},(_,i)=>({id:'Q'+i,...q(i)}));
 const base={players:[{playerId:'P1'}],queue:[],ledger:[]};
 const after={...base,queue,ledger:[{id:'A',playerId:'P1',streamer_id:'papa',amount:25,storage_pool:'shengma',at:'2026-10-15T12:00:00Z'},{id:'B',playerId:'P1',streamer_id:'papa',amount:25,storage_pool:'radio',at:'2026-10-15T12:00:00Z'}]};
 const before=structuredClone(after),rows=roomBadgeChanges(base,after,{spaceId:'space-001',roomId:'papa',asOf:'2026-10-16T04:00:00Z'});
 assert.ok(rows.some(r=>r.code==='sung100'&&r.active));assert.ok(stockBadgeCandidates(after,'space-001','papa','2026-10-16T04:00:00Z').some(r=>r.code==='stock50'));assert.deepEqual(after,before);
});
