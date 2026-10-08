import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

test('Phase 1 migrations apply in order without rewriting existing business records',async t=>{
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text not null,id text not null,data jsonb not null,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,
  login_id text,role text,streamer_id text,expires_at timestamptz not null);
 create table papa_v2_revision(id int primary key,revision bigint not null);
 insert into papa_v2_revision values(1,1);
 create table papa_streamer_accounts(streamer_id text primary key,password_hash text,enabled boolean);
 create table papa_president_accounts(account_key text primary key,password_hash text);
 create table papa_notice_config(id text primary key,value jsonb);
 create table papa_release_backups(release text primary key,snapshot jsonb);
 create function papa_v2_snapshot() returns jsonb language sql as $$select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(e)) from papa_v2_entities e))$$;
 create table papa_notifications(id uuid primary key default gen_random_uuid(),streamer_id text not null,
  recipient text not null,read_at timestamptz,created_at timestamptz not null default now());
 create table papa_push_subscriptions(id uuid primary key default gen_random_uuid(),streamer_id text,recipient text,endpoint text,subscription jsonb,session_hash text);
 create table papa_events(id bigint generated always as identity primary key,streamer_id text not null,
  entity_kind text not null,entity_id text not null,action text not null,actor_role text,
  actor_player_id text,created_at timestamptz not null default now(),effective_at text,
  before_data jsonb,after_data jsonb);
 create function papa_audit_redact(value jsonb) returns jsonb language sql immutable as $$select value$$;
 insert into papa_v2_entities values
  ('meta','1','{"streamers":[{"id":"papa","display_name":"怕怕"}]}'),
  ('players','P1','{"playerId":"P1","name":"玩家","password":"secret"}'),
  ('songs','S1','{"songId":"S1","streamer_id":"papa","title":"舊歌"}'),
  ('queue','Q1','{"id":"Q1","streamer_id":"papa","playerId":"P1"}');
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role)
  values('papa','queue','Q1','complete','legacy-server');
 insert into papa_notifications(streamer_id,recipient) values('papa','P1');`);
 // Run against the catalog schema actually deployed on main, including the
 // partial-group review and new relation/lyrics triggers, not a toy baseline.
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)||/^20261008000[1-8]_/.test(f)).sort())
  await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await q("select papa_catalog_reconcile_songs('',100)");
 const candidate=(await q("select id,source_hash from papa_catalog_candidates where song_id='S1'"))[0];
 await q("select papa_catalog_review_selected('independent',$1,$2,'president')",[[candidate.id],{[candidate.id]:candidate.source_hash}]);
 const beforeLinks=await q('select * from papa_catalog_song_links order by song_id');
 const beforeEntities=await q('select kind,id,data from papa_v2_entities order by kind,id');
 const beforeEvents=await q('select id,streamer_id,entity_kind,entity_id,action,actor_role from papa_events');
 for(let number=1;number<=11;number++){
  const file=`supabase/migrations/20261007${String(number).padStart(4,'0')}_${[
   'space_foundation','device_sessions','verified_identity_binding',
   'audit_actor_snapshots','device_push_contract','device_access_lifecycle',
   'notification_space_scope','policy_feature_entitlement',
   'scoped_read_snapshot','web_device_push_bridge','room_operational_commit'][number-1]}.sql`;
  await db.exec(fs.readFileSync(file,'utf8'));
 }
 assert.deepEqual(await q('select kind,id,data from papa_v2_entities order by kind,id'),beforeEntities);
 assert.deepEqual(await q('select id,streamer_id,entity_kind,entity_id,action,actor_role from papa_events'),beforeEvents);
 assert.deepEqual(await q('select * from papa_catalog_song_links order by song_id'),beforeLinks);
 assert.deepEqual(await q("select kind,space_id from papa_v2_entities where kind in ('songs','queue') order by kind"),[
  {kind:'queue',space_id:'space-001'},{kind:'songs',space_id:'space-001'}]);
 assert.equal((await q('select count(*)::int n from papa_device_sessions'))[0].n,0);
 assert.equal((await q('select count(*)::int n from papa_device_notification_deliveries'))[0].n,0);
 assert.equal((await q('select space_id from papa_notifications'))[0].space_id,'space-001');
 assert.equal((await q('select count(*)::int n from papa_space_entitlements'))[0].n,0,
  'no existing feature is silently gated by the skeleton');
});
