import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

test('selected review keeps Honey 2+1 / 2+2 isolated, private data intact and lyrics inherited',async t=>{
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args))[0].value;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,1);
 create table papa_notice_config(id text primary key,value jsonb);
 create function papa_v2_snapshot() returns jsonb language sql as $$select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(e)) from papa_v2_entities e))$$;`);
 await db.exec(fs.readFileSync('supabase/migrations/202609240001_release_a.sql','utf8'));
 await db.exec(`create table papa_notifications(id uuid default gen_random_uuid(),streamer_id text,streamer_name text,recipient text,type text,level int,entity_id text,body text);`);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await q('insert into papa_v2_entities values($1,$2,$3)',['meta','1',{streamers:[{id:'papa',active:true},{id:'b',active:true},{id:'c',active:true},{id:'d',active:true}]}]);
 const originals=[];
 for(const [i,title] of ['Honey','Honey','Honey','Honey2','Honey2','Honey2','Honey2','Solo','Var','Var'].entries()){
  const song={songId:'s'+i,streamer_id:['papa','b','c','d'][i%4],title,artist:i===2?'Other':'Artist',cat:'華語',artistType:'女歌手',version:i===9?'Live':'',tags:['private'],key:'D',creditCost:2,privateNote:'note',lyrics:i%2===0?'lyrics '+i:''};originals.push(song);
  await q('insert into papa_v2_entities values($1,$2,$3)',['songs',song.songId,song]);
 }
 const selection=async ids=>{const rows=await q('select id,source_hash from papa_catalog_candidates where song_id=any($1) order by song_id',[ids]);return {ids:rows.map(r=>r.id),hashes:Object.fromEntries(rows.map(r=>[r.id,r.source_hash]))};};
 const review=async(ids,decision,extra={})=>{const a=await selection(ids);return rpc('papa_catalog_review_selected',[decision,a.ids,a.hashes,'president',extra.family||null,null,extra.metadata||{},extra.lyrics?a.ids[0]:null,null]);};
 const single=await rpc('papa_catalog_review_page',['singles']);assert.equal(single.total,1);assert.equal(single.rows[0].title,'Solo');
 const dup=await rpc('papa_catalog_review_page',['duplicates','', '',1,0]);assert.equal(dup.total,3);assert.equal(dup.rows.length,1);assert.equal(dup.rows[0].rows.length,3);assert.ok(dup.hasMore);assert.ok(!JSON.stringify(dup).includes('lyrics 0'));
 const a=await review(['s0','s1'],'confirm_same',{lyrics:true});
 assert.equal((await rpc('papa_catalog_get_lyrics',[null,'b','s1'])).body,'lyrics 0');
 assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s0'])).mode,'own');
 const residual=await rpc('papa_catalog_review_page',['duplicates','Honey']);assert.ok(residual.rows.some(g=>g.rows.length===1&&g.rows[0].songId==='s2'));
 const b=await review(['s2'],'independent');assert.notEqual(a.familyId,b.familyId);
 const c=await review(['s3','s4'],'confirm_same');const d=await review(['s5','s6'],'confirm_same');assert.notEqual(c.familyId,d.familyId);
 const versions=await review(['s8','s9'],'different_versions');const vrows=await q('select id from papa_catalog_variants where family_id=$1',[versions.familyId]);assert.equal(vrows.length,2);
 const families=await rpc('papa_catalog_families_page',['Honey',1,0]);assert.equal(families.rows.length,1);assert.equal(families.total,4);assert.equal(families.rows[0].variants.length,1);assert.ok(families.rows[0].variants[0].streamerCount>=1);assert.equal((await q('select count(*)::int n from papa_catalog_song_links where variant_id=$1',[a.variantId]))[0].n,2);assert.ok(!JSON.stringify(families).includes('streamerId'));
 const metadata=await rpc('papa_catalog_song_metadata',['b']);assert.equal(metadata.find(r=>r.songId==='s1').hasLyrics,true);assert.ok(!JSON.stringify(metadata).includes('lyrics 0'));
 await rpc('papa_catalog_save_lyric',[a.variantId,'new shared','president',true]);assert.equal((await rpc('papa_catalog_get_lyrics',[null,'b','s1'])).body,'new shared');assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s0'])).body,'lyrics 0');
 await rpc('papa_catalog_lyric_choice',['papa','s0','shared',null,'retained note','streamer:papa']);assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s0'])).body,'new shared');assert.equal((await q("select body from papa_catalog_custom_archives where song_id='s0'"))[0].body,'lyrics 0');assert.equal((await rpc('papa_catalog_get_lyrics',[null,'papa','s0'])).privateNote,'retained note');
 const proposals=await rpc('papa_catalog_lyric_sources',[c.variantId,3,0]);assert.equal(proposals.total,1);
 const source=proposals.rows[0];await rpc('papa_catalog_adopt_lyric',[c.variantId,source.streamerId,source.songId,'president',false,source.updatedAt]);assert.equal((await rpc('papa_catalog_get_lyrics',[c.variantId])).body,'lyrics 4');assert.equal((await rpc('papa_catalog_get_lyrics',[d.variantId])).body,'');
 await assert.rejects(review(['s7'],'confirm_same'),/INVALID/);
 const e=await selection(['s7']);e.hashes[e.ids[0]]='0'.repeat(32);await assert.rejects(rpc('papa_catalog_review_selected',['independent',e.ids,e.hashes,'president']),/STALE/);
 await rpc('papa_catalog_candidate_edit',[e.ids[0],(await selection(['s7'])).hashes[e.ids[0]],{title:'Edited',artist:'New',language:'華語',performerType:'男歌手',versionLabel:'Live'},'president']);
 assert.equal((await rpc('papa_catalog_review_page',['singles'])).rows[0].title,'Edited');
 assert.deepEqual((await q("select data from papa_v2_entities where kind='songs' order by id")).map(r=>r.data),originals.sort((a,b)=>a.songId.localeCompare(b.songId)));
 assert.ok((await q('select count(*)::int n from papa_catalog_negative_decisions'))[0].n>0);
 // A later re-scan must not re-group a pair explicitly judged independent.
 await q("update papa_catalog_candidates set status='pending' where song_id in ('s0','s2')");
 const negatives=await rpc('papa_catalog_review_page',['singles','Honey']);assert.ok(negatives.rows.some(r=>r.songId==='s2'));
 // A new version is a candidate under the stated family, never an automatic formal link.
 await q('insert into papa_v2_entities values($1,$2,$3)',['songs','s-new',{songId:'s-new',streamer_id:'papa',title:'A new label',artist:'Artist',cat:'華語',version:'Live',catalogCandidateFamily:a.familyId}]);
 const proposed=await q("select preferred_family,status from papa_catalog_candidates where song_id='s-new'");assert.equal(proposed[0].preferred_family,a.familyId);assert.equal(proposed[0].status,'pending');assert.equal((await q("select count(*)::int n from papa_catalog_song_links where song_id='s-new'"))[0].n,0);
 // Already linked variants are skipped atomically; one master update changes the projected view only.
 const beforeCount=(await q("select count(*)::int n from papa_v2_entities where kind='songs'"))[0].n;
 assert.equal((await rpc('papa_catalog_batch_add',['b',[a.variantId],'shared','streamer:b'])).added,0);assert.equal((await q("select count(*)::int n from papa_v2_entities where kind='songs'"))[0].n,beforeCount);
 await q('update papa_catalog_variants set title=$1 where id=$2',['Changed master',a.variantId]);assert.equal((await rpc('papa_catalog_song_metadata',['b'])).find(r=>r.songId==='s1').title,'Changed master');assert.equal((await q("select data->>'title' title from papa_v2_entities where id='s1'"))[0].title,'Honey');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(rpc('papa_catalog_review_page',['singles']),/permission denied/);await assert.rejects(q('select body from papa_catalog_custom_archives'),/permission denied/);await db.exec('reset role');}
});
