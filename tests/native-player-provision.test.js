import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {empty,mutate,TABLES,DEFAULTS} from '../src/core.js';
import {stateEntries,stateChanges} from '../src/state-patch.js';
import {createRoomDraft,recordRoomDraftAction,replayRoomDraft} from '../src/room-draft.js';
import {deriveNotices} from '../src/notification-rules.js';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const at='2026-10-09T04:00:00Z',space='provision-space',room='provision-room',foreignSpace='provision-foreign';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 await db.exec(migration('202609240001_release_a.sql'));await db.exec(migration('202609240003_notifications.sql'));
 const legacy=mutate(empty(),{type:'song',data:{title:'Legacy song',artist:'Legacy artist'}},{role:'admin'},at);
 legacy.players=[{playerId:'P1',name:'Legacy P1',ids:['same-login'],names:[],password:'legacy-secret',note:'keep legacy'}];
 for(const row of stateEntries(legacy))await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[row.kind,row.id,row.data]);
 await db.exec(migration('202610070001_space_foundation.sql'));
 await db.exec(migration('202610070004_audit_actor_snapshots.sql'));
 await db.exec(migration('202610070009_scoped_read_snapshot.sql'));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 await db.exec(migration('202610070011_room_operational_commit.sql'));
 await db.exec(migration('202610070013_space_player_profiles.sql'));
 await db.exec(migration('202610070015_room_admin_commit.sql'));
 const audit=migration('202610080012_communication_space.sql');
 for(const name of ['papa_communication_player_name','papa_native_meta_audit_projection','papa_event_actor_snapshot']){
  const start=audit.indexOf('function '+name+'('),statement=audit.lastIndexOf('create ',start);
  assert.ok(start>=0);await db.exec(audit.slice(statement,audit.indexOf('$$;',start)+3));
 }
 await db.exec(migration('202610080013_native_room_transactions.sql'));
 await db.exec(migration('202610090006_native_player_provision.sql'));
 await q('insert into papa_spaces(id,slug,display_name) values($1,$1,$1),($2,$2,$2)',[space,foreignSpace]);
 await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2),($3,$4)',[room,space,'foreign-room',foreignSpace]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [room,'foreign-room']){meta.streamers.push({id,slug:id,display_name:id,active:true});meta.streamerSettings[id]=structuredClone(DEFAULTS);}
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const member=async(subject,scope=space,role='player',streamer=null)=>(await q('insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,$3,$4) returning id',[subject,scope,role,streamer]))[0].id;
 const admin=await account(),president=await account(),existingAccount=await account(),foreignAccount=await account();
 const adminMembership=await member(admin,space,'streamer_admin',room),existingMembership=await member(existingAccount),foreignMembership=await member(foreignAccount,foreignSpace);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 for(const [scope,id,subject,membership] of [[space,'EXISTING',existingAccount,existingMembership],[foreignSpace,'P1',foreignAccount,foreignMembership]])
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',[scope,id,subject,membership,{playerId:id,name:'Existing '+scope,names:[],ids:['same-login'],note:'keep '+scope}]);
 const ctx={role:'streamer_admin',account_id:admin,actor_streamer_id:room,streamer_id:room,space_id:space,action:'playersImport'};
 const revision=async()=>Number((await q('select revision from papa_v2_revision'))[0].revision);
 const commit=async(changes,bindings=[],options={})=>rpc('papa_room_admin_commit_with_player_bindings',[
  options.expected??await revision(),changes,options.removed||[],options.context||ctx,options.notices||[],options.room||room,bindings]);
 const binding=async(id)=>{const subject=await account(),membership=await member(subject);return {player_id:id,account_id:subject,membership_id:membership};};
 const read=async()=>{
  const value=await rpc('papa_v2_room_write_snapshot_in_space',[room,[],space]),state=empty();state.revision=Number(value.revision);
  for(const row of value.rows)if(row.kind==='meta')Object.assign(state,row.data);else if(row.kind==='settings')state.settings=row.data;else if(TABLES.includes(row.kind))state[row.kind].push(row.data);
  return state;
 };
 const stable=async()=>({entities:await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),
  profiles:await q('select space_id,player_id,account_id,membership_id,data from papa_space_player_profiles order by space_id,player_id'),
  accounts:await q('select * from papa_accounts order by id'),memberships:await q('select * from papa_space_memberships order by id'),
  revision:await q('select revision from papa_v2_revision'),events:await q('select * from papa_events order by id'),
  notices:await q('select * from papa_notifications order by id'),push:await q('select * from papa_push_jobs order by id')});
 const notice=(id='00000000-0000-4000-8000-000000000019',recipient='P1')=>({id,streamer_id:room,streamer_name:room,recipient,type:'credit',level:1,body:'Initial balance',entity_id:recipient,created_at:at});
 return {db,q,rpc,account,member,admin,adminMembership,president,existingAccount,existingMembership,foreignAccount,foreignMembership,ctx,revision,commit,binding,read,stable,notice};
}
const player=(id,data={})=>({kind:'players',id,data:{playerId:id,name:'Native '+id,ids:[],names:[],note:'',...data}});

test('explicit native bindings publish a Core player/initial balance batch with one revision and normal profile audit',async t=>{
 const {q,ctx,commit,binding,read,stable,notice}=await fixture(t);
 const before=await read();
 let after=mutate(before,{streamer:room,type:'player',data:{name:'Imported A',ids:['a-login'],balance:3}},{role:'admin'},at);
 after=mutate(after,{streamer:room,type:'player',data:{name:'Imported B',ids:['b-login'],balance:2}},{role:'admin'},at);
 const added=after.players.filter(p=>!before.players.some(old=>old.playerId===p.playerId));
 for(const row of added)delete row.password;
 after.settings=after.streamerSettings[room];
 const patch=stateChanges(before,after,{preserveOrder:true}),bindings=await Promise.all(added.map(p=>binding(p.playerId)));
 const baseline=await stable();
 assert.equal(Number(await commit(patch.changes,bindings,{expected:before.revision,notices:[notice(undefined,added[0].playerId)]})),before.revision+1);
 for(const [i,row] of added.entries()){
  const result=(await q('select account_id,membership_id,data from papa_space_player_profiles where space_id=$1 and player_id=$2',[space,row.playerId]))[0];
  assert.equal(result.account_id,bindings[i].account_id);assert.equal(result.membership_id,bindings[i].membership_id);
  assert.deepEqual(result.data,patch.changes.find(c=>c.kind==='players'&&c.id===row.playerId).data);
  assert.equal((await q("select sum((data->>'amount')::numeric)::int amount from papa_v2_entities where kind='ledger' and space_id=$1 and data->>'playerId'=$2",[space,row.playerId]))[0].amount,i===0?3:2);
  const event=(await q("select * from papa_events where entity_kind='players' and entity_id=$1",[row.playerId]))[0];
  assert.equal(event.space_id,space);assert.equal(event.actor_account_id,ctx.account_id);assert.equal(event.target_player_id,row.playerId);
  assert.equal(event.target_player_name_snapshot,row.name);assert.deepEqual(event.before_data,{playerId:row.playerId});assert.equal(event.after_data.name,row.name);
 }
 const final=await stable();assert.deepEqual(final.accounts,baseline.accounts);assert.deepEqual(final.memberships,baseline.memberships);
 assert.deepEqual(final.entities.filter(e=>e.kind==='players'||e.space_id==='space-001'||e.space_id===foreignSpace),baseline.entities.filter(e=>e.kind==='players'||e.space_id==='space-001'||e.space_id===foreignSpace));
 assert.deepEqual(final.profiles.filter(p=>p.space_id===foreignSpace),baseline.profiles.filter(p=>p.space_id===foreignSpace));
 assert.equal(final.notices.length,1);assert.equal(final.events.filter(e=>e.entity_kind==='players'&&e.space_id===space).length,2);
});

test('a downstream notice error rolls back every provisioned profile, balance, event and revision',async t=>{
 const {commit,binding,stable,notice}=await fixture(t),bindings=[await binding('ROLLBACK-A'),await binding('ROLLBACK-B')];
 const changes=[player('ROLLBACK-A'),player('ROLLBACK-B'),{kind:'ledger',id:'initial-credit',data:{id:'initial-credit',streamer_id:room,playerId:'ROLLBACK-A',amount:5,at}}];
 const baseline=await stable();
 await assert.rejects(commit(changes,bindings,{notices:[notice('invalid-uuid','ROLLBACK-A')]}),/uuid/);
 assert.deepEqual(await stable(),baseline);
});

test('native player IDs may match legacy or another Space while all identities remain independent',async t=>{
 const {q,commit,binding,stable,notice,existingAccount,existingMembership}=await fixture(t),bound=await binding('P1');
 const baseline=await stable();
 assert.equal(Number(await commit([player('P1',{name:'New native P1',ids:['same-login']})],[bound],{notices:[notice()]})),1);
 assert.deepEqual((await stable()).entities,baseline.entities,'no legacy entity rows change');
 assert.deepEqual((await stable()).profiles.filter(p=>p.space_id===foreignSpace),baseline.profiles.filter(p=>p.space_id===foreignSpace));
 assert.equal((await q('select data->>\'name\' name from papa_space_player_profiles where space_id=$1 and player_id=$2',[space,'P1']))[0].name,'New native P1');
 const existingIdentity=(await q('select account_id,membership_id from papa_space_player_profiles where space_id=$1 and player_id=$2',[space,'EXISTING']))[0];
 assert.equal(Number(await commit([player('EXISTING',{name:'Edited existing'})],[])),2);
 assert.deepEqual((await q('select account_id,membership_id from papa_space_player_profiles where space_id=$1 and player_id=$2',[space,'EXISTING']))[0],existingIdentity);
 const after=await stable();
 await assert.rejects(commit([player('EXISTING')],[{player_id:'EXISTING',account_id:existingAccount,membership_id:existingMembership}]),/BINDING_INVALID/);
 assert.deepEqual(await stable(),after);
});

test('missing, duplicate, unrelated, foreign and credential bindings fail before writes',async t=>{
 const {q,commit,binding,stable,existingAccount,existingMembership,foreignAccount,foreignMembership,admin,adminMembership}=await fixture(t);
 const first=await binding('NEW'),second=await binding('SECOND'),changes=[player('NEW')],baseline=await stable();
 const reject=async(rows,bindings)=>{await assert.rejects(commit(rows,bindings),/INVALID/);assert.deepEqual(await stable(),baseline);};
 await reject(changes,[]);await reject(changes,[first,second]);await reject(changes,[first,first]);
 await reject([player('NEW'),player('SECOND')],[first,{...first,player_id:'SECOND',account_id:first.account_id.toUpperCase()}]);
 await reject(changes,[{...first,account_id:second.account_id}]);await reject(changes,[{...first,membership_id:second.membership_id}]);
 await reject(changes,[{...first,account_id:foreignAccount,membership_id:foreignMembership}]);
 await reject(changes,[{...first,account_id:admin,membership_id:adminMembership}]);
 await reject(changes,[{...first,account_id:existingAccount,membership_id:existingMembership}]);
 for(const bad of [null,{},'NEW',{...first,data:{name:'Injected'}},{...first,player_id:' '},{...first,account_id:'bad-uuid'},{...first,membership_id:7}])await reject(changes,[bad]);
 for(const data of [{password:''},{currentPassword:'secret'},{token:'secret'},{names:[{ACCESStoken:'nested'}]},
  {account_id:first.account_id},{membershipId:first.membership_id},{space_id:space}])await reject([player('NEW',data)],[first]);
 await reject([player('NEW'),player('NEW')],[first]);await reject([{kind:'players',id:'NEW',data:{playerId:'OTHER',name:'Wrong identity'}}],[first]);
 assert.equal((await q('select count(*)::int n from papa_space_player_profiles where space_id=$1',[space]))[0].n,1);
});

test('stale, unauthorized, disabled and revoked identities cannot provision profiles',async t=>{
 const {db,q,commit,binding,stable,ctx,existingAccount,president,admin,adminMembership}=await fixture(t),bound=await binding('NEW');
 const reject=async(options,error=/INVALID/)=>{const before=await stable();await assert.rejects(commit([player('NEW')],[bound],options),error);assert.deepEqual(await stable(),before);};
 await reject({expected:7},/VERSION_CONFLICT/);
 await reject({context:{...ctx,role:'player',account_id:existingAccount,player_id:'EXISTING',actor_streamer_id:null}});
 await reject({context:{...ctx,actor_streamer_id:'foreign-room'}});await reject({context:{...ctx,space_id:foreignSpace}});
 await reject({context:{...ctx,role:'super_admin'}});await reject({room:'papa'});await reject({room:'unknown-room'});
 await q("update papa_space_memberships set status='suspended' where id=$1",[bound.membership_id]);await reject({});
 await q("update papa_space_memberships set status='active' where id=$1",[bound.membership_id]);
 await q('update papa_accounts set disabled_at=now() where id=$1',[bound.account_id]);await reject({});
 await q('update papa_accounts set disabled_at=null where id=$1',[bound.account_id]);
 await q("update papa_space_memberships set status='suspended' where id=$1",[adminMembership]);await reject({});
 await q("update papa_space_memberships set status='active' where id=$1",[adminMembership]);
 await q('update papa_accounts set disabled_at=now() where id=$1',[admin]);await reject({});
 await q('update papa_accounts set disabled_at=null where id=$1',[admin]);
 for(const role of ['anon','authenticated']){
  const before=await stable();await db.exec('set role '+role);
  await assert.rejects(commit([player('NEW')],[bound],{expected:0}),/permission denied/);
  await db.exec('reset role');assert.deepEqual(await stable(),before);
 }
 await db.exec('set role service_role');
 assert.equal(Number(await commit([player('NEW')],[bound],{expected:0,context:{...ctx,role:'super_admin',account_id:president,actor_streamer_id:null}})),1);
 await db.exec('reset role');
});

async function replayScenario(f){
 const draftAt='2026-10-09T04:00:00.000Z',oldAt='2026-10-09T03:00:00.000Z',registered='2026-10-01T00:00:00.000Z';
 const {q,read,binding,ctx}=f;
 for(const [kind,id,data] of [
  ['songs','KEEP-S',{songId:'KEEP-S',streamer_id:room,title:'Protected native song',artist:'Artist',tags:['Before'],lyrics:'Keep native lyrics',privateNotes:'Keep native notes',lyricHistory:['Keep native history'],_order:17}],
  ['queue','KEEP-Q',{id:'KEEP-Q',streamer_id:room,songId:'KEEP-S',playerId:'EXISTING',title:'Protected native song',artist:'Artist',kind:'saved',status:'waiting',creditCost:1,at:oldAt,acceptedAt:oldAt,awaitingAcknowledgment:false,awaitingPreparation:false,created_at:registered,_order:73}],
  ['ledger','KEEP-L',{id:'KEEP-L',streamer_id:room,playerId:'EXISTING',amount:10,note:'Existing balance',at:oldAt,_order:9}],
  ['songs','FOREIGN-S',{songId:'FOREIGN-S',streamer_id:'foreign-room',title:'Foreign protected song',lyrics:'Keep foreign lyrics'}],
  ['ledger','FOREIGN-L',{id:'FOREIGN-L',streamer_id:'foreign-room',playerId:'P1',amount:25,at:oldAt}]
 ])await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[kind,id,data]);
 const before=await read();
 assert.equal(Object.hasOwn(before.songs.find(s=>s.songId==='KEEP-S'),'lyrics'),false);
 assert.equal(JSON.stringify(before).includes('Keep foreign'),false);
 let recorded=before,journal=createRoomDraft(before,room);
 const add=(type,data)=>{const result=recordRoomDraftAction(recorded,journal,{type,data},{role:'admin'},draftAt);recorded=result.state;journal=result.journal;};
 add('player',{name:'Draft newcomer',ids:['draft-login'],balance:5});
 const playerId=recorded.players.find(p=>p.name==='Draft newcomer').playerId;
 add('song',{title:'Draft allocation song',artist:'Draft Artist',creditCost:1});
 const songId=recorded.songs.find(s=>s.title==='Draft allocation song').songId;
 add('song',{songId:'KEEP-S',title:'Protected native song',artist:'Artist',tags:['Draft']});
 add('allocate',{playerId,total:3,stored:1,items:[{songId},{songId}],note:'Draft allocation'});
 const [cancelled,completed]=recorded.queue.filter(row=>row.playerId===playerId),allocationId=cancelled.allocation_id;
 add('queue',{id:cancelled.id,operation:'cancel'});
 add('queue',{id:cancelled.id,operation:'delete'});
 add('queue',{id:completed.id,operation:'stage',preparationMinutes:0});
 add('queue',{id:completed.id,operation:'complete'});
 add('queue',{id:'KEEP-Q',operation:'complete'});
 add('recordTime',{table:'queue',id:'KEEP-Q',times:{completedAt:'2026-10-09T03:30:00.000Z'}});
 const bound=await binding(playerId),replayed=replayRoomDraft(await read(),journal,{role:'admin'},draftAt);
 assert.deepEqual(replayed,recorded,'server replay preserves all UI identities and dependent business changes');
 for(const state of [recorded,replayed]){
  state.settings=state.streamerSettings[room];
  for(const row of state.players)if(row.password==='')delete row.password;
 }
 const patch=stateChanges(before,replayed,{preserveOrder:true});
 const notices=deriveNotices(before,replayed,{...ctx,action:'publish'},draftAt);
 return {before,journal,replayed,patch,notices,bound,playerId,songId,allocationId,cancelledId:cancelled.id,completedId:completed.id,registered,draftAt};
}

test('native draft replay commits dependent player/song/allocation/refund IDs once while preserving private bodies and history',async t=>{
 const f=await fixture(t),scenario=await replayScenario(f);
 const {q,commit,stable}=f,{before,patch,notices,bound,playerId,songId,allocationId,cancelledId,completedId,registered}=scenario;
 const baseline=await stable();
 assert.equal(Number(await commit(patch.changes,[bound],{expected:before.revision,removed:patch.removed,notices,context:{...f.ctx,action:'publish'}})),before.revision+1);
 const entities=await q('select kind,id,data,space_id from papa_v2_entities order by kind,id');
 const queue=entities.filter(row=>row.kind==='queue'&&row.data.playerId===playerId).map(row=>row.data);
 assert.deepEqual(new Set(queue.map(row=>row.id)),new Set([cancelledId,completedId]));
 for(const row of queue){assert.equal(row.songId,songId);assert.equal(row.allocation_id,allocationId);assert.equal(row.items[0].songId,songId);assert.equal(row.receivedCreditCost,1);}
 const cancelled=queue.find(row=>row.id===cancelledId),completed=queue.find(row=>row.id===completedId);
 assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.allocationReturnedCredits,1);assert.ok(cancelled.allocationReturnedAt);
 assert.equal(completed.status,'completed');assert.ok(completed.completedAt);
 const settlement=entities.filter(row=>row.kind==='ledger'&&row.data.queueId===cancelledId&&row.data.allocationSettlement==='return');
 assert.equal(settlement.length,1);assert.equal(settlement[0].data.amount,1);assert.equal(settlement[0].data.allocation_id,allocationId);
 assert.equal(entities.filter(row=>row.kind==='ledger'&&row.data.playerId===playerId).reduce((sum,row)=>sum+row.data.amount,0),7);
 const profile=(await q('select account_id,membership_id,data from papa_space_player_profiles where space_id=$1 and player_id=$2',[space,playerId]))[0];
 assert.equal(profile.account_id,bound.account_id);assert.equal(profile.membership_id,bound.membership_id);assert.equal(profile.data.name,'Draft newcomer');assert.equal(Object.hasOwn(profile.data,'password'),false);
 const source=entities.find(row=>row.kind==='songs'&&row.id==='KEEP-S').data;
 assert.equal(source.lyrics,'Keep native lyrics');assert.equal(source.privateNotes,'Keep native notes');assert.deepEqual(source.lyricHistory,['Keep native history']);assert.deepEqual(source.tags,['Draft']);
 const history=entities.find(row=>row.kind==='queue'&&row.id==='KEEP-Q').data;
 assert.equal(history.created_at,registered);assert.equal(history.completedAt,'2026-10-09T03:30:00.000Z');assert.equal(history.history_effective_at,history.completedAt);assert.equal(history.quota_effective_at,history.completedAt);
 assert.equal(history.original_times.completedAt,scenario.draftAt);
 assert.equal(entities.find(row=>row.kind==='ledger'&&row.data.queueId==='KEEP-Q').data.at,history.completedAt);
 const final=await stable();
 assert.deepEqual(final.entities.filter(row=>row.kind==='players'||row.space_id==='space-001'||row.space_id===foreignSpace),baseline.entities.filter(row=>row.kind==='players'||row.space_id==='space-001'||row.space_id===foreignSpace));
 assert.deepEqual(final.profiles.filter(row=>row.space_id===foreignSpace),baseline.profiles.filter(row=>row.space_id===foreignSpace));
 assert.deepEqual(final.accounts,baseline.accounts);assert.deepEqual(final.memberships,baseline.memberships);
 assert.equal(final.notices.length,notices.length);assert.ok(final.notices.some(row=>row.type==='completed'&&row.entity_id==='KEEP-Q'));
 assert.ok(final.notices.some(row=>row.type==='credit'&&row.entity_id===settlement[0].id));
 assert.ok(final.events.some(row=>row.entity_kind==='players'&&row.entity_id===playerId&&row.action==='publish'));
 assert.ok(final.events.some(row=>row.entity_kind==='queue'&&row.entity_id===cancelledId&&row.action==='publish'));
 assert.ok(final.events.some(row=>row.entity_kind==='ledger'&&row.entity_id===settlement[0].id&&row.action==='publish'));
});

test('replayed draft stale revision and downstream notice failure roll back profiles, dependent rows, private bodies and history together',async t=>{
 const f=await fixture(t),scenario=await replayScenario(f),baseline=await f.stable();
 const {before,journal,patch,notices,bound,draftAt}=scenario;
 assert.throws(()=>replayRoomDraft({...before,revision:before.revision+1},journal,{role:'admin'},draftAt),/草稿已過期/);
 await assert.rejects(f.commit(patch.changes,[bound],{expected:before.revision+1,removed:patch.removed,notices}),/VERSION_CONFLICT/);
 assert.deepEqual(await f.stable(),baseline);
 assert.ok(notices.length);
 await assert.rejects(f.commit(patch.changes,[bound],{expected:before.revision,removed:patch.removed,notices:[{...notices[0],id:'invalid-uuid'},...notices.slice(1)]}),/uuid/);
 assert.deepEqual(await f.stable(),baseline);
});
