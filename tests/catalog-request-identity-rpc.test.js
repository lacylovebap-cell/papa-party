import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const migration=fs.readFileSync('supabase/migrations/202610180001_catalog_request_identity.sql','utf8');
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,23);
 create table papa_v2_entities(kind text,id text,data jsonb,space_id text,primary key(kind,id));
 create table papa_spaces(id text primary key,status text);insert into papa_spaces values('space-001','active'),('space-002','active');
 create table papa_space_streamers(streamer_id text primary key,space_id text);insert into papa_space_streamers values('feng','space-001'),('other','space-002');
 create table papa_catalog_families(id text primary key,active boolean);
 create table papa_catalog_variants(id text primary key,family_id text,title text,artist text,active boolean);
 create table papa_catalog_song_links(streamer_id text,song_id text,variant_id text,source_hash text);
 create table papa_events(id bigint generated always as identity primary key,streamer_id text,space_id text,entity_kind text,entity_id text,action text,actor_role text,actor_player_id text,effective_at text,hour_bucket bigint,after_data jsonb);
 create unique index failed_hour on papa_events(streamer_id,actor_player_id,hour_bucket) where action='request_failed';
 create function papa_achievement_player_valid(s text,p text,registered boolean) returns boolean language sql as $$select s='space-001' and p='P1'$$;
 insert into papa_catalog_families values('F',true);insert into papa_catalog_variants values('V','F','遇見','孫燕姿',true);`);
 const definition=fs.readFileSync('supabase/migrations/202610010001_shared_catalog.sql','utf8').match(/create function public\.papa_catalog_source_hash\([\s\S]*?\$\$;/)[0];await db.exec(definition);
 const raw={songId:'S1',streamer_id:'feng',title:'聽見',artist:'舊歌手',lyrics:'PRIVATE LYRICS',privateNotes:'PRIVATE NOTES',creditCost:1,tags:['原標籤']};
 await q("insert into papa_v2_entities values('songs','S1',$1,'space-001'),('songs','FOREIGN',$2,'space-002')",[raw,{...raw,songId:'FOREIGN',streamer_id:'other'}]);
 await q("insert into papa_catalog_song_links values('feng','S1','V',papa_catalog_source_hash($1))",[raw]);
 await db.exec(migration);const call=async(name,args)=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args))[0].v;
 return {db,q,call,raw,read:ids=>call('papa_catalog_request_metadata',['space-001','feng',ids])};
}
test('selected request projection agrees with valid shared identity and never rewrites original songs or exposes lyrics/notes',async t=>{
 const f=await fixture(t),before=await f.q('select * from papa_v2_entities');const r=await f.read(['S1']);assert.deepEqual(r,{version:1,scope:{spaceId:'space-001',roomId:'feng'},revision:23,songs:[{songId:'S1',title:'遇見',artist:'孫燕姿'}]});
 assert.deepEqual(await f.q('select * from papa_v2_entities'),before);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|lyrics|notes|creditCost|tags/);
 assert.deepEqual((await f.read(['FOREIGN'])).songs,[]);for(const role of ['anon','authenticated'])assert.equal((await f.q("select has_function_privilege($1,'papa_catalog_request_metadata(text,text,text[])','execute') v",[role]))[0].v,false);
});
test('stale links, inactive variants/families and unlinked songs fall back to original identity, with bounded scoped input',async t=>{
 const f=await fixture(t);for(const sql of ["update papa_catalog_song_links set source_hash='stale'","update papa_catalog_variants set active=false","update papa_catalog_families set active=false"]){
  await f.q("update papa_catalog_song_links set source_hash=papa_catalog_source_hash($1)",[f.raw]);await f.q('update papa_catalog_variants set active=true');await f.q('update papa_catalog_families set active=true');await f.db.exec(sql);assert.equal((await f.read(['S1'])).songs[0].title,'聽見');
 }
 for(const ids of [[],['S1','S1'],[null],Array.from({length:101},(_,i)=>'S'+i)])await assert.rejects(f.read(ids),/INPUT_INVALID/);
 await assert.rejects(f.call('papa_catalog_request_metadata',['space-002','feng',['S1']]),/SCOPE_INVALID/);
});
test('new failed-request facts use canonical identity once per player/hour and preserve all previous Audit',async t=>{
 const f=await fixture(t);await f.q("insert into papa_events(streamer_id,action,after_data) values('feng','old_audit','{\"title\":\"聽見\"}')");
 const old=await f.q('select * from papa_events'),hour=Math.floor(Date.now()/3600000),args=['feng','P1','S1',hour];assert.equal(await f.call('papa_record_failed_request',args),true);assert.equal(await f.call('papa_record_failed_request',args),false);
 const facts=await f.q("select after_data from papa_events where action='request_failed'");assert.deepEqual(facts,[{after_data:{songId:'S1',title:'遇見',artist:'孫燕姿',reason:'hourly_limit'}}]);assert.deepEqual(await f.q("select * from papa_events where action='old_audit'"),old);
 await assert.rejects(f.call('papa_record_failed_request',['feng','WRONG','S1',hour]),/SCOPE_INVALID/);assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,23);
});
