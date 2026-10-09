import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {empty,DEFAULTS,TABLES,upgradePlatform,mutate} from '../src/core.js';
import {stateEntries,stateChanges} from '../src/state-patch.js';
import {deriveNotices,canonicalNoticeLink} from '../src/notification-rules.js';
import {venuePolicyHistoryVenue,venuePolicyLedgerPool} from '../src/venue-policy.js';

const at='2026-10-09T04:00:00Z',nativeSpace='space-venue-native',nativeRoom='venue-native';
const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const withoutVenueSettings=()=>{const settings=structuredClone(DEFAULTS);delete settings.radio_enabled;delete settings.current_space;return settings;};

// Follow the established native-room PGlite fixture: execute the original
// business migrations and only the actual native audit functions they need.
async function fixture(t,room){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 let businessCalls=0;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');
 await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 await db.exec(migration('202609240001_release_a.sql'));
 await db.exec(migration('202609240003_notifications.sql'));
 const initial=upgradePlatform(empty());initial.settings=withoutVenueSettings();
 initial.streamers.push({id:'michelle',slug:'michelle',display_name:'Other Legacy Room',active:true});
 initial.streamerSettings.michelle=withoutVenueSettings();
 for(const id of Object.keys(initial.streamerSettings))initial.streamerSettings[id]=withoutVenueSettings();
 initial.players=[{playerId:'P1',name:'Legacy Player',ids:['legacy-login'],names:[],password:'legacy-secret'}];
 initial.songs=[{songId:'legacy-song',streamer_id:'papa',title:'Legacy Song',artist:'Artist',creditCost:2,lyrics:'private lyric'}];
 initial.queue=[{id:'legacy-history',streamer_id:'papa',playerId:'P1',songId:'legacy-song',kind:'saved',status:'waiting',creditCost:1,at}];
 initial.ledger=[{id:'legacy-credit',streamer_id:'papa',playerId:'P1',amount:10,at}];
 for(const entry of stateEntries(initial))await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[entry.kind,entry.id,entry.data]);
 await db.exec(migration('202610070001_space_foundation.sql'));
 await db.exec(migration('202610070004_audit_actor_snapshots.sql'));
 await db.exec(migration('202610070007_notification_space_scope.sql'));
 await db.exec(migration('202610070009_scoped_read_snapshot.sql'));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 await db.exec(migration('202610070011_room_operational_commit.sql'));
 await db.exec(migration('202610070013_space_player_profiles.sql'));
 await db.exec(migration('202610070015_room_admin_commit.sql'));
 const audit=migration('202610080012_communication_space.sql');
 for(const name of ['papa_communication_player_name','papa_native_meta_audit_projection','papa_event_actor_snapshot']){
  const start=audit.indexOf('function '+name+'(');
  assert.ok(start>=0,'native audit function exists: '+name);
  await db.exec(audit.slice(audit.lastIndexOf('create ',start),audit.indexOf('$$;',start)+3));
 }
 await db.exec(migration('202610080013_native_room_transactions.sql'));
 await q("insert into papa_spaces(id,slug,display_name) values($1,'venue-native','Native Venue Space')",[nativeSpace]);
 for(const id of [nativeRoom,'venue-other'])await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,nativeSpace]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [nativeRoom,'venue-other']){
  meta.streamers.push({id,slug:id,display_name:id,active:true});
  meta.streamerSettings[id]=withoutVenueSettings();
 }
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const admin=await account(),player=await account();
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,'streamer_admin',$3)",[admin,nativeSpace,nativeRoom]);
 const membership=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[player,nativeSpace]))[0].id;
 await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
  [nativeSpace,'P1',player,membership,{playerId:'P1',name:'Native Player',ids:['native-login'],names:[],_order:0}]);
 for(const [kind,id,data] of [
  ['songs','native-song',{songId:'native-song',streamer_id:nativeRoom,title:'Native Song',artist:'Artist',creditCost:2,lyrics:'private native lyric'}],
  ['queue','native-history',{id:'native-history',streamer_id:nativeRoom,playerId:'P1',songId:'native-song',kind:'saved',status:'waiting',creditCost:1,at,_order:0}],
  ['ledger','native-credit',{id:'native-credit',streamer_id:nativeRoom,playerId:'P1',amount:10,at}],
  ['queue','other-legacy-queue',{id:'other-legacy-queue',streamer_id:'michelle',playerId:'P1',kind:'live',status:'waiting',at}],
  ['queue','other-native-queue',{id:'other-native-queue',streamer_id:'venue-other',playerId:'P1',kind:'live',status:'waiting',at}]
 ])await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[kind,id,data]);
 const space=room===nativeRoom?nativeSpace:'space-001',songId=room===nativeRoom?'native-song':'legacy-song';
 const ctx={role:'streamer_admin',streamer_id:room,actor_streamer_id:room,space_id:space,...(room===nativeRoom?{account_id:admin}:{})};
 const self={...ctx,role:'player',actor_streamer_id:null,player_id:'P1',...(room===nativeRoom?{account_id:player}:{})};
 const read=async()=>{
  const snapshot=await rpc('papa_v2_room_write_snapshot_in_space',[room,[],space]),state=empty();
  state.revision=Number(snapshot.revision);
  for(const row of snapshot.rows)if(row.kind==='meta')Object.assign(state,row.data);else if(row.kind==='settings')state.settings=row.data;else if(TABLES.includes(row.kind))state[row.kind].push(row.data);
  return state;
 };
 const commit=async(expected,changes,context=ctx,notices=[],adminCommit=false)=>{
  businessCalls++;
  return Number(await rpc(adminCommit?'papa_room_admin_commit':'papa_room_operational_commit',[expected,changes,[],context,notices,room]));
 };
 const mutateCommit=async(action,context=ctx)=>{
  const before=await read(),after=mutate(before,{...action,streamer:room},{role:context.role==='player'?'player':'admin',playerId:context.player_id},at);
  // Match the production adapter's room settings alias and ordering behavior.
  if(room===nativeRoom)after.settings=after.streamerSettings[room];
  const patch=stateChanges(before,after,{preserveOrder:true});
  assert.deepEqual(patch.removed,[]);
  const actor={...context,action:action.type==='queue'?'queue:'+action.data.operation:action.type};
  const notices=deriveNotices(before,after,actor,at),expectedCalls=businessCalls+1;
  after.revision=await commit(before.revision,patch.changes,actor,notices);
  assert.equal(after.revision,before.revision+1);assert.equal(businessCalls,expectedCalls,'one existing operational RPC persists each Core mutation');
  return {before,after,notices};
 };
 const stable=async()=>({entities:await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),
  profiles:await q('select space_id,player_id,data from papa_space_player_profiles order by space_id,player_id'),
  events:await q('select * from papa_events order by id'),notices:await q('select * from papa_notifications order by id'),
  push:await q('select * from papa_push_jobs order by id'),revision:await q('select revision from papa_v2_revision')});
 const others=async()=>({entities:await q("select kind,id,data,space_id from papa_v2_entities where space_id is not null and data->>'streamer_id'<>$1 order by kind,id",[room]),
  settings:Object.fromEntries(Object.entries((await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data.streamerSettings).filter(([id])=>id!==room))});
 return {q,read,commit,mutateCommit,stable,others,ctx,self,space,songId,calls:()=>businessCalls};
}

for(const room of ['papa',nativeRoom])test(room+' venue metadata survives the existing atomic room RPC, reads, audit and canonical notices',async t=>{
 const {q,read,commit,mutateCommit,stable,others,ctx,self,space,songId,calls}=await fixture(t,room);
 const foreignBefore=await others();
 const original=await read(),historyId=room===nativeRoom?'native-history':'legacy-history';
 const oldCredit=original.ledger.find(x=>x.id===(room===nativeRoom?'native-credit':'legacy-credit'));
 assert.equal(venuePolicyLedgerPool(oldCredit),'shengma');assert.equal(Object.hasOwn(oldCredit,'storage_pool'),false);
 assert.equal(venuePolicyHistoryVenue(original.queue.find(x=>x.id===historyId)),null);
 const configure=async(settings)=>{
  const before=await read(),roomSettings={...before.streamerSettings[room],...settings};
  const meta={schemaVersion:3,streamers:before.streamers,streamerSettings:{...before.streamerSettings,[room]:roomSettings},migrationIssues:before.migrationIssues||[]};
  const expectedCalls=calls()+1;
  assert.equal(await commit(before.revision,[{kind:'settings',id:'1',data:roomSettings},{kind:'meta',id:'1',data:meta}],{...ctx,action:'settings'},[],true),before.revision+1);
  assert.equal(calls(),expectedCalls,'one existing admin RPC owns the settings transaction');
 };
 await configure({radio_enabled:true,current_space:'radio',hourlyLimit:4});
 let view=await read();assert.equal(view.streamerSettings[room].radio_enabled,true);assert.equal(view.streamerSettings[room].current_space,'radio');
 const requested=await mutateCommit({type:'request',data:{songId,kind:'saved'}},self),saved=requested.after.queue.at(-1);
 assert.equal(saved.creditCost,2);assert.equal(saved.venue,'radio');assert.equal(saved.consumed_storage_pool,'shengma','radio request falls back to its sufficient original pool');
 await configure({radio_enabled:false,current_space:'shengma'});
 view=await read();let persisted=view.queue.find(x=>x.id===saved.id);
 assert.equal(persisted.venue,'radio');assert.equal(persisted.consumed_storage_pool,'shengma');
 await mutateCommit({type:'queue',data:{id:saved.id,operation:'acknowledge',preparationMinutes:0}});
 const completed=await mutateCommit({type:'queue',data:{id:saved.id,operation:'complete'}});
 const debit=completed.after.ledger.find(x=>x.queueId===saved.id);
 assert.equal(debit.amount,-2);assert.equal(debit.storage_pool,'shengma');assert.equal(debit.venue,'radio');
 view=await read();persisted=view.queue.find(x=>x.id===saved.id);
 assert.equal(persisted.venue,'radio');assert.equal(persisted.consumed_storage_pool,'shengma');
 assert.equal(view.ledger.find(x=>x.id===debit.id).storage_pool,'shengma');
 const allocated={id:'venue-allocation-'+room,streamer_id:room,playerId:'P1',songId,title:'Live Song',kind:'live',status:'waiting',creditCost:2,allocation_id:'venue-draw',allocation_storage_pool:'radio',venue:'radio',at,_order:2};
 assert.equal(await commit(view.revision,[{kind:'queue',id:allocated.id,data:allocated}],{...ctx,action:'allocate'}),view.revision+1);
 const cancelledAllocation=await mutateCommit({type:'cancelOwn',data:{id:allocated.id}},self),returned=cancelledAllocation.after.ledger.find(x=>x.queueId===allocated.id);
 assert.equal(returned.storage_pool,'radio');assert.equal(returned.amount,2);assert.equal(returned.allocationSettlement,'return');
 view=await read();assert.equal(view.queue.find(x=>x.id===allocated.id).allocation_storage_pool,'radio');assert.equal(view.ledger.find(x=>x.id===returned.id).storage_pool,'radio');
 await mutateCommit({type:'cancelOwn',data:{id:historyId}},self);
 view=await read();assert.equal(Object.hasOwn(view.queue.find(x=>x.id===historyId),'venue'),false);assert.equal(Object.hasOwn(view.queue.find(x=>x.id===historyId),'consumed_storage_pool'),false);
 assert.equal(venuePolicyHistoryVenue(view.queue.find(x=>x.id===historyId)),null);
 assert.deepEqual(view.ledger.find(x=>x.id===oldCredit.id),oldCredit,'reads and unrelated operations do not backfill historical ledger pool metadata');
 const events=await q("select entity_kind,entity_id,action,before_data,after_data,space_id from papa_events where streamer_id=$1 and action in ('request','queue:complete','allocate','cancelOwn','settings') order by id",[room]);
 for(const event of events)assert.equal(event.space_id,space,'venue labels never replace canonical audit Space');
 const request=events.find(x=>x.action==='request'&&x.entity_kind==='queue'&&x.entity_id===saved.id);
 assert.equal(request.after_data.venue,'radio');assert.equal(request.after_data.consumed_storage_pool,'shengma');assert.equal(request.space_id,space);
 const completion=events.find(x=>x.action==='queue:complete'&&x.entity_kind==='queue');
 assert.equal(completion.before_data.venue,'radio');assert.equal(completion.after_data.venue,'radio');assert.equal(completion.after_data.consumed_storage_pool,'shengma');
 assert.equal(events.find(x=>x.entity_id===debit.id).after_data.storage_pool,'shengma');assert.equal(events.find(x=>x.entity_id===debit.id).after_data.venue,'radio');
 assert.equal(events.find(x=>x.entity_id===allocated.id).after_data.allocation_storage_pool,'radio');
 assert.equal(events.find(x=>x.entity_id===returned.id).after_data.storage_pool,'radio');
 const settingEvent=events.find(x=>x.action==='settings'&&x.entity_kind==='meta'&&x.after_data.streamerSettings[room].current_space==='radio');
 assert.equal(settingEvent.after_data.streamerSettings[room].radio_enabled,true);
 const savedNotices=await q('select * from papa_notifications where entity_id=$1 order by id',[saved.id]);
 assert.ok(savedNotices.length>=3);
 for(const notice of savedNotices){assert.equal(notice.space_id,space);assert.equal(canonicalNoticeLink(notice,room).spaceId,space);assert.equal(notice.streamer_id,room);}
 const baseline=await stable(),badNotice={...completed.notices[0],id:'invalid-uuid'};
 await assert.rejects(commit(view.revision-1,[{kind:'ledger',id:returned.id,data:{...returned,amount:20}}],{...ctx,action:'ledger'},[badNotice]),/VERSION_CONFLICT/);
 assert.deepEqual(await stable(),baseline,'stale revision leaves entity, audit, notice, push and revision rows unchanged');
 await assert.rejects(commit(view.revision,[{kind:'queue',id:saved.id,data:{...persisted,status:'cancelled'}},{kind:'ledger',id:returned.id,data:{...returned,amount:20}}],{...ctx,action:'queue:cancel'},[badNotice]),/uuid/);
 assert.deepEqual(await stable(),baseline,'notice failure rolls all business metadata back in the original transaction');
 assert.deepEqual(await others(),foreignBefore,'other room and other canonical Space rows and settings are unchanged');
});
