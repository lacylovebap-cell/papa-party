import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const none={spaces:[],total:0,hasMore:false,membershipCount:0};
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(statement,args=[])=>(await db.query(statement,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql',
  '202609250001_roles_and_notification_scope.sql','202609280001_manager_passwords.sql'])await db.exec(migration(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1)",[{streamers:[{id:'papa',slug:'papa',display_name:'Legacy Public Room',active:true}],streamerSettings:{papa:{note:'private legacy setting'}},migrationIssues:['private migration issue']}]);
 await q("insert into papa_v2_entities(kind,id,data) values('players','P1',$1),('songs','LS',$2)",[
  {playerId:'P1',name:'Private Legacy Player',password:'private password',ids:[]},
  {songId:'LS',streamer_id:'papa',title:'Private song title',lyrics:'private lyrics'}]);
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql',
  '202610070003_verified_identity_binding.sql','202610070005_device_push_contract.sql',
  '202610070006_device_access_lifecycle.sql','202610070009_scoped_read_snapshot.sql',
  '202610070010_web_device_push_bridge.sql'])await db.exec(migration(name));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 for(const name of ['202610070013_space_player_profiles.sql','202610070014_device_space_identity.sql',
  '202610090001_device_space_switch.sql','202610090002_space_entry.sql'])await db.exec(migration(name));
 const spaces=[['entry-alpha','alpha','Alpha Public Space','active'],['entry-beta','beta','Beta Public Space','active'],
  ['entry-empty','empty','Empty Public Space','active'],['entry-suspended','suspended','Suspended Public Space','suspended']];
 for(const values of spaces)await q('insert into papa_spaces(id,slug,display_name,status) values($1,$2,$3,$4)',values);
 const rooms=[['alpha-first','entry-alpha','alpha-first-slug','Alpha First Public Room',true],
  ['alpha-assigned','entry-alpha','alpha-assigned-slug','Alpha Assigned Public Room',true],
  ['alpha-inactive','entry-alpha','alpha-inactive-slug','Inactive Public Room',false],
  ['beta-room','entry-beta','beta-room-slug','Beta Public Room',true],
  ['suspended-room','entry-suspended','suspended-room-slug','Suspended Public Room',true]];
 const meta=(await q("select data from papa_v2_entities where kind='meta'"))[0].data;
 for(const [id,scope,slug,name,active] of rooms){
  await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,scope]);
  meta.streamers.push({id,slug,display_name:name,active,privateNote:'private registry note'});
 }
 await q("update papa_v2_entities set data=$1 where kind='meta'",[meta]);
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const player=await account(),manager=await account(),president=await account(),unbound=await account();
 const member=async(subject,space,role='player',streamer=null)=>(await q('insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,$3,$4) returning id',[subject,space,role,streamer]))[0].id;
 await q("insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,'P1')",[player]);
 await member(player,'space-001');
 const alphaMember=await member(player,'entry-alpha');
 for(const [scope,id,membership] of [['entry-alpha','P-ALPHA',alphaMember],['entry-empty','P-EMPTY',await member(player,'entry-empty')],['entry-suspended','P-SUSPENDED',await member(player,'entry-suspended')]])
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
   [scope,id,player,membership,{playerId:id,name:'Private Native Player',note:'private profile note'}]);
 await member(player,'entry-beta','streamer_admin','beta-room');
 await member(unbound,'entry-alpha');
 const managerMember=await member(manager,'entry-alpha','streamer_admin','alpha-assigned');
 await q("insert into papa_streamer_accounts(streamer_id,password_hash,enabled) values('alpha-assigned','verified-fixture',true),('beta-room','verified-fixture',true)");
 await q("insert into papa_manager_account_links(manager_key,account_id) values('streamer:alpha-assigned',$1),('president',$2)",[manager,president]);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 const entry=(subject=player,role='player',streamer=null,slug=null,hostname=null,limit=50,offset=0)=>rpc('papa_account_space_entry',[subject,role,streamer,slug,hostname,limit,offset]);
 return {db,q,rpc,player,manager,president,unbound,alphaMember,managerMember,entry};
}

test('bounded entry returns only canonical role-authorized Spaces with active public destinations',async t=>{
 const {db,q,player,manager,president,unbound,entry}=await fixture(t);
 const result=await entry();assert.deepEqual(result.spaces.map(s=>s.id),['entry-alpha','space-001']);assert.equal(result.total,2);assert.equal(result.hasMore,false);assert.equal(result.membershipCount,2,'manager-only membership and empty/suspended scopes are not counted');
 const alpha=result.spaces[0];assert.deepEqual(alpha,{id:'entry-alpha',slug:'alpha',name:'Alpha Public Space',streamerCount:2,
  streamerId:'alpha-first',streamerSlug:'alpha-first-slug',streamerName:'Alpha First Public Room'});
 for(const space of result.spaces)assert.deepEqual(Object.keys(space).sort(),['id','name','slug','streamerCount','streamerId','streamerName','streamerSlug'].sort());
 for(const privateValue of ['P1','P-ALPHA','Private Legacy Player','Private Native Player','private password','private lyrics','private profile','private registry','private legacy'])
  assert.equal(JSON.stringify(result).includes(privateValue),false);
 assert.deepEqual(await entry(unbound),none,'active player membership without a profile supplies no destination');
 assert.deepEqual(await entry(player,'streamer_admin','alpha-first'),none,'role text cannot supply a manager credential binding');
 assert.deepEqual(await entry(player,'president'),none);
 assert.deepEqual(await entry(manager,'player'),none,'streamer membership never supplies player identity');
 const managerEntry=await entry(manager,'streamer_admin','alpha-assigned');assert.equal(managerEntry.spaces.length,1);assert.equal(managerEntry.membershipCount,1);
 assert.equal(managerEntry.spaces[0].streamerId,'alpha-assigned');assert.equal(managerEntry.spaces[0].streamerCount,1);
 assert.deepEqual(await entry(manager,'streamer_admin','alpha-first'),none);
 const global=await entry(president,'president');assert.deepEqual(global.spaces.map(s=>s.id),['entry-alpha','entry-beta','space-001']);
 assert.equal(global.spaces.some(s=>s.id==='entry-empty'),false);assert.equal(global.spaces.some(s=>s.id==='entry-suspended'),false);
 await db.exec('set role service_role');assert.equal((await entry()).total,2);await db.exec('reset role');
 await db.exec('set role anon');await assert.rejects(entry(),/permission denied/);await assert.rejects(q('select * from papa_space_hostnames'),/permission denied/);await db.exec('reset role');
});

test('slug and verified-hostname resolution intersect membership and reveal no unknown or unauthorized destination',async t=>{
 const {q,player,president,entry}=await fixture(t);
 const selected=await entry(player,'player',null,'alpha');assert.equal(selected.spaces[0].id,'entry-alpha');assert.equal(selected.total,1);assert.equal(selected.membershipCount,2,'a dedicated slug retains the number of usable memberships');
 for(const slug of ['', 'unknown','beta','empty','suspended'])assert.deepEqual(await entry(player,'player',null,slug),none);
 assert.deepEqual((await q('select * from papa_space_hostnames')),[],'no domain is provisioned by the migration');
 await q("insert into papa_space_hostnames(hostname,space_id,verified_at) values('alpha.example.test','entry-alpha',now()),('beta.example.test','entry-beta',now()),('unverified.example.test','entry-alpha',null)");
 const resolved=await entry(player,'player',null,null,'ALPHA.EXAMPLE.TEST');assert.equal(resolved.spaces[0].id,'entry-alpha');assert.equal(resolved.total,1);assert.equal(resolved.membershipCount,2);
 assert.deepEqual(await entry(player,'player',null,null,'beta.example.test'),none);
 assert.equal((await entry(president,'president',null,null,'beta.example.test')).spaces[0].id,'entry-beta');
 for(const hostname of ['', 'unknown.example.test','unverified.example.test','https://alpha.example.test','alpha.example.test:443'])
  assert.deepEqual(await entry(player,'player',null,null,hostname),none);
 assert.deepEqual(await entry(player,'player',null,'papa-party','alpha.example.test'),none,'slug and hostname cannot disagree');
 await assert.rejects(q("insert into papa_space_hostnames(hostname,space_id) values('UPPER.example.test','entry-alpha')"),/check constraint/);
 await assert.rejects(q("insert into papa_space_hostnames(hostname,space_id) values('https://example.test','entry-alpha')"),/check constraint/);
 await assert.rejects(q("insert into papa_space_hostnames(hostname,space_id) values('alpha.example.test','entry-beta')"),/unique constraint/);
});

test('player and president room hints prefer an active authorized destination without changing room counts or streamer grants',async t=>{
 const {player,manager,president,entry}=await fixture(t);
 for(const hint of ['alpha-assigned','alpha-assigned-slug']){
  const result=await entry(player,'player',hint,'alpha');
  assert.equal(result.spaces[0].streamerId,'alpha-assigned');assert.equal(result.spaces[0].streamerCount,2);
  const global=await entry(president,'president',hint,'alpha');
  assert.equal(global.spaces[0].streamerId,'alpha-assigned');assert.equal(global.spaces[0].streamerCount,2);
 }
 for(const hint of ['beta-room','alpha-inactive','missing-room']){
  const result=await entry(player,'player',hint,'alpha');
  assert.equal(result.spaces[0].streamerId,'alpha-first');assert.equal(result.spaces[0].streamerCount,2);
  assert.deepEqual((await entry(player,'player',hint)).spaces.map(s=>s.id),['entry-alpha','space-001']);
 }
 assert.deepEqual(await entry(player,'player','beta-room','beta'),none,'a foreign room hint supplies no player identity');
 assert.deepEqual(await entry(manager,'streamer_admin','alpha-first','alpha'),none);
 const assigned=await entry(manager,'streamer_admin','alpha-assigned','alpha');
 assert.equal(assigned.spaces[0].streamerId,'alpha-assigned');assert.equal(assigned.spaces[0].streamerCount,1);
});

test('entry revalidates profiles, active Account and role grants; limits and pagination stay server bounded',async t=>{
 const {q,player,manager,president,alphaMember,managerMember,entry}=await fixture(t);
 const first=await entry(player,'player',null,null,null,1,0);assert.equal(first.total,2);assert.equal(first.hasMore,true);assert.equal(first.spaces[0].id,'entry-alpha');
 const last=await entry(player,'player',null,null,null,1,1);assert.equal(last.total,2);assert.equal(last.hasMore,false);assert.equal(last.spaces[0].id,'space-001');
 const beyond=await entry(player,'player',null,null,null,1,10);assert.equal(beyond.total,2);assert.equal(beyond.hasMore,false);assert.deepEqual(beyond.spaces,[]);
 for(const [limit,offset] of [[null,0],[0,0],[101,0],[1,null],[1,-1],[1,10001]])
  await assert.rejects(entry(player,'player',null,null,null,limit,offset),/SPACE_ENTRY_PAGE_INVALID/);
 await q("update papa_space_memberships set status='suspended' where id=$1",[alphaMember]);assert.deepEqual(await entry(player,'player',null,'alpha'),none);
 await q("update papa_space_memberships set status='active' where id=$1",[alphaMember]);
 await q("delete from papa_space_player_profiles where space_id='entry-alpha' and account_id=$1",[player]);assert.deepEqual(await entry(player,'player',null,'alpha'),none);
 await q('update papa_accounts set disabled_at=now() where id=$1',[player]);assert.deepEqual(await entry(),none);
 await q("update papa_space_memberships set status='suspended' where id=$1",[managerMember]);assert.deepEqual(await entry(manager,'streamer_admin','alpha-assigned'),none);
 await q("update papa_space_memberships set status='active' where id=$1",[managerMember]);
 await q("update papa_streamer_accounts set enabled=false where streamer_id='alpha-assigned'");assert.deepEqual(await entry(manager,'streamer_admin','alpha-assigned'),none);
 await q('delete from papa_platform_roles where account_id=$1',[president]);assert.deepEqual(await entry(president,'president'),none);
});
