import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {empty,mutate,TABLES,DEFAULTS} from '../src/core.js';
import {stateEntries,stateChanges} from '../src/state-patch.js';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const at='2026-10-08T04:00:00Z',space='space-native-test',room='native-room',otherRoom='native-room-two';
async function fixture(t){
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

test('native room admin uses real business commits, selected song hydration and preserved legacy/settings/private bodies',async t=>{
 const {db,q,rpc,ctx,read,commit,mutateCommit,legacySong}=await fixture(t);
 const legacyBefore=await q("select kind,id,data from papa_v2_entities where space_id='space-001' or kind in ('players','settings') order by kind,id");
 const metaBefore=(await q("select data from papa_v2_entities where kind='meta'"))[0].data;
 const view=await read();assert.equal(JSON.stringify(view).includes('legacy-private'),false);
 assert.equal(JSON.stringify(view).includes('native-private-lyrics'),false);assert.equal(view.players[0].name,'Native P1');
 const hydrated=await read(['NS']);assert.equal(hydrated.songs[0].lyrics,'native-private-lyrics');
 assert.equal(JSON.stringify(hydrated).includes('other-native-private-lyrics'),false);
 assert.equal(JSON.stringify(hydrated).includes('foreign-private-lyrics'),false);
 await assert.rejects(read([legacySong]),/SCOPE_INVALID/);
 await assert.rejects(read(['NS2']),/SCOPE_INVALID/);
 await assert.rejects(rpc('papa_v2_room_write_snapshot_in_space',[room,['NS'],'space-001']),/UNKNOWN_STREAMER_SPACE/);
 await assert.rejects(rpc('papa_v2_room_write_snapshot',[room,['NS']]),/UNKNOWN_STREAMER_SPACE/);
 await mutateCommit({type:'songsBulk',data:{songIds:['NS'],tags:['New'],tagMode:'add'}});
 let song=(await q("select data from papa_v2_entities where kind='songs' and id='NS'"))[0].data;
 assert.equal(song.lyrics,'native-private-lyrics');assert.equal(song.privateNotes,'native-private-notes');assert.deepEqual(song.lyricHistory,['keep-history']);assert.ok(song.tags.includes('New'));
 assert.equal((await q("select space_id from papa_v2_entities where kind='songs' and id='NS'"))[0].space_id,space,'original entity Space trigger runs');
 await mutateCommit({type:'song',data:{...song,title:'Native Song edited'}});
 assert.equal((await q("select data->>'lyrics' lyrics from papa_v2_entities where kind='songs' and id='NS'"))[0].lyrics,'native-private-lyrics');
 await mutateCommit({type:'settings',data:{status:'忙碌中'}});
 const metaAfter=(await q("select data from papa_v2_entities where kind='meta'"))[0].data;
 assert.equal(metaAfter.streamerSettings[room].status,'忙碌中');
 assert.deepEqual(metaAfter.streamerSettings.papa,metaBefore.streamerSettings.papa);
 assert.deepEqual(metaAfter.streamerSettings[otherRoom],metaBefore.streamerSettings[otherRoom]);
 assert.deepEqual(metaAfter.streamers,metaBefore.streamers);assert.deepEqual(metaAfter.migrationIssues,metaBefore.migrationIssues);assert.equal(metaAfter.privatePlatformField,'legacy-private-meta');
 const settingsEvent=(await q("select before_data,after_data from papa_events where streamer_id=$1 and entity_kind='meta' and action='settings' order by id desc limit 1",[room]))[0];
 for(const data of [settingsEvent.before_data,settingsEvent.after_data]){
  assert.deepEqual(Object.keys(data).sort(),['streamerSettings','streamers']);
  assert.deepEqual(Object.keys(data.streamerSettings),[room]);assert.deepEqual(data.streamers.map(r=>r.id),[room]);
  assert.equal(JSON.stringify(data).includes('legacy-private'),false);
  assert.equal(JSON.stringify(data).includes('private settings for '+otherRoom),false);
  assert.equal(JSON.stringify(data).includes('private settings for foreign-room'),false);
 }
 assert.equal(settingsEvent.before_data.streamerSettings[room].status,'空閒中');
 assert.equal(settingsEvent.after_data.streamerSettings[room].status,'忙碌中');
 await mutateCommit({type:'wishAdmin',data:{id:'NW',status:'已學會',addSong:true}});
 assert.equal((await q("select count(*)::int n from papa_v2_entities where kind='songs' and space_id=$1 and data->>'title'='Native Wish'",[space]))[0].n,1);
 assert.deepEqual(await q("select kind,id,data from papa_v2_entities where space_id='space-001' or kind in ('players','settings') order by kind,id"),legacyBefore);
 assert.ok((await q("select count(*)::int n from papa_events where streamer_id=$1 and action='songsBulk' and entity_kind='songs'",[room]))[0].n>0);
 await db.exec('set role anon');await assert.rejects(read(['NS']),/permission denied/);await assert.rejects(commit([]),/permission denied/);await db.exec('reset role');
});

test('native room references, roles, global ID collisions and notice failure roll back the original commit',async t=>{
 const {q,ctx,admin,player,president,legacySong,commit,notice,stable}=await fixture(t);
 const item={kind:'queue',id:'NQ',data:(await q("select data from papa_v2_entities where kind='queue' and id='NQ'"))[0].data};
 await q('insert into papa_push_subscriptions(streamer_id,recipient,endpoint,subscription,session_hash) values($1,$2,$3,$4,$5)',[room,'P1','https://push.test/native',{},'fixture-session']);
 assert.equal(Number(await commit([{...item,data:{...item.data,status:'completed'}}],[],{...ctx,action:'queue:complete'},[notice()],true)),1);
 assert.equal((await q("select count(*)::int n from papa_push_jobs"))[0].n,1,'original notification/push trigger runs');
 const baseline=await stable();
 const reject=async(changes,removed=[],context=ctx,notices=[],operational=false,error=/SCOPE_INVALID/)=>{
  await assert.rejects(commit(changes,removed,context,notices,operational),error);assert.deepEqual(await stable(),baseline);
 };
 for(const playerId of ['PF','legacy-only-player','unknown'])await reject([{...item,data:{...item.data,playerId}}],[],ctx,[],true);
 await reject([{...item,data:{...item.data,cancelled_by:'PF'}}],[],ctx,[],true);
 await reject([{...item,data:{...item.data,items:[{playerId:'PF'}]}}],[],ctx,[],true);
 for(const kind of ['queue','ledger','wishes','crowns','cards'])await reject([{kind,id:'cross-'+kind,data:{id:'cross-'+kind,streamer_id:room,playerId:'PF'}}]);
 await reject([{...item,data:{...item.data,songId:legacySong}}],[],ctx,[],true);
 await reject([{kind:'queue',id:'FQ',data:{...item.data,id:'FQ'}}],[],ctx,[],true);
 await reject([],[{kind:'queue',id:'FQ'}],ctx,[],true);
 await reject([{kind:'songs',id:legacySong,data:{songId:legacySong,streamer_id:room,title:'Collision'}}]);
 await reject([{...item,data:{...item.data,status:'cancelled'}}],[],ctx,[{...notice(),recipient:'PF'}],true);
 await reject([],[],{...ctx,space_id:'space-001'},[],true,/ACTOR_INVALID/);
 await reject([],[],{...ctx,actor_streamer_id:otherRoom},[],true,/ACTOR_INVALID/);
 await reject([],[],{...ctx,account_id:player},[],true,/ACTOR_INVALID/);
 await reject([],[],{...ctx,role:'super_admin'},[],true,/ACTOR_INVALID/);
 await reject([{...item,data:{...item.data,status:'cancelled'}}],[],ctx,[notice('invalid-uuid')],true,/uuid/);
 await assert.rejects(commit([item],[],ctx,[],true,0),/VERSION_CONFLICT/);assert.deepEqual(await stable(),baseline);
 await q("update papa_space_memberships set status='suspended' where account_id=$1",[admin]);
 await assert.rejects(commit([],[],ctx,[],true),/ACTOR_INVALID/);
 await q("update papa_space_memberships set status='active' where account_id=$1",[admin]);
 await q('update papa_accounts set disabled_at=now() where id=$1',[admin]);
 await assert.rejects(commit([],[],ctx,[],true),/ACTOR_INVALID/);
 await q('update papa_accounts set disabled_at=null where id=$1',[admin]);
 assert.equal(Number(await commit([],[],{...ctx,role:'super_admin',account_id:president,actor_streamer_id:null})),2,'verified president can administer native room');
});

test('native player self is account-bound, credentials/identity immutable, and profile audit/notices/revision atomic',async t=>{
 const {db,q,rpc,ctx,player,secondPlayer,read,commit,mutateCommit,notice,stable}=await fixture(t);
 const self={...ctx,role:'player',account_id:player,actor_streamer_id:null,player_id:'P1',action:'self'};
 const identity=(await q("select account_id,membership_id from papa_space_player_profiles where space_id=$1 and player_id='P1'",[space]))[0];
 const legacy=(await q("select data from papa_v2_entities where kind='players' and id='P1'"))[0].data;
 assert.equal(Number(await mutateCommit({type:'self',data:{name:'Renamed native player'}},self,[notice()])),1);
 const profile=(await q("select data,account_id,membership_id from papa_space_player_profiles where space_id=$1 and player_id='P1'",[space]))[0];
 assert.equal(profile.data.name,'Renamed native player');assert.equal(profile.data.note,'private native P1');assert.deepEqual({account_id:profile.account_id,membership_id:profile.membership_id},identity);
 assert.deepEqual((await q("select data from papa_v2_entities where kind='players' and id='P1'"))[0].data,legacy);
 const event=(await q("select * from papa_events where entity_kind='players' and entity_id='P1' and action='self' order by id desc limit 1"))[0];
 assert.equal(event.space_id,space);assert.equal(event.actor_account_id,player);assert.equal(event.actor_player_id,'P1');assert.equal(event.target_player_id,'P1');
 assert.equal(event.actor_display_name_snapshot,'Renamed native player');assert.equal(event.target_player_name_snapshot,'Renamed native player');assert.equal(event.before_data.name,'Native P1');
 assert.equal((await q('select count(*)::int n from papa_notifications'))[0].n,1);
 const baseline=await stable(),change=(id,data)=>({kind:'players',id,data:{playerId:id,...data}});
 const reject=async(changes,context=self,notices=[],error=/INVALID/)=>{
  await assert.rejects(commit(changes,[],context,notices),error);assert.deepEqual(await stable(),baseline);
 };
 await reject([change('P2',{name:'Stolen profile'})]);
 await reject([change('P1',{name:'Stolen actor'})],{...self,account_id:secondPlayer});
 await reject([change('new-player',{name:'Unbound profile'})],ctx);
 for(const data of [{password:'secret'},{password:''},{token:'token'},{accessToken:'token'},{currentPassword:'secret'},
  {names:[{accessToken:'nested credential'}]},
  {accountId:secondPlayer},{membership_id:identity.membership_id},{note:'Player cannot replace private admin note'}])await reject([change('P1',data)]);
 await assert.rejects(commit([],[{kind:'players',id:'P1'}],ctx),/SCOPE_INVALID/);assert.deepEqual(await stable(),baseline);
 await reject([change('P1',{name:'Must roll back'})],self,[notice('invalid-uuid')],/uuid/);
 const nativeAdmin={...ctx,action:'player'};
 assert.equal(Number(await commit([change('P1',{name:'Administrator correction'})],[],nativeAdmin)),2);
 const after=(await q("select data from papa_space_player_profiles where space_id=$1 and player_id='P1'",[space]))[0].data;
 assert.equal(after.note,'private native P1');assert.equal(after.name,'Administrator correction');
 const requestSelf={...self,action:'request'};
 const before=await read();const next=mutate(before,{streamer:room,type:'request',data:{songId:'NS',kind:'saved'}},{role:'player',playerId:'P1'},at);next.settings=next.streamerSettings[room];
 const patch=stateChanges(before,next,{preserveOrder:true});
 assert.equal(Number(await commit(patch.changes,patch.removed,requestSelf,[],true,before.revision)),3,'account-bound player request uses original guarded room operation');
 const playerEvent=(await q("select * from papa_events where action='request' and entity_kind='queue' order by id desc limit 1"))[0];
 assert.equal(playerEvent.actor_display_name_snapshot,'Administrator correction');assert.equal(playerEvent.target_player_name_snapshot,'Administrator correction');assert.equal(playerEvent.space_id,space);
 await assert.rejects(commit([{kind:'ledger',id:'player-credit',data:{id:'player-credit',streamer_id:room,playerId:'P1',amount:100}}],[],requestSelf,[],true),/ACTOR_INVALID/);
 await db.exec('set role service_role');
 await assert.rejects(rpc('papa_room_native_commit',[3,[],[],self,[],room,false]),/permission denied/);
 await db.exec('reset role');
});

test('old room snapshot and six-argument commits retain Space 001 behavior after the native extension',async t=>{
 const {q,rpc,legacySong}=await fixture(t);
 const nativeBefore=await q('select space_id,player_id,account_id,membership_id,data from papa_space_player_profiles order by space_id,player_id');
 const snapshot=await rpc('papa_v2_room_write_snapshot',['papa',[legacySong]]);
 assert.equal(snapshot.rows.find(r=>r.kind==='songs').data.lyrics,'legacy-private-lyrics');
 assert.equal(JSON.stringify(snapshot).includes('native-private-lyrics'),false);
 const legacyContext={role:'streamer_admin',actor_streamer_id:'papa',streamer_id:'papa',space_id:'space-001',action:'songsBulk'};
 const revision=Number(snapshot.revision);
 assert.equal(Number(await rpc('papa_room_admin_commit',[revision,
  [{kind:'songs',id:legacySong,data:{songId:legacySong,streamer_id:'papa',title:'Legacy title edited',tags:['Legacy tag']}}],[],legacyContext,[],'papa'])),revision+1);
 assert.equal((await q("select data->>'lyrics' lyrics from papa_v2_entities where kind='songs' and id=$1",[legacySong]))[0].lyrics,'legacy-private-lyrics');
 assert.equal(Number(await rpc('papa_room_operational_commit',[revision+1,
  [{kind:'queue',id:'legacy-queue',data:{id:'legacy-queue',streamer_id:'papa',playerId:'P1',songId:legacySong,status:'waiting'}}],[],{...legacyContext,action:'queue'},[],'papa'])),revision+2);
 const oldPlayer=(await q("select data from papa_v2_entities where kind='players' and id='P1'"))[0].data;
 assert.equal(Number(await rpc('papa_room_admin_commit',[revision+2,
  [{kind:'players',id:'P1',data:{...oldPlayer,name:'Legacy Player edited'}}],[],{role:'player',player_id:'P1',streamer_id:'papa',space_id:'space-001',action:'self'},[],'papa'])),revision+3);
 assert.equal((await q("select data->>'password' password from papa_v2_entities where kind='players' and id='P1'"))[0].password,'legacy-password');
 assert.deepEqual(await q('select space_id,player_id,account_id,membership_id,data from papa_space_player_profiles order by space_id,player_id'),nativeBefore);
});

test('native missing cancellation fields, malformed IDs/pairing and retained foreign references fail closed with rollback',async t=>{
 const {q,ctx,player,read,commit,stable}=await fixture(t);
 const self={...ctx,role:'player',account_id:player,actor_streamer_id:null,player_id:'P1',action:'cancelOwn'};
 const initial=(await q("select data from papa_v2_entities where kind='queue' and id='NQ'"))[0].data;
 const allocated={...initial,id:'NAL',kind:'live',allocation_id:'A1',creditCost:1};
 for(const data of [{...initial,id:''},{...initial,id:'777'},{...initial,id:'NCOMPLETE',status:'completed'},allocated])
  await q("insert into papa_v2_entities(kind,id,data) values('queue',$1,$2)",[data.id,data]);
 let baseline=await stable();
 const reject=async(changes,removed=[],context=ctx,operational=false,error=/INVALID/)=>{
  await assert.rejects(commit(changes,removed,context,[],operational),error);
  assert.deepEqual(await stable(),baseline,'rejected mutation leaves entities/profiles/revision/events/notices intact');
 };
 const missingStatus={...initial};delete missingStatus.status;
 await reject([{kind:'queue',id:'NQ',data:missingStatus}],[],self,true,/ACTOR_INVALID/);
 await reject([{kind:'queue',id:'NQ',data:{...initial,status:null}}],[],self,true,/ACTOR_INVALID/);
 await reject([{kind:'queue',id:'NCOMPLETE',data:{...initial,id:'NCOMPLETE',status:'cancelled'}}],[],self,true,/ACTOR_INVALID/);
 const cancelled={kind:'queue',id:'NAL',data:{...allocated,status:'cancelled',cancelled_by:'P1',allocationReturnedAt:at,allocationReturnedCredits:1}};
 const returned={kind:'ledger',id:'NRETURN',data:{id:'NRETURN',streamer_id:room,playerId:'P1',queueId:'NAL',amount:1,allocation_id:'A1',at}};
 await reject([cancelled,returned],[],self,true,/ACTOR_INVALID/);
 await reject([cancelled,{...returned,data:{...returned.data,allocationSettlement:null}}],[],self,true,/ACTOR_INVALID/);
 for(const id of ['',null,777,{},[]])await reject([], [{kind:'queue',id}]);
 for(const kind of [null,777,{},[]])await reject([], [{kind,id:'NQ'}]);
 for(const id of ['',null,777,{},[]])await reject([{kind:'queue',id,data:{...initial,id:String(id??'')}}]);
 const songPatch=data=>({kind:'songs',id:'NS',data:{songId:'NS',streamer_id:room,...data}});
 for(const pairSongIds of ['FS',{},null,[null],[7],[''],[' '],['FS']])await reject([songPatch({pairSongIds})]);
 for(const pairSongId of ['FS',{},7,'',' '])await reject([songPatch({pairSongId})]);
 for(const [key,value] of [['songId',{}],['queueId',7],['crownId','']])
  await reject([{kind:'queue',id:'NQ',data:{...initial,[key]:value}}],[],ctx,true);
 // Source merges must validate retained fields, even when the incoming patch
 // does not name the foreign relation stored in the original song body.
 await q("update papa_v2_entities set data=data||$1::jsonb where kind='songs' and id='NS'",[{pairSongIds:['FS']}]);
 baseline=await stable();await reject([songPatch({tags:['Changed']})]);
 await q("update papa_v2_entities set data=(data-'pairSongIds')||$1::jsonb where kind='songs' and id='NS'",[{retained:{playerId:'PF'}}]);
 baseline=await stable();await reject([songPatch({tags:['Changed']})]);
 await q("update papa_v2_entities set data=data-'retained' where kind='songs' and id='NS'");
 const before=await read();const after=mutate(before,{streamer:room,type:'cancelOwn',data:{id:'NAL'}},{role:'player',playerId:'P1'},at);
 after.settings=after.streamerSettings[room];const patch=stateChanges(before,after,{preserveOrder:true});
 assert.equal(Number(await commit(patch.changes,patch.removed,self,[],true,before.revision)),before.revision+1,'real Core cancellation still returns allocated credits atomically');
 assert.equal((await q("select data->>'status' status from papa_v2_entities where kind='queue' and id='NAL'"))[0].status,'cancelled');
 assert.equal((await q("select count(*)::int n from papa_v2_entities where kind='ledger' and data->>'queueId'='NAL' and data->>'allocationSettlement'='return'"))[0].n,1);
});
