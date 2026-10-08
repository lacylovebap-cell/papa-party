import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('installation-bound delivery is idempotent and respects actor, Space, and revocation',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,
  login_id text,role text,streamer_id text,expires_at timestamptz not null);
 create table papa_notifications(id uuid primary key default gen_random_uuid(),streamer_id text not null,
  recipient text not null,read_at timestamptz);
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa"}]}');`);
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql',
  '202610070005_device_push_contract.sql'])
  await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 await db.exec("insert into papa_spaces(id,slug,display_name) values('space-002','other','Other')");
 await db.exec("insert into papa_space_streamers(streamer_id,space_id) values('other-room','space-002')");
 const identities={};
 for(const name of ['player','manager','president','other'])
  identities[name]=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[identities.player,'P1']);
 await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[identities.other,'P2']);
 await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player')",[identities.player]);
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,'space-001','streamer_admin','papa')",[identities.manager]);
 await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-002','player')",[identities.other]);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[identities.president]);
 const makeSession=async(name,platform,role,scope,streamer,hashChar)=>{
  const installation=crypto.randomUUID();
  await q('insert into papa_installations(id,platform) values($1,$2)',[installation,platform]);
  return (await q(`insert into papa_device_sessions
   (installation_id,account_id,session_kind,role,space_id,streamer_id,refresh_hash,expires_at)
   values($1,$2,$3,$4,$5,$6,$7,now()+interval '90 days') returning id`,
   [installation,identities[name],role==='player'?'player':'manager',role,scope,streamer,
    (hashChar||{player:'a',manager:'b',president:'c',other:'d'}[name]).repeat(64)]))[0].id;
 };
 const player=await makeSession('player','web','player','space-001',null);
 const manager=await makeSession('manager','android','streamer_admin','space-001','papa');
 const president=await makeSession('president','web','president',null,null);
 const other=await makeSession('other','web','player','space-002',null);
 const web=JSON.stringify({p256dh:'key',auth:'secret'});
 const register=async(session,transport,destination,credentials={})=>
  (await q(`insert into papa_device_push_registrations
   (device_session_id,transport,destination,credentials)
   values($1,$2,$3,$4) returning id`,[session,transport,destination,credentials]))[0].id;
 const playerRegistration=await register(player,'web_push','https://push.example/player',web);
 const managerRegistration=await register(manager,'fcm','fcm-manager');
 await register(president,'web_push','https://push.example/president',web);
 await register(other,'web_push','https://push.example/other',web);
 await assert.rejects(register(manager,'apns','https://push.example/wrong'),/PUSH_PLATFORM_MISMATCH/);
 const notice=async(recipient,room='papa')=>
  (await q('insert into papa_notifications(streamer_id,recipient) values($1,$2) returning id',[room,recipient]))[0].id;
 const enqueue=async id=>(await q('select papa_enqueue_device_deliveries($1) n',[id]))[0].n;
 const pNotice=await notice('P1');
 assert.equal(await enqueue(pNotice),1);assert.equal(await enqueue(pNotice),0);
 assert.equal((await q('select registration_id from papa_device_notification_deliveries where notification_id=$1',[pNotice]))[0].registration_id,playerRegistration);
 const secondPlayer=await makeSession('player','web','player','space-001',null,'e');
 await register(secondPlayer,'web_push','https://push.example/player-second',web);
 assert.equal(await enqueue(await notice('P1')),2,'two installations of one account both receive the event');
 const adminNotice=await notice('__admin__');
 assert.equal(await enqueue(adminNotice),1);
 assert.equal((await q('select registration_id from papa_device_notification_deliveries where notification_id=$1',[adminNotice]))[0].registration_id,managerRegistration);
 assert.equal(await enqueue(await notice('__super__')),1);
 assert.equal(await enqueue(await notice('P2','papa')),0,'another Space cannot receive this room notification');
 assert.equal(await enqueue(await notice('P2','other-room')),1);
 await q('update papa_device_sessions set revoked_at=now() where id=$1',[manager]);
 assert.equal(await enqueue(await notice('__admin__')),0,'revoked device gets no new job');
 await q("update papa_space_memberships set status='suspended' where account_id=$1 and role='player'",[identities.player]);
 assert.equal(await enqueue(await notice('P1')),0,'suspended membership stops both player devices');
 await q('update papa_device_push_registrations set enabled=false where id=$1',[managerRegistration]);
 await db.exec('set role anon');
 await assert.rejects(q('select * from papa_device_push_registrations'),/permission denied/);
 await assert.rejects(enqueue(pNotice),/permission denied/);
 await db.exec('reset role');
});
