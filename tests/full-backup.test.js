import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {empty,mutate} from '../src/core.js';
import {stateEntries} from '../src/state-patch.js';

test('complete private export preserves legacy/native/catalog/history data, excludes live credentials and makes no writes',async t=>{
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const read=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const one=async(sql,args=[])=>(await q(sql,args))[0];
 const rpc=async(name,args=[])=>(await one('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).result;
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);');
 const base=read('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql',
  '202609250001_roles_and_notification_scope.sql','202609280001_manager_passwords.sql',
  '202609250002_private_chat.sql','202609260001_board.sql','202609260002_board_integrity.sql'])await db.exec(read(name));
 const legacy=mutate(empty(),{type:'song',data:{title:'Legacy source',artist:'Artist',lyrics:'legacy-private-lyrics'}},{role:'admin'},'2026-10-09T01:00:00Z');
 legacy.players=[{playerId:'P1',name:'Legacy Player',ids:['legacy-id'],password:'retained-business-password',note:'private legacy note'}];
 for(const entry of stateEntries(legacy))await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[entry.kind,entry.id,entry.data]);
 // Load the actual deployed catalog and bridge schemas; do not substitute
 // mocks for tables that must survive a real recovery export.
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)||/^2026100800(?:0[1-9]|10)_/.test(f)).sort())await db.exec(read(file));
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100700\d\d_/.test(f)||/^20261008001[1-4]_/.test(f)||/^2026100900(?:0[1-9]|1[0-5])_/.test(f)).sort())await db.exec(read(file));
 const account=async()=>(await one('insert into papa_accounts default values returning id')).id;
 const president=await account(),player=await account(),manager=await account();
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1),('streamer:native-room',$2)",[president,manager]);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,'P1')",[player]);
 await q("insert into papa_spaces(id,slug,display_name) values('space-native','native','Independent')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('native-room','space-native')");
 const meta=(await one("select data from papa_v2_entities where kind='meta'")).data;
 meta.streamers.push({id:'native-room',slug:'native-room',display_name:'Native',active:true});
 meta.streamerSettings['native-room']={manual:'private native setting'};
 await q("update papa_v2_entities set data=$1 where kind='meta'",[meta]);
 const membership=(await one("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-native','player') returning id",[player])).id;
 await q("insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values('space-native','P1',$1,$2,$3)",
  [player,membership,{playerId:'P1',name:'Independent Native Player',ids:[],note:'native private note'}]);
 await q("insert into papa_v2_entities(kind,id,data) values('songs','NATIVE_S',$1)",[{songId:'NATIVE_S',streamer_id:'native-room',title:'Native Source',lyrics:'native-private-lyrics',privateNote:'retain native key'}]);
 await q("insert into papa_player_extra_quotas(streamer_id,player_id,space_id,extra_quota,updated_by) values('native-room','P1','space-native',3,$1)",[president]);
 const family=(await one("insert into papa_catalog_families(title) values('Shared family') returning id")).id;
 const variant=(await one("insert into papa_catalog_variants(family_id,title,artist) values($1,'Shared variant','Artist') returning id",[family])).id;
 const source=(await one("select data from papa_v2_entities where kind='songs' and id='NATIVE_S'")).data;
 await q("insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values('native-room','NATIVE_S',$1,papa_catalog_source_hash($2))",[variant,source]);
 await q("insert into papa_catalog_lyric_revisions(variant_id,revision,body,active,actor_id) values($1,1,'shared lyric',true,'president')",[variant]);
 await q("insert into papa_catalog_private_notes(streamer_id,song_id,body) values('native-room','NATIVE_S','private breath marks')");
 await q("insert into papa_catalog_custom_archives(streamer_id,song_id,body) values('native-room','NATIVE_S','archived custom lyric')");
 await q("insert into papa_notice_preferences(streamer_id,recipient,preferences,topic) values('native-room','P1',$1,'private-capability-channel') on conflict(streamer_id,recipient) do update set topic=excluded.topic,preferences=excluded.preferences",[{chat:{push:false}}]);
 await q("insert into papa_notice_config(id,value) values('test-private',$1)",[{secret:'private-worker-secret'}]);
 await q("insert into papa_v2_sessions(token_hash,player_id,expires_at) values($1,'P1',now()+interval '1 day')",['a'.repeat(64)]);
 const before=await rpc('papa_v2_snapshot');
 const rev=(await one('select revision from papa_v2_revision')).revision;
 const result=await rpc('papa_president_full_backup',[president]);
 assert.deepEqual(result.rows,before.rows);assert.equal(result.revision,before.revision);
 const architecture=result.architecture;assert.equal(architecture.formatVersion,1);
 assert.equal(architecture.tables.papa_space_player_profiles[0].data.name,'Independent Native Player');
 assert.equal(architecture.tables.papa_space_player_profiles[0].account_id,player);
 assert.equal(architecture.tables.papa_player_extra_quotas[0].extra_quota,3);
 assert.equal(architecture.tables.papa_catalog_song_links[0].variant_id,variant);
 assert.equal(architecture.tables.papa_catalog_lyric_revisions[0].body,'shared lyric');
 assert.equal(architecture.tables.papa_catalog_custom_archives[0].body,'archived custom lyric');
 assert.ok(result.rows.some(r=>r.kind==='players'&&r.data.password==='retained-business-password'));
 for(const [name,rows] of Object.entries(architecture.tables)){
  assert.equal(architecture.counts[name],rows.length);
  const actual=(await q('select to_jsonb(record) row from '+name+' record')).map(r=>r.row);
  if(name==='papa_notice_preferences')assert.deepEqual(rows,actual.map(({streamer_id,recipient,preferences})=>({streamer_id,recipient,preferences})));
  else assert.deepEqual(rows,actual,'every recoverable column retained: '+name);
 }
 for(const forbidden of ['private-worker-secret','private-capability-channel','a'.repeat(64)])
  assert.equal(JSON.stringify(result).includes(forbidden),false);
 assert.equal(architecture.tables.papa_v2_sessions,undefined);
 assert.equal(architecture.tables.papa_push_subscriptions,undefined);
 assert.deepEqual(await rpc('papa_v2_snapshot'),before);assert.equal((await one('select revision from papa_v2_revision')).revision,rev);
 assert.ok(architecture.manifest.restoreRequirements.some(s=>s.includes('fresh device')));
 for(const actor of [null,player,manager])await assert.rejects(rpc('papa_president_full_backup',[actor]),/BACKUP_ACTOR_INVALID/);
 await db.exec('set role service_role');assert.equal((await rpc('papa_president_full_backup',[president])).revision,result.revision);await db.exec('reset role');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(rpc('papa_president_full_backup',[president]),/permission denied/);await db.exec('reset role');
 }
 await db.exec('alter table papa_catalog_custom_archives rename to missing_backup_fixture');
 await assert.rejects(rpc('papa_president_full_backup',[president]),/BACKUP_SCHEMA_INCOMPLETE/,'never silently export an incomplete schema');
 await db.exec('alter table missing_backup_fixture rename to papa_catalog_custom_archives');
 await q('update papa_accounts set disabled_at=now() where id=$1',[president]);
 await assert.rejects(rpc('papa_president_full_backup',[president]),/BACKUP_ACTOR_INVALID/);
});
