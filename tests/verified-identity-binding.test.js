import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const foundation=fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8');
const binding=fs.readFileSync('supabase/migrations/202610070003_verified_identity_binding.sql','utf8');
const h=c=>c.repeat(64);

test('verified legacy sessions bind to stable player/manager accounts without changing legacy rows',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,
  login_id text,role text,streamer_id text,expires_at timestamptz not null);
 create table papa_streamer_accounts(streamer_id text primary key,enabled boolean not null);
 insert into papa_streamer_accounts values('papa',true),('michelle',true);
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa"},{"id":"michelle"}]}');`);
 const oldRows=await q('select kind,id,data from papa_v2_entities');
 await db.exec(foundation);
 await db.exec(fs.readFileSync('supabase/migrations/202610070002_device_sessions.sql','utf8'));
 await db.exec(binding);
 assert.deepEqual(await q('select kind,id,data from papa_v2_entities'),oldRows);
 for(const [token,player,role,room] of [
  [h('a'),'p1','player',null],[h('b'),'p1','player',null],
  [h('c'),'__admin__','super_admin',null],
  [h('d'),'__streamer__:papa','streamer_admin','papa'],
  [h('e'),'__streamer__:michelle','streamer_admin','michelle']])
  await q(`insert into papa_v2_sessions(token_hash,player_id,role,streamer_id,expires_at)
   values($1,$2,$3,$4,now()+interval '12 hours')`,[token,player,role,room]);
 const bind=async token=>(await q('select papa_bind_verified_legacy_session($1) result',[token]))[0].result;
 const p1=await bind(h('a')),p2=await bind(h('b'));
 assert.equal(p1.accountId,p2.accountId);
 assert.equal(p1.role,'player');assert.equal(p1.spaceId,'space-001');
 assert.equal((await q('select count(*)::int n from papa_account_legacy_players'))[0].n,1);
 assert.equal((await q('select count(*)::int n from papa_space_memberships'))[0].n,1);
 assert.deepEqual(await bind(h('a')),p1,'rebinding is idempotent');
 const president=await bind(h('c')),papa=await bind(h('d')),michelle=await bind(h('e'));
 assert.equal(president.role,'president');assert.equal(president.spaceId,null);
 assert.equal(papa.role,'streamer_admin');assert.equal(papa.streamerId,'papa');
 assert.notEqual(papa.accountId,michelle.accountId);
 assert.notEqual(president.accountId,papa.accountId);
 assert.equal((await q("select count(*)::int n from papa_platform_roles where role='president'"))[0].n,1);
 assert.equal((await q('select count(*)::int n from papa_v2_sessions where account_id is not null'))[0].n,5);
 const actor=async token=>(await q('select papa_verified_session_actor($1) result',[token]))[0].result;
 assert.equal((await actor(h('a'))).playerId,'p1');
 assert.equal((await actor(h('c'))).role,'super_admin');
 assert.equal((await actor(h('d'))).streamerId,'papa');
 assert.equal((await q('select papa_verified_session_actor($1,$2) result',[h('a'),'michelle']))[0].result.role,'player');
 assert.equal((await q('select papa_verified_session_actor($1,$2) result',[h('d'),'michelle']))[0].result,null,
  'a streamer manager cannot access another streamer in the same Space');
 await q("insert into papa_spaces(id,slug,display_name) values('space-002','other','Other')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('other-room','space-002')");
 await q("update papa_v2_entities set data=jsonb_set(data,'{streamers}',data->'streamers'||'[ {\"id\":\"other-room\",\"slug\":\"other\"} ]'::jsonb) where kind='meta'");
 assert.equal((await q('select papa_verified_session_actor($1,$2) result',[h('a'),'other']))[0].result,null,
  'a player cannot access a room in another Space');
 assert.equal((await q('select papa_verified_session_actor($1,$2) result',[h('c'),'other']))[0].result.role,'super_admin');
 await q('update papa_v2_sessions set account_id=$1 where token_hash=$2',[michelle.accountId,h('b')]);
 assert.equal(await actor(h('b')),null,'a cross-identity account pointer never authorizes');
 await assert.rejects(bind(h('b')),/SESSION_ACCOUNT_MISMATCH/);
 await q('update papa_v2_sessions set account_id=$1 where token_hash=$2',[p1.accountId,h('b')]);
 await q(`insert into papa_v2_sessions(token_hash,player_id,role,expires_at)
  values($1,'p1','player',now()+interval '1 hour')`,[h('9')]);
 assert.equal((await actor(h('9'))).spaceId,'space-001','an old unbound session keeps its original scope');
 assert.equal(await bind(h('f')),null,'a nonexistent token cannot create an account');
 await q("update papa_space_memberships set status='suspended' where account_id=$1",[p1.accountId]);
 assert.equal(await actor(h('a')),null,'suspended membership invalidates an existing access token');
 await assert.rejects(bind(h('a')),/MEMBERSHIP_SUSPENDED/);
 await q("update papa_streamer_accounts set enabled=false where streamer_id='papa'");
 assert.equal(await actor(h('d')),null,'disabled streamer invalidates an existing access token');
 await q('update papa_accounts set disabled_at=now() where id=$1',[president.accountId]);
 assert.equal(await actor(h('c')),null,'disabled president account invalidates its token');
 await db.exec('set role anon');
 await assert.rejects(bind(h('a')),/permission denied/);
 await assert.rejects(actor(h('a')),/permission denied/);
 await db.exec('reset role');
});

test('a mismatched manager session never creates an identity',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,
  login_id text,role text,streamer_id text,expires_at timestamptz not null);
 create table papa_streamer_accounts(streamer_id text primary key,enabled boolean not null);`);
 await db.exec(foundation);
 await db.exec(fs.readFileSync('supabase/migrations/202610070002_device_sessions.sql','utf8'));
 await db.exec(binding);
 await db.query(`insert into papa_v2_sessions(token_hash,player_id,role,streamer_id,expires_at)
  values($1,'__streamer__:other','streamer_admin','papa',now()+interval '1 hour')`,[h('f')]);
 assert.equal((await db.query('select papa_bind_verified_legacy_session($1) result',[h('f')])).rows[0].result,null);
 assert.equal((await db.query('select count(*)::int n from papa_accounts')).rows[0].n,0);
});
