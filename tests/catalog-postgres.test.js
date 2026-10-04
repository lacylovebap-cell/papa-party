import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Isolated real PostgreSQL (WASM), never a network connection to production.
// Install the pinned QA dependency: npm install --no-save @electric-sql/pglite@0.5.8
let PGlite;
try { ({PGlite}=await import('@electric-sql/pglite')); } catch {}
test('shared catalog migration and transactions in isolated PostgreSQL', {skip:!PGlite && 'Install @electric-sql/pglite@0.5.8 to run SQL integration QA'}, async t=>{
 const db=new PGlite();
 t.after(()=>db.close());
 const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const one=async(sql,args=[]) => (await q(sql,args))[0];
 const rpc=async(name,args=[]) => (await one(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).result;
 const song=(id,room,title,extra={})=>({songId:id,streamer_id:room,title,artist:'歌手',cat:'國語',artistType:'女歌手',tags:['甜歌'],lyrics:'舊版歌詞 secret_'+id,creditCost:2,privateNotes:'private_'+id,_order:1,...extra});
 const original=[song('s1','papa','Ａ Song！'),song('s2','papa','另一首'),song('s3','michelle','Ａ Song！'),song('s4','papa','Ａ Song！'),song('s5','papa','待改歌曲')];
 await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.papa_v2_entities(kind text not null,id text not null,data jsonb not null,primary key(kind,id));
  create table public.papa_v2_revision(id int primary key,revision bigint not null);
  create table public.papa_events(id bigint generated always as identity primary key,
   streamer_id text not null,entity_kind text not null,entity_id text not null,action text not null,
   actor_role text,actor_player_id text,created_at timestamptz not null default now(),
   effective_at text,before_data jsonb,after_data jsonb);
  insert into papa_v2_revision values(1,7);`);
 await q('insert into papa_v2_entities values($1,$2,$3)', ['meta','1',{streamers:[{id:'papa',active:true},{id:'michelle',active:true},{id:'disabled',active:false}]}]);
 for (const s of original) await q('insert into papa_v2_entities values($1,$2,$3)',['songs',s.songId,s]);
 const migration=await readFile(new URL('../supabase/migrations/202610010001_shared_catalog.sql',import.meta.url),'utf8');
 await db.exec(migration);
 await db.exec(await readFile(new URL('../supabase/migrations/202610010004_safe_event_reads.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202610010005_catalog_governance.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202610010007_catalog_language_filters.sql',import.meta.url),'utf8'));
 const candidate=async id=>await one('select * from papa_catalog_candidates where song_id=$1',[id]);
 const review=async(decision,ids,variant=null,family=null,expected=null)=>{
  const hashes=expected??Object.fromEntries((await q('select id,source_hash from papa_catalog_candidates where id=any($1)',[ids])).map(c=>[c.id,c.source_hash]));
  return rpc('papa_catalog_review',[decision,ids,variant,family,'','president',hashes]);
 };
 const versions=async ids=>Object.fromEntries((await q('select id,updated_at from papa_catalog_variants where id=any($1)',[ids])).map(v=>[v.id,v.updated_at]));
 const govern=async(action,ids,{candidates=[],family=null,metadata={},expected=null,sources=null}={})=>rpc('papa_catalog_governance',[
  action,ids,candidates,family,metadata,expected??await versions(ids),sources??Object.fromEntries((await q('select id,source_hash from papa_catalog_candidates where id=any($1)',[candidates])).map(c=>[c.id,c.source_hash])),'president']);
 let v1,v2;
 await t.test('migration preserves every original song and creates no automatic approvals',async()=>{
  assert.deepEqual((await q("select data from papa_v2_entities where kind='songs' order by id")).map(x=>x.data),original);
  assert.equal((await one('select count(*)::int as n from papa_catalog_candidates')).n,0);
  assert.equal((await one('select count(*)::int as n from papa_catalog_song_links')).n,0);
  assert.equal((await one("select papa_catalog_normalize('Ａ Song！') as value")).value,'asong');
 });
 await t.test('all new tables use RLS and direct browser access/function execution is denied',async()=>{
  assert((await q("select relrowsecurity from pg_class where relname like 'papa_catalog_%' and relkind='r'")).every(x=>x.relrowsecurity));
  for(const role of ['anon','authenticated']) {
   await db.exec('set role '+role);
   await assert.rejects(q('select * from papa_catalog_lyric_revisions'),/permission denied/);
   await assert.rejects(rpc('papa_catalog_search'),/permission denied/);
   await assert.rejects(rpc('papa_event_page',['papa',0,false]),/permission denied/);
   await assert.rejects(rpc('papa_catalog_governance',['update_variant',[]]),/permission denied/);
   await assert.rejects(rpc('papa_catalog_language_filter',['papa']),/permission denied/);
   await assert.rejects(rpc('papa_catalog_language_filter_save',['papa','auto',[],'forged']),/permission denied/);
   await assert.rejects(rpc('papa_song_search_room',['papa','',[],30,0,'英語']),/permission denied/);
   await db.exec('reset role');
  }
 });
 await t.test('bounded resumable scanning is idempotent and only indexes candidates',async()=>{
  const a=await rpc('papa_catalog_reconcile_songs',['',2]); assert.equal(a.processed,2);assert.equal(a.nextCursor,'s2');
  const b=await rpc('papa_catalog_reconcile_songs',[a.nextCursor,2]);assert.equal(b.nextCursor,'s4');
  const c=await rpc('papa_catalog_reconcile_songs',[b.nextCursor,2]);assert.equal(c.nextCursor,null);
  await rpc('papa_catalog_reconcile_songs',['',100]);
  assert.equal((await one('select count(*)::int as n from papa_catalog_candidates')).n,5);
  assert.equal((await one('select count(*)::int as n from papa_catalog_song_links')).n,0);
 });
 await t.test('batch approve creates independent common entries for unrelated songs',async()=>{
  const a=await candidate('s1'),b=await candidate('s2');
  await review('approve_new',[a.id,b.id]);
  const links=await q("select song_id,variant_id from papa_catalog_song_links where song_id in ('s1','s2') order by song_id");
  [v1,v2]=links.map(x=>x.variant_id);assert.notEqual(v1,v2);
 });
 await t.test('multiple original songs can link to one version without altering originals',async()=>{
  await review('link_variant',[(await candidate('s3')).id,(await candidate('s4')).id],v1);
  assert.equal((await one('select count(*)::int as n from papa_catalog_song_links where variant_id=$1',[v1])).n,3);
  assert.deepEqual((await q("select data from papa_v2_entities where kind='songs' order by id")).map(x=>x.data),original);
 });
 await t.test('shared lyric revisions, custom copies and private notes are independent',async()=>{
  assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s1'])).body,original[0].lyrics);
  await rpc('papa_catalog_save_lyric',[v1,'共同秘密歌詞一','president',true]);
  await rpc('papa_catalog_lyric_choice',['papa','s1','copy','我的副本','私密備註','streamer:papa']);
  await rpc('papa_catalog_lyric_choice',['michelle','s3','shared',null,null,'streamer:michelle']);
  await rpc('papa_catalog_save_lyric',[v1,'共同秘密歌詞二','president',true]);
  assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s1'])).body,'我的副本');
  assert.equal((await rpc('papa_catalog_get_lyrics',[null,'michelle','s3'])).body,'共同秘密歌詞二');
  assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s1'])).privateNote,'私密備註');
  assert.equal((await rpc('papa_catalog_lyric_history',[v1,20,0])).rows.length,2);
 });
 await t.test('unlink retains copies and materializes shared lyrics without touching original data',async()=>{
  await review('unlink',[(await candidate('s1')).id,(await candidate('s3')).id]);
  assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s1'])).body,'我的副本');
  assert.equal((await rpc('papa_catalog_get_lyrics',[null,'michelle','s3'])).body,'共同秘密歌詞二');
  assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s1'])).privateNote,'私密備註');
  assert.deepEqual((await q("select data from papa_v2_entities where kind='songs' order by id")).map(x=>x.data),original);
 });
 await t.test('review failure rolls back earlier candidate changes and audit inserts',async()=>{
  const before=await one('select count(*)::int as n from papa_catalog_audit');
  await assert.rejects(review('approve_new',[(await candidate('s5')).id,'00000000-0000-4000-8000-000000000000']),/CATALOG_CANDIDATE_MISSING/);
  assert.equal((await candidate('s5')).status,'pending');
  assert.deepEqual(await one('select count(*)::int as n from papa_catalog_audit'),before);
 });
 await t.test('stale UI selection is rejected after the original metadata changes',async()=>{
  const old=await candidate('s5');
  await q("update papa_v2_entities set data=jsonb_set(data,'{title}','\"已修改\"') where kind='songs' and id='s5'");
  assert.notEqual((await candidate('s5')).source_hash,old.source_hash);
  await assert.rejects(review('approve_new',[old.id],null,null,{[old.id]:old.source_hash}),/CATALOG_SELECTION_STALE/);
  assert.equal((await candidate('s5')).status,'pending');
  await assert.rejects(rpc('papa_catalog_review',['approve_new',[old.id],null,null,'','president']),/CATALOG_REVIEW_INVALID/);
 });
 await t.test('templates deactivate without deleting used IDs and keep stable identity',async()=>{
  await rpc('papa_catalog_template_change',['language','update','mandarin','華語',5,true,'president']);
  await rpc('papa_catalog_template_change',['language','deactivate','mandarin',null,null,null,'president']);
  const lang=await one("select * from papa_catalog_languages where id='mandarin'");
  assert.equal(lang.name,'華語');assert.equal(lang.active,false);
  assert.equal((await one('select language_id from papa_catalog_variants where id=$1',[v1])).language_id,'mandarin');
  const projected=await rpc('papa_catalog_song_metadata',['papa']);
  assert.equal(projected.find(x=>x.songId==='s4').cat,'華語');
  assert(!JSON.stringify(projected).includes('lyrics'));
  assert.equal((await one("select data->>'cat' as value from papa_v2_entities where id='s4' and kind='songs'")).value,'國語');
 });
 await t.test('batch adding is atomic and idempotent and advances revision only when added',async()=>{
  const before=(await one('select revision from papa_v2_revision where id=1')).revision;
  const result=await rpc('papa_catalog_batch_add',['michelle',[v1,v2],'copy','streamer:michelle']);
  assert.equal(result.added,2);assert.equal(result.revision,Number(before)+1);
  const again=await rpc('papa_catalog_batch_add',['michelle',[v1,v2],'copy','streamer:michelle']);
  assert.equal(again.added,0);assert.equal(again.revision,result.revision);
  await assert.rejects(rpc('papa_catalog_batch_add',['papa',[v1,'00000000-0000-4000-8000-000000000000'],'shared','streamer:papa']),/CATALOG_VARIANT_MISSING/);
 });
 await t.test('search is room scoped, paginated and returns IDs or metadata with no lyrics/notes',async()=>{
  const result=await rpc('papa_song_search_room',['papa','我的副本',['甜歌'],1,0]);
  assert.deepEqual(result.songIds,['s1']);assert.equal(result.total,1);
  const privateResult=await rpc('papa_song_search_room',['papa','私密備註',[],30,0]);assert.equal(privateResult.total,0);
  const other=await rpc('papa_song_search_room',['michelle','我的副本',[],30,0]);assert.equal(other.total,0);
  await assert.rejects(rpc('papa_song_search_room',['disabled','',[],30,0]),/CATALOG_ROOM_MISSING/);
  const catalog=await rpc('papa_catalog_search',['',1,0,'papa']);assert.equal(catalog.rows.length,1);assert.equal(catalog.hasMore,true);
  assert(!JSON.stringify(catalog).includes('共同秘密'));
  const history=await rpc('papa_catalog_review_list',['history',50,0]);
  assert(!JSON.stringify(history).includes('私密備註'));assert(!JSON.stringify(history).includes('共同秘密'));
 });
 await t.test('common metadata edits update projection/search and reject stale submissions without modifying originals',async()=>{
  const originalsBefore=await q("select id,data from papa_v2_entities where kind='songs' order by id");
  const stale=await versions([v1]);
  const revBefore=Number((await one('select revision from papa_v2_revision where id=1')).revision);
  const result=await govern('update_variant',[v1],{metadata:{title:'共用新名稱',languageId:'english',versionLabel:'錄音室版'}});
  assert.equal(result.revision,revBefore+1);
  assert.deepEqual(await q("select id,data from papa_v2_entities where kind='songs' order by id"),originalsBefore);
  assert.equal((await rpc('papa_catalog_song_metadata',['papa'])).find(s=>s.songId==='s4').title,'共用新名稱');
  assert((await rpc('papa_song_search_room',['papa','共用新名稱',[],30,0])).songIds.includes('s4'));
  assert.equal((await rpc('papa_catalog_search',['共用新名稱',30,0,'papa'])).rows[0].language,'英語');
  const auditBefore=(await one('select count(*)::int as n from papa_catalog_audit')).n;
  await assert.rejects(govern('update_variant',[v1],{metadata:{title:'stale'},expected:stale}),/CATALOG_SELECTION_STALE/);
  assert.equal((await one('select count(*)::int as n from papa_catalog_audit')).n,auditBefore);
  assert.equal(Number((await one('select revision from papa_v2_revision where id=1')).revision),result.revision);
 });
 await t.test('family merge changes only group association and keeps variant, lyric, and song identities',async()=>{
  const target=(await one('select family_id from papa_catalog_variants where id=$1',[v1])).family_id;
  const linksBefore=await q('select * from papa_catalog_song_links order by streamer_id,song_id');
  const lyricsBefore=await q('select * from papa_catalog_lyric_revisions order by variant_id,revision');
  await govern('merge_family',[v2],{family:target});
  assert.equal((await one('select family_id from papa_catalog_variants where id=$1',[v2])).family_id,target);
  assert.deepEqual(await q('select * from papa_catalog_song_links order by streamer_id,song_id'),linksBefore);
  assert.deepEqual(await q('select * from papa_catalog_lyric_revisions order by variant_id,revision'),lyricsBefore);
  const revision=Number((await one('select revision from papa_v2_revision where id=1')).revision);
  assert.equal((await govern('merge_family',[v2],{family:target})).count,0);
  assert.equal(Number((await one('select revision from papa_v2_revision where id=1')).revision),revision);
 });
 await t.test('split validates the entire batch and preserves private copies, notes, source IDs and old shared history',async()=>{
  const roomCopy=await one("select song_id from papa_catalog_song_links where streamer_id='michelle' and variant_id=$1",[v1]);
  const candidateIds=[(await candidate('s4')).id,(await candidate(roomCopy.song_id)).id];
  await rpc('papa_catalog_lyric_choice',['papa','s4','shared',null,'拆分私人註記','streamer:papa']);
  await rpc('papa_catalog_lyric_choice',['michelle',roomCopy.song_id,'copy','保留私人歌詞副本','另一份私註','streamer:michelle']);
  const sourceSongs=await q("select id,data from papa_v2_entities where kind='songs' order by id");
  const variantsBefore=(await one('select count(*)::int as n from papa_catalog_variants')).n;
  await assert.rejects(govern('split_variant',[v1],{candidates:[candidateIds[0],'00000000-0000-4000-8000-000000000000']}),/CATALOG_CANDIDATE_MISSING/);
  assert.equal((await one('select count(*)::int as n from papa_catalog_variants')).n,variantsBefore);
  const oldHistory=await q('select * from papa_catalog_lyric_revisions where variant_id=$1 order by revision',[v1]);
  const result=await govern('split_variant',[v1],{candidates:candidateIds,metadata:{versionLabel:'重新確認版本'}});
  assert.notEqual(result.variantId,v1);assert.equal(result.count,2);
  assert.deepEqual(await q("select id,data from papa_v2_entities where kind='songs' order by id"),sourceSongs);
  assert.deepEqual(await q('select * from papa_catalog_lyric_revisions where variant_id=$1 order by revision',[v1]),oldHistory);
  const local=await rpc('papa_catalog_get_lyrics',[null,'papa','s4']);
  assert.equal(local.body,'共同秘密歌詞二');assert.equal(local.privateNote,'拆分私人註記');assert.equal(local.variantId,result.variantId);
  const copied=await rpc('papa_catalog_get_lyrics',[null,'michelle',roomCopy.song_id]);
  assert.equal(copied.body,'保留私人歌詞副本');assert.equal(copied.privateNote,'另一份私註');
  await rpc('papa_catalog_save_lyric',[v1,'原版本後來更新','president',true]);
  assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s4'])).body,'共同秘密歌詞二');
  assert(!JSON.stringify(await rpc('papa_catalog_review_list',['history',50,0])).includes('保留私人歌詞副本'));
 });
 await t.test('event reads redact nested lyrics and private notes, page at 50, and retain stored history',async()=>{
  const sensitive={title:'可見歌名',lyrics:'legacy lyric secret',nested:{privateNotes:'private text',items:[{lyricsBody:'large body',value:'safe'}]}};
  for(let i=0;i<52;i++) await q(`insert into papa_events(streamer_id,entity_kind,entity_id,action,after_data)
   values('papa','songs',$1,'edit',$2)`,[String(i),sensitive]);
  await q(`insert into papa_events(streamer_id,entity_kind,entity_id,action,after_data)
   values('michelle','songs','other','edit',$1),('papa','players','player','edit',$1)`,[sensitive]);
  const page=await rpc('papa_event_page',['papa',0,false]);
  assert.equal(page.rows.length,50);assert.equal(page.hasMore,true);
  assert(page.rows.every(row=>row.streamer_id==='papa' && row.entity_kind==='songs'));
  assert(!JSON.stringify(page).includes('legacy lyric'));assert(!JSON.stringify(page).includes('private text'));
  assert(!JSON.stringify(page).includes('large body'));assert(JSON.stringify(page).includes('safe'));
  const second=await rpc('papa_event_page',['papa',1,false]);assert.equal(second.rows.length,2);assert.equal(second.hasMore,false);
  assert.equal((await rpc('papa_event_page',['papa',1,true])).rows.length,3);
  assert.deepEqual((await one("select after_data from papa_events where entity_id='0'")).after_data,sensitive);
  await assert.rejects(rpc('papa_event_page',['papa',201,false]),/EVENT_PAGE_INVALID/);
 });
 await t.test('automatic language filters use effective room metadata and retain unmatched legacy names without private fields',async()=>{
  await q('insert into papa_v2_entities values($1,$2,$3)',['songs','legacy-language',song('legacy-language','papa','舊語言歌曲',{cat:'自訂舊語言'})]);
  const papa=await rpc('papa_catalog_language_filter',['papa']);
  assert.equal(papa.mode,'auto');assert.deepEqual(papa.languageIds,[]);
  assert(papa.languages.some(l=>l.name==='英語'&&l.id==='english'));
  assert(papa.languages.some(l=>l.name==='自訂舊語言'&&l.id===null));
  assert(papa.languages.some(l=>l.name==='國語'));
  assert(!JSON.stringify(papa).includes('lyrics'));assert(!JSON.stringify(papa).includes('secret_'));
  const michelle=await rpc('papa_catalog_language_filter',['michelle']);
  assert(!michelle.languages.some(l=>l.name==='自訂舊語言'));
  await db.exec('set role service_role');
  try {assert.equal((await rpc('papa_catalog_language_filter',['papa'])).mode,'auto');}
  finally {await db.exec('reset role');}
  await assert.rejects(rpc('papa_catalog_language_filter',['unknown-room']),/CATALOG_ROOM_MISSING/);
 });
 await t.test('custom language filters are room scoped, ordered, idempotent and timestamped without altering songs',async()=>{
  const originalSongs=await q("select id,data from papa_v2_entities where kind='songs' order by id");
  const before=Number((await one('select revision from papa_v2_revision where id=1')).revision);
  const selected=await rpc('papa_catalog_language_filter_save',['papa','custom',['japanese','english'],'streamer:papa']);
  assert.equal(selected.changed,true);assert.equal(selected.revision,before+1);
  assert.deepEqual(selected.languageIds,['english','japanese']);
  assert.deepEqual(selected.languages.map(l=>l.name),['英語','日語']);
  const timestamp=(await one("select updated_at from papa_catalog_language_filters where streamer_id='papa'")).updated_at;
  const unchanged=await rpc('papa_catalog_language_filter_save',['papa','custom',['english','japanese'],'streamer:papa']);
  assert.equal(unchanged.changed,false);assert.equal(unchanged.revision,selected.revision);
  assert.deepEqual((await one("select updated_at from papa_catalog_language_filters where streamer_id='papa'")).updated_at,timestamp);
  assert.equal((await rpc('papa_catalog_language_filter',['michelle'])).mode,'auto');
  assert.deepEqual(await q("select id,data from papa_v2_entities where kind='songs' order by id"),originalSongs);
  const audit=(await one("select details from papa_catalog_audit where action='language_filter' order by id desc limit 1")).details;
  assert.equal(audit.streamerId,'papa');assert.deepEqual(audit.after.languageIds,['english','japanese']);
  await assert.rejects(rpc('papa_catalog_language_filter_save',['papa','custom',['english','unknown'],'streamer:papa']),/CATALOG_TEMPLATE_MISSING/);
  await assert.rejects(rpc('papa_catalog_language_filter_save',['papa','custom',['english','english'],'streamer:papa']),/CATALOG_LANGUAGE_FILTER_INVALID/);
  assert.deepEqual((await rpc('papa_catalog_language_filter',['papa'])).languageIds,['english','japanese']);
  assert.equal(Number((await one('select revision from papa_v2_revision where id=1')).revision),selected.revision);
  await rpc('papa_catalog_template_change',['language','deactivate','japanese',null,null,null,'president']);
  assert.equal((await rpc('papa_catalog_language_filter_save',['papa','custom',['english','japanese'],'streamer:papa'])).changed,false);
  await assert.rejects(rpc('papa_catalog_language_filter_save',['michelle','custom',['japanese'],'streamer:michelle']),/CATALOG_TEMPLATE_MISSING/);
  const auto=await rpc('papa_catalog_language_filter_save',['papa','auto',[],'streamer:papa']);
  assert.equal(auto.mode,'auto');assert.deepEqual(auto.languageIds,[]);assert.equal(auto.changed,true);
  assert(new Date((await one("select updated_at from papa_catalog_language_filters where streamer_id='papa'")).updated_at)>new Date(timestamp));
 });
 await t.test('language search applies before pagination and uses shared renamed categories with no cross-room matches',async()=>{
  const expected=await rpc('papa_song_search_room',['papa','',[],30,0,'英語']);
  assert(expected.songIds.includes('s4'));
  const page=await rpc('papa_song_search_room',['papa','',[],1,0,'英語']);
  assert.equal(page.total,expected.total);assert.equal(page.songIds.length,1);assert.deepEqual(page.songIds,expected.songIds.slice(0,1));
  if(expected.total>1) assert.equal(page.hasMore,true);
  assert.equal((await rpc('papa_song_search_room',['papa','',[],30,0,'國語'])).songIds.includes('s4'),false);
  assert.deepEqual((await rpc('papa_song_search_room',['papa','',[],30,0,'自訂舊語言'])).songIds,['legacy-language']);
  assert.equal((await rpc('papa_song_search_room',['michelle','',[],30,0,'自訂舊語言'])).total,0);
  const renamed=await rpc('papa_song_search_room',['papa','',[],30,0,'華語']);assert(renamed.songIds.includes('s2'));
  await assert.rejects(rpc('papa_song_search_room',['papa','',[],30,0,'x'.repeat(121)]),/CATALOG_SEARCH_LIMIT/);
 });
 await t.test('stale common links do not contribute shared lyrics or category matches to room search',async()=>{
  assert((await rpc('papa_song_search_room',['papa','共同秘密歌詞二',[],30,0])).songIds.includes('s4'));
  await q("update papa_v2_entities set data=jsonb_set(data,'{title}','\"主播修改後需重審\"') where kind='songs' and id='s4'");
  assert.equal((await candidate('s4')).status,'pending');
  assert(!(await rpc('papa_song_search_room',['papa','共同秘密歌詞二',[],30,0])).songIds.includes('s4'));
  assert(!(await rpc('papa_song_search_room',['papa','',[],30,0,'英語'])).songIds.includes('s4'));
  assert((await rpc('papa_song_search_room',['papa','secret_s4',[],30,0,'國語'])).songIds.includes('s4'));
 });
});
