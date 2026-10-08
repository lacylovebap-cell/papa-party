import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8');

test('Space 001 bridge preserves legacy entities and rejects cross-Space writes',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text not null check(kind in ('players','songs','ledger','queue','crowns','cards','wishes','settings','meta')),
 id text not null,data jsonb not null,primary key(kind,id));`);
 await q('insert into papa_v2_entities values($1,$2,$3)',[
  'meta','1',{streamers:[{id:'papa'},{id:'michelle'}]}]);
 await q('insert into papa_v2_entities values($1,$2,$3)',[
  'players','p1',{playerId:'p1',name:'玩家'}]);
 await q('insert into papa_v2_entities values($1,$2,$3)',[
  'songs','s1',{streamer_id:'papa',songId:'s1',title:'原歌'}]);
 await q('insert into papa_v2_entities values($1,$2,$3)',[
  'queue','q1',{streamer_id:'michelle',id:'q1',playerId:'p1'}]);
 const before=await q('select kind,id,data from papa_v2_entities order by kind,id');
 await db.exec(migration);
 const after=await q('select kind,id,data from papa_v2_entities order by kind,id');
 assert.deepEqual(after,before,'original data and identifiers stay byte-equivalent at the JSON level');
 assert.deepEqual(await q('select kind,id,space_id from papa_v2_entities order by kind,id'),[
  {kind:'meta',id:'1',space_id:null},
  {kind:'players',id:'p1',space_id:null},
  {kind:'queue',id:'q1',space_id:'space-001'},
  {kind:'songs',id:'s1',space_id:'space-001'}]);
 await q('update papa_v2_entities set data=$1 where kind=$2 and id=$3',[
  {streamer_id:'papa',songId:'s1',title:'改名'},'songs','s1']);
 assert.equal((await q("select space_id from papa_v2_entities where id='s1'"))[0].space_id,'space-001');
 await q('update papa_v2_entities set data=$1 where kind=$2',[
  {streamers:[{id:'papa'},{id:'michelle'},{id:'new-room'}]},'meta']);
 await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[
  'songs','s2',{streamer_id:'new-room',songId:'s2'}]);
 assert.equal((await q("select space_id from papa_v2_entities where id='s2'"))[0].space_id,'space-001');
 await q("insert into papa_spaces(id,slug,display_name) values('space-002','other','Other')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('other-room','space-002')");
 await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[
  'songs','s3',{streamer_id:'other-room',songId:'s3'}]);
 assert.equal((await q("select space_id from papa_v2_entities where id='s3'"))[0].space_id,'space-002');
 await assert.rejects(q('insert into papa_v2_entities(kind,id,data,space_id) values($1,$2,$3,$4)',[
  'songs','bad',{streamer_id:'other-room'},'space-001']),/SPACE_SCOPE_MISMATCH/);
 await assert.rejects(q('update papa_v2_entities set data=$1 where id=$2',[
  {streamer_id:'other-room',songId:'s1'},'s1']),/SPACE_SCOPE_MISMATCH|SPACE_MOVE_REQUIRES_EXPLICIT_MIGRATION/);
 await assert.rejects(q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[
  'songs','unknown',{streamer_id:'unmapped'}]),/UNKNOWN_STREAMER_SPACE/);
 const account=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[account,'p1']);
 await q('insert into papa_space_memberships(account_id,space_id,role) values($1,$2,$3)',[
  account,'space-001','player']);
 await assert.rejects(q('insert into papa_space_memberships(account_id,space_id,role) values($1,$2,$3)',[
  account,'space-001','player']),/duplicate key/);
 await assert.rejects(q('insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,$3,$4)',[
  account,'space-001','streamer_admin','other-room']),/foreign key/);
 await q('insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,$3,$4)',[
  account,'space-002','streamer_admin','other-room']);
 const other=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q('insert into papa_space_memberships(account_id,space_id,role) values($1,$2,$3)',[
  other,'space-001','player']);
 assert.deepEqual((await q('select papa_account_space_list($1) spaces',[other]))[0].spaces.map(s=>s.id),['space-001']);
 assert.equal((await q('select papa_account_space_by_slug($1,$2) space',[other,'other']))[0].space,null);
 assert.deepEqual((await q('select papa_account_space_list($1) spaces',[account]))[0].spaces.map(s=>s.id).sort(),['space-001','space-002']);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[other]);
 assert.deepEqual((await q('select papa_account_space_list($1) spaces',[other]))[0].spaces.map(s=>s.id).sort(),['space-001','space-002']);
 await db.exec('set role anon');
 await assert.rejects(q('select * from papa_space_memberships'),/permission denied/);
 await assert.rejects(q('select * from papa_accounts'),/permission denied/);
 await assert.rejects(q('select papa_account_space_list($1)',[other]),/permission denied/);
 await db.exec('reset role');
});

test('Space foundation aborts rather than misassigning unscoped legacy business rows',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 insert into papa_v2_entities values('songs','orphan','{"songId":"orphan"}');`);
 await assert.rejects(db.exec(migration),/SPACE_BACKFILL_INCOMPLETE/);
 await db.exec('rollback');
 assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_name='papa_spaces'")).rows[0].n,0,
  'the transactional migration leaves the old schema intact on preflight failure');
});
