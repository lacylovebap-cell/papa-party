import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './medal-management-fixture.js';
const manager={role:'streamer_admin',space_id:'space-001',actor_streamer_id:'papa',account_id:'11111111-1111-4111-8111-111111111111'};
const player={...manager,role:'player',player_id:'P1'};
const call=async(f,name,args)=>(await f.q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
test('v2 management preserves definitions, isolates policy, blocks global and H/L changes, removes player controls',async t=>{
 const f=await fixture(t),before=await f.q('select * from papa_achievement_catalog order by code');
 const catalog=await call(f,'papa_achievement_management',['space-001','papa',manager,'catalog',null,'',0]);
 assert.equal(catalog.rows.length,60);assert.equal(catalog.rows.find(r=>r.code==='love10').manualAllowed,false);
 for(const code of ['love10','insomnia','chosen'])await assert.rejects(call(f,'papa_achievement_visibility_set',['space-001','papa',manager,code,'hidden']),/SETTING_INVALID/);
 await assert.rejects(call(f,'papa_achievement_management',['space-001','other',manager,'catalog',null,'',0]),/ROOM_DENIED/);
 await assert.rejects(call(f,'papa_achievement_visibility_set',['space-001','papa',player,'sung100','hidden']),/MANAGER_REQUIRED/);
 await call(f,'papa_achievement_visibility_set',['space-001','papa',manager,'sung100','after_award']);
 const page=await call(f,'papa_achievement_page',['space-001','papa','P1',player]);
 const hidden=page.rows.find(r=>r.code==='sung100');assert.equal(hidden.name,'？？？');assert.equal(hidden.emoji,null);assert.equal(hidden.condition,null);
 assert.equal(page.totalDefinitions,60);
 await assert.rejects(call(f,'papa_achievement_public_set',['space-001','papa',player,'sung100',true]),/STREAMER_POLICY_REQUIRED/);
 assert.deepEqual(await f.q('select * from papa_achievement_catalog order by code'),before);
});
test('batch certification is atomic and idempotent; recipient activity and rankings use v2 awards without player publication',async t=>{
 const f=await fixture(t);
 await f.q(`insert into papa_v2_entities values('players','P3','{"name":"two"}',null),('ledger','L1','{"playerId":"P1","streamer_id":"papa"}','space-001'),('ledger','L3','{"playerId":"P3","streamer_id":"papa"}','space-001')`);
 const before=await f.q('select * from papa_v2_entities order by kind,id');
 const grant=(ids,code='sung100')=>call(f,'papa_achievement_manual_grant_batch',['space-001','papa',manager,ids,code,'歷史紀錄核對',null]);
 await assert.rejects(grant(['P1'],'love10'),/CERTIFICATION_INVALID/);
 await assert.rejects(grant(['P1'],'night'),/EXPIRY_UNDEFINED/);
 await f.db.exec(`create function fail_second() returns trigger language plpgsql as $$begin if new.player_id='P3' then raise exception 'SECOND_FAIL';end if;return new;end$$;create trigger fail_second before insert on papa_achievement_awards for each row execute function fail_second()`);
 await assert.rejects(grant(['P1','P3']),/SECOND_FAIL/);
 assert.equal((await f.q('select count(*)::int n from papa_achievement_awards'))[0].n,0);
 assert.equal((await f.q('select count(*)::int n from papa_events'))[0].n,0);
 assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,42);
 await f.q('drop trigger fail_second on papa_achievement_awards');
 assert.deepEqual(await grant(['P1','P3']),{ok:true,granted:2,alreadyRecorded:0});
 assert.deepEqual(await grant(['P3','P1']),{ok:true,granted:0,alreadyRecorded:2});
 const recipients=await call(f,'papa_achievement_management',['space-001','papa',manager,'recipients','sung100','',0]);
 assert.equal(recipients.total,2);assert.ok(recipients.rows.every(r=>r.currentActive&&r.source==='管理者授予'));
 for(const mode of ['room','global_single','global_streamers','global_total']){
  const rank=await call(f,'papa_achievement_collection',['space-001','papa',player,mode,'',0,null,null]);
  assert.equal(rank.rows[0].total,1);assert.equal(rank.rows[0].rank,1);
 }
 const rankBefore=await f.q('select * from papa_badge_rank_rows()');
 await call(f,'papa_achievement_visibility_set',['space-001','papa',manager,'sung100','hidden']);
 assert.deepEqual(await f.q('select * from papa_badge_rank_rows()'),rankBefore);
 assert.equal((await f.q('select * from papa_achievement_public_rows()')).length,0);
 const own=await call(f,'papa_achievement_page',['space-001','papa','P1',player]);
 assert.ok(own.rows.some(r=>r.code==='sung100'&&r.recorded));
 assert.deepEqual(await f.q('select * from papa_v2_entities order by kind,id'),before);
});

 test('management signals work with the deployed revision mechanism and optional scoped sync',async t=>{
 const f=await fixture(t);
 assert.equal((await f.q("select to_regprocedure('papa_room_sync_bump(text,text,text,text)') present"))[0].present,null);
 await call(f,'papa_achievement_visibility_set',['space-001','papa',manager,'sung100','after_award']);
 assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,43);
 await f.db.exec(`create table sync_probe(k text,s text,r text,d text);create function papa_room_sync_bump(k text,s text,r text,d text) returns void language sql as $$insert into sync_probe values(k,s,r,d)$$;`);
 await call(f,'papa_achievement_visibility_set',['space-001','papa',manager,'sung100','hidden']);
 assert.deepEqual(await f.q('select * from sync_probe'),[{k:'room',s:'space-001',r:'papa',d:'settings'}]);
 assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,44);
 });
