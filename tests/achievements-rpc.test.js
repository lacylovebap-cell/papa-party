import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;alter default privileges grant execute on functions to service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,space_id text,primary key(kind,id));
 create table papa_spaces(id text primary key,status text,accounting_rollover_hour int);
 create table papa_space_streamers(streamer_id text,space_id text);
 create table papa_space_player_profiles(space_id text,player_id text,data jsonb);
 insert into papa_spaces values('space-001','active',19),('space-002','active',0);
 insert into papa_space_streamers values('papa','space-001'),('other','space-001'),('foreign','space-002');
 create table papa_events(id bigint generated always as identity primary key,streamer_id text,entity_kind text,entity_id text,action text,actor_role text,actor_player_id text,created_at timestamptz default now(),effective_at text,before_data jsonb,after_data jsonb,hour_bucket bigint,actor_account_id uuid,actor_streamer_id text,target_player_id text,space_id text);
 create table papa_notifications(id uuid default gen_random_uuid(),streamer_id text,streamer_name text,recipient text,type text,level int,body text,entity_id text,space_id text);
 create function papa_accounting_time(value text) returns timestamptz language plpgsql immutable as $$begin return value::timestamptz;exception when others then return null;end$$;
 create function papa_notice_category_scope(s text,r text,a jsonb,m text) returns jsonb language plpgsql stable as $$begin
 if a->>'space_id' is distinct from s or a->>'role' not in ('player','streamer_admin','super_admin') or a->>'role'='streamer_admin' and a->>'actor_streamer_id' is distinct from r or not exists(select 1 from papa_space_streamers where space_id=s and streamer_id=r) then raise exception 'SCOPE_INVALID';end if;
 return jsonb_build_object('recipient',case a->>'role' when 'player' then a->>'player_id' when 'streamer_admin' then '__admin__' else '__super__' end);end$$;`);
 const q=async(s,args=[])=>(await db.query(s,args)).rows;
 const put=async(kind,id,data,space='space-001')=>q('insert into papa_v2_entities values($1,$2,$3,$4) on conflict(kind,id) do update set data=excluded.data,space_id=excluded.space_id',[kind,id,data,space]);
 await put('players','P1',{name:'one'});await put('players','P2',{name:'two'});await put('players','TEST',{test:true});
 await put('meta','meta',{streamers:[{id:'papa',display_name:'Room'}]});
 await db.exec(fs.readFileSync('supabase/migrations/202610140001_achievements.sql','utf8'));
 const current=(await q('select now() at_time'))[0].at_time;
 const queue=(id,p='P1',kind='live',status='completed',extra={})=>({id,playerId:p,streamer_id:'papa',kind,status,at:current,acceptedAt:current,completedAt:current,songId:'song',...extra});
 const event=async(kind,id,after,before=null,action='queue',scope='space-001')=>q('insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,before_data,after_data,space_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',['papa',kind,id,action,'streamer_admin',after?.playerId??before?.playerId??'P1',before,after,scope]);
 const flags=async(p='P1',room='papa',space='space-001')=>(await q('select papa_achievement_eligibility($1,$2,$3) v',[space,room,p]))[0].v;
 const page=async(p='P1',actor={role:'player',space_id:'space-001',player_id:'P1'})=>(await q('select papa_achievement_page($1,$2,$3,$4) v',['space-001','papa',p,actor]))[0].v;
 return {db,q,put,queue,event,flags,page,current};
}
test('manager historical certification preserves audit, exact date and idempotency without touching balances',async t=>{
 const f=await fixture(t);await f.db.exec(fs.readFileSync('supabase/migrations/202610140008_achievement_manual_certification.sql','utf8'));
 const manager={role:'streamer_admin',space_id:'space-001',actor_streamer_id:'papa',account_id:'11111111-1111-4111-8111-111111111111'};
 const grant=async(code,day=null)=>f.q('select papa_achievement_manual_grant($1,$2,$3,$4,$5,$6,$7) v',['space-001','papa',manager,'P1',code,'核對舊場次紀錄',day]);
 assert.equal((await grant('sung50'))[0].v.alreadyRecorded,false);
 assert.equal((await grant('sung50'))[0].v.alreadyRecorded,true);
 const award=(await f.q("select manual_verified,certification_reason,active from papa_achievement_awards where player_id='P1' and code='sung50'"))[0];
 assert.equal(award.manual_verified,true);assert.equal(award.active,true);
 assert.equal((await f.q("select count(*)::int n from papa_events where action='achievement_manual_certified'"))[0].n,1);
 assert.equal((await f.page()).rows.find(r=>r.code==='sung50').manualVerified,true);
 await f.event('queue','Q-CANCEL',{...f.queue('Q-CANCEL'),status:'cancelled'});
 assert.equal((await f.q("select active from papa_achievement_awards where player_id='P1' and code='sung50'"))[0].active,true,'automatic reconciliation cannot revoke manual certification');
 await assert.rejects(grant('first_mic'),/ACHIEVEMENT_SHOW_DAY_REQUIRED/);
 const day='2026-10-12';assert.equal((await grant('first_mic',day))[0].v.alreadyRecorded,false);
 assert.equal((await f.q("select active from papa_achievement_awards where code='first_mic' and period=$1",[day]))[0].active,false);
 await assert.rejects(f.q('select papa_achievement_manual_grant($1,$2,$3,$4,$5,$6,$7)',['space-001','papa',{role:'player',space_id:'space-001',player_id:'P1'},'P1','sung100','fake',null]),/ACHIEVEMENT_MANAGER_REQUIRED/);
});
test('Taipei 19:00 scope, 01–05 night, half-hour and comeback boundaries use valid live requests only',async t=>{
 const f=await fixture(t),asOf='2026-10-14T20:00:00Z',at=(i)=>'2026-10-14T'+String(17+i).padStart(2,'0')+':00:00Z';
 const flags=async()=>(await f.q("select papa_achievement_eligibility('space-001','papa','P1',$1) v",[asOf]))[0].v;
 for(let i=0;i<5;i++){const time=i<4?at(0):at(1);await f.put('queue','N'+i,f.queue('N'+i,'P1','live','waiting',{at:time,acceptedAt:time,completedAt:null}));}
 assert.equal((await flags()).night,true);assert.equal((await flags()).no_sleep,true);assert.equal((await flags()).saved_success,false);
 await f.put('queue','N4',f.queue('N4','P1','saved','waiting',{at:at(1),acceptedAt:at(1),completedAt:null}));assert.equal((await flags()).night,false);
 await f.put('queue','N4',f.queue('N4','P1','live','pending',{at:at(1),acceptedAt:null,completedAt:null}));assert.equal((await flags()).night,false);
 await f.q("delete from papa_v2_entities where kind='queue'");
 for(const [id,time] of [['A','17:00'],['B','17:10'],['C','17:30']])await f.put('queue',id,f.queue(id,'P1','live','waiting',{at:'2026-10-14T'+time+':00Z'}));
 assert.equal((await flags()).triple,true);
 await f.put('queue','C',f.queue('C','P1','live','waiting',{at:'2026-10-14T17:31:00Z'}));assert.equal((await flags()).triple,false);
 await f.q("delete from papa_v2_entities where kind='queue'");
 await f.put('queue','OLD',f.queue('OLD','P1','live','stored',{at:'2026-10-06T12:00:00Z'}));
 for(let i=0;i<5;i++)await f.put('queue','R'+i,f.queue('R'+i,'P1','live','waiting',{at:'2026-10-14T12:00:00Z'}));
 assert.equal((await flags()).comeback,true);await f.put('queue','OLD',f.queue('OLD','P1','live','stored',{at:'2026-10-10T12:00:00Z'}));assert.equal((await flags()).comeback,false);
});
test('server awards distinguish live request, saved performance, holdings and duplicates; migration leaves facts intact',async t=>{
 const f=await fixture(t);const {q,put,queue,event,flags}=f;
 assert.equal((await q('select count(*)::int n from papa_achievement_awards'))[0].n,0);
 await put('ledger','L1',{playerId:'P1',streamer_id:'papa',amount:100});
 const saved=queue('Q1','P1','saved');await put('queue','Q1',saved);await event('queue','Q1',saved,queue('Q1','P1','saved','waiting'));
 let x=await flags();assert.equal(x.saved_success,true);assert.equal(x.first_mic,true);assert.equal(x.first_live,false);assert.equal(x.stock100,true);
 assert.equal((await q('select count(*)::int n from papa_achievement_draws'))[0].n,1);
 const archived={...saved,archived:true};await put('queue','Q1',archived);await event('queue','Q1',archived,saved);
 assert.equal((await flags()).saved_success,true);assert.equal((await q('select count(*)::int n from papa_achievement_draws'))[0].n,1);
 const corrected={...archived,performance_duplicate_of:'canonical'};await put('queue','Q1',corrected);await event('queue','Q1',corrected,archived);
 assert.equal((await flags()).saved_success,false);assert.equal((await q("select active from papa_achievement_awards where code='saved_success'"))[0].active,false);
 const lower={playerId:'P1',streamer_id:'papa',amount:99};await put('ledger','L1',lower);await event('ledger','L1',lower,{...lower,amount:100});
 assert.equal((await flags()).stock100,false);assert.equal((await q("select active from papa_achievement_awards where code='stock100'"))[0].active,false);
 assert.equal((await q("select count(*)::int n from papa_events where action='achievement_inactive'"))[0].n>=2,true);
 const testQueue=queue('TESTQ','TEST');await put('queue','TESTQ',testQueue);await event('queue','TESTQ',testQueue);
 assert.deepEqual(await flags('TEST'),{});assert.equal((await q("select count(*)::int n from papa_achievement_draws where player_id='TEST'"))[0].n,0);
 assert.equal((await flags('P1','other')).saved_success,false);
});
test('50首兵郎 and 百歌王 count genuine performances with pair/repeat units, not requests or cancelled/self history',async t=>{
 const f=await fixture(t);for(let i=0;i<49;i++)await f.put('queue','Q'+i,f.queue('Q'+i));
 assert.equal((await f.flags()).sung50,false);
 await f.put('queue','Q50',f.queue('Q50','P1','saved','completed',{items:[{songId:'song',performances:2}]}));
 assert.equal((await f.flags()).sung50,true);assert.equal((await f.flags()).sung100,false);
 for(let i=51;i<=99;i++)await f.put('queue','Q'+i,f.queue('Q'+i));
 assert.equal((await f.flags()).sung100,true);
 await f.put('queue','Q99',f.queue('Q99','P1','live','cancelled'));
 assert.equal((await f.flags()).sung100,false);
 const before=await f.q('select kind,id,data from papa_v2_entities order by kind,id');await f.page();
 assert.deepEqual(await f.q('select kind,id,data from papa_v2_entities order by kind,id'),before);
 assert.equal((await f.q('select count(*)::int n from papa_achievement_awards'))[0].n,0,'read does not backfill awards or invent acquisition times');
 const rows=(await f.page()).rows;assert.equal(rows.find(x=>x.code==='sung50').name,'50首兵郎');assert.equal(rows.find(x=>x.code==='sung100').name,'百歌王');assert.equal(rows.find(x=>x.code==='sung50').acquiredAt,null);
});
test('visibility guards keep hidden medal conditions off player pages and preserve manager Audit',async t=>{
 const f=await fixture(t),manager={role:'streamer_admin',space_id:'space-001',actor_streamer_id:'papa',account_id:'11111111-1111-4111-8111-111111111111'},player={role:'player',space_id:'space-001',player_id:'P1'};
 await assert.rejects(f.page('P2'),/PLAYER_INVALID/);await assert.rejects(f.page('P1',{...manager,actor_streamer_id:'other'}),/SCOPE_INVALID/);
 const setting=(a,code,v)=>f.q('select papa_achievement_visibility_set($1,$2,$3,$4,$5)',['space-001','papa',a,code,v]);
 await assert.rejects(setting(player,'sung50','hidden'),/MANAGER_REQUIRED/);
 await setting(manager,'sung50','hidden');await setting(manager,'sung100','condition_hidden');
 const p=await f.page();assert.equal(p.rows.some(x=>x.code==='sung50'),false);assert.equal(p.rows.find(x=>x.code==='sung100').condition,null);assert.equal(p.rows.some(x=>x.code==='chosen'),false);
 const m=await f.page('P1',manager);assert.equal(m.rows.length,45);assert.ok(m.rows.find(x=>x.code==='chosen').condition.includes('0.5%'));
 for(const role of ['anon','authenticated','service_role']){await f.db.exec('set role '+role);await assert.rejects(f.q('select * from papa_achievement_awards'),/permission denied/);if(role!=='service_role')await assert.rejects(f.page(),/permission denied/);await f.db.exec('reset role');}
});
test('completion draws commit with the business transaction, are never rerolled and all draws precede deferred reconciliation',async t=>{
 const f=await fixture(t);await f.db.exec('begin');
 for(const id of ['Q1','Q2']){const row=f.queue(id);await f.put('queue',id,row);await f.event('queue',id,row,f.queue(id,'P1','live','waiting'));}
 assert.equal((await f.q('select count(*)::int n from papa_achievement_draws'))[0].n,2);
 // Deterministic fixture outcome; never connected to production randomness.
 await f.q("update papa_achievement_draws set won=true where queue_id='Q2'");await f.db.exec('commit');
 assert.equal((await f.q("select active from papa_achievement_awards where code='chosen'"))[0].active,true);
 const row=f.queue('Q2'),old=(await f.q("select * from papa_achievement_draws where queue_id='Q2'"))[0];await f.event('queue','Q2',{...row,effective_at:f.current},row);
 assert.deepEqual((await f.q("select * from papa_achievement_draws where queue_id='Q2'"))[0],old);
 await f.db.exec('begin');const rollback=f.queue('ROLLBACK');await f.put('queue','ROLLBACK',rollback);await f.event('queue','ROLLBACK',rollback);await f.db.exec('rollback');
 assert.equal((await f.q("select count(*)::int n from papa_achievement_draws where queue_id='ROLLBACK'"))[0].n,0);assert.equal((await f.q("select count(*)::int n from papa_v2_entities where id='ROLLBACK'"))[0].n,0);
 assert.equal((await f.q("select count(*)::int n from papa_notifications where entity_id='chosen'"))[0].n,1);
});
test('first-mic correction moves the single effective award, retains system Audit and never changes the performance facts',async t=>{
 const f=await fixture(t),base=Date.now(),later=new Date(base-60000).toISOString(),earlier=new Date(base-120000).toISOString();
 const second=f.queue('SECOND','P2','live','completed',{at:earlier,completedAt:later});await f.put('queue','SECOND',second);await f.event('queue','SECOND',second);
 const first=f.queue('FIRST','P1','saved','completed',{at:earlier,completedAt:earlier});await f.put('queue','FIRST',first);await f.event('queue','FIRST',first);
 const slots=await f.q("select player_id,active from papa_achievement_awards where code='first_mic' order by player_id");assert.deepEqual(slots,[{player_id:'P1',active:true},{player_id:'P2',active:false}]);
 assert.equal((await f.q("select count(*)::int n from papa_events where action='achievement_inactive' and entity_id='first_mic'"))[0].n,1);
 assert.deepEqual((await f.q("select data from papa_v2_entities where id='SECOND'"))[0].data,JSON.parse(JSON.stringify(second)));
 const imported=f.queue('IMPORTED');await f.put('queue','IMPORTED',imported);await f.event('queue','IMPORTED',imported,null,'import');assert.equal((await f.q("select count(*)::int n from papa_achievement_draws where queue_id='IMPORTED'"))[0].n,0);
});
test('request random outcomes are one per accepted queue, not per refresh, approval retry or completion',async t=>{
 const f=await fixture(t),waiting=f.queue('LIVE','P1','live','waiting');await f.put('queue','LIVE',waiting);await f.event('queue','LIVE',waiting,null,'onBehalf');
 const original=(await f.q("select * from papa_achievement_request_draws where queue_id='LIVE'"))[0];assert.ok(original);
 await f.event('queue','LIVE',waiting,null,'onBehalf');assert.deepEqual((await f.q("select * from papa_achievement_request_draws where queue_id='LIVE'"))[0],original);
 const complete={...waiting,status:'completed'};await f.put('queue','LIVE',complete);await f.event('queue','LIVE',complete,waiting);
 assert.deepEqual((await f.q("select * from papa_achievement_request_draws where queue_id='LIVE'"))[0],original);assert.equal((await f.q("select count(*)::int n from papa_achievement_draws where queue_id='LIVE'"))[0].n,1);
});

test('private award evaluators reject Supabase default service grants while scoped award RPC remains available',async t=>{
 const f=await fixture(t);for(const name of ['papa_achievement_player_valid(text,text,boolean)','papa_achievement_eligibility(text,text,text,timestamptz)','papa_achievement_event()','papa_achievement_draw_event()'])assert.equal((await f.q('select has_function_privilege(\'service_role\',$1,\'execute\') allowed',[name]))[0].allowed,false);
 assert.equal((await f.q("select has_function_privilege('service_role','papa_achievement_page(text,text,text,jsonb)','execute') allowed"))[0].allowed,true);
});
