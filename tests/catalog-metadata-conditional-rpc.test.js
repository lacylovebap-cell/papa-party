import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=fs.readFileSync(new URL('../supabase/migrations/202610130004_conditional_catalog_metadata.sql',import.meta.url),'utf8');
test('conditional metadata RPC preserves the existing projection, checks exact scope, and transfers only changes',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_spaces(id text primary key,status text);
 create table papa_space_streamers(streamer_id text primary key,space_id text);
 create table fixture_metadata(room_id text primary key,rows jsonb);
 insert into papa_spaces values('space-001','active'),('space-002','active'),('inactive','disabled');
 insert into papa_space_streamers values('room-a','space-001'),('room-b','space-002'),('inactive','inactive');
 insert into fixture_metadata values('room-a','[{"songId":"s1","title":"歌曲","hasLyrics":true,"catalogStatus":"pending"}]'),
 ('room-b','[{"songId":"s1","title":"歌曲","hasLyrics":true,"catalogStatus":"pending"}]');
 create function papa_catalog_song_metadata_in_space(room_id text) returns jsonb
 language sql stable as $$select rows from fixture_metadata f where f.room_id=$1$$;`);
 const original=(await db.query("select pg_get_functiondef('papa_catalog_song_metadata_in_space(text)'::regprocedure) definition")).rows;
 const data=(await db.query('select * from fixture_metadata order by room_id')).rows;
 await db.exec(migration);
 assert.deepEqual((await db.query('select * from fixture_metadata order by room_id')).rows,data);
 assert.deepEqual((await db.query("select pg_get_functiondef('papa_catalog_song_metadata_in_space(text)'::regprocedure) definition")).rows,original);
 const read=async(room,signature=null)=>(await db.query('select papa_catalog_song_metadata_conditional($1,$2) result',[room,signature])).rows[0].result;
 const first=await read('room-a');assert.equal(first.unchanged,false);assert.deepEqual(first.rows,data[0].rows);
 assert.match(first.signature,/^[a-f0-9]{64}$/);
 const unchanged=await read('room-a',first.signature);
 assert.equal(unchanged.unchanged,true);assert.equal('rows' in unchanged,false);
 assert.ok(JSON.stringify(unchanged).length<JSON.stringify(first).length);
 assert.notEqual((await read('room-b')).signature,first.signature,'identical rows in different scopes cannot share a signature');
 for(const update of [{title:'changed'},{hasLyrics:false},{catalogStatus:'linked'}]){
  await db.query("update fixture_metadata set rows=jsonb_build_array(rows->0||$1::jsonb) where room_id='room-a'",[JSON.stringify(update)]);
  const next=await read('room-a',first.signature);assert.equal(next.unchanged,false);assert.notEqual(next.signature,first.signature);
 }
 for(const room of ['missing','inactive',null])await assert.rejects(read(room),/CATALOG_METADATA_SCOPE_INVALID/);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(read('room-a'),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');assert.equal((await read('room-a')).spaceId,'space-001');await db.exec('reset role');
});
