import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

test('complete deployment batch applies atomically without changing original business data',async t=>{
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 await db.exec('create role anon;create role authenticated;create role service_role;create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,100);create table papa_notice_config(id text primary key,value jsonb);create table papa_events(id bigint primary key,streamer_id text,entity_kind text,entity_id text,action text,actor_role text,actor_player_id text,created_at timestamptz,effective_at text,before_data jsonb,after_data jsonb);');
 const rows=[{kind:'meta',id:'1',data:{streamers:[{id:'papa',active:true}]}},{kind:'songs',id:'s1',data:{songId:'s1',streamer_id:'papa',title:'原歌本',artist:'歌手',lyrics:'受保護的舊歌詞',creditCost:2}},{kind:'ledger',id:'l1',data:{playerId:'P1',count:20}},{kind:'queue',id:'q1',data:{songId:'s1',status:'waiting'}}];
 for(const row of rows)await db.query('insert into papa_v2_entities values($1,$2,$3)',[row.kind,row.id,row.data]);
 execFileSync(process.execPath,['build-schema.mjs'],{cwd:new URL('../',import.meta.url)});
 await db.exec(fs.readFileSync(new URL('../deploy-schema.txt',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select kind,id,data from papa_v2_entities order by kind,id')).rows,rows.toSorted((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id)));
 assert.equal((await db.query('select revision from papa_v2_revision')).rows[0].revision,100);
 assert.equal((await db.query('select count(*)::int as n from papa_catalog_candidates')).rows[0].n,0);
 const lean=(await db.query('select papa_v2_read_snapshot() as value')).rows[0].value;
 assert.equal('lyrics' in lean.rows.find(r=>r.kind==='songs').data,false);
 assert.equal((await db.query("select papa_catalog_reconcile_songs('',100) as value")).rows[0].value.processed,1);
 assert.equal((await db.query("select papa_catalog_review_list('pending',20,0) as value")).rows[0].value.rows.length,1);
 await db.exec('set role anon');
 await assert.rejects(db.query("select papa_song_search_room('papa','舊歌詞')"),/permission denied/);
 await db.exec('reset role');
});
