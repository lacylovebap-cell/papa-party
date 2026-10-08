import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

test('shared song master stays global while singer pages, counts and directory relationships are Space-scoped',async t=>{
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text not null,id text not null,data jsonb not null,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,
  login_id text,role text,streamer_id text,expires_at timestamptz not null);
 create table papa_v2_revision(id int primary key,revision bigint not null);
 insert into papa_v2_revision values(1,1);
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
  actor_player_id text,created_at timestamptz not null default now(),effective_at text,
  before_data jsonb,after_data jsonb);
 create function papa_audit_redact(value jsonb) returns jsonb language sql immutable as $$select value$$;
 insert into papa_v2_entities values
  ('meta','1','{"streamers":[{"id":"papa","display_name":"怕怕"}]}'),
  ('players','P1','{"playerId":"P1","name":"玩家","password":"secret"}'),
  ('songs','S1','{"songId":"S1","streamer_id":"papa","title":"共用歌","artist":"歌手"}'),
  ('queue','Q1','{"id":"Q1","streamer_id":"papa","playerId":"P1"}');
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role)
  values('papa','queue','Q1','complete','legacy-server');
 insert into papa_notifications(streamer_id,recipient) values('papa','P1');`);

 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)||/^20261008000[1-8]_/.test(f)).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await q("insert into papa_spaces(id,slug,display_name) values('space-002','other-space','Other')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('other-room','space-002')");
 await q("update papa_v2_entities set data=$1 where kind='meta'",[{streamers:[{id:'papa',slug:'papa',display_name:'怕怕',active:true},{id:'michelle',slug:'michelle',display_name:'米雪',active:true},{id:'other-room',slug:'other-room',display_name:'Other private room',active:true}]}]);
 for(const [songId,streamer] of [['S2','michelle'],['S3','other-room']])await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[songId,{songId,streamer_id:streamer,title:'共用歌',artist:'歌手',lyrics:'private-'+streamer}]);
 await rpc('papa_catalog_reconcile_songs',['',100]);
 const candidates=await q('select id,source_hash from papa_catalog_candidates order by song_id');
 const linked=await rpc('papa_catalog_review_selected',['confirm_same',candidates.map(c=>c.id),Object.fromEntries(candidates.map(c=>[c.id,c.source_hash])),'president']);
 const variant=(await q('select id,family_id from papa_catalog_variants where active'))[0];
 const before=await q('select kind,id,data from papa_v2_entities order by kind,id');
 const links=await q('select * from papa_catalog_song_links order by song_id');
 await db.exec(fs.readFileSync('supabase/migrations/202610070012_catalog_space_relations.sql','utf8'));
 const directory=await rpc('papa_streamer_directory');assert.equal(directory.find(r=>r.id==='other-room').spaceId,'space-002');
 for(const [space,expected] of [['space-001',['michelle','papa']],['space-002',['other-room']]]){
  const publicPage=await rpc('papa_catalog_public_page_in_space',['',12,0,space]);
  assert.equal(publicPage.total,1);assert.equal(publicPage.rows.length,1);
  assert.deepEqual(publicPage.rows[0].variants[0].streamers.map(r=>r.streamerId).sort(),expected);
  assert.equal(JSON.stringify(publicPage).includes('private-'),false);
  const rooms=await rpc('papa_catalog_variant_rooms_v2_in_space',[variant.id,1,0,space]);
  assert.equal(rooms.total,expected.length);assert.equal(rooms.items.length,1);assert.equal(rooms.hasMore,expected.length>1);
  const families=await rpc('papa_catalog_families_page_v2_in_space',['','all',20,0,space]);
  assert.equal(families.rows[0].variants[0].streamerCount,expected.length);
  const singers=await rpc('papa_catalog_family_singers_in_space',[variant.family_id,space]);
  assert.deepEqual(singers[0].rooms.map(r=>r.streamerId).sort(),expected);
 }
 assert.equal((await rpc('papa_catalog_variant_rooms_v2_in_space',[variant.id,30,0,null])).total,3,'president global review explicitly requests null');
 assert.deepEqual((await rpc('papa_catalog_public_page')).rows[0].variants[0].streamers.map(r=>r.streamerId).sort(),['michelle','papa'],'old signature safely defaults to Space 001');
 await assert.rejects(rpc('papa_catalog_public_page_in_space',['',12,0,null]),/CATALOG_SPACE_INVALID/);
 await assert.rejects(rpc('papa_catalog_public_page_in_space',['',12,0,'unknown']),/CATALOG_SPACE_INVALID/);
 assert.deepEqual(await q('select kind,id,data from papa_v2_entities order by kind,id'),before);
 assert.deepEqual(await q('select * from papa_catalog_song_links order by song_id'),links);
 assert.equal((await q('select count(*)::int n from papa_catalog_variants where active'))[0].n,1,'relations never clone shared masters');
 await q("update papa_spaces set status='suspended' where id='space-002'");
 assert.equal((await rpc('papa_streamer_directory')).some(r=>r.id==='other-room'),false);
 await assert.rejects(rpc('papa_catalog_public_page_in_space',['',12,0,'space-002']),/CATALOG_SPACE_INVALID/);
 await db.exec('set role anon');
 await assert.rejects(rpc('papa_catalog_public_page_in_space',['',12,0,'space-001']),/permission denied/);
 await db.exec('reset role');
});
