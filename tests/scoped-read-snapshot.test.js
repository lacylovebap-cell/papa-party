import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('ordinary snapshot returns shared directory and only the requested room without lyric bodies',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_revision(id int primary key,revision bigint not null);
 insert into papa_v2_revision values(1,7);
 insert into papa_v2_entities values
  ('meta','1','{"streamers":[{"id":"papa","slug":"papa"},{"id":"michelle","slug":"michelle"}]}'),
  ('settings','1','{"legacy":true}'),('players','P1','{"name":"共用玩家"}'),
  ('songs','S1','{"streamer_id":"papa","title":"A","lyrics":"secret-A","privateNote":"key"}'),
  ('songs','S2','{"streamer_id":"michelle","title":"B","lyrics":"secret-B"}'),
  ('queue','Q1','{"streamer_id":"papa","songId":"S1"}'),
  ('queue','Q2','{"streamer_id":"michelle","songId":"S2"}');`);
 const before=await q('select kind,id,data from papa_v2_entities order by kind,id');
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610070009_scoped_read_snapshot.sql','utf8'));
 const snapshot=async room=>(await q('select papa_v2_scoped_read_snapshot($1) result',[room]))[0].result;
 const papa=await snapshot('papa');
 assert.equal(papa.revision,7);
 assert.deepEqual(papa.rows.map(row=>row.id).sort(),['1','1','P1','Q1','S1']);
 assert.equal(papa.rows.find(row=>row.id==='S1').data.lyrics,undefined);
 assert.equal(papa.rows.find(row=>row.id==='S1').data.privateNote,undefined);
 const michelle=await snapshot('michelle');
 assert.deepEqual(michelle.rows.map(row=>row.id).sort(),['1','1','P1','Q2','S2']);
 await assert.rejects(snapshot('unknown'),/UNKNOWN_STREAMER_SPACE/);
 assert.deepEqual(await q('select kind,id,data from papa_v2_entities order by kind,id'),before,
  'the read migration does not rewrite business JSON');
 await db.exec('set role anon');
 await assert.rejects(snapshot('papa'),/permission denied/);
 await db.exec('reset role');
});
