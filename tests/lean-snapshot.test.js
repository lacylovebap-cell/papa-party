import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('ordinary snapshots strip song lyrics before transfer and leave stored data intact',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('create role anon;create role authenticated;create role service_role;create table papa_v2_revision(id int,revision bigint);insert into papa_v2_revision values(1,12);create table papa_v2_entities(kind text,id text,data jsonb);');
 const song={songId:'s1',streamer_id:'papa',title:'歌名',artist:'歌手',lyrics:'完整歌詞'.repeat(10000),lyricNotes:'私註',privateNotes:'私密內容',creditCost:2,tags:['原標籤']};
 const queue={id:'q1',streamer_id:'papa',songId:'s1',note:'演唱備註',status:'waiting'};
 await db.query('insert into papa_v2_entities values($1,$2,$3),($4,$5,$6)',['songs','s1',song,'queue','q1',queue]);
 await db.exec(await readFile(new URL('../supabase/migrations/202610010006_lean_read_snapshot.sql',import.meta.url),'utf8'));
 const [{snapshot}]=(await db.query('select papa_v2_read_snapshot() as snapshot')).rows;
 assert.equal(snapshot.revision,12);const clean=snapshot.rows.find(x=>x.kind==='songs').data;
 assert.equal(clean.creditCost,2);assert.deepEqual(clean.tags,song.tags);
 for(const key of ['lyrics','lyricNotes','privateNotes'])assert.equal(key in clean,false);
 assert.deepEqual(snapshot.rows.find(x=>x.kind==='queue').data,queue);
 assert.deepEqual((await db.query("select data from papa_v2_entities where kind='songs'")).rows[0].data,song);
 assert(Buffer.byteLength(JSON.stringify(snapshot))<Buffer.byteLength(JSON.stringify(song))/100);
 await db.exec('set role anon');await assert.rejects(db.query('select papa_v2_read_snapshot()'),/permission denied/);await db.exec('reset role');
});
