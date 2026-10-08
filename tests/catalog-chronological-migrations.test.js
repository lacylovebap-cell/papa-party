import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

test('catalog baseline, unpublished Space architecture and UI2 migrations apply in chronological order',async t=>{
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
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
  streamer_name text,recipient text not null,type text,level smallint,body text,entity_id text,
  read_at timestamptz,created_at timestamptz not null default now());
 create table papa_push_subscriptions(id uuid primary key default gen_random_uuid(),streamer_id text,recipient text,endpoint text,subscription jsonb,session_hash text);
 create table papa_events(id bigint generated always as identity primary key,streamer_id text not null,
  entity_kind text not null,entity_id text not null,action text not null,actor_role text,
  actor_player_id text,created_at timestamptz not null default now(),effective_at text,before_data jsonb,after_data jsonb);
 create function papa_audit_redact(value jsonb) returns jsonb language sql immutable as $$select value$$;
 insert into papa_v2_entities values
  ('meta','1','{"streamers":[{"id":"papa","slug":"papa","display_name":"怕怕","active":true}]}'),
  ('players','P1','{"playerId":"P1","name":"玩家","password":"secret"}'),
  ('songs','S1','{"songId":"S1","streamer_id":"papa","title":"Honey","artist":"Artist","lyrics":"private lyric"}'),
  ('queue','Q1','{"id":"Q1","streamer_id":"papa","playerId":"P1"}');
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role)
  values('papa','queue','Q1','complete','legacy-server');
 insert into papa_notifications(streamer_id,recipient) values('papa','P1');`);
 const before=await q('select kind,id,data from papa_v2_entities order by kind,id');
 const files=['202609250002_private_chat.sql','202609260001_board.sql','202609260002_board_integrity.sql',
  ...fs.readdirSync('supabase/migrations').filter(f=>/^202610(?:0100\d\d|05000[123]|0700\d\d|0800\d\d)_/.test(f))].sort();
 assert(files.indexOf('202610070012_catalog_space_relations.sql')<files.indexOf('202610080001_catalog_integrated.sql'));
 assert(files.indexOf('202610080010_admin_catalog_controls.sql')<files.indexOf('202610080011_catalog_filtered_space.sql'));
 for(const file of files){
  try{await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));}
  catch(error){error.message=file+': '+error.message;throw error;}
 }
 assert.deepEqual(await q('select kind,id,data from papa_v2_entities order by kind,id'),before);
 for(const signature of ['papa_catalog_public_page(text,integer,integer)',
  'papa_catalog_variant_rooms_v2(uuid,integer,integer)',
  'papa_catalog_families_page_v2(text,text,integer,integer)',
  'papa_catalog_family_singers(uuid)']){
  const definition=(await q('select pg_get_functiondef($1::regprocedure) definition',[signature]))[0].definition;
  assert(definition.includes('_in_space('),signature+' remains scoped after the last production definition');
 }
 assert.equal((await q("select papa_catalog_public_page('',12,0) page"))[0].page.total,0);
 const songs=(await q("select papa_song_search_in_space('Honey','space-001',100) songs"))[0].songs;
 assert.deepEqual(songs,[{songId:'S1',title:'Honey',artist:'Artist',streamer:'怕怕',slug:'papa'}]);
 assert.equal(JSON.stringify(songs).includes('private lyric'),false);
 assert.equal((await q("select count(*)::int n from papa_device_sessions"))[0].n,0);
});
