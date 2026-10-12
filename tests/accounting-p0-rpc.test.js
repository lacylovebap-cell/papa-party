import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {empty,mutate,scopeState,stats} from '../src/core.js';
import {stateEntries,stateChanges} from '../src/state-patch.js';
const at='2026-10-12T11:10:00Z',actor={role:'admin'},ctx={role:'streamer_admin',actor_streamer_id:'papa',streamer_id:'papa',space_id:'space-001',action:'accounting-test'};
test('real atomic RPC, deferred linkage, stale-device replay, rollback and selected-scope aggregation',async t=>{
 const db=new PGlite();t.after(()=>db.close());const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=fs.readFileSync('supabase/migrations/202609170001_party_v2.sql','utf8');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const file of ['202609240001_release_a.sql','202609240003_notifications.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 let state=mutate(empty(),{streamer:'papa',type:'player',data:{name:'isolated'}},actor,at);
 state=mutate(state,{streamer:'papa',type:'song',data:{title:'song',artist:'artist',creditCost:1}},actor,at);
 state=mutate(state,{streamer:'papa',type:'ledger',data:{playerId:state.players[0].playerId,amount:3}},actor,at);
 for(const r of stateEntries(state))await q('insert into papa_v2_entities values($1,$2,$3)',[r.kind,r.id,r.data]);
 await q('update papa_v2_revision set revision=$1',[state.revision]);
 await db.exec('alter table papa_notifications add column space_id text;');
 for(const file of ['202610070001_space_foundation.sql','202610070011_room_operational_commit.sql','202610120002_message_center_categories.sql','202610120007_message_center_preferences.sql','202610120008_accounting_integrity.sql','202610130001_accounting_show_boundary.sql','202610130002_accounting_minimal_linkage.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 const commit=async(before,after,notices=[])=>{const patch=stateChanges(before,after,{preserveOrder:true});return (await q('select papa_room_operational_commit($1,$2,$3,$4,$5,$6) rev',[before.revision,patch.changes,patch.removed,ctx,notices,'papa']))[0].rev;};
 const run=async(type,data,time=at)=>{const next=mutate(state,{streamer:'papa',type,data},actor,time);next.revision=await commit(state,next);state=next;};
 const summary=async(day='2026-10-12')=>(await q('select papa_accounting_summary($1,$2,$3) value',['space-001','papa',day]))[0].value;
 const assertSummary=async()=>{const result=await summary();for(const [key,value] of Object.entries(stats(scopeState(state,'papa'),at)))assert.equal(result[key],value);};
 const source=state.ledger[0].id,player=state.players[0].playerId,song=state.songs[0].songId;
 const input={ledgerId:source,playerId:player,total:3,stored:1,items:[{songId:song},{songId:song}]};
 const before=structuredClone(state),next=mutate(state,{streamer:'papa',type:'allocate',data:input},actor,at);
 const outcomes=await Promise.allSettled([commit(before,next),commit(before,next)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.match(outcomes.find(r=>r.status==='rejected').reason.message,/VERSION_CONFLICT/);state=next;state.revision=outcomes.find(r=>r.status==='fulfilled').value;
 await assertSummary();assert.equal((await summary()).available,1);
 // Guard failures roll back every row, Audit and revision.
 const snapshot=async()=>({rows:await q('select kind,id,data from papa_v2_entities order by kind,id'),events:await q('select id from papa_events order by id'),revision:await q('select revision from papa_v2_revision')});
 let original=await snapshot();const forged=structuredClone(state);forged.ledger[0].amount=0;
 await assert.rejects(commit(state,forged),/RECEIPT_IMMUTABLE/);assert.deepEqual(await snapshot(),original);
 const quantity=structuredClone(state);quantity.ledger[0].receipt_quantity=99;
 await assert.rejects(commit(state,quantity),/RECEIPT_IMMUTABLE/);assert.deepEqual(await snapshot(),original);
 const over=structuredClone(state);over.queue[0].creditCost=3;
 await assert.rejects(commit(state,over),/SOURCE_OVERALLOCATED/);assert.deepEqual(await snapshot(),original);
 await assert.rejects(q("delete from papa_v2_entities where kind='ledger' and id=$1",[source]),/USE_REVERSAL/);assert.deepEqual(await snapshot(),original);
 // Cancel once, then cancel again cannot mint a refund.
 await run('queue',{id:state.queue[0].id,operation:'cancel'});const ledger=structuredClone(state.ledger);
 assert.throws(()=>mutate(state,{streamer:'papa',type:'queue',data:{id:state.queue[0].id,operation:'cancel'}},actor,at));assert.deepEqual(state.ledger,ledger);
 await assertSummary();assert.equal((await summary()).available,2);
 await run('queue',{id:state.queue[1].id,operation:'stage',preparationMinutes:0});
 await run('queue',{id:state.queue[1].id,operation:'complete'});await assertSummary();assert.equal((await summary()).sung,1);
 const id=state.queue[1].id;original=await snapshot();
 await assert.rejects(q("delete from papa_v2_entities where kind='queue' and id=$1",[id]),/USE_CANCEL_OR_ARCHIVE/);assert.deepEqual(await snapshot(),original);
 const wrongLink=structuredClone(state);wrongLink.ledger.at(-1).source_transaction_id='foreign-source';
 await assert.rejects(commit(state,wrongLink),/SETTLEMENT/);assert.deepEqual(await snapshot(),original);
 const extra=structuredClone(state),debit=extra.ledger.at(-1);extra.ledger.push({...debit,id:crypto.randomUUID()});
 await assert.rejects(commit(state,extra),/SETTLEMENT/);assert.deepEqual(await snapshot(),original);
 await run('queue',{id,operation:'delete'});await assertSummary();assert.equal((await summary()).sung,1);assert.equal((await summary()).saved,2);
 // A failed notice insertion also rolls back otherwise valid accounting rows.
 const deposit=mutate(state,{streamer:'papa',type:'ledger',data:{playerId:player,amount:2}},actor,at);original=await snapshot();
 await assert.rejects(commit(state,deposit,[{id:'bad',streamer_id:'papa'}]),/uuid/);assert.deepEqual(await snapshot(),original);
 await run('ledger',{playerId:player,amount:2});await assertSummary();
 const receipt=state.ledger.at(-1);await run('ledger',{...receipt,remove:true});await assertSummary();assert.equal(state.ledger.find(l=>l.id===receipt.id).amount,2);
 const reversed=structuredClone(state);reversed.ledger.push({...reversed.ledger.at(-1),id:crypto.randomUUID()});original=await snapshot();
 await assert.rejects(commit(state,reversed),/DUPLICATE_REVERSAL|VOID_INVALID/);assert.deepEqual(await snapshot(),original);
 assert.equal((await summary('2026-10-13')).received,0);assert.equal((await summary('2026-10-13')).saved,2);
 await assert.rejects(q("select papa_accounting_summary('another-space','papa','2026-10-12')"),/SCOPE_INVALID/);
 await t.test('server aggregates retain the show across midnight and switch only at Taipei 19:00',async()=>{
  await run('ledger',{playerId:player,amount:1},'2026-10-13T10:59:59Z');
  await run('ledger',{playerId:player,amount:2},'2026-10-13T11:00:00Z');
  await run('ledger',{playerId:player,amount:3},'2026-10-13T16:00:00Z');
  await run('onBehalf',{playerId:player,songId:song,kind:'saved',completed:true},'2026-10-13T16:00:00Z');
  assert.equal((await summary('2026-10-12')).received,4);
  assert.equal((await summary('2026-10-13')).received,5);
  assert.equal((await summary('2026-10-13')).sung,1);
  assert.equal((await summary('2026-10-13')).rolloverHour,19);
  const local=stats(scopeState(state,'papa'),'2026-10-13T16:00:00Z');
  for(const [key,value] of Object.entries(local))assert.equal((await summary('2026-10-13'))[key],value);
 });
 await t.test('receipt void cancels source reservations and reverses linked legacy returns in one RPC',async()=>{
  const before=await summary();await run('ledger',{playerId:player,amount:3});const root=state.ledger.at(-1).id;
  await run('allocate',{ledgerId:root,playerId:player,total:3,stored:1,items:[{songId:song},{songId:song}]});
  await run('ledger',{...state.ledger.find(l=>l.id===root),remove:true});
  const after=await summary();for(const k of ['received','stored','sung','saved','reserved','available'])assert.equal(after[k],before[k]);
  await run('ledger',{playerId:player,amount:1});const legacyRoot=state.ledger.at(-1).id,group=crypto.randomUUID();
  const original=structuredClone(state),legacy=structuredClone(state);legacy.ledger.at(-1).allocation_id=group;
  for(let i=0;i<2;i++)legacy.queue.push({id:crypto.randomUUID(),playerId:player,streamer_id:'papa',kind:'live',status:'waiting',songId:song,title:'legacy',artist:'',at,acceptedAt:at,creditCost:1,allocation_id:group,allocation_storage_pool:'shengma'});
  legacy.revision=await commit(original,legacy);state=legacy;
  for(const row of state.queue.filter(q=>q.allocation_id===group))await run('queue',{id:row.id,operation:'cancel'});
  const partial=structuredClone(state),legacySource=partial.ledger.find(l=>l.id===legacyRoot);legacySource.voided_at=at;
  partial.ledger.push({id:crypto.randomUUID(),playerId:player,streamer_id:'papa',amount:-legacySource.amount,at,storage_pool:'shengma',reversal_of:legacyRoot,conversion:true});
  const intact=await snapshot();await assert.rejects(commit(state,partial),/VOID_INVALID/);assert.deepEqual(await snapshot(),intact);
  await run('ledger',{...state.ledger.find(l=>l.id===legacyRoot),remove:true});
  const end=await summary();for(const k of ['received','stored','sung','saved','reserved','available'])assert.equal(end[k],before[k]);
  assert.ok(state.ledger.filter(l=>l.allocation_id===group&&l.allocationSettlement==='return').every(l=>l.voided_at));
 });
 await t.test('reviewed duplicate linkage preserves performance/debits and is idempotent and scope-bound',async()=>{
  await run('onBehalf',{playerId:player,songId:song,kind:'saved',completed:true});const duplicate=state.queue.at(-1).id;
  const prior=await summary(),money=structuredClone(state.ledger);
  await run('queue',{id:duplicate,operation:'correctDuplicate',canonicalQueueId:id});
  assert.equal((await summary()).sung,prior.sung-1);assert.deepEqual(state.ledger,money);
  await run('queue',{id:duplicate,operation:'correctDuplicate',canonicalQueueId:id});assert.deepEqual(state.ledger,money);
  assert.equal(state.queue.find(q=>q.id===duplicate).status,'completed');
  assert.throws(()=>mutate(state,{streamer:'papa',type:'queue',data:{id,operation:'correctDuplicate',canonicalQueueId:duplicate}},actor,at));
 });
 await t.test('legacy source withdrawal follows exact allocation Audit batches without rewriting facts or balances',async()=>{
  const room='legacy-room',person='legacy-player',source='legacy-receipt',first='legacy-first',second='legacy-second',current='legacy-current';
  await q("insert into papa_space_streamers(streamer_id,space_id) values($1,'space-001')",[room]);
  const row=async(kind,id,data)=>q("insert into papa_v2_entities(kind,id,data,space_id) values($1,$2,$3,'space-001')",[kind,id,{...data,playerId:person,streamer_id:room,at,acceptedAt:at}]);
  await row('ledger','current-receipt',{amount:2});await row('ledger','extra-receipt',{amount:2});
  for(const [id,group,status] of [['old-a',first,'stored'],['old-b',first,'stored'],['old-c',first,'completed'],['old-d',second,'completed'],['current-q',current,'completed']])await row('queue',id,{kind:'live',status,allocation_id:group,creditCost:1,...(status==='completed'?{completedAt:at}:{})});
  await q("update papa_v2_entities set data=data||jsonb_build_object('allocation_id',$1::text) where kind='ledger' and id='current-receipt'",[current]);
  for(const id of ['old-a','old-b'])await row('ledger','return-'+id,{amount:1,queueId:id,conversion:true,allocation_id:first,allocationSettlement:'return'});
  await row('ledger','spent',{amount:-2});
  const oldReceipt={id:source,playerId:person,streamer_id:room,amount:0,at};
  const audit=async(kind,id,action,before,after,created)=>q('insert into papa_events(streamer_id,entity_kind,entity_id,action,before_data,after_data,created_at) values($1,$2,$3,$4,$5,$6,$7)',[room,kind,id,action,before,after,created]);
  for(const [group,batch] of [[first,'2026-10-12T11:30:00Z'],[second,'2026-10-12T12:15:00Z']]){
   await audit('ledger',source,'allocate',{...oldReceipt,amount:3},oldReceipt,batch);
   await audit('queue','audit-'+group,'allocate',null,{playerId:person,allocation_id:group,allocation_storage_pool:'shengma'},batch);
  }
  await audit('ledger',source,'ledger',oldReceipt,null,'2026-10-12T12:26:00Z');
  const read=async()=>(await q("select papa_accounting_summary('space-001',$1,'2026-10-12') value",[room]))[0].value;
  const before=await snapshot(),result=await read();assert.equal(result.received,5);assert.equal(result.stored,2);assert.equal(result.sung,3);assert.equal(result.saved,4);assert.deepEqual(await snapshot(),before);
  // A fully allocated legacy receipt can have no retained parent. Without
  // explicit withdrawal evidence, its real receipt must remain counted.
  await row('queue','unknown-source',{kind:'live',status:'waiting',allocation_id:'unknown-group',creditCost:1});
  assert.equal((await read()).received,6);
  const ambiguous='2026-10-12T13:00:00Z';
  await audit('ledger','ambiguous-deleted','allocate',oldReceipt,oldReceipt,ambiguous);
  await audit('ledger','ambiguous-retained','allocate',oldReceipt,oldReceipt,ambiguous);
  await audit('queue','unknown-source','allocate',null,{playerId:person,allocation_id:'unknown-group'},ambiguous);
  await audit('ledger','ambiguous-deleted','ledger',oldReceipt,null,'2026-10-12T13:10:00Z');
  assert.equal((await read()).received,6,'ambiguous legacy batches must not guess a withdrawn source');
 });
 await t.test('rollover configuration belongs to the Space; other Spaces do not inherit 19:00',async()=>{
  await q("insert into papa_spaces(id,slug,display_name) values('isolated-space','isolated-space','isolated')");
  await q("insert into papa_space_streamers(streamer_id,space_id) values('isolated-room','isolated-space')");
  assert.equal((await q("select papa_accounting_summary('isolated-space','isolated-room','2026-10-12') value"))[0].value.rolloverHour,0);
 });
 await db.exec('set role anon');await assert.rejects(summary(),/permission denied/);await db.exec('reset role');
});
