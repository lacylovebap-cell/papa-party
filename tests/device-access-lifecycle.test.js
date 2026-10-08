import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('durable login rotates atomically, survives a new access token, and revokes both on logout/password change',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,
  login_id text,role text,streamer_id text,expires_at timestamptz not null);
 create table papa_streamer_accounts(streamer_id text primary key,password_hash text not null,enabled boolean not null);
 create table papa_president_accounts(account_key text primary key,password_hash text not null);
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa"}]}'),
  ('players','P1','{"playerId":"P1","name":"玩家","password":"old"}');
 insert into papa_streamer_accounts values('papa','old',true);
 insert into papa_president_accounts values('president:legacy','old');`);
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql',
  '202610070003_verified_identity_binding.sql','202610070006_device_access_lifecycle.sql'])
  await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 const accounts={};
 for(const kind of ['player','manager','president','other'])
  accounts[kind]=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[accounts.player,'P1']);
 await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[accounts.other,'P2']);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('streamer:papa',$1)",[accounts.manager]);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[accounts.president]);
 await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player')",[accounts.player]);
 await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player')",[accounts.other]);
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,'space-001','streamer_admin','papa')",[accounts.manager]);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[accounts.president]);
 const install=crypto.randomUUID();
 const start=async(account,role,room,refresh)=>
  (await q('select papa_start_device_session($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
   [account,install,'web','1.0',role,role==='president'?null:'space-001',room,refresh,
    role==='player'?'platform-login':'']))[0].result;
 const original=await start(accounts.player,'player',null,'a'.repeat(64));
 assert.equal(original.kind,'player');
 await assert.rejects(start(accounts.other,'player',null,'b'.repeat(64)),/INSTALLATION_ACCOUNT_CONFLICT/);
 const refresh=async(id,oldHash,newHash,accessHash)=>
  (await q('select papa_refresh_device_access($1,$2,$3,$4) result',[id,oldHash,newHash,accessHash]))[0].result;
 const renewed=await refresh(original.sessionId,'a'.repeat(64),'c'.repeat(64),'d'.repeat(64));
 assert.equal(renewed.accountId,accounts.player);
 const playerActor=(await q("select papa_verified_session_actor($1) actor",['d'.repeat(64)]))[0].actor;
 assert.equal(playerActor.playerId,'P1');assert.equal(playerActor.loginId,'platform-login');
 assert.equal(await refresh(original.sessionId,'a'.repeat(64),'e'.repeat(64),'f'.repeat(64)),null);
 assert.equal((await q('select count(*)::int n from papa_v2_sessions where device_session_id=$1',[original.sessionId]))[0].n,1);
 assert.equal((await q('select papa_revoke_device_with_refresh($1,$2) result',[original.sessionId,'c'.repeat(64)]))[0].result,true);
 assert.equal((await q('select count(*)::int n from papa_v2_sessions where device_session_id=$1',[original.sessionId]))[0].n,0);
 assert.equal(await refresh(original.sessionId,'c'.repeat(64),'0'.repeat(64),'1'.repeat(64)),null);
 const playerAgain=await start(accounts.player,'player',null,'2'.repeat(64));
 await q("update papa_space_memberships set status='suspended' where account_id=$1 and role='player'",[accounts.player]);
 await assert.rejects(refresh(playerAgain.sessionId,'2'.repeat(64),'3'.repeat(64),'4'.repeat(64)),/MEMBERSHIP_REQUIRED/);
 await q("update papa_space_memberships set status='active' where account_id=$1 and role='player'",[accounts.player]);
 await refresh(playerAgain.sessionId,'2'.repeat(64),'3'.repeat(64),'4'.repeat(64));
 await q("update papa_v2_entities set data=jsonb_set(data,'{password}','\"changed\"') where kind='players' and id='P1'");
 assert.equal((await q('select revoked_at is not null revoked from papa_device_sessions where id=$1',[playerAgain.sessionId]))[0].revoked,true);
 assert.equal((await q("select papa_verified_session_actor($1) actor",['4'.repeat(64)]))[0].actor,null);
 const manager=await start(accounts.manager,'streamer_admin','papa','5'.repeat(64));
 await refresh(manager.sessionId,'5'.repeat(64),'6'.repeat(64),'7'.repeat(64));
 await q("update papa_streamer_accounts set password_hash='new' where streamer_id='papa'");
 assert.equal((await q('select revoked_at is not null revoked from papa_device_sessions where id=$1',[manager.sessionId]))[0].revoked,true);
 assert.equal((await q("select papa_verified_session_actor($1) actor",['7'.repeat(64)]))[0].actor,null);
 const president=await start(accounts.president,'president',null,'8'.repeat(64));
 await refresh(president.sessionId,'8'.repeat(64),'9'.repeat(64),'a'.repeat(64));
 await q("update papa_president_accounts set password_hash='new' where account_key='president:legacy'");
 assert.equal((await q('select revoked_at is not null revoked from papa_device_sessions where id=$1',[president.sessionId]))[0].revoked,true);
 await q("insert into papa_spaces(id,slug,display_name) values('space-002','other','Other')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('other-room','space-002')");
 await q("update papa_v2_entities set data=jsonb_set(data,'{streamers}',data->'streamers'||'[{\"id\":\"other-room\",\"slug\":\"other\"}]'::jsonb) where kind='meta'");
 await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-002','player')",[accounts.player]);
 const secondInstall=crypto.randomUUID();
 const otherSession=(await q('select papa_start_device_session($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
  [accounts.player,secondInstall,'web','1.0','player','space-002',null,'b'.repeat(64),'platform-login']))[0].result;
 await refresh(otherSession.sessionId,'b'.repeat(64),'f'.repeat(64),'1'.repeat(64));
 assert.equal((await q('select papa_verified_session_actor($1,$2) actor',
  ['1'.repeat(64),'other']))[0].actor.spaceId,'space-002');
 assert.equal((await q('select papa_verified_session_actor($1,$2) actor',
  ['1'.repeat(64),'papa']))[0].actor,null,'Space 002 session cannot read Space 001');
 await db.exec('set role anon');
 await assert.rejects(start(accounts.player,'player',null,'b'.repeat(64)),/permission denied/);
 await db.exec('reset role');
});
