import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=fs.readFileSync(new URL('../supabase/migrations/202610120001_room_live_sync_revisions.sql',import.meta.url),'utf8');
const original=fs.readFileSync(new URL('../supabase/migrations/202609170001_party_v2.sql',import.meta.url),'utf8');
const legacyCommit=original.match(/create or replace function public\.papa_v2_commit\([\s\S]*?\$\$;/)[0];
const spaceFoundation=fs.readFileSync(new URL('../supabase/migrations/202610070001_space_foundation.sql',import.meta.url),'utf8');
const legacyScopeGuard=spaceFoundation.match(/create function public\.papa_entity_space_guard\(\)[\s\S]*?for each row execute function public\.papa_entity_space_guard\(\);/)[0];
const family='11111111-1111-4111-8111-111111111111',variant='22222222-2222-4222-8222-222222222222';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_spaces(id text primary key,status text not null default 'active',slug text,display_name text);
 create table papa_space_streamers(streamer_id text primary key,space_id text not null references papa_spaces(id));
 create table papa_v2_revision(id int primary key,revision bigint not null);
 create table papa_v2_entities(kind text not null check(kind in ('players','songs','ledger','queue','crowns','cards','wishes','settings','meta')),id text not null,data jsonb not null,space_id text,primary key(kind,id));
 create table papa_space_player_profiles(space_id text not null,player_id text not null,data jsonb not null,primary key(space_id,player_id));
 create table papa_catalog_families(id uuid primary key,title text,updated_at timestamptz default now());
 create table papa_catalog_variants(id uuid primary key,family_id uuid,title text,artist text,updated_at timestamptz default now());
 create table papa_catalog_languages(id text primary key,name text,updated_at timestamptz default now());
 create table papa_catalog_performer_types(id text primary key,name text,updated_at timestamptz default now());
 create table papa_catalog_lyric_revisions(variant_id uuid,revision int,body text,active boolean,created_at timestamptz default now(),primary key(variant_id,revision));
 create table papa_catalog_song_links(streamer_id text,song_id text,variant_id uuid,source_hash text,linked_at timestamptz default now(),primary key(streamer_id,song_id));
 create table papa_catalog_lyric_selections(streamer_id text,song_id text,mode text,body text,updated_at timestamptz default now(),primary key(streamer_id,song_id));
 create table papa_catalog_language_filters(streamer_id text primary key,mode text,updated_at timestamptz default now());
 create table papa_catalog_language_filter_items(streamer_id text,language_id text,primary key(streamer_id,language_id));
 create table papa_catalog_private_notes(streamer_id text,song_id text,body text);
 insert into papa_spaces values('space-001','active','papa-party','PA Party'),('space-002','active','other','Other');
 insert into papa_space_streamers values('papa','space-001'),('michelle','space-001'),('other','space-002');
 insert into papa_v2_revision values(1,7);
 insert into papa_v2_entities(kind,id,data,space_id) values
 ('meta','1','{"schemaVersion":3,"revision":7,"streamers":[{"id":"papa","slug":"papa","display_name":"怕怕"},{"id":"michelle","slug":"michelle","display_name":"米雪"},{"id":"other","slug":"other","display_name":"Other"}],"streamerSettings":{"papa":{"status":"空閒中"},"michelle":{"status":"空閒中"},"other":{"status":"空閒中"}}}',null),
 ('settings','1','{"status":"空閒中"}',null),
 ('players','P1','{"playerId":"P1","name":"玩家甲","password":"private-password"}',null),
 ('songs','S1','{"songId":"S1","streamer_id":"papa","title":"歌曲","artist":"歌手","lyrics":"private-lyrics","hidden":false}','space-001'),
 ('queue','Q1','{"id":"Q1","streamer_id":"papa","playerId":"P1","status":"waiting","title":"歌曲","note":"private-history"}','space-001'),
 ('ledger','L1','{"id":"L1","streamer_id":"papa","playerId":"P1","amount":2,"note":"private-ledger"}','space-001');
 insert into papa_space_player_profiles values('space-002','P2','{"playerId":"P2","name":"Other player"}');
 insert into papa_catalog_families(id,title) values('${family}','作品');
 insert into papa_catalog_variants(id,family_id,title,artist) values('${variant}','${family}','歌曲','歌手');
 insert into papa_catalog_languages(id,name) values('mandarin','華語');
 insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values('papa','S1','${variant}','original');
 insert into papa_catalog_private_notes values('papa','S1','private-note');`);
 await db.exec(legacyCommit);
 await db.exec(legacyScopeGuard);
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const before=await q('select kind,id,data,space_id from papa_v2_entities order by kind,id');
 await db.exec(migration);
 return {db,q,before,head:async(room='papa',space='space-001')=>(await q('select papa_room_sync_head($1,$2) value',[room,space]))[0].value};
}

test('migration adds empty revision heads without changing existing formal records or global revision',async t=>{
 const {q,before,head}=await fixture(t);assert.deepEqual(await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),before);
 assert.equal((await q('select count(*)::int n from papa_room_sync_revisions'))[0].n,0);
 assert.deepEqual(await head(),{version:1,spaceId:'space-001',streamerId:'papa',room:{},space:{},catalog:{},globalRevision:7,capabilities:{scopedRevision:true,authoritative:false,delta:false,realtime:false}});
});

test('room inserts, changes and deletes affect only that room/domain and identical writes are quiet',async t=>{
 const {q,head}=await fixture(t);
 await q("insert into papa_v2_entities values('queue','Q2',$1,'space-001')",[{id:'Q2',streamer_id:'papa',playerId:'P1',title:'private-title',status:'pending'}]);
 assert.deepEqual((await head()).room,{queue:1});assert.deepEqual((await head('michelle')).room,{});assert.deepEqual((await head('other','space-002')).room,{});
 await q("update papa_v2_entities set data=data||'{\"status\":\"completed\"}' where kind='queue' and id='Q2'");assert.equal((await head()).room.queue,2);
 await q("update papa_v2_entities set data=data where kind='queue' and id='Q2'");assert.equal((await head()).room.queue,2);
 await q("delete from papa_v2_entities where kind='queue' and id='Q2'");assert.equal((await head()).room.queue,3);
 assert.equal((await head()).globalRevision,7,'only existing commit functions own the global write token');assert.doesNotMatch(JSON.stringify(await head()),/private-title|P1|private-history|private-password|private-lyrics/);
});

test('ledger changes do not manufacture unrelated room/domain revisions',async t=>{
 const {q,head}=await fixture(t);await q("update papa_v2_entities set data=data||'{\"amount\":3}' where kind='ledger' and id='L1'");
 assert.deepEqual((await head()).room,{ledger:1});assert.deepEqual((await head()).space,{});assert.deepEqual((await head('michelle')).room,{});
});

test('legacy and native player changes use their one Space parent without room fan-out',async t=>{
 const {q,head}=await fixture(t);await q("update papa_v2_entities set data=data||'{\"name\":\"新名稱\"}' where kind='players' and id='P1'");
 assert.deepEqual((await head()).space,{players:1});assert.deepEqual((await head('michelle')).space,{players:1});assert.deepEqual((await head('other','space-002')).space,{});
 await q("update papa_space_player_profiles set data=data||'{\"name\":\"Other changed\"}' where space_id='space-002' and player_id='P2'");assert.deepEqual((await head('other','space-002')).space,{players:1});
 await q("delete from papa_space_player_profiles where space_id='space-002' and player_id='P2'");assert.equal((await head('other','space-002')).space.players,2);
 assert.equal((await q("select count(*)::int n from papa_room_sync_revisions where domain='players'"))[0].n,2);assert.deepEqual((await head()).room,{});
});

test('meta settings compare exact changed room keys while revision-only changes remain quiet',async t=>{
 const {q,head}=await fixture(t);await q("update papa_v2_entities set data=jsonb_set(data,'{streamerSettings,papa,status}',to_jsonb('忙碌中'::text)) where kind='meta' and id='1'");
 assert.deepEqual((await head()).room,{settings:1});assert.deepEqual((await head('michelle')).room,{});assert.deepEqual((await head('other','space-002')).room,{});assert.deepEqual((await head()).space,{});
 await q("update papa_v2_entities set data=jsonb_set(data,'{revision}','8') where kind='meta' and id='1'");assert.deepEqual((await head()).room,{settings:1});assert.deepEqual((await head()).space,{});
 await q("update papa_v2_entities set data=data #- '{streamerSettings,papa}' where kind='meta' and id='1'");assert.equal((await head()).room.settings,2);
});

test('several changed descriptors in one Space touch only one directory head and preserve other Spaces',async t=>{
 const {q,head}=await fixture(t);await q("update papa_v2_entities set data=jsonb_set(jsonb_set(data,'{streamers,0,display_name}',to_jsonb('新怕怕'::text)),'{streamers,1,display_name}',to_jsonb('新米雪'::text)) where kind='meta' and id='1'");
 assert.deepEqual((await head()).space,{directory:1});assert.deepEqual((await head('michelle')).space,{directory:1});assert.deepEqual((await head('other','space-002')).space,{});
 await q("update papa_v2_entities set data=jsonb_set(data,'{schemaVersion}','4') where kind='meta' and id='1'");assert.equal((await head()).space.metadata,1);assert.deepEqual((await head('other','space-002')).space,{});
});

test('linked songs and link deletions invalidate relevant Space catalog relations without unlinked fan-out',async t=>{
 const {q,head}=await fixture(t);await q("insert into papa_v2_entities values('songs','S2',$1,'space-001')",[{songId:'S2',streamer_id:'papa',title:'unlinked'}]);
 assert.equal((await head()).room.songs,1);assert.deepEqual((await head()).space,{});
 await q("insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values('papa','S2',$1,'s2')",[variant]);assert.equal((await head()).room.songs,2);assert.equal((await head()).space.catalog_relations,1);
 await q("update papa_v2_entities set data=data||'{\"hidden\":true}' where kind='songs' and id='S1'");assert.equal((await head()).room.songs,3);assert.equal((await head()).space.catalog_relations,2);
 await q("delete from papa_catalog_song_links where streamer_id='papa' and song_id='S2'");assert.equal((await head()).room.songs,4);assert.equal((await head()).space.catalog_relations,3);
 assert.deepEqual((await head('michelle')).room,{});assert.equal((await head('michelle')).space.catalog_relations,3);assert.deepEqual((await head('other','space-002')).space,{});
});

test('shared catalog master uses a single global head while private notes remain invisible',async t=>{
 const {q,head}=await fixture(t);await q('update papa_catalog_variants set title=$1 where id=$2',['new variant',variant]);
 assert.deepEqual((await head()).catalog,{shared_catalog:1});assert.deepEqual((await head('other','space-002')).catalog,{shared_catalog:1});assert.deepEqual((await head()).room,{});
 await q("update papa_catalog_variants set updated_at=now()+interval '1 second' where id=$1",[variant]);assert.equal((await head()).catalog.shared_catalog,1);
 await q("update papa_catalog_languages set name='國語' where id='mandarin'");await q('insert into papa_catalog_lyric_revisions(variant_id,revision,body,active) values($1,1,$2,true)',[variant,'private-master-lyrics']);
 await q("update papa_catalog_private_notes set body='changed-secret'");assert.equal((await head()).catalog.shared_catalog,3);assert.doesNotMatch(JSON.stringify(await head()),/lyrics|changed-secret|new variant/);
 assert.equal((await q('select count(*)::int n from papa_room_sync_revisions'))[0].n,1,'no per-room master-change fan-out');
});

test('canonical scope and service-only privileges prevent direct unauthenticated activity reads',async t=>{
 const {db,q,head}=await fixture(t);await assert.rejects(head('papa','space-002'),/ROOM_SYNC_SCOPE_INVALID/);await assert.rejects(head('unknown'),/ROOM_SYNC_SCOPE_INVALID/);
 await db.exec('set role authenticated');try{await assert.rejects(q('select * from papa_room_sync_revisions'),/permission denied/);await assert.rejects(head(),/permission denied/);}finally{await db.exec('reset role');}
 await db.exec('set role service_role');try{assert.equal((await head()).streamerId,'papa');await assert.rejects(q("select papa_room_sync_bump('room','space-001','papa','queue')"),/permission denied/);await assert.rejects(q("insert into papa_room_sync_revisions values('room','space-001','papa','queue',1)"),/permission denied/);}finally{await db.exec('reset role');}
});

test('existing write conflicts and atomic rollback remain intact alongside scoped counters',async t=>{
 const {q,head}=await fixture(t),change={kind:'queue',id:'new',data:{id:'new',streamer_id:'papa',playerId:'P1',status:'waiting'}};
 await assert.rejects(q('select papa_v2_commit($1,$2,$3)',[6,[change],[]]),/VERSION_CONFLICT/);assert.deepEqual((await head()).room,{});
 await assert.rejects(q('select papa_v2_commit($1,$2,$3)',[7,[change,{kind:'invalid',id:'bad',data:{streamer_id:'papa'}}],[]]),/check constraint/);assert.deepEqual((await head()).room,{});assert.equal((await head()).globalRevision,7);
 await q('select papa_v2_commit($1,$2,$3)',[7,[change],[]]);assert.equal((await head()).room.queue,1);assert.equal((await head()).globalRevision,8);
 const other={...change,id:'other-new',data:{...change.data,id:'other-new',streamer_id:'michelle'}};
 await assert.rejects(q('select papa_v2_commit($1,$2,$3)',[7,[other],[]]),/VERSION_CONFLICT/);assert.deepEqual((await head('michelle')).room,{});
 await q('select papa_v2_commit($1,$2,$3)',[8,[other],[]]);assert.equal((await head('michelle')).room.queue,1);assert.equal((await head()).room.queue,1);
});

test('suspended or removed canonical mappings cannot return an old room head',async t=>{
 const {q,head}=await fixture(t);await q("update papa_spaces set status='suspended' where id='space-001'");await assert.rejects(head(),/ROOM_SYNC_SCOPE_INVALID/);
 await q("update papa_spaces set status='active' where id='space-001'");assert.equal((await head()).space.directory,2);assert.deepEqual((await head('other','space-002')).space,{});
 await q("delete from papa_space_streamers where streamer_id='papa'");await assert.rejects(head(),/ROOM_SYNC_SCOPE_INVALID/);assert.equal((await head('michelle')).space.directory,3);
});
