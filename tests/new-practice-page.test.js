import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const pageMigration='202610090008_new_practice_page.sql',nativeSpace='space-new-practice',nativeRoom='new-practice-room';
const publicKeys=new Set(['id','songId','streamer_id','title','artist','cat','artistType','tags','new','murmur','creditCost','shortMode','pairSongIds','hidden',
 '_order','sort_order','version','catalogVariantId','hasLyrics','lyricsMode','hasSharedLyrics','hasCustomLyrics']);
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 await db.exec(migration('202609240001_release_a.sql'));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1)",[{schemaVersion:3,streamers:[
  {id:'papa',slug:'papa',active:true},{id:'michelle',slug:'michelle',active:true},{id:'disabled',slug:'disabled',active:false}],streamerSettings:{papa:{},michelle:{},disabled:{}}}]);
 await db.exec(migration('202610010001_shared_catalog.sql'));
 await db.exec(migration('202610070001_space_foundation.sql'));
 await q("insert into papa_spaces(id,slug,display_name) values($1,'new-practice','New Practice'),('space-practice-foreign','practice-foreign','Foreign')",[nativeSpace]);
 for(const [id,space] of [[nativeRoom,nativeSpace],['practice-other',nativeSpace],['practice-foreign','space-practice-foreign']])
  await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,space]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [nativeRoom,'practice-other','practice-foreign']){meta.streamers.push({id,slug:id,active:true});meta.streamerSettings[id]={};}
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const family=(await q("insert into papa_catalog_families(title) values('Shared Family') returning id"))[0].id;
 const inactiveFamily=(await q("insert into papa_catalog_families(title,active) values('Inactive Family',false) returning id"))[0].id;
 const variant=async(owner,title,active=true)=>(await q('insert into papa_catalog_variants(family_id,title,artist,language_id,performer_type_id,version_label,active) values($1,$2,$3,$4,$5,$6,$7) returning id',
  [owner,title,'Shared Artist','mandarin','female','Acoustic',active]))[0].id;
 const shared=await variant(family,'Shared Canonical'),inactive=await variant(family,'Inactive Canonical',false),inactiveOwner=await variant(inactiveFamily,'Inactive Family Canonical');
 await q("insert into papa_catalog_lyric_revisions(variant_id,revision,body,active,actor_id) values($1,1,'secret shared lyric body',true,'president')",[shared]);
 const sourceBodies={};
 for(const room of ['papa',nativeRoom]){
  for(const [suffix,fields,link] of [
   ['00-old',{new:false,_order:-1},null],
   ['s01',{_order:0,sort_order:4096},shared],
   ['s02',{_order:1},shared],
   ['s03',{_order:2,sort_order:-5},shared],
   ['s04',{_order:3,sort_order:1024},'stale'],
   ['s05',{_order:4},shared],
   ['s06',{_order:5},null],
   ['s07',{_order:6,sort_order:'0'},inactive],
   ['s08',{_order:7,sort_order:9007199254740992},inactiveOwner],
   ['s09',{new:false,_order:8},shared],
   ['s10',{_order:9,sort_order:0,hidden:true},shared],
   ['s11',{lyrics:'',sort_order:null},null],
   ['s12',{_order:8796093022208,sort_order:0.5},null]
  ]){
   const id=room+'-'+suffix,data={songId:id,streamer_id:room,title:'Original '+suffix,artist:'Original Artist',cat:'Original Language',artistType:'Original Performer',
    tags:['room tag'],new:true,hidden:false,murmur:'Public song comment',creditCost:2,shortMode:'both',pairSongIds:[],
    lyrics:'secret original lyric '+id,lyricNotes:'secret private lyric note',privateNotes:'secret private notes',lyricHistory:['secret lyric history'],
    key:'secret private key',futurePrivate:{body:'secret future private field'},...fields};
   sourceBodies[id]=data;
   await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,data]);
   if(link)await q('insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values($1,$2,$3,papa_catalog_source_hash($4))',
    [room,id,link==='stale'?shared:link,link==='stale'?{...data,title:'Old Stale Title'}:data]);
  }
  await q("insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body) values($1,$2,$3,'own','secret custom selected lyric')",[room,room+'-s01',shared]);
  await q("insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body) values($1,$2,$3,'own','')",[room,room+'-s02',shared]);
  await q("insert into papa_catalog_private_notes(streamer_id,song_id,body) values($1,$2,'secret catalog private note')",[room,room+'-s01']);
 }
 for(const room of ['michelle','practice-other','practice-foreign','disabled']){
  const id=room+'-song',data={songId:id,streamer_id:room,title:'Other Room Song',artist:'Other Artist',new:true,hidden:false,sort_order:-100,_order:0,lyrics:'secret foreign lyric'};
  await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,data]);
  await q('insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values($1,$2,$3,papa_catalog_source_hash($4))',[room,id,shared,data]);
 }
 // The actual ordinary room overlay is the comparison for shared hash/status
 // semantics; the paged RPC does not call or download this complete helper.
 const overlay=migration('202610080011_catalog_filtered_space.sql'),start=overlay.indexOf('create function papa_catalog_song_metadata_in_space(');
 await db.exec(overlay.slice(start,overlay.indexOf('$$;',start)+3));
 const stable=async()=>({entities:await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),
  links:await q('select streamer_id,song_id,variant_id,source_hash,linked_at from papa_catalog_song_links order by streamer_id,song_id'),
  variants:await q('select id,family_id,title,artist,language_id,language_text,performer_type_id,performer_type_text,version_label,active,created_at,updated_at from papa_catalog_variants order by id'),
  families:await q('select id,title,active,created_at,updated_at from papa_catalog_families order by id'),
  lyrics:await q('select variant_id,revision,body,active,actor_id,created_at from papa_catalog_lyric_revisions order by variant_id,revision'),
  selections:await q('select streamer_id,song_id,variant_id,mode,body,updated_at from papa_catalog_lyric_selections order by streamer_id,song_id'),
  notes:await q('select streamer_id,song_id,body,updated_at from papa_catalog_private_notes order by streamer_id,song_id'),
  candidates:await q('select id,streamer_id,song_id,source_hash,status,updated_at from papa_catalog_candidates order by streamer_id,song_id'),
  audit:await q('select id,actor_id,action,details from papa_catalog_audit order by id'),revision:await q('select id,revision from papa_v2_revision')});
 const before=await stable();await db.exec(migration(pageMigration));assert.deepEqual(await stable(),before,'migration is additive and preserves original/catalog/private bodies');
 const page=(space='space-001',room='papa',management=false,limit=5,offset=0)=>rpc('papa_new_practice_page',[space,room,management,limit,offset]);
 return {db,q,rpc,page,stable,sourceBodies,shared};
}

for(const [space,room] of [['space-001','papa'],[nativeSpace,nativeRoom]])test(room+' new practice pages use stable room-private order and the current lean catalog overlay',async t=>{
 const {page,stable,rpc,q,sourceBodies,shared}=await fixture(t),before=await stable();
 const suffix=row=>row.songId.slice(room.length+1),home=await page(space,room);
 assert.deepEqual(home.rows.map(suffix),['s03','s02','s04','s11','s12']);
 assert.equal(home.total,10);assert.equal(home.pageLimit,5);assert.equal(home.pageOffset,0);assert.equal(home.hasMore,true);
 const second=await page(space,room,false,5,5);assert.deepEqual(second.rows.map(suffix),['s01','s05','s06','s07','s08']);assert.equal(second.total,10);assert.equal(second.hasMore,false);
 assert.deepEqual((await page(space,room,false,5,10)).rows,[]);
 const all=[...home.rows,...second.rows],overlay=await rpc('papa_catalog_song_metadata_in_space',[room]);
 for(const row of all){
  assert.equal(row.new,true);assert.equal(row.hidden,false);assert.equal(row.streamer_id,room);
  assert.ok(Object.keys(row).every(key=>publicKeys.has(key)),'only lightweight fields reach public list rows');
  assert.deepEqual(row.tags,['room tag']);assert.equal(row.creditCost,2);assert.equal(row.shortMode,'both');
  const common=overlay.find(song=>song.songId===row.songId);
  for(const field of ['title','artist','cat','artistType','version','catalogVariantId','hasLyrics','lyricsMode'])
   if(common[field]!==undefined)assert.deepEqual(row[field],common[field],'shared overlay matches current room snapshot: '+field);
 }
 assert.doesNotMatch(JSON.stringify(all),/secret|lyricNotes|privateNotes|lyricHistory|futurePrivate|sourceHash|source_hash|previousSongId|nextSongId|catalogStatus/);
 const own=all.find(row=>suffix(row)==='s01'),emptyOwn=all.find(row=>suffix(row)==='s02'),sharedRow=all.find(row=>suffix(row)==='s03');
 assert.equal(own.title,'Shared Canonical');assert.equal(own.hasLyrics,true);assert.equal(own.hasSharedLyrics,true);assert.equal(own.hasCustomLyrics,true);assert.equal(own.lyricsMode,'own');
 assert.equal(emptyOwn.hasLyrics,false);assert.equal(emptyOwn.hasSharedLyrics,true);assert.equal(emptyOwn.hasCustomLyrics,false);
 assert.equal(sharedRow.hasLyrics,true);assert.equal(sharedRow.hasSharedLyrics,true);assert.equal(sharedRow.lyricsMode,'own','legacy mode marker follows the existing helper');
 assert.equal(all.find(row=>suffix(row)==='s04').title,'Original s04','stale links never overlay common master fields');
 assert.equal(all.find(row=>suffix(row)==='s07').title,'Original s07','inactive variant never overlays room fields');
 assert.equal(all.find(row=>suffix(row)==='s08').title,'Original s08','inactive family never overlays room fields');
 assert.equal(all.find(row=>suffix(row)==='s06').hasCustomLyrics,true);assert.equal(all.find(row=>suffix(row)==='s11').hasLyrics,false);
 assert.equal(all.find(row=>suffix(row)==='s07').sort_order,6144,'numeric string ranks return only their effective original-order fallback');
 assert.equal(all.find(row=>suffix(row)==='s08').sort_order,7168,'unsafe ranks return the full-room fallback without page-local renumbering');
 assert.equal(all.find(row=>suffix(row)==='s12').sort_order,3072,'virtual rank includes non-new rows in the original canonical source position');
 assert.equal(Object.hasOwn(all.find(row=>suffix(row)==='s12'),'_order'),false,'unsafe scaled source rank falls back to canonical full-room position');
 assert.equal(own._order,0);assert.equal(own.sort_order,4096);assert.deepEqual(sourceBodies[own.songId].tags,own.tags);
 assert.deepEqual(await stable(),before,'pages never rewrite originals, common masters, private notes, lyrics, audit or revision');
 await q("update papa_catalog_variants set title='Live Shared Canonical' where id=$1",[shared]);
 assert.equal((await page(space,room,false,50)).rows.find(row=>suffix(row)==='s01').title,'Live Shared Canonical','common metadata resolves live without copying to each room');
 assert.equal((await q("select data->>'title' title from papa_v2_entities where kind='songs' and id=$1",[room+'-s01']))[0].title,'Original s01');
 await q("update papa_catalog_variants set title='Shared Canonical' where id=$1",[shared]);assert.deepEqual(await stable(),before);
});

test('manager new-practice neighbors span pages and remain private to the canonical room',async t=>{
 const {page,stable}=await fixture(t),before=await stable();
 const full=await page(nativeSpace,nativeRoom,true,50);assert.equal(full.total,11);
 const ids=full.rows.map(row=>row.songId);assert.deepEqual(ids.map(id=>id.slice(nativeRoom.length+1)),['s03','s10','s02','s04','s11','s12','s01','s05','s06','s07','s08']);
 for(const [index,row] of full.rows.entries()){assert.equal(row.previousSongId,ids[index-1]||null);assert.equal(row.nextSongId,ids[index+1]||null);assert.equal(typeof row.catalogStatus,'string');}
 const first=await page(nativeSpace,nativeRoom,true,3,0),second=await page(nativeSpace,nativeRoom,true,3,3);
 assert.equal(first.rows[2].nextSongId,second.rows[0].songId);assert.equal(second.rows[0].previousSongId,first.rows[2].songId);
 assert.equal(first.total,11);assert.equal(second.total,11);assert.equal(second.pageOffset,3);assert.equal(second.hasMore,true);
 assert.equal(full.rows.find(row=>row.songId.endsWith('-s10')).hidden,true);
 assert.equal(full.rows.find(row=>row.songId.endsWith('-s04')).catalogStatus,'pending');
 assert.equal(full.rows.find(row=>row.songId.endsWith('-s01')).catalogStatus,'linked');
 assert.doesNotMatch(JSON.stringify(full),/secret|privateNotes|lyricHistory|futurePrivate|sourceHash|source_hash|practice-foreign|michelle/);
 const other=await page(nativeSpace,'practice-other',true);assert.deepEqual(other.rows.map(row=>row.songId),['practice-other-song']);
 assert.equal(other.rows[0].previousSongId,null);assert.equal(other.rows[0].nextSongId,null);
 assert.deepEqual(await stable(),before);
});

test('new practice pages enforce service-only access, canonical visibility and strict pagination without snapshot reads',async t=>{
 const {db,q,rpc,page,stable}=await fixture(t),before=await stable();
 for(const args of [
  ['space-001','papa',null],['space-001','papa',false,0],['space-001','papa',false,51],['space-001','papa',false,null],
  ['space-001','papa',false,5,-1],['space-001','papa',false,5,10000001],['space-001','papa',false,5,null]
 ])await assert.rejects(page(...args),/NEW_PRACTICE_PAGE_INVALID/);
 for(const args of [[nativeSpace,'papa'],['space-001',nativeRoom],[null,'papa'],['space-001',null],['missing','papa'],['space-001','unknown']])
  await assert.rejects(page(...args),/NEW_PRACTICE_SCOPE_INVALID/);
 await assert.rejects(page('space-001','disabled'),/NEW_PRACTICE_SCOPE_INVALID/);assert.equal((await page('space-001','disabled',true)).total,1);
 await q("update papa_spaces set status='suspended' where id=$1",[nativeSpace]);await assert.rejects(page(nativeSpace,nativeRoom,true),/NEW_PRACTICE_SCOPE_INVALID/);
 await q("update papa_spaces set status='active' where id=$1",[nativeSpace]);
 const end=await page('space-001','papa',false,50,10000000);assert.equal(end.total,10);assert.deepEqual(end.rows,[]);assert.equal(end.hasMore,false);
 const defaults=await rpc('papa_new_practice_page',['space-001','papa']);assert.equal(defaults.rows.length,5);assert.equal(defaults.pageOffset,0);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(page(),/permission denied/);await assert.rejects(page(nativeSpace,nativeRoom,true),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');assert.equal((await page()).total,10);await db.exec('reset role');
 assert.deepEqual(await stable(),before);
 const sql=migration(pageMigration);assert.doesNotMatch(sql,/\bselect\s+\*/i);assert.doesNotMatch(sql,/papa_(?:v2_\w*snapshot\w*|catalog_song_metadata\w*)\s*\(/i);
 assert.doesNotMatch(sql,/\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i);assert.doesNotMatch(sql,/\bpapa_(?:events|queue)\b/i);
});
