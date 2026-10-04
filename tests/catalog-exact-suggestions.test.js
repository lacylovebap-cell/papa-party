import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// All SQL runs in an in-memory PostgreSQL instance, never in production.
let PGlite;
try { ({PGlite}=await import('@electric-sql/pglite')); } catch {}

test('review suggestions use exact normalized title and artist on a bounded page',
 {skip:!PGlite && 'Install @electric-sql/pglite@0.5.8 for isolated SQL QA'}, async t=>{
  const db=new PGlite();
  t.after(()=>db.close());
  const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const one=async(sql,args=[]) => (await rows(sql,args))[0];
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.papa_v2_entities(kind text not null,id text not null,data jsonb not null,primary key(kind,id));
    create table public.papa_v2_revision(id int primary key,revision bigint not null);
    create table public.papa_events(id bigint generated always as identity primary key,
      streamer_id text not null,entity_kind text not null,entity_id text not null,action text not null,
      actor_role text,actor_player_id text,created_at timestamptz not null default now(),
      effective_at text,before_data jsonb,after_data jsonb);
    insert into papa_v2_revision values(1,1);`);
  await db.exec(await readFile(new URL('../supabase/migrations/202610010001_shared_catalog.sql',import.meta.url),'utf8'));

  const family=(await one("insert into papa_catalog_families(title) values('台灣夜') returning id")).id;
  const matches=[];
  for(let i=0;i<4;i++)await rows(
    'insert into papa_catalog_variants(id,family_id,title,artist,version_label) values($1,$2,$3,$4,$5)',
    [matches[i]=`10000000-0000-4000-8000-00000000000${i}`,family,'台灣夜','Singer','版本'+i]);
  await rows('insert into papa_catalog_variants(family_id,title,artist) values($1,$2,$3)',
    [family,'台灣夜','Other Artist']);
  await rows('insert into papa_catalog_variants(family_id,title,artist) values($1,$2,$3)',
    [family,'台灣夜晚','Singer']);
  await rows('insert into papa_catalog_variants(family_id,title,artist,active) values($1,$2,$3,false)',
    [family,'台灣夜','Singer']);
  const inactiveFamily=(await one("insert into papa_catalog_families(title,active) values('已停用',false) returning id")).id;
  await rows('insert into papa_catalog_variants(id,family_id,title,artist) values($1,$2,$3,$4)',
    ['00000000-0000-4000-8000-000000000001',inactiveFamily,'台灣夜','Singer']);
  // Reusing a common version in several rooms must not repeat suggestions.
  await rows(`insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash)
    values('papa','already-linked',$1,repeat('b',32)),('michelle','also-linked',$1,repeat('b',32))`,[matches[0]]);
  await rows(`insert into papa_catalog_lyric_revisions(variant_id,revision,body,actor_id)
    values($1,1,'shared lyric secret','president')`,[matches[0]]);
  await rows("insert into papa_catalog_private_notes(streamer_id,song_id,body) values('papa','target','private note secret')");
  await rows(`insert into papa_catalog_candidates
    (streamer_id,song_id,source_hash,title,artist,title_key,artist_key,updated_at)
    values('papa','target',repeat('a',32),'臺灣 夜','Singer','臺灣夜','singer','2026-10-01')`);
  await rows(`insert into papa_catalog_candidates
    (streamer_id,song_id,source_hash,title,artist,title_key,artist_key,updated_at)
    select 'papa','other-'||i,repeat('a',32),'其他歌曲'||i,'Singer','其他歌曲'||i,
      'singer','2026-09-30'::timestamptz from generate_series(1,54) i`);

  await db.exec(await readFile(new URL('../supabase/migrations/202610010008_catalog_exact_suggestions.sql',import.meta.url),'utf8'));
  assert.equal((await one("select papa_catalog_normalize('臺灣 夜') as value")).value,'台灣夜');
  assert.equal((await one("select title_key from papa_catalog_candidates where song_id='target'")).title_key,'台灣夜');
  const index=(await one("select indexdef from pg_indexes where indexname='papa_catalog_variants_exact_suggestion'")).indexdef;
  assert.match(index,/papa_catalog_normalize\(title\)/);
  assert.match(index,/papa_catalog_normalize\(artist\)/);

  const first=(await one("select papa_catalog_review_list('pending',50,0) as result")).result;
  assert.equal(first.total,55);
  assert.equal(first.rows.length,50);
  assert.equal(first.hasMore,true);
  assert.equal(first.rows[0].songId,'target');
  assert.equal(first.rows[0].suggestedVariants.length,3);
  assert(first.rows[0].suggestedVariants.every(x=>x.title==='台灣夜'&&x.artist==='Singer'));
  assert.equal(new Set(first.rows[0].suggestedVariants.map(x=>x.id)).size,3);
  assert.deepEqual(first.rows[0].suggestedVariants.map(x=>x.id),matches.slice(0,3));
  assert.deepEqual(Object.keys(first.rows[0].suggestedVariants[0]).sort(),['id','title','artist','versionLabel'].sort());
  assert(first.rows.slice(1).every(x=>x.suggestedVariants.length===0));
  assert.equal(first.rows[0].sourceHash,'a'.repeat(32));
  assert(!JSON.stringify(first).includes('shared lyric secret'));
  assert(!JSON.stringify(first).includes('private note secret'));
  const second=(await one("select papa_catalog_review_list('pending',50,50) as result")).result;
  assert.equal(second.rows.length,5);
  assert.equal(second.hasMore,false);
  assert(second.rows.every(x=>x.suggestedVariants.length===0));

  // Blank artists and merely similar titles stay manual, as do reviewed rows.
  await rows(`insert into papa_catalog_candidates
    (streamer_id,song_id,source_hash,title,artist,title_key,artist_key,status,updated_at)
    values('papa','blank-artist',repeat('c',32),'台灣夜','','台灣夜','','pending','2026-10-02'),
      ('papa','similar-title',repeat('c',32),'台灣','Singer','台灣','singer','pending','2026-10-02'),
      ('papa','reviewed',repeat('c',32),'台灣夜','Singer','台灣夜','singer','approved','2026-10-02')`);
  const manual=(await one("select papa_catalog_review_list('pending',2,0) as result")).result;
  assert(manual.rows.every(x=>x.suggestedVariants.length===0));
  const approved=(await one("select papa_catalog_review_list('approved',20,0) as result")).result;
  assert.equal(approved.rows.length,1);assert.deepEqual(approved.rows[0].suggestedVariants,[]);
  const empty=(await one("select papa_catalog_review_list('pending',50,10000) as result")).result;
  assert.deepEqual(empty.rows,[]);assert.equal(empty.hasMore,false);
  for(const args of [['unknown',1,0],['pending',0,0],['pending',51,0],['pending',1,-1],['pending',1,10001],
    [null,1,0],['pending',null,0],['pending',1,null]])
    await assert.rejects(one('select papa_catalog_review_list($1,$2,$3) as result',args),/CATALOG_PAGE_LIMIT/);

  await rows("insert into papa_catalog_audit(actor_id,action) values('president','test')");
  const history=(await one("select papa_catalog_review_list('history',20,0) as result")).result;
  assert.deepEqual(Object.keys(history.rows[0]).sort(),
    ['action','actorId','candidateIds','createdAt','details','familyId','id','variantId'].sort());
  for(const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    try {await assert.rejects(one("select papa_catalog_review_list('pending',1,0) as result"),/permission denied/);}
    finally {await db.exec('reset role');}
  }
  await db.exec('set role service_role');
  try {assert.equal((await one("select papa_catalog_review_list('pending',1,0) as result")).result.rows.length,1);}
  finally {await db.exec('reset role');}
 });
