import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const newMigration='202610090011_song_visibility_search.sql',nativeSpace='space-visibility',nativeRoom='visibility-room';
const suffixes=['h-linked','v-pending','v-linked','v-own','h-pending','h-copy','v-stale-link','h-stale-pending',
 'v-inactive-variant','h-inactive-family','v-rejected','h-unlinked','v-plain'];
const linked=['h-linked','v-linked','v-own','h-copy'],pendingStatus=['v-pending','h-pending','v-stale-link','h-inactive-family'];

async function fixture(t){
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 await db.exec(migration('202609240001_release_a.sql'));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1)",[{streamers:[
  {id:'papa',slug:'papa',active:true},{id:'michelle',slug:'michelle',active:true},{id:'disabled',slug:'disabled',active:false}]}]);
 for(const file of ['202610010001_shared_catalog.sql','202610010007_catalog_language_filters.sql',
  '202610010009_validated_room_lyrics.sql','202610010010_indexed_catalog_search.sql','202610080002_catalog_hidden_search.sql',
  '202610070001_space_foundation.sql'])await db.exec(migration(file));
 await q("insert into papa_spaces(id,slug,display_name) values($1,'visibility','Visibility'),('space-visibility-foreign','visibility-foreign','Foreign')",[nativeSpace]);
 for(const [id,space] of [[nativeRoom,nativeSpace],['visibility-other',nativeSpace],['visibility-foreign','space-visibility-foreign']])
  await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,space]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [nativeRoom,'visibility-other','visibility-foreign'])meta.streamers.push({id,slug:id,active:true});
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const family=(await q("insert into papa_catalog_families(title) values('Shared Family') returning id"))[0].id;
 const inactiveFamily=(await q("insert into papa_catalog_families(title,active) values('Inactive Family',false) returning id"))[0].id;
 const variant=async(owner,title,active=true)=>(await q("insert into papa_catalog_variants(family_id,title,artist,language_id,performer_type_id,version_label,active) values($1,$2,'Shared Artist','mandarin','female','Live',$3) returning id",[owner,title,active]))[0].id;
 const shared=await variant(family,'SharedNeedle Canonical'),inactive=await variant(family,'InactiveVariantNeedle',false),inactiveOwner=await variant(inactiveFamily,'InactiveFamilyNeedle');
 await q("insert into papa_catalog_lyric_revisions(variant_id,revision,body,active,actor_id) values($1,1,'oldsharedneedle private inactive lyric',false,'president'),($1,2,'sharedlyricneedle 中文共用搜尋 private shared lyric',true,'president'),($2,1,'inactivevariantbodyneedle',true,'president'),($3,1,'inactivefamilybodyneedle',true,'president')",[shared,inactive,inactiveOwner]);
 const bodies={};
 for(const room of ['papa',nativeRoom]){
  for(const [index,suffix] of suffixes.entries()){
   const id=room+'-'+suffix,data={songId:id,streamer_id:room,title:'Original '+suffix,artist:'Local Artist',cat:'Local Language',artistType:'Local Performer',
    tags:['roomtag','sweet'],murmur:'publiccommentneedle',lyrics:'legacyneedle 中文搜尋 100%_\\path '+id,privateNotes:'excludedPrivateNeedle',
    lyricNotes:'excludedNoteNeedle',lyricHistory:['private history'],hidden:suffix.startsWith('h-'),_order:index};
   if(suffix==='v-own')data._order=2;
   if(suffix==='v-plain')delete data.hidden;
   bodies[id]=data;await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,data]);
   const link=linked.includes(suffix)||suffix==='v-stale-link'?shared:suffix==='v-inactive-variant'?inactive:suffix==='h-inactive-family'?inactiveOwner:null;
   if(link)await q('insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values($1,$2,$3,papa_catalog_source_hash($4))',
    [room,id,link,suffix==='v-stale-link'?{...data,title:'Old title'}:data]);
   const status=pendingStatus.includes(suffix)||suffix==='h-stale-pending'||suffix==='h-linked'?'pending':suffix==='v-rejected'?'rejected':suffix==='v-inactive-variant'?'approved':null;
   if(status)await q('insert into papa_catalog_candidates(streamer_id,song_id,source_hash,status,title) values($1,$2,papa_catalog_source_hash($3),$4,$5) on conflict(streamer_id,song_id) do update set source_hash=excluded.source_hash,status=excluded.status,title=excluded.title',
    [room,id,suffix==='h-stale-pending'?{...data,title:'Old pending title'}:data,status,data.title]);
   else await q('delete from papa_catalog_candidates where streamer_id=$1 and song_id=$2',[room,id]);
  }
  await q("insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body) values($1,$2,$3,'own','ownneedle private own lyric'),($1,$4,$3,'copy','copyneedle private copy lyric')",[room,room+'-v-own',shared,room+'-h-copy']);
  await q("insert into papa_catalog_private_notes(streamer_id,song_id,body) values($1,$2,'excludedCatalogNoteNeedle')",[room,room+'-v-linked']);
 }
 for(const room of ['michelle','visibility-other','visibility-foreign','disabled']){
  const id=room+'-foreign',data={songId:id,streamer_id:room,title:'ForeignOnlyNeedle',artist:'Artist',cat:'Local Language',tags:['roomtag'],hidden:true,lyrics:'foreignlyricneedle',_order:0};
  await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,data]);
  await q('insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values($1,$2,$3,papa_catalog_source_hash($4))',[room,id,shared,data]);
  await q("insert into papa_catalog_candidates(streamer_id,song_id,source_hash,status) values($1,$2,papa_catalog_source_hash($3),'pending') on conflict(streamer_id,song_id) do update set source_hash=excluded.source_hash,status=excluded.status",[room,id,data]);
 }
 const definition=(await q("select pg_get_functiondef('papa_song_search_room_v2(text,text,text[],integer,integer,text,boolean)'::regprocedure) definition"))[0].definition;
 await db.exec(definition.replace('FUNCTION public.papa_song_search_room_v2(','FUNCTION public.papa_song_search_room_before011('));
 const stable=async()=>{
  const result={};
  for(const [table,order] of [['papa_v2_entities','kind,id'],['papa_catalog_song_links','streamer_id,song_id'],['papa_catalog_candidates','streamer_id,song_id'],
   ['papa_catalog_families','id'],['papa_catalog_variants','id'],['papa_catalog_lyric_revisions','variant_id,revision'],
   ['papa_catalog_lyric_selections','streamer_id,song_id'],['papa_catalog_private_notes','streamer_id,song_id'],['papa_catalog_audit','id'],['papa_v2_revision','id'],['papa_events','id']])
   result[table]=await q('select to_jsonb(source) row from '+table+' source order by '+order);
  return result;
 };
 const before=await stable();await db.exec(migration(newMigration));assert.deepEqual(await stable(),before,'installing the query preserves every source, private body and accounting revision');
 const search=({space='space-001',room='papa',query='',tags=[],limit=30,offset=0,language=null,visibility='visible',status='all'}={})=>
  rpc('papa_song_search_room_v3',[room,query,tags,limit,offset,language,visibility,status,space]);
 return {db,q,rpc,search,stable,shared,bodies};
}

for(const [space,room] of [['space-001','papa'],[nativeSpace,nativeRoom]])test(room+' visibility/status counts filter the complete own-room result before ID-only pagination',async t=>{
 const {search,stable}=await fixture(t),before=await stable(),strip=ids=>ids.map(id=>id.slice(room.length+1));
 const all=await search({space,room,visibility:'all',limit:50});assert.deepEqual(strip(all.songIds),suffixes);assert.equal(all.total,13);assert.equal(all.hasMore,false);
 assert.deepEqual(Object.keys(all).sort(),['hasMore','songIds','total']);
 for(const visibility of ['visible','hidden','all'])for(const status of ['all','linked','pending','unlinked']){
  const expected=suffixes.filter(id=>(visibility==='all'||id.startsWith(visibility==='hidden'?'h-':'v-'))
   &&(status==='all'||status==='linked'&&linked.includes(id)||status==='pending'&&pendingStatus.includes(id)||status==='unlinked'&&!linked.includes(id)&&!pendingStatus.includes(id)));
  const full=await search({space,room,visibility,status,limit:50});assert.deepEqual(strip(full.songIds),expected,visibility+' '+status);assert.equal(full.total,expected.length);
  const first=await search({space,room,visibility,status,limit:2}),second=await search({space,room,visibility,status,limit:2,offset:2});
  assert.deepEqual(strip(first.songIds),expected.slice(0,2));assert.deepEqual(strip(second.songIds),expected.slice(2,4));
  assert.equal(first.total,expected.length);assert.equal(second.total,expected.length);assert.equal(first.hasMore,expected.length>2);assert.equal(second.hasMore,expected.length>4);
  const beyond=await search({space,room,visibility,status,offset:10000});assert.deepEqual(beyond.songIds,[]);assert.equal(beyond.total,expected.length);assert.equal(beyond.hasMore,false);
 }
 assert.equal(new Set(all.songIds).size,all.total,'shared variants, lyrics and candidate metadata do not multiply song counts');
 assert.doesNotMatch(JSON.stringify(all),/private|lyrics|source_hash|ForeignOnly|foreignlyric|michelle|visibility-foreign/);
 assert.deepEqual(await stable(),before,'reads preserve all original/catalog/private/audit/accounting rows');
});

test('old seven-argument search delegates to one indexed query and preserves literal lyrics, tags and language results',async t=>{
 const {rpc,search,stable}=await fixture(t),before=await stable();
 const cases=[[''],['  '],['sharedneedle'],['sharedlyricneedle'],['oldsharedneedle'],['ownneedle'],['copyneedle'],['legacyneedle'],
  ['中文'],['中文搜尋'],['中文　搜尋'],['100%_\\path'],['%'],['_'],['\\'],['publiccommentneedle'],['sharedneedle shared'],
  ['inactivevariantbodyneedle'],['inactivefamilybodyneedle'],['foreignlyricneedle'],['excludedPrivateNeedle'],['excludedNoteNeedle'],['excludedCatalogNoteNeedle'],
  ['',['roomtag']],['',['missing','sweet']],['sharedneedle',['sweet']],['sharedneedle',['missing']],['',[],'國語'],['',[],'Local Language'],['',[],'missing language']];
 for(const room of ['papa',nativeRoom])for(const includeHidden of [false,true,null])for(const [query,tags=[],language=null] of cases){
  const args=[room,query,tags,3,1,language,includeHidden];
  assert.deepEqual(await rpc('papa_song_search_room_v2',args),await rpc('papa_song_search_room_before011',args),JSON.stringify(args));
 }
 assert.deepEqual((await rpc('papa_song_search_room_v2',['papa'])).songIds,suffixes.filter(id=>id.startsWith('v-')).map(id=>'papa-'+id));
 assert.deepEqual((await rpc('papa_song_search_room_v3',['papa'])).songIds,(await rpc('papa_song_search_room_v2',['papa'])).songIds);
 assert.deepEqual((await search({query:'sharedlyricneedle'})).songIds,['papa-v-linked']);
 assert.deepEqual((await search({query:'copyneedle',visibility:'hidden',status:'linked'})).songIds,['papa-h-copy']);
 assert.deepEqual((await search({query:'legacyneedle',visibility:'hidden',status:'pending'})).songIds,['papa-h-pending','papa-h-inactive-family']);
 assert.equal((await search({query:'ForeignOnlyNeedle',visibility:'all'})).total,0);
 assert.deepEqual(await stable(),before);
});

test('status uses current source hashes and active master/family state without refreshing or writing catalog metadata',async t=>{
 const {search,q,shared,stable,bodies}=await fixture(t),before=await stable();
 assert.equal((await search({visibility:'all',status:'linked'})).total,4,'linked wins over a pending candidate');
 assert.ok((await search({visibility:'all',status:'pending'})).songIds.includes('papa-v-stale-link'),'a stale link falls back to a current pending candidate');
 assert.ok(!(await search({visibility:'all',status:'pending'})).songIds.includes('papa-h-stale-pending'),'stale pending hashes never count as current pending');
 assert.ok((await search({visibility:'all',status:'unlinked'})).songIds.includes('papa-v-inactive-variant'),'inactive variants do not link');
 assert.ok((await search({visibility:'all',status:'pending'})).songIds.includes('papa-h-inactive-family'),'inactive families fall back to current pending');
 await q('update papa_catalog_variants set active=false where id=$1',[shared]);
 assert.equal((await search({visibility:'all',status:'linked'})).total,0);
 assert.ok((await search({visibility:'all',status:'pending'})).songIds.includes('papa-h-linked'));
 assert.equal((await search({query:'sharedlyricneedle',visibility:'all'})).total,0,'inactive master lyrics cannot satisfy the search');
 await q('update papa_catalog_variants set active=true where id=$1',[shared]);
 await q("update papa_catalog_candidates set source_hash=papa_catalog_source_hash($1) where streamer_id='papa' and song_id='papa-h-stale-pending'",[bodies['papa-h-stale-pending']]);
 assert.ok((await search({visibility:'hidden',status:'pending'})).songIds.includes('papa-h-stale-pending'));
 await q("update papa_catalog_candidates set source_hash=papa_catalog_source_hash($1) where streamer_id='papa' and song_id='papa-h-stale-pending'",[{...bodies['papa-h-stale-pending'],title:'Old pending title'}]);
 assert.deepEqual(await stable(),before,'temporary test edits are restored; search itself never reconciles or mutates rows');
});

test('canonical room/Space, bounds, enum filters and service-only grants prevent cross-scope or browser reads',async t=>{
 const {db,search,rpc,q,stable}=await fixture(t),before=await stable();
 for(const args of [{space:nativeSpace},{space:'space-001',room:nativeRoom},{space:'missing'},{space:''}])await assert.rejects(search(args),/CATALOG_SCOPE_INVALID/);
 for(const room of ['missing','disabled'])await assert.rejects(search({room}),/CATALOG_ROOM_MISSING/);
 assert.deepEqual((await search({space:nativeSpace,room:'visibility-other',visibility:'hidden'})).songIds,['visibility-other-foreign']);
 assert.deepEqual((await search({space:'space-visibility-foreign',room:'visibility-foreign',visibility:'all'})).songIds,['visibility-foreign-foreign']);
 for(const args of [{limit:null},{limit:0},{limit:51},{offset:null},{offset:-1},{offset:10001},{query:'x'.repeat(121)},
  {tags:Array(31).fill('tag')},{language:'x'.repeat(121)},{room:''}])await assert.rejects(search(args),/CATALOG_SEARCH_LIMIT/);
 for(const args of [{visibility:null},{visibility:'unknown'},{status:null},{status:'approved'}])await assert.rejects(search(args),/CATALOG_SEARCH_FILTER_INVALID/);
 await q('update papa_spaces set status=\'suspended\' where id=$1',[nativeSpace]);
 await assert.rejects(search({space:nativeSpace,room:nativeRoom}),/CATALOG_ROOM_MISSING/);
 await assert.rejects(rpc('papa_song_search_room_v2',[nativeRoom]),/CATALOG_ROOM_MISSING/);
 await q('update papa_spaces set status=\'active\' where id=$1',[nativeSpace]);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(search(),/permission denied/);await assert.rejects(rpc('papa_song_search_room_v2',['papa']),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');assert.equal((await search({visibility:'hidden',status:'linked'})).total,2);
 assert.equal((await rpc('papa_song_search_room_v2',['papa'])).total,7);await db.exec('reset role');
 assert.deepEqual(await stable(),before);
});

test('v3 retains the selective original source-index path and v2 contains only the compatibility delegation',async t=>{
 const {db,q}=await fixture(t);
 const definition=(await q("select pg_get_functiondef('papa_song_search_room_v3(text,text,text[],integer,integer,text,text,text,text)'::regprocedure) definition"))[0].definition;
 const wrapper=(await q("select pg_get_functiondef('papa_song_search_room_v2(text,text,text[],integer,integer,text,boolean)'::regprocedure) definition"))[0].definition;
 assert.match(wrapper,/papa_song_search_room_v3\(/);assert.doesNotMatch(wrapper,/candidate_ids|papa_v2_entities/);
 assert.equal((definition.match(/candidate_ids as materialized/g)||[]).length,1);assert.doesNotMatch(definition,/select\s+\*|jsonb_agg\([^)]*data|papa_catalog_song_metadata/i);
 await q("insert into papa_v2_entities(kind,id,data) select 'songs','index-fixture-'||i,jsonb_build_object('songId','index-fixture-'||i,'streamer_id','papa','title','Filler '||i,'lyrics',case when i=1234 then 'uniqueIndexNeedle' else repeat('ordinary filler lyric ',8)||i end) from generate_series(1,2000) i");
 // Flush the bulk fixture's GIN pending list before inspecting its normal
 // selective plan; this is maintenance of the isolated database only.
 await db.exec('vacuum analyze papa_v2_entities');
 const sourceSql=definition.slice(definition.indexOf('select e.id,e.space_id'),definition.indexOf('),candidate_ids as materialized'))
  .replace(/\banchor is not null/g,"papa_catalog_search_anchor('uniqueindexneedle') is not null")
  .replace(/\blike pattern/g,"like papa_catalog_search_pattern('uniqueindexneedle')");
 const plan=(await q('explain (analyze,buffers,format json) '+sourceSql))[0]['QUERY PLAN'];
 assert.match(JSON.stringify(plan),/papa_song_search_source_trgm/);assert.equal(plan[0].Plan['Actual Rows'],1);
});
