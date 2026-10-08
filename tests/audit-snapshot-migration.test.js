import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const read=path=>fs.readFileSync(path,'utf8');
test('new audit rows separate authenticated actor and target snapshots; old rows stay unknown',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,
  login_id text,role text,streamer_id text,expires_at timestamptz not null);
 create table papa_streamer_accounts(streamer_id text primary key,enabled boolean not null);
 create table papa_events(id bigint generated always as identity primary key,streamer_id text not null,
  entity_kind text not null,entity_id text not null,action text not null,actor_role text,
  actor_player_id text,created_at timestamptz not null default now(),effective_at text,
  before_data jsonb,after_data jsonb);
 create function papa_audit_redact(value jsonb) returns jsonb language sql immutable as $$select value$$;
 insert into papa_v2_entities values
  ('meta','1','{"streamers":[{"id":"papa","display_name":"怕怕"}]}'),
  ('players','target','{"playerId":"target","name":"霖"}');
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,after_data)
 values('papa','queue','old','complete','legacy-server','target','{"playerId":"target","title":"舊歌"}');`);
 await db.exec(read('supabase/migrations/202610070001_space_foundation.sql'));
 await db.exec(read('supabase/migrations/202610070002_device_sessions.sql'));
 await db.exec(read('supabase/migrations/202610070003_verified_identity_binding.sql'));
 await db.exec(read('supabase/migrations/202610070004_audit_actor_snapshots.sql'));
 const account=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q('select set_config($1,$2,false)',[
  'papa.actor_context',JSON.stringify({account_id:account,actor_streamer_id:'papa',space_id:'space-001'})]);
 await q(`insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,after_data)
  values('papa','queue','new','complete','streamer_admin','target',$1)`,
  [{playerId:'target',title:'All For You',status:'completed'}]);
 const rows=await q('select entity_id,actor_account_id,actor_streamer_id,actor_display_name_snapshot,target_player_id,target_player_name_snapshot,space_id from papa_events order by id');
 assert.equal(rows[0].actor_account_id,null);
 assert.equal(rows[0].actor_display_name_snapshot,null);
 assert.equal(rows[1].actor_account_id,account);
 assert.equal(rows[1].actor_display_name_snapshot,'怕怕');
 assert.equal(rows[1].target_player_id,'target');
 assert.equal(rows[1].target_player_name_snapshot,'霖');
 assert.equal(rows[1].space_id,'space-001');
 const page=(await q("select papa_event_page_v2('papa',0,false,null,2,0) result"))[0].result;
 assert.equal(page.rows.length,2);
 assert.equal(page.rows[0].actor_display_name_snapshot,'怕怕');
 assert.equal(page.rows[0].target_player_name_snapshot,'霖');
 await q("insert into papa_manager_account_links(manager_key,account_id) values('streamer:papa',$1)",[account]);
 await q('select set_config($1,$2,false)',['papa.actor_context','{}']);
 await q("insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,after_data) values('__global__','shared_catalog','catalog:1','update_variant','streamer:papa','{\"title\":\"共同歌曲\"}')");
 const catalog=(await q("select actor_account_id,actor_display_name_snapshot,space_id from papa_events where entity_id='catalog:1'"))[0];
 assert.equal(catalog.actor_account_id,account);
 assert.equal(catalog.actor_display_name_snapshot,'怕怕');
 assert.equal(catalog.space_id,null,'global catalog events stay platform scoped');
 const president=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[president]);
 await q("insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role) values('__global__','shared_catalog','catalog:2','approve_new','president')");
 assert.equal((await q("select actor_account_id from papa_events where entity_id='catalog:2'"))[0].actor_account_id,president);
 const playerAccount=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q("insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,'target')",[playerAccount]);
 await q("insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role) values('__global__','shared_catalog','catalog:3','batch_add','player:target')");
 const playerCatalog=(await q("select actor_account_id,actor_display_name_snapshot,target_player_id from papa_events where entity_id='catalog:3'"))[0];
 assert.equal(playerCatalog.actor_account_id,playerAccount);
 assert.equal(playerCatalog.actor_display_name_snapshot,'霖');
 assert.equal(playerCatalog.target_player_id,null,'actor player is not the target of a catalog event');
 await db.exec('set role anon');
 await assert.rejects(q("select papa_event_page_v2('papa')"),/permission denied/);
 await db.exec('reset role');
});
