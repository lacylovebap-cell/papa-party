import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Isolated PostgreSQL only. No request or connection to the production service.
let PGlite;
try {({PGlite}=await import('@electric-sql/pglite'));} catch {}

test('initial review suggests bounded live song peers before any common entry exists',
 {skip:!PGlite && 'Install @electric-sql/pglite@0.5.8 for isolated SQL QA'},async t=>{
  const db=new PGlite();t.after(()=>db.close());
  const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const one=async(sql,args=[])=>(await rows(sql,args))[0];
  const rpc=async(name,args=[])=>(await one(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).result;
  const song=(songId,streamer_id,title='台灣夜',artist='Singer',cat='國語',version='')=>({
    songId,streamer_id,title,artist,cat,version,artistType:'女歌手',lyrics:'private lyrics '+songId,
    privateNotes:'private notes '+songId,tags:['private tags'],creditCost:99,privateField:'private extra'});
  const originals=[song('target','papa','臺灣 夜'),song('same','michelle','台灣夜',' SINGER！','華語'),
    song('version','papa','台灣 夜','Singer','英語','Acoustic'),song('same-title','michelle','台灣夜','Other Singer'),
    song('unrelated','papa','台灣夜晚'),song('stale','papa'),song('removed','papa'),song('rejected','papa'),
    song('deleted','papa'),song('moved-room','papa'),song('blank-title','papa','！？'),song('blank-title-peer','papa','·'),
    song('blank-artist','papa','無歌手題目',''),song('blank-artist-peer','michelle','無歌手題目',''),
    song('version-only','papa','版本分辨'),song('version-only-peer','michelle','版本分辨','Singer','國語','Live'),
    song('language-only','papa','語言分辨'),song('language-only-peer','michelle','語言分辨','Singer','英語')];
  for(let i=0;i<54;i++)originals.push(song('unrelated-'+i,'papa','其他歌名'+i));
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.papa_v2_entities(kind text not null,id text not null,data jsonb not null,primary key(kind,id));
    create table public.papa_v2_revision(id int primary key,revision bigint not null);
    create table public.papa_events(id bigint generated always as identity primary key,
      streamer_id text not null,entity_kind text not null,entity_id text not null,action text not null,
      actor_role text,actor_player_id text,created_at timestamptz not null default now(),
      effective_at text,before_data jsonb,after_data jsonb);
    insert into papa_v2_revision values(1,7);`);
  await rows('insert into papa_v2_entities values($1,$2,$3)',['meta','1',{streamers:[
    {id:'papa',display_name:'怕怕',privateSetting:'room private secret'},
    {id:'michelle',display_name:'<img src=x onerror=alert(1)>',privateSetting:'other room private secret'}]}]);
  for(const source of originals)await rows('insert into papa_v2_entities values($1,$2,$3)',['songs',source.songId,source]);
  for(const migration of ['202610010001_shared_catalog.sql','202610010008_catalog_exact_suggestions.sql'])
    await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
  let cursor='';let processed=0;
  do {
    const scan=await rpc('papa_catalog_reconcile_songs',[cursor,17]);
    processed+=scan.processed;cursor=scan.nextCursor;
  } while(cursor!==null);
  assert.equal(processed,originals.length);
  assert.deepEqual((await rows("select data from papa_v2_entities where kind='songs' order by id")).map(x=>x.data),
    [...originals].sort((a,b)=>a.songId.localeCompare(b.songId)));
  assert.equal((await one('select count(*)::int as n from papa_catalog_families')).n,0);
  assert.equal((await one('select count(*)::int as n from papa_catalog_variants')).n,0);
  await rows("update papa_catalog_candidates set source_hash=repeat('0',32) where song_id='stale'");
  await rows("update papa_catalog_candidates set status='removed' where song_id='removed'");
  await rows("update papa_catalog_candidates set status='rejected' where song_id='rejected'");
  await rows("delete from papa_v2_entities where kind='songs' and id='deleted'");
  await rows("update papa_catalog_candidates set streamer_id='michelle' where song_id='moved-room'");
  await rows("update papa_catalog_candidates set updated_at='2030-01-01' where song_id='target'");
  const before={songs:await rows('select kind,id,data from papa_v2_entities order by kind,id'),
    candidates:await rows('select * from papa_catalog_candidates order by id'),
    revision:(await one('select revision from papa_v2_revision where id=1')).revision};
  const previous=await rpc('papa_catalog_review_list',['pending',1,0]);
  await db.exec(await readFile(new URL('../supabase/migrations/202610010011_catalog_peer_suggestions.sql',import.meta.url),'utf8'));
  const first=await rpc('papa_catalog_review_list',['pending',1,0]);
  assert.equal(first.rows[0].songId,'target');assert.equal(first.rows.length,1);assert.equal(first.hasMore,true);
  assert.equal(first.total,originals.length-2);
  assert.deepEqual(first.rows[0].suggestedVariants,previous.rows[0].suggestedVariants);
  assert.deepEqual(first.rows[0].suggestedVariants,[]);
  const peers=first.rows[0].suggestedCandidates;
  assert.equal(peers.length,3);assert.equal(new Set(peers.map(x=>x.id)).size,3);
  assert.deepEqual(Object.fromEntries(peers.map(x=>[x.songId,x.matchType])),{
    same:'possible_same',version:'possible_version','same-title':'same_title'});
  assert.deepEqual(Object.keys(peers[0]).sort(),[
    'id','streamerId','songId','title','artist','language','performerType','versionLabel','matchType'].sort());
  assert(peers.some(x=>x.streamerId==='michelle'));
  assert(!JSON.stringify(first).includes('private'));
  assert(!JSON.stringify(first).includes('<img'));
  assert.deepEqual(await rows('select kind,id,data from papa_v2_entities order by kind,id'),before.songs);
  assert.deepEqual(await rows('select * from papa_catalog_candidates order by id'),before.candidates);
  assert.equal((await one('select revision from papa_v2_revision where id=1')).revision,before.revision);
  assert.equal((await one('select count(*)::int as n from papa_catalog_song_links')).n,0);
  assert.equal((await one('select count(*)::int as n from papa_catalog_audit')).n,0);

  const all=[];
  for(let offset=0;offset<first.total;offset+=50) {
    const page=await rpc('papa_catalog_review_list',['pending',50,offset]);
    assert(page.rows.length<=50);assert(page.rows.every(x=>x.suggestedCandidates.length<=3));all.push(...page.rows);
  }
  for(const id of ['stale','deleted','moved-room','blank-title','blank-title-peer','unrelated'])
    assert.deepEqual(all.find(x=>x.songId===id).suggestedCandidates,[]);
  assert(all.every(x=>x.suggestedCandidates.every(peer=>peer.id!==x.id &&
    !['removed','rejected','stale','deleted','moved-room'].includes(peer.songId))));
  assert.equal(all.find(x=>x.songId==='blank-artist').suggestedCandidates[0].matchType,'same_title');
  assert.deepEqual(all.find(x=>x.songId==='blank-artist').suggestedCandidates.map(x=>x.songId),['blank-artist-peer']);
  assert.equal(all.find(x=>x.songId==='version-only').suggestedCandidates[0].matchType,'possible_version');
  assert.equal(all.find(x=>x.songId==='language-only').suggestedCandidates[0].matchType,'possible_version');
  const index=(await one("select indexdef from pg_indexes where indexname='papa_catalog_candidate_title_peers'")).indexdef;
  assert.match(index,/\(title_key, id\)/);assert.match(index,/pending/);assert.match(index,/approved/);

  await rows("update papa_catalog_candidates set status='approved' where song_id='same'");
  const withApproved=await rpc('papa_catalog_review_list',['pending',1,0]);
  assert(withApproved.rows[0].suggestedCandidates.some(x=>x.songId==='same'));
  const approved=await rpc('papa_catalog_review_list',['approved',20,0]);
  assert.deepEqual(approved.rows[0].suggestedCandidates,[]);
  await rows('insert into papa_v2_entities values($1,$2,$3)',['songs','fourth-peer',song('fourth-peer','papa')]);
  await rows("update papa_catalog_candidates set id='ffffffff-ffff-4fff-8fff-ffffffffffff' where song_id='fourth-peer'");
  const capped=(await rpc('papa_catalog_review_list',['pending',1,0])).rows[0].suggestedCandidates;
  assert.equal(capped.length,3);assert.deepEqual(capped,withApproved.rows[0].suggestedCandidates);
  // The former common-version hints and the audit envelope remain unchanged.
  const family=(await one("insert into papa_catalog_families(title) values('台灣夜') returning id")).id;
  const variant=(await one('insert into papa_catalog_variants(family_id,title,artist) values($1,$2,$3) returning id',
    [family,'台灣夜','Singer'])).id;
  assert.deepEqual((await rpc('papa_catalog_review_list',['pending',1,0])).rows[0].suggestedVariants,
    [{id:variant,title:'台灣夜',artist:'Singer',versionLabel:''}]);
  await rows("insert into papa_catalog_audit(actor_id,action) values('president','test')");
  const history=await rpc('papa_catalog_review_list',['history',20,0]);
  assert.deepEqual(Object.keys(history.rows[0]).sort(),[
    'action','actorId','candidateIds','createdAt','details','familyId','id','variantId'].sort());
  for(const args of [['pending',51,0],['pending',1,-1],['pending',1,10001],['bad',1,0]])
    await assert.rejects(rpc('papa_catalog_review_list',args),/CATALOG_PAGE_LIMIT/);
  for(const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    try {await assert.rejects(rpc('papa_catalog_review_list',['pending',1,0]),/permission denied/);}
    finally {await db.exec('reset role');}
  }
  await db.exec('set role service_role');
  try {assert.equal((await rpc('papa_catalog_review_list',['pending',1,0])).rows[0].suggestedCandidates.length,3);}
  finally {await db.exec('reset role');}
 });
