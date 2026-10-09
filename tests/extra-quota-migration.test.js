import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {empty,mutate,TABLES,DEFAULTS} from '../src/core.js';
import {stateEntries,stateChanges} from '../src/state-patch.js';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const releasedQuotaMigration=execFileSync('git',['show','origin/main:supabase/migrations/202610090004_player_extra_quota.sql'],{encoding:'utf8'});
const at='2026-10-08T04:00:00Z',space='space-native-test',room='native-room',otherRoom='native-room-two';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((value,i)=>'$'+(i+1)+(name==='papa_manage_player_extra_quota'&&i===5?'::'+(typeof value==='object'?'jsonb':'text'):'')).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 await db.exec(migration('202609240001_release_a.sql'));await db.exec(migration('202609240003_notifications.sql'));
 await db.exec(migration('202609250001_roles_and_notification_scope.sql'));
 await db.exec(migration('202610010006_lean_read_snapshot.sql'));
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
 for(const name of ['papa_communication_player_exists','papa_communication_player_name','papa_native_meta_audit_projection','papa_event_actor_snapshot']){
  const start=audit.indexOf('function '+name+'(');
  assert.ok(start>=0,'native audit function exists: '+name);
  const statement=audit.lastIndexOf('create ',start);
  await db.exec(audit.slice(statement,audit.indexOf('$$;',start)+3));
 }
 await db.exec(migration('202610080013_native_room_transactions.sql'));
 await db.exec(releasedQuotaMigration);
 await db.exec(migration('202610090015_quota_native_compatibility.sql'));
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
  notices:await q('select * from papa_notifications order by id'),push:await q('select * from papa_push_jobs order by id')});
 return {db,q,rpc,ctx,admin,player,secondPlayer,president,legacySong:legacy.songs[0].songId,read,commit,mutateCommit,notice,stable};
}

test('extra rights are normalized, per room/player, audit once and join the original scoped read without changing business entities',async t=>{
 const {q,rpc,ctx,stable,president}=await fixture(t),before=await stable();
 const rev=()=>q('select revision from papa_v2_revision').then(r=>Number(r[0].revision));
 const grant=(r,p,n,c=ctx)=>rpc('papa_manage_player_extra_quota',[before.revision[0].revision,r,p,n,true,c]);
 await grant(room,'P1',2);
 const attribution=(await q('select updated_by,updated_by_account from papa_player_extra_quotas where streamer_id=$1 and player_id=$2',[room,'P1']))[0];
 assert.equal(attribution.updated_by,ctx.account_id);assert.equal(attribution.updated_by_account,ctx.account_id);
 const unchanged=await stable();assert.deepEqual(unchanged.entities,before.entities);assert.deepEqual(unchanged.profiles,before.profiles);assert.deepEqual(unchanged.notices,before.notices);
 assert.equal(unchanged.events.length,before.events.length+1);assert.equal(unchanged.events.at(-1).target_player_name_snapshot,'Native P1');assert.equal(unchanged.events.at(-1).after_data.extra_quota,2);
 const minimal=await rpc('papa_v2_scoped_read_snapshot_in_space',[room,space]);assert.deepEqual(minimal.extraQuotaRights,{});
 const own=await rpc('papa_v2_scoped_read_snapshot_with_quota',[room,space,'P1']);
 assert.deepEqual(own.extraQuotas,[{streamer_id:room,player_id:'P1',extra_quota:2,enabled:true}]);assert.equal(own.extraQuotaRights.P1[0].extra_quota,2);assert.equal(own.extraQuotaRights.P2,undefined);
 const alternate={role:'super_admin',account_id:president,space_id:space,streamer_id:otherRoom};
 await rpc('papa_manage_player_extra_quota',[await rev(),otherRoom,'P1',1,true,alternate]);
 const other=await rpc('papa_v2_room_write_snapshot_with_quota',[otherRoom,[],space,'P1']);
 assert.equal(other.extraQuotas.length,1);assert.equal(other.extraQuotas[0].streamer_id,otherRoom);assert.deepEqual(other.extraQuotaRights.P1.map(x=>x.extra_quota).sort(),[1,2]);
 const legacy=await rpc('papa_v2_scoped_read_snapshot_in_space',['papa','space-001']);assert.deepEqual(legacy.extraQuotas,[]);assert.deepEqual(legacy.extraQuotaRights,{});
 const legacyManager={role:'super_admin',account_id:president,space_id:'space-001',streamer_id:'papa'};
 await rpc('papa_manage_player_extra_quota',[await rev(),'papa','P1',3,true,legacyManager]);
 const legacyRights=await rpc('papa_v2_scoped_read_snapshot_with_quota',['papa','space-001','P1']);assert.deepEqual(legacyRights.extraQuotaRights.P1,[{streamer_id:'papa',streamer_name:'怕怕',extra_quota:3}]);
 const nativeRights=await rpc('papa_v2_scoped_read_snapshot_with_quota',[room,space,'P1']);assert.deepEqual(nativeRights.extraQuotaRights.P1.map(x=>x.extra_quota).sort(),[1,2],'identical player IDs never join rights across Spaces');
 const untargetedLegacy=await rpc('papa_v2_scoped_read_snapshot',['papa']);
 assert.deepEqual(untargetedLegacy.rows,legacyRights.rows,'the original one-argument snapshot keeps the same entity rows');
 assert.deepEqual(untargetedLegacy.extraQuotas,[],'an untargeted read includes only saved participants, not unrelated room grants');
 assert.equal((await q("select data from papa_v2_entities where kind='meta'"))[0].data.streamerSettings[room].extraQuotas,undefined);
});

test('quota RPC rejects foreign roles/players, invalid values and stale writes and rolls back an audit failure',async t=>{
 const {db,q,rpc,ctx,player,stable}=await fixture(t),base=await stable(),revision=Number(base.revision[0].revision);
 const call=(overrides={})=>rpc('papa_manage_player_extra_quota',[overrides.revision??revision,overrides.room??room,overrides.player??'P1',overrides.extra??2,overrides.enabled??true,overrides.actor??ctx]);
 for(const body of [{room:otherRoom},{player:'PF'},{player:'missing'},{extra:-1},{extra:100001},{revision:revision+1},{actor:{...ctx,role:'player',account_id:player,player_id:'P1'}}])await assert.rejects(call(body));
 assert.deepEqual(await stable(),base);
 await db.exec("create function reject_quota_event() returns trigger language plpgsql as $$ begin if new.entity_kind='extra_quota' then raise exception 'quota audit failed';end if;return new;end $$;create trigger reject_quota_event before insert on papa_events for each row execute function reject_quota_event();");
 await assert.rejects(call(),/quota audit failed/);assert.deepEqual(await stable(),base);assert.deepEqual(await q('select streamer_id,player_id from papa_player_extra_quotas'),[]);
 await db.exec('drop trigger reject_quota_event on papa_events;');
 await call();await assert.rejects(call(),/VERSION_CONFLICT/);
 const current=Number((await q('select revision from papa_v2_revision'))[0].revision);
 await rpc('papa_manage_player_extra_quota',[current,room,'P1',2,false,ctx]);
 const snapshot=await rpc('papa_v2_scoped_read_snapshot_in_space',[room,space]);assert.equal(snapshot.extraQuotas[0].enabled,false);assert.equal(snapshot.extraQuotaRights.P1,undefined);
 await db.exec('set role anon');await assert.rejects(q('select streamer_id from papa_player_extra_quotas'),/permission denied/);await assert.rejects(call(),/permission denied/);await db.exec('reset role');
});

test('corrected saved history uses the same guarded transaction and never duplicates ledger debits or rewrites other rooms',async t=>{
 const {q,read,mutateCommit,stable}=await fixture(t);
 await mutateCommit({type:'queue',data:{id:'NQ',operation:'complete'}});
 const before=await stable(),oldRow=(await read()).queue.find(x=>x.id==='NQ'),time='2026-10-08T03:10:00.000Z';
 await mutateCommit({type:'recordTime',data:{table:'queue',id:'NQ',times:{effective_at:time}}});
 const after=await stable(),record=(await read()).queue.find(x=>x.id==='NQ');
 assert.equal(record.quota_effective_at,time);assert.equal(record.completedAt,time);assert.equal(record.effective_at,time);assert.equal(record.original_times.completedAt,oldRow.completedAt);
 const ownLedger=before.entities.filter(x=>x.kind==='ledger'&&x.data.queueId==='NQ');assert.equal(ownLedger.length,1);
 for(const entry of ownLedger){const updated=after.entities.find(x=>x.kind==='ledger'&&x.id===entry.id);assert.equal(updated.data.amount,entry.data.amount);assert.equal(updated.data.at,time);}
 const untouched=before.entities.filter(x=>!['meta','settings'].includes(x.kind)&&x.data.streamer_id!==room);
 assert.deepEqual(after.entities.filter(x=>!['meta','settings'].includes(x.kind)&&x.data.streamer_id!==room),untouched);assert.deepEqual(after.profiles,before.profiles);
});

