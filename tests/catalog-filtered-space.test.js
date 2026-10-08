import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

test('UI2 filtered catalog reads, public song search and lightweight singer counts stay in the selected Space',async t=>{
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const one=async(sql,args=[])=>(await q(sql,args))[0];
 const rpc=async(name,args=[])=>(await one('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).result;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text not null,id text not null,data jsonb not null,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,
  login_id text,role text,streamer_id text,expires_at timestamptz not null);
 create table papa_v2_revision(id int primary key,revision bigint not null);insert into papa_v2_revision values(1,1);
 create table papa_streamer_accounts(streamer_id text primary key,password_hash text,enabled boolean);
 create table papa_president_accounts(account_key text primary key,password_hash text);
 create table papa_notice_config(id text primary key,value jsonb);
 create table papa_release_backups(release text primary key,snapshot jsonb);
 create function papa_v2_snapshot() returns jsonb language sql as $$select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(e)) from papa_v2_entities e))$$;
 create table papa_notifications(id uuid primary key default gen_random_uuid(),streamer_id text not null,
  recipient text not null,read_at timestamptz,created_at timestamptz not null default now());
 create table papa_push_subscriptions(id uuid primary key default gen_random_uuid(),streamer_id text,recipient text,endpoint text,subscription jsonb,session_hash text);
 create table papa_events(id bigint generated always as identity primary key,streamer_id text not null,
  entity_kind text not null,entity_id text not null,action text not null,actor_role text,
  actor_player_id text,created_at timestamptz not null default now(),effective_at text,before_data jsonb,after_data jsonb);
 create function papa_audit_redact(value jsonb) returns jsonb language sql immutable as $$select value$$;`);
 await q("insert into papa_v2_entities values('meta','1',$1)",[{streamers:[{id:'papa',slug:'papa',display_name:'怕怕',active:true},{id:'michelle',slug:'michelle',display_name:'米雪',active:true},{id:'disabled',display_name:'Disabled private room',active:false}]}]);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)||/^2026100800(?:0[1-9]|10)_/.test(f)).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await q("insert into papa_spaces(id,slug,display_name) values('space-002','other-space','Other')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('other-a','space-002'),('other-b','space-002')");
 await q("update papa_v2_entities set data=data||$1 where kind='meta' and id='1'",[{streamers:[
  {id:'papa',slug:'papa',display_name:'怕怕',active:true},{id:'michelle',slug:'michelle',display_name:'米雪',active:true},
  {id:'disabled',display_name:'Disabled private room',active:false},
  {id:'other-a',slug:'other-a',display_name:'Other private room A',active:true},
  {id:'other-b',slug:'other-b',display_name:'Other private room B',active:true}]}]);
 const honey=(await one("insert into papa_catalog_families(title) values('Honey A') returning id")).id;
 const familyB=(await one("insert into papa_catalog_families(title) values('Honey B') returning id")).id;
 const createVariant=async(family,title,language,performer,kind)=>
  (await one('insert into papa_catalog_variants(family_id,title,artist,language_text,performer_type_text,version_kind,version_label) values($1,$2,$3,$4,$5,$6,$6) returning id',[family,title,'Artist',language,performer,kind])).id;
 const original=await createVariant(honey,'Honey','國語','女歌手','original');
 const otherCover=await createVariant(honey,'Honey','Foreign language','Other performer','cover');
 const localCover=await createVariant(familyB,'Honey B','英語','團體','cover');
 const unavailable=await createVariant(honey,'Honey','Unavailable language','Unavailable performer','live');
 const addSong=async(id,room,variant,{hidden=false,stale=false}={})=>{
  const data={songId:id,streamer_id:room,title:'Honey',artist:'Artist',lyrics:'secret lyric '+id,privateNote:'secret note',hidden};
  await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,data]);
  await q('insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values($1,$2,$3,papa_catalog_source_hash($4))',[room,id,variant,{...data,...(stale?{title:'Stale title'}:{})}]);
 };
 for(const [id,room] of [['s1','papa'],['s2','michelle'],['s3','other-a'],['s4','other-b'],['s5','papa']])await addSong(id,room,original);
 await addSong('s6','other-a',otherCover);await addSong('s7','papa',localCover);
 await addSong('s8','papa',unavailable,{hidden:true});await addSong('s9','papa',unavailable,{stale:true});await addSong('s10','disabled',unavailable);
 await q("insert into papa_catalog_lyric_revisions(variant_id,revision,body,active,actor_id) values($1,1,$2,true,'president')",[original,'shared secret lyric']);
 await rpc('papa_catalog_lyric_choice',['other-a','s6','own','foreign secret lyric',null,'president']);
 await rpc('papa_catalog_lyric_choice',['papa','s7','own','local secret lyric',null,'president']);
 const before=await q('select kind,id,data,space_id from papa_v2_entities order by kind,id');
 const links=await q('select streamer_id,song_id,variant_id,source_hash from papa_catalog_song_links order by song_id');
 await db.exec(fs.readFileSync('supabase/migrations/202610070012_catalog_space_relations.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610080011_catalog_filtered_space.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610080014_space_song_search.sql','utf8'));
 const publicPage=(space='space-001',query='',language='',performer='',version='',limit=12,offset=0)=>
  rpc('papa_catalog_public_page_filtered_in_space',[query,language,performer,version,limit,offset,space]);
 const families=(space='space-001',viewer='papa',query='',lyrics='all',language='',version='',limit=20,offset=0)=>
  rpc('papa_catalog_families_page_v3_in_space',[query,lyrics,limit,offset,language,version,viewer,space]);
 const rooms=(space='space-001',limit=30,offset=0)=>rpc('papa_catalog_variant_rooms_v3_in_space',[original,limit,offset,space]);
 const variantFrom=(page,id)=>page.rows.flatMap(f=>f.variants).find(v=>v.variantId===id);
 const publicOne=await publicPage();assert.equal(publicOne.total,2);
 assert.deepEqual(publicOne.filters,{languages:['國語','英語'],performerTypes:['團體','女歌手'],versionKinds:['cover','original']});
 assert.deepEqual(variantFrom(publicOne,original).streamers.map(r=>r.streamerId).sort(),['michelle','papa']);
 assert.equal(/secret|private|Foreign|Other performer|Unavailable|lyrics/.test(JSON.stringify(publicOne)),false);
 const publicTwo=await publicPage('space-002');assert.equal(publicTwo.total,1);
 assert.deepEqual(publicTwo.filters,{languages:['Foreign language','國語'],performerTypes:['Other performer','女歌手'],versionKinds:['cover','original']});
 assert.deepEqual(variantFrom(publicTwo,original).streamers.map(r=>r.streamerId).sort(),['other-a','other-b']);
 assert.equal(JSON.stringify(publicTwo).includes('怕怕'),false);
 const filtered=await publicPage('space-001','Honey','英語','團體','cover');assert.equal(filtered.total,1);
 assert.equal(filtered.rows[0].familyId,familyB);assert.equal(filtered.rows[0].variants.length,1);
 assert.equal((await publicPage('space-001','','Foreign language')).total,0);
 assert.equal((await publicPage('space-001','','','團體','original')).total,0);
 const first=await publicPage('space-001','','','','',1),second=await publicPage('space-001','','','','',1,1);
 assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.notEqual(first.rows[0].familyId,second.rows[0].familyId);
 assert.deepEqual((await publicPage('space-001','','','','',1,2)).rows,[]);
 assert.deepEqual((await publicPage('space-001','missing')).filters,publicOne.filters,'facets stay scoped before query and pagination');
 const roomsOne=await rooms();assert.equal(roomsOne.total,2);
 assert.deepEqual(roomsOne.items.map(r=>[r.streamerId,r.streamerName]).sort(),[['michelle','米雪'],['papa','怕怕']]);
 assert.equal(roomsOne.items.find(r=>r.streamerId==='papa').songs.length,2,'multiple linked songs count as one room');
 assert.equal(/Other private|secret lyric|privateNote/.test(JSON.stringify(roomsOne)),false);
 const roomsTwo=await rooms('space-002',1);assert.equal(roomsTwo.total,2);assert.equal(roomsTwo.items.length,1);assert.equal(roomsTwo.hasMore,true);
 assert.equal((await rooms('space-002',1,1)).hasMore,false);assert.equal((await rooms(null)).total,4,'global review explicitly requests null');
 const adminOne=await families();assert.equal(variantFrom(adminOne,original).streamerCount,2);
 assert.equal(variantFrom(adminOne,original).alreadyAdded,true);assert.equal(variantFrom(adminOne,otherCover).streamerCount,0);
 assert.equal(variantFrom(adminOne,otherCover).alreadyAdded,false);assert.equal(variantFrom(adminOne,original).hasSharedLyrics,true);
 assert.equal(variantFrom(await families('space-001','other-a'),original).alreadyAdded,false,'foreign viewer room cannot leak alreadyAdded');
 assert.equal(variantFrom(await families('space-002','other-a'),original).streamerCount,2);
 assert.equal(variantFrom(await families('space-002','other-a'),otherCover).alreadyAdded,true);
 assert.equal(variantFrom(await families(null,'other-a'),original).streamerCount,4);
 assert.equal(variantFrom(adminOne,otherCover).lyricProposalCount,0,'foreign private lyric source count stays private');
 assert.equal(variantFrom(await families('space-002','other-a'),otherCover).lyricProposalCount,1);
 assert.equal(variantFrom(await families(null,'other-a'),otherCover).lyricProposalCount,1);
 assert.equal((await families('space-001','papa','','proposals')).rows[0].id,familyB);
 assert.equal((await families('space-002','other-a','','proposals')).rows[0].id,honey);
 const legacyFamilies=(space='space-001',lyrics='all')=>rpc('papa_catalog_families_page_v2_in_space',['',lyrics,20,0,space]);
 assert.equal(variantFrom(await legacyFamilies(),otherCover).lyricProposalCount,0,'old scoped family RPC cannot reveal foreign proposal counts');
 assert.equal(variantFrom(await legacyFamilies('space-002'),otherCover).lyricProposalCount,1);
 assert.equal(variantFrom(await legacyFamilies(null),otherCover).lyricProposalCount,1,'old scoped global review still explicitly requests null');
 assert.equal((await legacyFamilies('space-001','proposals')).rows[0].id,familyB);
 assert.equal((await legacyFamilies('space-002','proposals')).rows[0].id,honey);
 assert.equal(variantFrom(await rpc('papa_catalog_families_page_v2'),otherCover).lyricProposalCount,0,'old Space 001 signature uses scoped private proposal counts');
 assert.equal((await families('space-001','papa','Honey','with')).total,1);
 assert.equal((await families('space-001','papa','Honey','all','英語','cover')).rows[0].id,familyB);
 const adminFirst=await families('space-001','papa','','all','','',1),adminSecond=await families('space-001','papa','','all','','',1,1);
 assert.equal(adminFirst.hasMore,true);assert.equal(adminSecond.hasMore,false);assert.notEqual(adminFirst.rows[0].id,adminSecond.rows[0].id);
 assert.deepEqual(adminFirst.filters,adminOne.filters,'shared master facets remain global regardless of page');
 assert.equal(/secret lyric|Other private|privateNote/.test(JSON.stringify(adminOne)),false);
 for(const room of ['papa','michelle','other-a','other-b']){
  const metadata=await rpc('papa_catalog_song_metadata_in_space',[room]);
  assert.equal(metadata.find(s=>s.catalogVariantId===original).otherStreamerCount,1,room+' sees only its own Space peer');
  assert.equal(/secret lyric|privateNote|streamerName/.test(JSON.stringify(metadata)),false);
 }
 assert.equal((await rpc('papa_catalog_song_metadata_in_space',['papa'])).find(s=>s.catalogVariantId===localCover).otherStreamerCount,0);
 assert.deepEqual(await rpc('papa_catalog_song_metadata_in_space',['unknown']),[]);
 const search=(query='',space='space-001',limit=100)=>rpc('papa_song_search_in_space',[query,space,limit]);
 const searchOne=await search();assert.deepEqual(searchOne.map(s=>s.songId).sort(),['s1','s2','s5','s7','s9']);
 assert.deepEqual((await search('','space-002')).map(s=>s.songId).sort(),['s3','s4','s6']);
 assert.equal(/Other private|secret|lyrics|privateNote/.test(JSON.stringify(searchOne)),false);
 assert.deepEqual(Object.keys(searchOne[0]).sort(),['artist','slug','songId','streamer','title']);
 assert.deepEqual((await search('Honey B')).map(s=>s.songId),['s7'],'current shared master metadata drives matching and display');
 assert.equal((await search('ARTIST Honey')).length,5,'metadata tokens match case-insensitively in any order');
 assert.equal((await search('Honey 國語')).length,3,'legacy language spelling matches shared metadata');
 assert.equal((await search('secret lyric')).length,0,'private lyrics cannot supply search matches');
 assert.equal((await search('%')).length,0,'search treats wildcards literally');
 assert.equal((await search('', 'space-001',1)).length,1);
 assert.equal((await search('missing')).length,0);
 await assert.rejects(search('',null),/CATALOG_SPACE_INVALID/);await assert.rejects(search('','unknown'),/CATALOG_SPACE_INVALID/);
 await assert.rejects(search('','space-001',101),/CATALOG_SEARCH_LIMIT/);
 await assert.rejects(search('x'.repeat(101)),/CATALOG_SEARCH_LIMIT/);
 const signatures=await q("select proname,proargnames from pg_proc where proname in ('papa_catalog_public_page_filtered_in_space','papa_catalog_variant_rooms_v3_in_space','papa_catalog_families_page_v3_in_space','papa_catalog_song_metadata_in_space') order by proname");
 assert.deepEqual(signatures.map(r=>r.proargnames),[
  ['query_text','lyrics_filter','page_limit','page_offset','language_filter','version_filter','viewer_room','requested_space'],
  ['query_text','language_filter','performer_filter','version_filter','page_limit','page_offset','requested_space'],
  ['room_id'],['chosen_variant','page_limit','page_offset','requested_space']]);
 await assert.rejects(publicPage(null),/CATALOG_SPACE_INVALID/);await assert.rejects(publicPage('unknown'),/CATALOG_SPACE_INVALID/);
 await assert.rejects(publicPage('space-001','','','','',21),/CATALOG_PAGE_LIMIT/);
 await assert.rejects(publicPage('space-001','','','','',12,10001),/CATALOG_PAGE_LIMIT/);
 await assert.rejects(rooms('space-001',51),/CATALOG_PAGE_LIMIT/);
 await assert.rejects(families('space-001','papa','','all','','',51),/CATALOG_PAGE_LIMIT/);
 await assert.rejects(families('space-001','papa','','invalid'),/CATALOG_PAGE_LIMIT/);
 for(const [name,args,limitIndex,offsetIndex] of [
  ['papa_catalog_public_page_in_space',['',12,0,'space-001'],1,2],
  ['papa_catalog_variant_rooms_v2_in_space',[original,30,0,'space-001'],1,2],
  ['papa_catalog_families_page_v2_in_space',['','all',20,0,'space-001'],2,3],
  ['papa_catalog_public_page',['',12,0],1,2],
  ['papa_catalog_variant_rooms_v2',[original,30,0],1,2],
  ['papa_catalog_families_page_v2',['','all',20,0],2,3]]){
  for(const index of [limitIndex,offsetIndex]){
   const invalid=[...args];invalid[index]=null;
   await assert.rejects(rpc(name,invalid),/CATALOG_PAGE_LIMIT/,name+' rejects null pagination');
  }
 }
 assert.deepEqual(await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),before);
 assert.deepEqual(await q('select streamer_id,song_id,variant_id,source_hash from papa_catalog_song_links order by song_id'),links);
 assert.equal((await one('select count(*)::int n from papa_catalog_variants where active')).n,4,'shared masters are not cloned');
 await q("update papa_spaces set status='suspended' where id='space-002'");
 await assert.rejects(publicPage('space-002'),/CATALOG_SPACE_INVALID/);
 await assert.rejects(rooms('space-002'),/CATALOG_SPACE_INVALID/);
 await assert.rejects(families('space-002'),/CATALOG_SPACE_INVALID/);
 await assert.rejects(search('','space-002'),/CATALOG_SPACE_INVALID/);
 assert.equal((await rooms(null)).total,2);assert.deepEqual(await rpc('papa_catalog_song_metadata_in_space',['other-a']),[]);
 await db.exec('set role anon');await assert.rejects(publicPage(),/permission denied/);await assert.rejects(rooms(),/permission denied/);
 await assert.rejects(families(),/permission denied/);await assert.rejects(rpc('papa_catalog_song_metadata_in_space',['papa']),/permission denied/);
 await assert.rejects(search(),/permission denied/);
 await db.exec('reset role');
});
