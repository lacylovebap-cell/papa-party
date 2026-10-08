import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=fs.readFileSync('supabase/migrations/202610070007_notification_space_scope.sql','utf8');
test('notification Space backfill preserves existing content and guards future writes',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_notifications(id uuid primary key default gen_random_uuid(),streamer_id text not null,
  recipient text not null,body text,read_at timestamptz,created_at timestamptz not null default now());
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa"}]}');
 insert into papa_notifications(streamer_id,recipient,body) values('papa','P1','一則舊通知');`);
 const before=await q('select id,streamer_id,recipient,body,read_at from papa_notifications');
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await db.exec(migration);
 assert.deepEqual(await q('select id,streamer_id,recipient,body,read_at from papa_notifications'),before);
 assert.equal((await q('select space_id from papa_notifications'))[0].space_id,'space-001');
 await q("insert into papa_spaces(id,slug,display_name) values('space-002','other','Other')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('other','space-002')");
 const second=(await q("insert into papa_notifications(streamer_id,recipient,body) values('other','P2','另一則') returning space_id"))[0];
 assert.equal(second.space_id,'space-002');
 await assert.rejects(q("insert into papa_notifications(streamer_id,recipient,space_id) values('other','P2','space-001')"),/NOTIFICATION_SPACE_MISMATCH/);
 await assert.rejects(q("update papa_notifications set streamer_id='other' where id=$1",[before[0].id]),/NOTIFICATION_SPACE_MISMATCH|NOTIFICATION_MOVE_REQUIRES_EXPLICIT_MIGRATION/);
});

test('an unmapped old notification aborts the entire migration',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_notifications(id uuid primary key default gen_random_uuid(),streamer_id text not null,
  recipient text not null,created_at timestamptz not null default now());
 insert into papa_notifications(streamer_id,recipient) values('unmapped','P1');`);
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await assert.rejects(db.exec(migration),/NOTIFICATION_SPACE_BACKFILL_INCOMPLETE/);
 await db.exec('rollback');
 assert.equal((await q("select count(*)::int n from information_schema.columns where table_name='papa_notifications' and column_name='space_id'"))[0].n,0);
});
