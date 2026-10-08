import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('device refresh rotates once, keeps player/manager separate, and revokes by verified account',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,
  login_id text,role text,streamer_id text,expires_at timestamptz not null);
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa"}]}');`);
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql'])
  await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 const player=(await q('insert into papa_accounts default values returning id'))[0].id;
 const manager=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player')",[player]);
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,'space-001','streamer_admin','papa')",[manager]);
 const installation=crypto.randomUUID();
 await q("insert into papa_installations(id,platform) values($1,'web')",[installation]);
 const old='a'.repeat(64),next='b'.repeat(64);
 const playerSession=(await q(`insert into papa_device_sessions
  (installation_id,account_id,session_kind,role,space_id,refresh_hash,expires_at)
  values($1,$2,'player','player','space-001',$3,now()+interval '90 days') returning id`,
  [installation,player,old]))[0].id;
 const managerSession=(await q(`insert into papa_device_sessions
  (installation_id,account_id,session_kind,role,space_id,streamer_id,refresh_hash,expires_at)
  values($1,$2,'manager','streamer_admin','space-001','papa',$3,now()+interval '90 days') returning id`,
  [installation,manager,'c'.repeat(64)]))[0].id;
 assert.notEqual(playerSession,managerSession);
 const first=(await q('select papa_rotate_device_session($1,$2,$3) result',[playerSession,old,next]))[0].result;
 assert.equal(first.accountId,player);assert.equal(first.role,'player');assert.equal(first.rotation,1);
 assert.equal((await q('select papa_rotate_device_session($1,$2,$3) result',[playerSession,old,'d'.repeat(64)]))[0].result,null,
  'consumed refresh token cannot be replayed');
 await assert.rejects(q('update papa_device_sessions set role=$1 where id=$2',['president',playerSession]),/SESSION_SCOPE_IMMUTABLE/);
 assert.equal((await q('select papa_revoke_device_session($1,$2) result',[player,managerSession]))[0].result,false);
 assert.equal((await q('select papa_revoke_device_session($1,$2) result',[player,playerSession]))[0].result,true);
 assert.equal((await q('select papa_rotate_device_session($1,$2,$3) result',[playerSession,next,'e'.repeat(64)]))[0].result,null);
 await assert.rejects(q(`insert into papa_device_sessions
  (installation_id,account_id,session_kind,role,space_id,refresh_hash,expires_at)
  values($1,$2,'player','player','space-001',$3,now()+interval '90 days')`,
  [crypto.randomUUID(),manager,'f'.repeat(64)]),/MEMBERSHIP_REQUIRED/);
 await q('update papa_accounts set disabled_at=now() where id=$1',[manager]);
 assert.equal((await q('select papa_revoke_device_session($1,$2) result',[manager,managerSession]))[0].result,true,
  'a disabled account can still explicitly revoke its existing session');
 await db.exec('set role anon');
 await assert.rejects(q('select * from papa_device_sessions'),/permission denied/);
 await assert.rejects(q('select papa_rotate_device_session($1,$2,$3)',[playerSession,next,'d'.repeat(64)]),/permission denied/);
 await db.exec('reset role');
});
