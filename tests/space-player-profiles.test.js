import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('Space player profiles, settings and room reads do not inherit legacy business data',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,9);
 insert into papa_v2_entities values
 ('meta','1','{"schemaVersion":3,"streamers":[{"id":"papa","slug":"papa","display_name":"怕怕","active":true},{"id":"michelle","slug":"michelle","display_name":"米雪","active":true}],"streamerSettings":{"papa":{"private":"legacy-private-settings"}},"migrationIssues":["legacy-private-issue"]}'),
 ('settings','1','{"private":"legacy-private-settings"}'),
 ('players','P1','{"playerId":"P1","name":"legacy-private-profile","password":"legacy-private-password","ids":[],"names":[]}'),
 ('songs','S1','{"songId":"S1","streamer_id":"papa","lyrics":"legacy-private-lyrics","title":"Legacy"}'),
 ('ledger','L1','{"id":"L1","streamer_id":"papa","playerId":"P1","amount":20}');`);
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610070009_scoped_read_snapshot.sql','utf8'));
 const directorySql=fs.readFileSync('supabase/migrations/202610070012_catalog_space_relations.sql','utf8');
 await db.exec(directorySql.slice(directorySql.indexOf('create or replace function public.papa_streamer_directory'),directorySql.indexOf('$$;')+3));
 const before=await q('select kind,id,data from papa_v2_entities order by kind,id');
 await db.exec(fs.readFileSync('supabase/migrations/202610070013_space_player_profiles.sql','utf8'));
 assert.deepEqual(await q('select kind,id,data from papa_v2_entities order by kind,id'),before);
 await q("insert into papa_spaces(id,slug,display_name) values('space-002','other','Other')");
 await q("insert into papa_space_streamers values('room-002','space-002',now())");
 const metadata=(await q("select data from papa_v2_entities where kind='meta'"))[0].data;
 metadata.streamers.push({id:'room-002',slug:'room-002',display_name:'Other room',active:true});
 metadata.streamerSettings['room-002']={status:'Other setting',hourlyLimit:2};
 await q("update papa_v2_entities set data=$1 where kind='meta'",[metadata]);
 await q("insert into papa_v2_entities(kind,id,data) values('songs','S2',$1)",[{songId:'S2',streamer_id:'room-002',title:'Other song',lyrics:'private lyric 002'}]);
 const account=(await q('insert into papa_accounts default values returning id'))[0].id;
 const member001=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player') returning id",[account]))[0].id;
 const member002=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-002','player') returning id",[account]))[0].id;
 const profile={playerId:'P1',name:'Other private profile',ids:['other-ID'],names:[]};
 const insert=async(space,player,member,data=profile)=>q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',[space,player,account,member,data]);
 await insert('space-002','P1',member002);
 assert.equal((await rpc('papa_space_player_rows',['space-001']))[0].data.name,'legacy-private-profile');
 assert.deepEqual((await rpc('papa_space_player_rows',['space-002']))[0].data,profile);
 const snapshot=await rpc('papa_v2_scoped_read_snapshot_in_space',['room-002','space-002']);
 assert.equal(snapshot.rows.find(r=>r.kind==='players').data.name,'Other private profile');
 assert.equal(snapshot.rows.filter(r=>r.kind==='ledger').length,0,'Space 001 credits are not inherited');
 assert.deepEqual(snapshot.rows.find(r=>r.kind==='meta').data.streamers.map(r=>r.id),['room-002']);
 assert.deepEqual(snapshot.rows.find(r=>r.kind==='settings').data,{status:'Other setting',hourlyLimit:2});
 assert.equal(JSON.stringify(snapshot).includes('legacy-private'),false);
 assert.equal(JSON.stringify(snapshot).includes('private lyric 002'),false);
 const old=await rpc('papa_v2_scoped_read_snapshot',['papa']);
 assert.deepEqual(old.rows.find(r=>r.kind==='meta').data.streamers.map(r=>r.id),['papa','michelle']);
 assert.equal(JSON.stringify(old).includes('Other private profile'),false);
 await assert.rejects(rpc('papa_v2_scoped_read_snapshot',['room-002']),/UNKNOWN_STREAMER_SPACE/);
 await assert.rejects(rpc('papa_v2_scoped_read_snapshot_in_space',['room-002','space-001']),/UNKNOWN_STREAMER_SPACE/);
 const anotherAccount=(await q('insert into papa_accounts default values returning id'))[0].id;
 await assert.rejects(q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',
  ['space-002','bad',anotherAccount,member001,{playerId:'bad'}]),/foreign key/);
 await assert.rejects(q("update papa_space_player_profiles set player_id='moved',data=$1",[{playerId:'moved'}]),/PROFILE_IDENTITY_IMMUTABLE/);
 await assert.rejects(q('update papa_space_player_profiles set data=$1',[{...profile,password:'not an account credential'}]),/check constraint/);
 const admin=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-002','space_admin') returning id",[account]))[0].id;
 await assert.rejects(q('update papa_space_player_profiles set membership_id=$1',[admin]),/PLAYER_MEMBERSHIP_REQUIRED/);
 await db.exec('set role anon');
 await assert.rejects(rpc('papa_v2_scoped_read_snapshot_in_space',['room-002','space-002']),/permission denied/);
 await assert.rejects(q('select data from papa_space_player_profiles'),/permission denied/);
 await db.exec('reset role');
});
