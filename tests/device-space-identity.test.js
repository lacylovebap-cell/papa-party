import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

test('device access and Push resolve the independent Space profile and revoke the previous slot atomically',async t=>{
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
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
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)||/^20261008000[1-8]_/.test(f)).sort())
  await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 for(let number=1;number<=14;number++){
  const file=`supabase/migrations/20261007${String(number).padStart(4,'0')}_${[
   'space_foundation','device_sessions','verified_identity_binding',
   'audit_actor_snapshots','device_push_contract','device_access_lifecycle',
   'notification_space_scope','policy_feature_entitlement',
   'scoped_read_snapshot','web_device_push_bridge','room_operational_commit','catalog_space_relations','space_player_profiles','device_space_identity'][number-1]}.sql`;
  await db.exec(fs.readFileSync(file,'utf8'));
 }

 const account=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q("insert into papa_account_legacy_players values($1,'P1',now())",[account]);
 await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player')",[account]);
 await q("insert into papa_spaces(id,slug,display_name) values('space-002','other','Other')");
 await q("insert into papa_space_streamers values('room-002','space-002',now())");
 const metadata=(await q("select data from papa_v2_entities where kind='meta'"))[0].data;
 metadata.streamers.push({id:'room-002',slug:'room-002',active:true});
 await q("update papa_v2_entities set data=$1 where kind='meta'",[metadata]);
 const member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-002','player') returning id",[account]))[0].id;
 await q("insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values('space-002','P-OTHER',$1,$2,$3)",[account,member,{playerId:'P-OTHER',name:'Different profile',ids:['OTHER-LOGIN']}]);
 const install=crypto.randomUUID();
 const start=async(space,hash,login='LEGACY-LOGIN')=>rpc('papa_start_device_session',[account,install,'web','qa','player',space,null,hash.repeat(64),login]);
 const refresh=async(device,old,next,access)=>rpc('papa_refresh_device_access',[device,old.repeat(64),next.repeat(64),access.repeat(64)]);
 const old=await start('space-001','a');
 assert.equal((await refresh(old.sessionId,'a','b','c')).playerId,'P1');
 assert.equal((await rpc('papa_verified_session_actor',['c'.repeat(64),'papa'])).playerId,'P1');
 const current=await start('space-002','d');
 assert.equal(await rpc('papa_verified_session_actor',['c'.repeat(64),'papa']),null,'changing the player slot revokes its old access');
 const access=await refresh(current.sessionId,'d','e','f');
 assert.equal(access.playerId,'P-OTHER');assert.equal(access.spaceId,'space-002');assert.equal(access.loginId,'','a legacy Space login ID is not carried into another Space');
 const actor=await rpc('papa_verified_session_actor',['f'.repeat(64),'room-002']);
 assert.equal(actor.playerId,'P-OTHER');assert.equal(actor.spaceId,'space-002');
 assert.equal(await rpc('papa_verified_session_actor',['f'.repeat(64),'papa']),null);
 assert.equal(await rpc('papa_device_push_recipient',[current.sessionId,'room-002','P-OTHER']),true);
 assert.equal(await rpc('papa_device_push_recipient',[current.sessionId,'room-002','P1']),false);
 assert.equal(await rpc('papa_device_push_recipient',[current.sessionId,'papa','P-OTHER']),false);
 await q("update papa_space_memberships set status='suspended' where id=$1",[member]);
 assert.equal(await rpc('papa_verified_session_actor',['f'.repeat(64),'room-002']),null);
 assert.equal(await rpc('papa_device_push_recipient',[current.sessionId,'room-002','P-OTHER']),false);
 await assert.rejects(refresh(current.sessionId,'e','0','1'),/MEMBERSHIP_REQUIRED/);
 assert.equal((await q('select refresh_hash from papa_device_sessions where id=$1',[current.sessionId]))[0].refresh_hash,'e'.repeat(64),'failed refresh does not consume the previous token');
 await q("update papa_space_memberships set status='active' where id=$1",[member]);
 assert.equal((await refresh(current.sessionId,'e','0','1')).playerId,'P-OTHER');
 await rpc('papa_revoke_device_with_refresh',[current.sessionId,'0'.repeat(64)]);
 assert.equal(await rpc('papa_verified_session_actor',['1'.repeat(64),'room-002']),null);
 assert.equal(await rpc('papa_device_push_recipient',[current.sessionId,'room-002','P-OTHER']),false);
});
