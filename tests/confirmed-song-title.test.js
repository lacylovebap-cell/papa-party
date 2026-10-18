import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const correction=fs.readFileSync('ops/correct-confirmed-song-title-20261018.sql','utf8');
const songId='e0f30150-321e-4aca-8797-38abf93f7661',room='53d61a59-0eb3-4f05-9fff-c3d1cd034e4d',variant='d1f09fcb-b1bf-4555-be74-63dc8c6d041e';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,23);
 create table papa_v2_entities(kind text,id text,data jsonb,space_id text,primary key(kind,id));
 create table papa_catalog_families(id text primary key,active boolean);insert into papa_catalog_families values('F',true);
 create table papa_catalog_variants(id text primary key,family_id text,title text,artist text,active boolean);
 create table papa_catalog_song_links(streamer_id text,song_id text,variant_id text,source_hash text);
 create table papa_catalog_candidates(streamer_id text,song_id text,source_hash text,source_revision bigint,title text,artist text,language_text text,performer_type_text text,version_label text,title_key text,artist_key text,status text default 'pending',reviewed_by text,reviewed_at timestamptz,updated_at timestamptz,unique(streamer_id,song_id));
 create table papa_events(id bigint generated always as identity primary key,streamer_id text,entity_kind text,entity_id text,action text,actor_role text,actor_player_id text,effective_at text,before_data jsonb,after_data jsonb);
 create function papa_audit_redact(v jsonb) returns jsonb language sql as $$select v$$;`);
 const catalog=fs.readFileSync('supabase/migrations/202610010001_shared_catalog.sql','utf8');
 for(const name of ['papa_catalog_source_hash','papa_catalog_normalize','papa_catalog_index_song'])await db.exec(catalog.match(new RegExp('create function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'))[0]);
 const audit=fs.readFileSync('supabase/migrations/202609240001_release_a.sql','utf8');await db.exec(audit.match(/create or replace function public\.papa_capture_event\([\s\S]*?\$\$;/)[0]);
 const raw={songId,streamer_id:room,title:'聽見',artist:'孫燕姿',lyrics:'fixture lyrics',tags:['保留標籤'],creditCost:1};
 await q("insert into papa_v2_entities values('songs',$1,$2,'space-001'),('queue','Q1',$3,'space-001'),('ledger','L1','{\"amount\":3}','space-001')",[songId,raw,{songId,title:'聽見',status:'completed',playerId:'P1'}]);
 await q("insert into papa_catalog_variants values($1,'F','遇見','孫燕姿',true)",[variant]);
 await q('insert into papa_catalog_song_links values($1,$2,$3,papa_catalog_source_hash($4))',[room,songId,variant,raw]);
 await q("insert into papa_catalog_candidates(streamer_id,song_id,source_hash,title,artist,status,reviewed_by,reviewed_at) values($1,$2,papa_catalog_source_hash($3),'聽見','孫燕姿','approved','reviewer','2026-10-18T00:00:00Z')",[room,songId,raw]);
 await db.exec(`create trigger song_index after update on papa_v2_entities for each row when(new.kind='songs') execute function papa_catalog_index_song();
 create trigger song_audit after update on papa_v2_entities for each row execute function papa_capture_event();`);
 const hash=(await q('select md5($1::jsonb::text) v',[raw]))[0].v,sql=correction.replace("'2e31b33d844f88238d42ea36f76bc674'",`'${hash}'`);
 return {db,q,raw,sql};
}
test('confirmed typo correction retains stable IDs, lyrics, tags, history and valid approved link; retry is a no-op',async t=>{
 const f=await fixture(t),others=await f.q("select * from papa_v2_entities where kind<>'songs'");await f.db.exec(f.sql);
 assert.deepEqual((await f.q("select data from papa_v2_entities where kind='songs'"))[0].data,{...f.raw,title:'遇見'});
 assert.deepEqual(await f.q("select * from papa_v2_entities where kind<>'songs'"),others);
 assert.deepEqual(await f.q("select l.variant_id,l.source_hash=papa_catalog_source_hash(e.data) valid,c.status,c.reviewed_by from papa_catalog_song_links l join papa_v2_entities e on e.id=l.song_id and e.kind='songs' join papa_catalog_candidates c using(streamer_id,song_id)"),[{variant_id:variant,valid:true,status:'approved',reviewed_by:'reviewer'}]);
 const events=await f.q('select * from papa_events');assert.equal(events.length,1);assert.equal(events[0].before_data.title,'聽見');assert.equal(events[0].after_data.title,'遇見');
 await f.db.exec(f.sql);assert.deepEqual(await f.q('select * from papa_events'),events);assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,24);
});
test('concurrent song edit or changed catalog link aborts correction without partial writes',async t=>{
 for(const change of ["update papa_v2_entities set data=data||'{\"creditCost\":2}' where kind='songs'","update papa_catalog_song_links set source_hash='changed'"]){
  const f=await fixture(t);await f.db.exec(change);const before=await f.q('select * from papa_v2_entities'),events=await f.q('select * from papa_events');
  await assert.rejects(f.db.exec(f.sql),/CONFIRMED_/);await f.db.exec('rollback');assert.deepEqual(await f.q('select * from papa_v2_entities'),before);assert.deepEqual(await f.q('select * from papa_events'),events);assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,23);
 }
});
