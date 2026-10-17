// Real native transaction fixture reused from native-room-transactions.test.js.
// Every record is isolated PGlite data; no production connection exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {empty,mutate,TABLES,DEFAULTS} from '../src/core.js';
import {stateEntries,stateChanges} from '../src/state-patch.js';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const at='2026-10-08T04:00:00Z',space='space-native-test',room='native-room',otherRoom='native-room-two';
async function fixture(t,{install=true}={}){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 await db.exec(migration('202609240001_release_a.sql'));await db.exec(migration('202609240003_notifications.sql'));
 const legacy=mutate(empty(),{type:'song',data:{title:'Legacy song',artist:'Legacy artist',lyrics:'legacy-private-lyrics'}},{role:'admin'},at);
 legacy.players=[{playerId:'P1',name:'Legacy Player',ids:['legacy-login'],names:[],password:'legacy-password',note:'legacy-private-profile'}];
 legacy.migrationIssues=['legacy-private-issues'];
 for(const entry of stateEntries(legacy))await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[entry.kind,entry.id,entry.data]);
 await db.exec(migration('202610070001_space_foundation.sql'));
 await db.exec(migration('202610070004_audit_actor_snapshots.sql'));
 await db.exec(migration('202610070009_scoped_read_snapshot.sql'));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 await db.exec(migration('202610070011_room_operational_commit.sql'));
 await db.exec(migration('202610070013_space_player_profiles.sql'));
 await db.exec(migration('202610070015_room_admin_commit.sql'));
 // The actual native audit functions have no device-table dependencies. Keep
 // this fixture focused on the real room business commit and profile storage.
 const audit=migration('202610080012_communication_space.sql');
 for(const name of ['papa_communication_player_name','papa_native_meta_audit_projection','papa_event_actor_snapshot']){
  const start=audit.indexOf('function '+name+'(');
  assert.ok(start>=0,'native audit function exists: '+name);
  const statement=audit.lastIndexOf('create ',start);
  await db.exec(audit.slice(statement,audit.indexOf('$$;',start)+3));
 }
 await db.exec(migration('202610080013_native_room_transactions.sql'));
 await db.exec(migration('202610130005_operation_receipts.sql'));
 if(install)await db.exec(migration('202610170001_native_operation_receipts.sql'));
 await q("insert into papa_spaces(id,slug,display_name) values($1,'native-test','Native Test'),('space-foreign-test','foreign-test','Foreign Test')",[space]);
 for(const [id,scope] of [[room,space],[otherRoom,space],['foreign-room','space-foreign-test']])
  await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,scope]);
 const meta=(await q("select data from papa_v2_entities where kind='meta'"))[0].data;
 for(const id of [room,otherRoom,'foreign-room']){
  meta.streamers.push({id,slug:id,display_name:id,active:true});
  meta.streamerSettings[id]={...structuredClone(DEFAULTS),manual:'private settings for '+id};
 }
 meta.privatePlatformField='legacy-private-meta';
 await q("update papa_v2_entities set data=$1 where kind='meta'",[meta]);
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const admin=await account(),player=await account(),secondPlayer=await account(),foreignPlayer=await account(),president=await account();
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,'streamer_admin',$3)",[admin,space,room]);
 for(const [id,subject,scope] of [['P1',player,space],['P2',secondPlayer,space],['PF',foreignPlayer,'space-foreign-test']]){
  const membership=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[subject,scope]))[0].id;
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
   [scope,id,subject,membership,{playerId:id,name:'Native '+id,ids:['native-'+id],names:[],note:'private native '+id,_order:0}]);
 }
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 const sourceRows=[
  ['songs','NS',{songId:'NS',streamer_id:room,title:'Native Song',artist:'Native Artist',tags:['Old'],lyrics:'native-private-lyrics',privateNotes:'native-private-notes',lyricHistory:['keep-history']}],
  ['songs','NS2',{songId:'NS2',streamer_id:otherRoom,title:'Other Native Song',lyrics:'other-native-private-lyrics'}],
  ['songs','FS',{songId:'FS',streamer_id:'foreign-room',title:'Foreign Song',lyrics:'foreign-private-lyrics'}],
  ['queue','NQ',{id:'NQ',streamer_id:room,songId:'NS',playerId:'P1',kind:'saved',status:'waiting',creditCost:1,at,_order:73}],
  ['queue','FQ',{id:'FQ',streamer_id:'foreign-room',songId:'FS',playerId:'PF',kind:'saved',status:'waiting',at}],
  ['ledger','NL',{id:'NL',streamer_id:room,playerId:'P1',amount:10,at}],
  ['wishes','NW',{id:'NW',streamer_id:room,playerId:'P1',title:'Native Wish',artist:'Artist',status:'收到',at}]
 ];
 for(const [kind,id,data] of sourceRows)await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[kind,id,data]);
 const ctx={role:'streamer_admin',account_id:admin,actor_streamer_id:room,streamer_id:room,space_id:space,action:'songsBulk'};
 const read=async(ids=[])=>{
  const result=await rpc('papa_v2_room_write_snapshot_in_space',[room,ids,space]);
  const state=empty();state.revision=Number(result.revision);
  for(const row of result.rows)if(row.kind==='meta')Object.assign(state,row.data);else if(row.kind==='settings')state.settings=row.data;else if(TABLES.includes(row.kind))state[row.kind].push(row.data);
  return state;
 };
 const commit=async(changes,removed=[],context=ctx,notices=[],operational=false,expected=null)=>rpc(operational?'papa_room_operational_commit':'papa_room_admin_commit',
  [expected??Number((await q('select revision from papa_v2_revision'))[0].revision),changes,removed,context,notices,room]);
 const mutateCommit=async(action,context=ctx,notices=[])=>{
  const before=await read(action.type==='song'&&action.data.songId?[action.data.songId]:[]);
  const after=mutate(before,{...action,streamer:room},{role:context.role==='player'?'player':'admin',playerId:context.player_id},at);
  after.settings=after.streamerSettings[room];
  const patch=stateChanges(before,after,{preserveOrder:true});
  return commit(patch.changes,patch.removed,{...context,action:action.type},notices,false,before.revision);
 };
 const notice=(id='00000000-0000-4000-8000-000000000011')=>({id,streamer_id:room,streamer_name:'Native room',recipient:'P1',type:'queue',level:2,body:'Native notice',entity_id:'NQ',created_at:at});
 const stable=async()=>({entities:await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),
  profiles:await q('select space_id,player_id,account_id,membership_id,data from papa_space_player_profiles order by space_id,player_id'),
  revision:await q('select revision from papa_v2_revision'),events:await q('select * from papa_events order by id'),
  notices:await q('select * from papa_notifications order by id'),push:await q('select * from papa_push_jobs order by id'),
  receipts:await q('select * from papa_operation_receipts order by space_id,streamer_id,actor_key,operation_id')});
 return {db,q,rpc,ctx,admin,player,secondPlayer,foreignPlayer,president,legacySong:legacy.songs[0].songId,read,commit,mutateCommit,notice,stable};
}

const actorKey=context=>createHash('sha256').update(JSON.stringify([
 context.account_id,context.role,context.role==='player'?context.player_id:null,
 context.role==='streamer_admin'?context.actor_streamer_id:null
])).digest('hex');
const requestHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function receipts(f){
 const send=async({context=f.ctx,changes=[],removed=[],notices=[],target=room,
  operation=crypto.randomUUID(),key=actorKey(context),hash=requestHash({changes,removed,notices}),expected=0}={})=>
  f.rpc('papa_room_operational_commit_receipted',[expected,changes,removed,context,notices,target,operation,key,hash]);
 const lookup=(operation,key,scope=space,target=room)=>f.rpc('papa_operation_receipt',[target,scope,key,operation]);
 const nativeLookup=(operation,key,context=f.ctx,scope=space,target=room)=>f.rpc('papa_native_operation_receipt',[target,scope,key,operation,context]);
 const queue=async(status='completed')=>({kind:'queue',id:'NQ',data:{
  ...(await f.q("select data from papa_v2_entities where kind='queue' and id='NQ'"))[0].data,status
 }});
 return {send,lookup,nativeLookup,queue};
}

test('native manager duplicate deliveries serialize into one original transaction and one receipt',async t=>{
 const f=await fixture(t),r=receipts(f),operation=crypto.randomUUID(),key=actorKey(f.ctx);
 const changes=[await r.queue()],request={changes,operation,key,notices:[f.notice()]};
 const before=await f.stable();
 const results=await Promise.all([r.send(request),r.send(request)]);
 assert.deepEqual(results.map(v=>v.duplicate),[false,true]);assert.equal(results[0].revision,1);assert.equal(results[1].revision,1);
 const after=await f.stable();assert.equal(after.receipts.length,1);assert.equal(after.notices.length,before.notices.length+1);
 assert.equal(after.events.length,before.events.length+1);assert.equal(Number(after.revision[0].revision),1);
 assert.equal((await r.lookup(operation,key)).committed,true);
 assert.deepEqual(await r.send(request),{revision:1,duplicate:true});assert.deepEqual(await f.stable(),after);
 // An unseen operation still obeys the original global revision CAS.
 await assert.rejects(r.send({...request,operation:crypto.randomUUID()}),/VERSION_CONFLICT/);
 assert.deepEqual(await f.stable(),after);
});

test('native receipt reuse rejects changed intent and forged Room Space Account or player identity',async t=>{
 const f=await fixture(t),r=receipts(f),operation=crypto.randomUUID(),key=actorKey(f.ctx),changes=[await r.queue()];
 await r.send({changes,operation,key});
 // Make the second Account genuinely authorized for the same manager role;
 // knowing the first actor's key still cannot replay that actor's receipt.
 await f.q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,'streamer_admin',$3)",[f.secondPlayer,space,room]);
 const baseline=await f.stable();
 const rejects=async(input,error=/ACTOR_INVALID|SCOPE_INVALID/)=>{
  await assert.rejects(r.send({changes,operation,key,...input}),error);assert.deepEqual(await f.stable(),baseline);
 };
 await rejects({hash:requestHash('different-intent')},/OPERATION_RECEIPT_REUSED/);
 await rejects({context:{...f.ctx,space_id:'space-foreign-test'}});
 await rejects({context:{...f.ctx,streamer_id:otherRoom}});
 await rejects({context:{...f.ctx,actor_streamer_id:otherRoom}});
 await rejects({target:otherRoom,context:{...f.ctx,streamer_id:otherRoom,actor_streamer_id:otherRoom}});
 await rejects({target:'foreign-room',context:{...f.ctx,space_id:'space-foreign-test',streamer_id:'foreign-room',actor_streamer_id:'foreign-room'}});
 await rejects({context:{...f.ctx,account_id:f.foreignPlayer}});
 await rejects({context:{...f.ctx,account_id:f.secondPlayer}},/ROOM_OPERATION_ACTOR_INVALID/);
 await rejects({context:{...f.ctx,role:'player',account_id:f.secondPlayer,actor_streamer_id:null,player_id:'P1',action:'request'}});
 assert.equal((await r.lookup(operation,'a'.repeat(64))).committed,false);
 await assert.rejects(r.lookup(operation,key,'space-foreign-test'),/SCOPE_INVALID/);
});

test('native player and president requests retain real Account authority and atomic notice Audit attribution',async t=>{
 const f=await fixture(t),r=receipts(f),self={...f.ctx,role:'player',account_id:f.player,player_id:'P1',actor_streamer_id:null,action:'request'};
 const data={id:'player-request',streamer_id:room,songId:'NS',playerId:'P1',kind:'saved',status:'waiting',creditCost:1,at};
 const operation=crypto.randomUUID(),changes=[{kind:'queue',id:data.id,data}],key=actorKey(self);
 assert.deepEqual(await r.send({context:self,changes,operation,key,notices:[f.notice()]}),{revision:1,duplicate:false});
 const baseline=await f.stable();assert.equal(baseline.receipts[0].actor_key,key);
 const event=(await f.q("select actor_account_id,actor_player_id,actor_display_name_snapshot,space_id from papa_events where entity_id='player-request'"))[0];
 assert.equal(event.actor_account_id,f.player);assert.equal(event.actor_player_id,'P1');assert.equal(event.space_id,space);assert.equal(event.actor_display_name_snapshot,'Native P1');
 assert.deepEqual(await r.send({context:self,changes,operation,key,notices:[f.notice()]}),{revision:1,duplicate:true});assert.deepEqual(await f.stable(),baseline);
 const president={...f.ctx,role:'super_admin',account_id:f.president,actor_streamer_id:null,action:'queue:complete'};
 assert.deepEqual(await r.send({context:president,changes:[await r.queue()],expected:1}),{revision:2,duplicate:false});
 const final=await f.stable();assert.equal(final.receipts.length,2);assert.equal(Number(final.revision[0].revision),2);
});

test('native duplicates revalidate suspended membership disabled Account Space and revoked president authority',async t=>{
 const f=await fixture(t),r=receipts(f),operation=crypto.randomUUID(),changes=[await r.queue()],request={changes,operation};
 await r.send(request);
 const verifyRejected=async(setup,restore,error=/ACTOR_INVALID|SCOPE_INVALID/)=>{
  await setup();const before=await f.stable();await assert.rejects(r.send(request),error);assert.deepEqual(await f.stable(),before);await restore();
 };
 await verifyRejected(()=>f.q("update papa_space_memberships set status='suspended' where account_id=$1 and role='streamer_admin'",[f.admin]),()=>f.q("update papa_space_memberships set status='active' where account_id=$1 and role='streamer_admin'",[f.admin]));
 await verifyRejected(()=>f.q('update papa_accounts set disabled_at=now() where id=$1',[f.admin]),()=>f.q('update papa_accounts set disabled_at=null where id=$1',[f.admin]));
 await verifyRejected(()=>f.q("update papa_spaces set status='suspended' where id=$1",[space]),()=>f.q("update papa_spaces set status='active' where id=$1",[space]));
 const self={...f.ctx,role:'player',account_id:f.player,player_id:'P1',actor_streamer_id:null,action:'wish'},ownOperation=crypto.randomUUID();
 const own={context:self,operation:ownOperation,expected:1,changes:[{kind:'wishes',id:'player-wish',data:{id:'player-wish',streamer_id:room,playerId:'P1',title:'Wish',status:'收到',at}}]};
 await r.send(own);await f.q("update papa_space_memberships set status='suspended' where account_id=$1 and role='player'",[f.player]);
 let baseline=await f.stable();await assert.rejects(r.send(own),/ACTOR_INVALID/);assert.deepEqual(await f.stable(),baseline);
 await f.q("update papa_space_memberships set status='active' where account_id=$1 and role='player'",[f.player]);
 const president={...f.ctx,role:'super_admin',account_id:f.president,actor_streamer_id:null},presidentRequest={context:president,operation:crypto.randomUUID(),expected:2,changes:[]};
 await r.send(presidentRequest);await f.q('delete from papa_platform_roles where account_id=$1',[f.president]);
 baseline=await f.stable();await assert.rejects(r.send(presidentRequest),/ACTOR_INVALID/);assert.deepEqual(await f.stable(),baseline);
});

test('native invalid references notices Audit failure and receipt failure roll back every original effect',async t=>{
 const f=await fixture(t),r=receipts(f),changes=[await r.queue()],baseline=await f.stable();
 const rejected=async(input,error)=>{
  const operation=crypto.randomUUID();await assert.rejects(r.send({changes,operation,...input}),error);
  assert.equal((await r.lookup(operation,actorKey(input?.context||f.ctx))).committed,false);assert.deepEqual(await f.stable(),baseline);
 };
 await rejected({changes:[{...changes[0],data:{...changes[0].data,playerId:'PF'}}]},/SCOPE_INVALID/);
 await rejected({notices:[f.notice('invalid-uuid')]},/uuid/);
 await rejected({notices:[{...f.notice(),recipient:'PF'}]},/SCOPE_INVALID/);
 await rejected({expected:999},/VERSION_CONFLICT/);
 await f.db.exec("create function fixture_audit_fail() returns trigger language plpgsql as $$ begin if new.action='queue:fail-audit' then raise exception 'FIXTURE_AUDIT_FAILURE';end if;return new;end $$;create trigger fixture_audit_fail before insert on papa_events for each row execute function fixture_audit_fail();");
 await rejected({context:{...f.ctx,action:'queue:fail-audit'},notices:[f.notice()]},/FIXTURE_AUDIT_FAILURE/);
 await f.db.exec('drop trigger fixture_audit_fail on papa_events;drop function fixture_audit_fail();');
 await f.db.exec("create function fixture_receipt_fail() returns trigger language plpgsql as $$ begin raise exception 'FIXTURE_RECEIPT_FAILURE';end $$;create trigger fixture_receipt_fail before insert on papa_operation_receipts for each row execute function fixture_receipt_fail();");
 await rejected({notices:[f.notice()]},/FIXTURE_RECEIPT_FAILURE/);
 await f.db.exec('drop trigger fixture_receipt_fail on papa_operation_receipts;drop function fixture_receipt_fail();');
 assert.deepEqual(await r.send({changes,notices:[f.notice()]}),{revision:1,duplicate:false});
});

test('receipt extension preserves prior legacy receipts business data and exact original commit definitions',async t=>{
 const f=await fixture(t,{install:false}),r=receipts(f),operation=crypto.randomUUID(),key='a'.repeat(64),hash='b'.repeat(64);
 const context={role:'streamer_admin',actor_streamer_id:'papa',streamer_id:'papa',space_id:'space-001',action:'queue'};
 const change={kind:'queue',id:'legacy-request',data:{id:'legacy-request',streamer_id:'papa',playerId:'P1',songId:f.legacySong,status:'waiting'}};
 const request={target:'papa',context,changes:[change],operation,key,hash};
 assert.deepEqual(await r.send(request),{revision:1,duplicate:false});
 const before=await f.stable(),definitions=await f.q("select oid::regprocedure::text name,pg_get_functiondef(oid) definition from pg_proc where proname in ('papa_room_operational_commit','papa_room_operational_commit_space001','papa_room_native_commit','papa_room_native_actor_guard','papa_operation_receipt') order by name");
 await f.db.exec(migration('202610170001_native_operation_receipts.sql'));
 assert.deepEqual(await f.stable(),before);assert.deepEqual(await f.q("select oid::regprocedure::text name,pg_get_functiondef(oid) definition from pg_proc where proname in ('papa_room_operational_commit','papa_room_operational_commit_space001','papa_room_native_commit','papa_room_native_actor_guard','papa_operation_receipt') order by name"),definitions);
 assert.deepEqual(await r.send(request),{revision:1,duplicate:true});assert.deepEqual(await f.stable(),before);
 await assert.rejects(r.send({...request,hash:'c'.repeat(64)}),/OPERATION_RECEIPT_REUSED/);assert.deepEqual(await f.stable(),before);
 await f.db.exec('set role service_role');
 try{assert.deepEqual(await r.send(request),{revision:1,duplicate:true});await assert.rejects(f.q('select * from papa_operation_receipts'),/permission denied/);}finally{await f.db.exec('reset role');}
 for(const role of ['anon','authenticated']){
  await f.db.exec('set role '+role);try{await assert.rejects(r.send(request),/permission denied/);}finally{await f.db.exec('reset role');}
 }
});

test('native actor-key JSON remains compatible with Edge identity including Unicode and escaped player IDs',async t=>{
 const f=await fixture(t),r=receipts(f),playerId='原生"玩家\\ID\n𝄞';
 const account=(await f.q('insert into papa_accounts default values returning id'))[0].id;
 const member=(await f.q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[account,space]))[0].id;
 await f.q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',[space,playerId,account,member,{playerId,name:'Unicode player',ids:[],names:[]}]);
 const context={...f.ctx,role:'player',account_id:account,player_id:playerId,actor_streamer_id:null,action:'wish'};
 const changes=[{kind:'wishes',id:'unicode-wish',data:{id:'unicode-wish',streamer_id:room,playerId,title:'Wish',status:'收到',at}}];
 const operation=crypto.randomUUID(),request={context,changes,operation};
 assert.deepEqual(await r.send(request),{revision:1,duplicate:false});assert.deepEqual(await r.send(request),{revision:1,duplicate:true});
});

test('native recovery lookup guards committed and missing receipts against current scope Account and Membership authority',async t=>{
 const f=await fixture(t),r=receipts(f),operation=crypto.randomUUID(),missing=crypto.randomUUID(),key=actorKey(f.ctx),changes=[await r.queue()],hash=requestHash('native-lookup-intent');
 await r.send({operation,key,hash,changes});
 const expected={committed:true,revision:1,requestHash:hash},before=await f.stable();
 assert.deepEqual(await r.nativeLookup(operation,key),expected);assert.deepEqual(await r.nativeLookup(missing,key),{committed:false});assert.deepEqual(await f.stable(),before);
 const reject=async(context=f.ctx,scope=space,target=room,actor=key,error=/ACTOR_INVALID|SCOPE_INVALID/)=>{
  const baseline=await f.stable();
  for(const id of [operation,missing])await assert.rejects(r.nativeLookup(id,actor,context,scope,target),error);
  assert.deepEqual(await f.stable(),baseline);
 };
 await reject(f.ctx,'space-001');await reject(f.ctx,'space-foreign-test');await reject(f.ctx,space,otherRoom);await reject(f.ctx,space,'unknown-room');
 await reject({...f.ctx,space_id:'space-foreign-test'});await reject({...f.ctx,streamer_id:otherRoom});await reject({...f.ctx,actor_streamer_id:otherRoom});
 await reject(f.ctx,space,room,'bad-key',/SCOPE_INVALID/);await assert.rejects(r.nativeLookup(null,key),/SCOPE_INVALID/);
 await f.q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,'streamer_admin',$3)",[f.secondPlayer,space,room]);
 await reject({...f.ctx,account_id:f.secondPlayer},space,room,key,/ROOM_OPERATION_ACTOR_INVALID/);
 await f.q("update papa_space_memberships set status='suspended' where account_id=$1 and role='streamer_admin'",[f.admin]);await reject();
 await f.q("update papa_space_memberships set status='active' where account_id=$1 and role='streamer_admin'",[f.admin]);
 await f.q('update papa_accounts set disabled_at=now() where id=$1',[f.admin]);await reject();
 await f.q('update papa_accounts set disabled_at=null where id=$1',[f.admin]);
 await f.q("update papa_spaces set status='suspended' where id=$1",[space]);await reject();
 await f.q("update papa_spaces set status='active' where id=$1",[space]);
 assert.deepEqual(await r.nativeLookup(operation,key),expected);assert.deepEqual(await r.nativeLookup(missing,key),{committed:false});
 // The old lookup remains deliberately unchanged; this contrast prevents an
 // integration from claiming its four-argument API revalidates native actors.
 await f.q("update papa_space_memberships set status='suspended' where account_id=$1 and role='streamer_admin'",[f.admin]);
 assert.deepEqual(await r.lookup(operation,key),expected);await reject();
});

test('native recovery lookup enforces exact player and president identity and service-only ACL',async t=>{
 const f=await fixture(t),r=receipts(f),context={...f.ctx,role:'player',account_id:f.player,player_id:'P1',actor_streamer_id:null,action:'wish'},key=actorKey(context),operation=crypto.randomUUID(),missing=crypto.randomUUID();
 const changes=[{kind:'wishes',id:'lookup-wish',data:{id:'lookup-wish',streamer_id:room,playerId:'P1',title:'Wish',status:'收到',at}}],hash=requestHash('player-wish');
 await r.send({context,changes,operation,key,hash});
 const expected={committed:true,revision:1,requestHash:hash};assert.deepEqual(await r.nativeLookup(operation,key,context),expected);
 let baseline=await f.stable();
 await assert.rejects(r.nativeLookup(operation,key,{...context,account_id:f.secondPlayer}),/ACTOR_INVALID/);
 await assert.rejects(r.nativeLookup(operation,key,{...context,account_id:f.secondPlayer,player_id:'P2'}),/ACTOR_INVALID/);
 await assert.rejects(r.nativeLookup(missing,key,{...context,account_id:f.secondPlayer,player_id:'P2'}),/ACTOR_INVALID/);assert.deepEqual(await f.stable(),baseline);
 await f.q("update papa_space_memberships set status='suspended' where account_id=$1 and role='player'",[f.player]);baseline=await f.stable();
 for(const id of [operation,missing])await assert.rejects(r.nativeLookup(id,key,context),/ACTOR_INVALID/);assert.deepEqual(await f.stable(),baseline);
 await f.q("update papa_space_memberships set status='active' where account_id=$1 and role='player'",[f.player]);
 const president={...f.ctx,role:'super_admin',account_id:f.president,actor_streamer_id:null},presidentKey=actorKey(president),presidentOperation=crypto.randomUUID(),presidentHash=requestHash('president-operation');
 await r.send({context:president,operation:presidentOperation,key:presidentKey,hash:presidentHash,expected:1});
 assert.deepEqual(await r.nativeLookup(presidentOperation,presidentKey,president),{committed:true,revision:2,requestHash:presidentHash});
 await f.q('delete from papa_platform_roles where account_id=$1',[f.president]);baseline=await f.stable();
 for(const id of [presidentOperation,missing])await assert.rejects(r.nativeLookup(id,presidentKey,president),/ACTOR_INVALID/);assert.deepEqual(await f.stable(),baseline);
 for(const role of ['anon','authenticated']){
  await f.db.exec('set role '+role);try{
   await assert.rejects(r.nativeLookup(operation,key,context),/permission denied/);
   await assert.rejects(r.nativeLookup(missing,key,context),/permission denied/);
  }finally{await f.db.exec('reset role');}
 }
 await f.db.exec('set role service_role');try{
  assert.deepEqual(await r.nativeLookup(operation,key,context),expected);assert.deepEqual(await r.nativeLookup(missing,key,context),{committed:false});
  await assert.rejects(f.q('select * from papa_operation_receipts'),/permission denied/);
  await assert.rejects(f.rpc('papa_room_native_actor_guard',[context,room,space]),/permission denied/);
 }finally{await f.db.exec('reset role');}
});
