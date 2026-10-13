import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {empty,mutate} from '../src/core.js';
import {stateEntries,stateChanges} from '../src/state-patch.js';
const at='2026-10-13T12:00:00Z',actor={role:'admin'},ctx={role:'streamer_admin',actor_streamer_id:'papa',streamer_id:'papa',space_id:'space-001',action:'isolated-test'};
test('receipt and existing accounting commit are atomic, replay-safe, scoped and preserve genuine performance facts',async t=>{
 const db=new PGlite();t.after(()=>db.close());const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=fs.readFileSync('supabase/migrations/202609170001_party_v2.sql','utf8');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const f of ['202609240001_release_a.sql','202609240003_notifications.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 let state=mutate(empty(),{streamer:'papa',type:'player',data:{name:'isolated'}},actor,at);
 state=mutate(state,{streamer:'papa',type:'song',data:{title:'song',creditCost:1}},actor,at);
 state=mutate(state,{streamer:'papa',type:'ledger',data:{playerId:state.players[0].playerId,amount:3}},actor,at);
 for(const r of stateEntries(state))await q('insert into papa_v2_entities values($1,$2,$3)',[r.kind,r.id,r.data]);
 await q('update papa_v2_revision set revision=$1',[state.revision]);await db.exec('alter table papa_notifications add column space_id text;');
 for(const f of ['202610070001_space_foundation.sql','202610070011_room_operational_commit.sql','202610120002_message_center_categories.sql','202610120007_message_center_preferences.sql','202610120008_accounting_integrity.sql','202610130001_accounting_show_boundary.sql','202610130002_accounting_minimal_linkage.sql','202610130003_legacy_return_reversal.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610070004_audit_actor_snapshots.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202609240002_failed_request_event.sql','utf8'));
 const profiles=fs.readFileSync('supabase/migrations/202610070013_space_player_profiles.sql','utf8');await db.exec(profiles.slice(0,profiles.indexOf('-- Directory projection'))+'commit;');
 await db.exec(fs.readFileSync('supabase/migrations/202610140001_achievements.sql','utf8'));
 const snapshot=async()=>({rows:await q('select kind,id,data from papa_v2_entities order by kind,id'),events:await q('select id from papa_events order by id'),revision:await q('select revision from papa_v2_revision'),receipts:await q('select * from papa_operation_receipts order by created_at'),awards:await q('select * from papa_achievement_awards order by code,period'),draws:await q('select * from papa_achievement_draws order by queue_id'),requestDraws:await q('select * from papa_achievement_request_draws order by queue_id')});
 const original=await q("select pg_get_functiondef('papa_room_operational_commit(bigint,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure) definition");
 const rowsBefore=await q('select kind,id,data from papa_v2_entities order by kind,id');
 await db.exec(fs.readFileSync('supabase/migrations/202610130005_operation_receipts.sql','utf8'));
 assert.deepEqual(await q('select kind,id,data from papa_v2_entities order by kind,id'),rowsBefore);
 assert.deepEqual(await q("select pg_get_functiondef('papa_room_operational_commit(bigint,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure) definition"),original);
 const key='a'.repeat(64),fingerprint='b'.repeat(64);
 const send=async(before,after,operation,hash=fingerprint,context=ctx,notices=[])=>{
  const p=stateChanges(before,after,{preserveOrder:true});
  return (await q('select papa_room_operational_commit_receipted($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[before.revision,p.changes,p.removed,context,notices,'papa',operation,key,hash]))[0].result;
 };
 const lookup=async(id,actorKey=key,space='space-001')=>(await q('select papa_operation_receipt($1,$2,$3,$4) result',['papa',space,actorKey,id]))[0].result;
 const op=crypto.randomUUID(),player=state.players[0].playerId,song=state.songs[0].songId,source=state.ledger[0].id;
 const before=structuredClone(state),allocated=mutate(state,{streamer:'papa',type:'allocate',data:{ledgerId:source,playerId:player,total:3,stored:1,items:[{songId:song},{songId:song}]}},actor,at);
 const duplicate=await Promise.all([send(before,allocated,op),send(before,allocated,op)]);
 assert.deepEqual(duplicate.map(r=>r.duplicate),[false,true]);assert.equal(duplicate[0].revision,duplicate[1].revision);
 state=allocated;state.revision=duplicate[0].revision;
 assert.equal((await q('select count(*)::int n from papa_operation_receipts'))[0].n,1);
 let prior=await snapshot();await assert.rejects(send(before,allocated,op,'c'.repeat(64)),/OPERATION_RECEIPT_REUSED/);assert.deepEqual(await snapshot(),prior);
 assert.equal((await lookup(op)).committed,true);assert.equal((await lookup(op,'d'.repeat(64))).committed,false);
 await assert.rejects(lookup(op,key,'other-space'),/SCOPE_INVALID/);
 await assert.rejects(send(before,allocated,crypto.randomUUID()),/VERSION_CONFLICT/);assert.deepEqual(await snapshot(),prior);
 const forged=structuredClone(state);forged.ledger[0].receipt_quantity=99;
 const failed=crypto.randomUUID();await assert.rejects(send(state,forged,failed),/RECEIPT_IMMUTABLE/);assert.equal((await lookup(failed)).committed,false);assert.deepEqual(await snapshot(),prior);
 const nextDeposit=mutate(state,{streamer:'papa',type:'ledger',data:{playerId:player,amount:1}},actor,at);
 const badNotice=crypto.randomUUID();await assert.rejects(send(state,nextDeposit,badNotice,fingerprint,ctx,[{id:'invalid',streamer_id:'papa'}]),/uuid/);assert.equal((await lookup(badNotice)).committed,false);assert.deepEqual(await snapshot(),prior);
 for(const [id,operation] of [[state.queue[0].id,'cancel'],[state.queue[1].id,'stage'],[state.queue[1].id,'complete'],[state.queue[1].id,'delete']]){
  const before=structuredClone(state),next=mutate(state,{streamer:'papa',type:'queue',data:{id,operation,preparationMinutes:0}},actor,at),op=crypto.randomUUID();
  const result=await send(before,next,op);state=next;state.revision=result.revision;
  prior=await snapshot();assert.equal((await send(before,next,op)).duplicate,true);assert.deepEqual(await snapshot(),prior);
 }
 const summary=(await q("select papa_accounting_summary('space-001','papa','2026-10-13') result"))[0].result;
 assert.equal(summary.received,3);assert.equal(summary.stored,2);assert.equal(summary.sung,1);
 assert.equal((await q('select count(*)::int n from papa_achievement_draws'))[0].n,1,'only the real completion, never retries or archive, draws');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);await assert.rejects(q('select * from papa_operation_receipts'),/permission denied/);
  if(role!=='service_role')await assert.rejects(lookup(op),/permission denied/);
  else assert.equal((await lookup(op)).committed,true);
  await db.exec('reset role');
 }
});
