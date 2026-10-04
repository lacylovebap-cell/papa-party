import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let PGlite, pg_trgm;
try {
 ({PGlite}=await import('@electric-sql/pglite'));
 ({pg_trgm}=await import('@electric-sql/pglite/contrib/pg_trgm'));
} catch {}

// Real PostgreSQL plus pg_trgm in memory: no production connection is used.
test('indexed catalog and room search preserve literal results and use source indexes',
 {skip:!PGlite && 'Install the pinned @electric-sql/pglite dependency for isolated SQL QA'},async t=>{
 const db=new PGlite({extensions:{pg_trgm}});
 t.after(()=>db.close());
 const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const one=async(sql,args=[]) => (await rows(sql,args))[0];
 const rpc=async(name,args=[]) => (await one(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).result;
 const migration=async name => db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.papa_v2_entities(kind text not null,id text not null,data jsonb not null,primary key(kind,id));
  create index papa_room_kind on public.papa_v2_entities(kind,(data->>'streamer_id'));
  create table public.papa_v2_revision(id int primary key,revision bigint not null);
  create table public.papa_events(id bigint generated always as identity primary key,
   streamer_id text not null,entity_kind text not null,entity_id text not null,action text not null,
   actor_role text,actor_player_id text,created_at timestamptz not null default now(),
   effective_at text,before_data jsonb,after_data jsonb);
  insert into papa_v2_revision values(1,1);
  insert into papa_v2_entities values('meta','1',
   '{"streamers":[{"id":"papa","active":true},{"id":"other","active":true},{"id":"disabled","active":false}]}'::jsonb);`);
 await migration('202610010001_shared_catalog.sql');
 await migration('202610010007_catalog_language_filters.sql');
 await migration('202610010009_validated_room_lyrics.sql');

 // Keep the pre-migration implementation as the result oracle.
 for(const name of ['papa_catalog_search','papa_song_search_room']) {
  const def=(await one('select pg_get_functiondef(p.oid) as value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=\'public\' and p.proname=$1',[name])).value;
  await db.exec(def.replace('FUNCTION public.'+name+'(', 'FUNCTION public.'+name+'_before010('));
 }
 const family=(await one("insert into papa_catalog_families(title) values('測試歌曲') returning id")).id;
 const variant=async(title,extra={})=>(await one(`insert into papa_catalog_variants
  (family_id,title,artist,language_id,language_text,performer_type_id,performer_type_text,version_label,active)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
  [family,title,extra.artist??'歌手 Singer',extra.languageId??'mandarin',extra.language??'原始語言',
   extra.performerId??'female',extra.performer??'原始歌手',extra.version??'現場 Live',extra.active??true])).id;
 const song=async(id,extra={})=>{
  const data={songId:id,streamer_id:'papa',title:'本地歌名 '+id,artist:'本地歌手',cat:'本地語言',
   artistType:'本地類型',tags:['甜歌','分類'],murmur:'公開碎念',lyrics:'legacysecret '+id,
   privateNotes:'excludedprivate'+id,_order:7,...extra};
  await rows('insert into papa_v2_entities values(\'songs\',$1,$2)',[id,data]);
  return data;
 };
 const link=async(id,vid)=>rows(`insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash)
  select data->>'streamer_id',id,$2,papa_catalog_source_hash(data) from papa_v2_entities where kind='songs' and id=$1`,[id,vid]);
 const shared=await variant('共同旋律%_\\橋', {artist:'A Singer',version:'Live 特別版'});
 await rows("insert into papa_catalog_lyric_revisions values($1,1,'共用星河秘密 sharedneedle',false,'president',now()),($1,2,'共用夜晚旋律 currentneedle 中文長詞搜尋 50%_\\end',true,'president',now())",[shared]);
 for(const id of ['shared','own','copy','stale','inactive','missing-body','null-copy'])await song(id);
 for(const id of ['shared','own','copy','stale','null-copy'])await link(id,shared);
 await rows(`insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body)
  values('papa','own',$1,'own','ownneedle 私人自訂歌詞'),('papa','copy',$1,'copy','copyneedle 我的歌詞副本'),
   ('papa','shared',$1,'shared',null),('papa','null-copy',$1,'copy',null)`,[shared]);
 await rows("insert into papa_catalog_private_notes values('papa','shared','excludedsecretnote',now())");
 await rows("update papa_v2_entities set data=jsonb_set(data,'{title}','\"變更本地歌名\"') where id='stale' and kind='songs'");
 const inactive=await variant('inactivevariantneedle',{active:false});
 await link('inactive',inactive);
 await rows("insert into papa_catalog_lyric_revisions(variant_id,revision,body,actor_id) values($1,1,'inactivebodyneedle','president')",[inactive]);
 const noBody=await variant('沒有共用歌詞 emptyshared');
 await link('missing-body',noBody);
 const inactiveFamily=(await one("insert into papa_catalog_families(title,active) values('停用歌曲群',false) returning id")).id;
 const inactiveFamilyVariant=(await one("insert into papa_catalog_variants(family_id,title,artist) values($1,'inactivefamilyneedle','歌手') returning id",[inactiveFamily])).id;
 await song('inactive-family');await link('inactive-family',inactiveFamilyVariant);
 await rows("insert into papa_catalog_lyric_revisions(variant_id,revision,body,actor_id) values($1,1,'inactivefamilybodyneedle','president')",[inactiveFamilyVariant]);
 await song('other-room',{streamer_id:'other',lyrics:'otherroomneedle currentneedle'});await link('other-room',shared);
 await song('legacy',{title:'Literal 100%_\\path',artist:'Singer Artist',lyrics:'中文長詞搜尋 搜尋 夜晚 lyricneedle 50%_\\end',_order:1});
 await song('null-fields',{title:null,artist:null,cat:null,artistType:null,murmur:null,tags:[],lyrics:null,_order:'bad'});
 await song('special-order',{lyrics:'lyricneedle',_order:'999999999'});
 await variant('Literal 100%_\\path',{artist:'Singer Artist',version:'Studio'});
 await variant('Field Boundary',{artist:'Artist Ending',version:'Live Show',languageId:null,language:'手工語言',performerId:null,performer:'手工類型'});
 await rows("update papa_catalog_languages set name='國語 新模板 languageupdated' where id='mandarin'");
 await rows("update papa_catalog_performer_types set name='女歌手 performerupdated' where id='female'");
 // 2,000 rows per large source prove plans on a realistically sized catalog.
 await rows(`insert into papa_v2_entities(kind,id,data)
  select 'songs','fixture-'||i,jsonb_build_object('songId','fixture-'||i,'streamer_id','papa',
   'title','測試歌曲 '||i,'artist','Artist '||i,'cat','國語','artistType','女歌手','tags',jsonb_build_array('分類'),
   'lyrics',case when i=1234 then 'planlegacyneedle 中文索引驗證' else repeat('ordinary filler lyric ',8)||i end,'_order',i)
  from generate_series(1,2000) i`);
 await rows(`insert into papa_catalog_variants(family_id,title,artist,language_text,performer_type_text,version_label)
  select $1,case when i=1234 then 'planvariantneedle 中文索引驗證' else 'Fixture Title '||i end,
   'Artist '||i,'fixture language','fixture performer','Version '||i from generate_series(1,2000) i`,[family]);
 await rows(`insert into papa_catalog_lyric_selections(streamer_id,song_id,mode,body)
  select 'papa','fixture-'||i,case when i%2=0 then 'copy' else 'own' end,
   case when i=1234 then 'planownneedle 中文自訂索引' else repeat('ordinary owned lyrics ',8)||i end
  from generate_series(1,2000) i`);
 await rows(`insert into papa_catalog_lyric_revisions(variant_id,revision,body,actor_id)
  select id,1,case when title like 'planvariantneedle%' then 'plansharedneedle 中文共用索引' else repeat('ordinary shared lyrics ',8)||title end,
   'president' from papa_catalog_variants where family_id=$1 and language_text='fixture language'`,[family]);
 await rows(`insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash)
  select 'papa',e.id,v.id,papa_catalog_source_hash(e.data)
  from papa_v2_entities e join papa_catalog_variants v on v.artist='Artist '||replace(e.id,'fixture-','') and v.language_text='fixture language'
  where e.kind='songs' and e.id like 'fixture-%'`);
 await db.exec('analyze papa_v2_entities; analyze papa_catalog_variants; analyze papa_catalog_lyric_selections; analyze papa_catalog_lyric_revisions;');
 const sourceBefore=await rows("select id,data from papa_v2_entities where kind='songs' order by id");
 const revisionBefore=await rows('select * from papa_v2_revision');
 const lyricBefore=await rows('select * from papa_catalog_lyric_revisions order by variant_id,revision');
 await migration('202610010010_indexed_catalog_search.sql');
 await db.exec('analyze papa_v2_entities; analyze papa_catalog_variants; analyze papa_catalog_lyric_selections; analyze papa_catalog_lyric_revisions;');

 await t.test('additive migration leaves original songs, bodies and revision untouched',async()=>{
  assert.deepEqual(await rows("select id,data from papa_v2_entities where kind='songs' order by id"),sourceBefore);
  assert.deepEqual(await rows('select * from papa_v2_revision'),revisionBefore);
  assert.deepEqual(await rows('select * from papa_catalog_lyric_revisions order by variant_id,revision'),lyricBefore);
 });
 await t.test('catalog phrase, CJK, template, literal wildcard and pagination results match before010',async()=>{
  for(const q of ['', '   ', '共同', '中文索引驗證', '旋律%_\\橋', '100%_\\path', '%', '_', '\\',
   'Singer', 'Singer live', 'boundary artist', 'show 手工語言', 'languageupdated', 'performerupdated',
   '中文', '中', '  Live 特別版  ', 'Live　特別版', 'doesnotexistneedle']) {
   for(const [limit,offset] of [[1,0],[50,0],[7,3],[1,10000]]) {
    const args=[q,limit,offset,'papa'];
    assert.deepEqual(await rpc('papa_catalog_search',args),await rpc('papa_catalog_search_before010',args),`catalog ${JSON.stringify(args)}`);
   }
  }
 });
 await t.test('room search preserves all-word matching, tags, language, effective lyrics and room scope',async()=>{
  const cases=[[''],['共同旋律%_\\橋'],['currentneedle'],['sharedneedle'],['ownneedle'],['copyneedle'],
   ['legacysecret'],['inactivebodyneedle'],['inactivefamilybodyneedle'],['emptyshared'],['lyricneedle'],
   ['中文长词'],['中文長詞搜尋'],['中文'],['中'],['搜尋 夜晚'],['搜尋　夜晚'],['搜尋\t夜晚'],
   ['100%_\\path'],['50%_\\end'],['%'],['_'],['\\'],['otherroomneedle'],['excludedsecretnote'],
   ['excludedprivate'],['languageupdated'],['performerupdated'],['公開碎念'],['分類'],[''],
   ['currentneedle',['甜歌']],['currentneedle',['missingtag']],['',['甜歌','missingtag']],
   ['currentneedle',[],'國語 新模板 languageupdated'],['currentneedle',[],'本地語言'],
   ['planownneedle'],['plansharedneedle'],['planlegacyneedle'],['Artist 1234'],['doesnotexistneedle']];
  for(const [q,tags=[],language=null] of cases)for(const [limit,offset] of [[50,0],[1,1]]) {
   const args=['papa',q,tags,limit,offset,language];
   assert.deepEqual(await rpc('papa_song_search_room',args),await rpc('papa_song_search_room_before010',args),`room ${JSON.stringify(args)}`);
  }
  for(const [limit,offset] of [[1,0],[50,50],[1,10000]]) {
   const args=['papa','',[],limit,offset,null];
   assert.deepEqual(await rpc('papa_song_search_room',args),await rpc('papa_song_search_room_before010',args),`pagination ${JSON.stringify(args)}`);
  }
  assert.equal((await rpc('papa_song_search_room',['papa','currentneedle',[],50,0])).total,1);
  assert.equal((await rpc('papa_song_search_room',['other','currentneedle',[],50,0])).total,1);
  assert.equal((await rpc('papa_song_search_room',['papa','excludedsecretnote',[],50,0])).total,0);
  assert.equal((await rpc('papa_song_search_room',['papa','excludedprivate',[],50,0])).total,0);
  assert(!JSON.stringify(await rpc('papa_catalog_search',['',50,0,'papa'])).includes('lyrics'));
 });
 await t.test('source substring predicates choose GIN index paths on 2,000-row fixtures',async()=>{
  const cases=[
   ["select id from papa_v2_entities where kind='songs' and papa_song_search_source(data) like papa_catalog_search_pattern('planlegacyneedle') escape E'\\\\'",'papa_song_search_source_trgm'],
   ["select id from papa_catalog_variants where active and lower(title||' '||artist||' '||version_label||' '||language_text||' '||performer_type_text) like papa_catalog_search_pattern('planvar') escape E'\\\\'",'papa_catalog_variant_search_trgm'],
   ["select song_id from papa_catalog_lyric_selections where streamer_id='papa' and mode in ('copy','own') and lower(body) like papa_catalog_search_pattern('planown') escape E'\\\\'",'papa_catalog_own_lyric_search_trgm'],
   ["select variant_id from papa_catalog_lyric_revisions where active and lower(body) like papa_catalog_search_pattern('planshare') escape E'\\\\'",'papa_catalog_shared_lyric_search_trgm'],
   ["select id from papa_catalog_variants where active and lower(title||' '||artist||' '||version_label||' '||language_text||' '||performer_type_text) like papa_catalog_search_pattern('中文索引驗證') escape E'\\\\'",'papa_catalog_variant_search_trgm'],
  ];
  for(const [sql,index] of cases) {
   const plan=(await one('explain (analyze,buffers,format json) '+sql))['QUERY PLAN'];
   assert.match(JSON.stringify(plan),new RegExp(index),JSON.stringify(plan));
   assert.equal(plan[0].Plan['Actual Rows'],1);
  }
  assert.equal((await one("select papa_catalog_search_anchor('中文索引驗證') as value")).value,'中文索引驗證');
  assert.equal((await one("select papa_catalog_search_anchor('中文') as value")).value,null);
 });
 await t.test('edits automatically update indexes and stale links fall back exactly',async()=>{
  await rows("update papa_catalog_lyric_selections set body='newownneedle 新自訂歌詞' where song_id='own'");
  await rows("update papa_catalog_lyric_revisions set active=false where variant_id=$1 and active",[shared]);
  await rows("insert into papa_catalog_lyric_revisions(variant_id,revision,body,actor_id) values($1,3,'newsharedneedle 新共用歌詞','president')",[shared]);
  await rows("update papa_catalog_variants set title='newtitleneedle 新名稱' where id=$1",[shared]);
  await rows("update papa_v2_entities set data=jsonb_set(data,'{lyrics}','\"newlegacyneedle 新舊版歌詞\"') where id='legacy' and kind='songs'");
  await rows("update papa_catalog_languages set name='newlanguageneedle 新語言' where id='mandarin'");
  for(const q of ['ownneedle','newownneedle','currentneedle','newsharedneedle','共同旋律','newtitleneedle','newlegacyneedle','newlanguageneedle']) {
   const args=['papa',q,[],50,0,null];
   assert.deepEqual(await rpc('papa_song_search_room',args),await rpc('papa_song_search_room_before010',args),q);
   assert.deepEqual(await rpc('papa_catalog_search',[q,50,0,'papa']),await rpc('papa_catalog_search_before010',[q,50,0,'papa']),q);
  }
 });
 await t.test('bounds and service-only permissions remain enforced',async()=>{
  for(const args of [['',51,0,null],['',1,-1,null],['x'.repeat(121),1,0,null]])await assert.rejects(rpc('papa_catalog_search',args),/CATALOG_PAGE_LIMIT/);
  for(const args of [['disabled','',[],1,0,null],['missing','',[],1,0,null]])await assert.rejects(rpc('papa_song_search_room',args),/CATALOG_ROOM_MISSING/);
  await assert.rejects(rpc('papa_song_search_room',['papa','',[],51,0,null]),/CATALOG_SEARCH_LIMIT/);
  for(const role of ['anon','authenticated']) {
   await db.exec('set role '+role);
   await assert.rejects(rpc('papa_catalog_search'),/permission denied/);
   await assert.rejects(rpc('papa_song_search_room',['papa']),/permission denied/);
   await assert.rejects(rpc('papa_song_search_source',[{privateNotes:'secret'}]),/permission denied/);
   await db.exec('reset role');
  }
 });
});
