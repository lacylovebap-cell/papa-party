import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=fs.readFileSync(new URL('../supabase/migrations/202610120002_message_center_categories.sql',import.meta.url),'utf8');
const communication=fs.readFileSync(new URL('../supabase/migrations/202610080012_communication_space.sql',import.meta.url),'utf8');
const actualFunction=name=>{
 const match=communication.match(new RegExp('create function '+name+'\\([\\s\\S]*?\\$\\$;'));
 assert.ok(match,name);return match[0];
};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const player={role:'player',account_id:id(101),space_id:'space-001',player_id:'P1'};
const native={role:'player',account_id:id(102),space_id:'space-002',player_id:'P1'};
const host={role:'streamer_admin',account_id:id(103),space_id:'space-001',actor_streamer_id:'papa'};
const president={role:'super_admin',account_id:id(104)};
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args)=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args))[0].value;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_spaces(id text primary key,status text not null default 'active');
 create table papa_space_streamers(streamer_id text primary key,space_id text not null references papa_spaces(id));
 create table papa_accounts(id uuid primary key,disabled_at timestamptz);
 create table papa_platform_roles(account_id uuid,role text);
 create table papa_account_legacy_players(account_id uuid,legacy_player_id text);
 create table papa_manager_account_links(account_id uuid,manager_key text);
 create table papa_space_memberships(id uuid primary key,account_id uuid,space_id text,role text,status text,streamer_id text);
 create table papa_space_player_profiles(account_id uuid,membership_id uuid,space_id text,player_id text);
 create table papa_v2_entities(kind text,id text,data jsonb);
 create table papa_notice_preferences(streamer_id text,recipient text,preferences jsonb,primary key(streamer_id,recipient));
 create table papa_notifications(id uuid primary key,space_id text,streamer_id text not null,streamer_name text not null,
  recipient text not null,type text not null,level smallint not null,body text not null,entity_id text,created_at timestamptz not null,
  read_at timestamptz,server_secret text);
 insert into papa_spaces values('space-001','active'),('space-002','active');
 insert into papa_space_streamers values('papa','space-001'),('michelle','space-001'),('other','space-002');
 insert into papa_accounts(id) values('${id(101)}'),('${id(102)}'),('${id(103)}'),('${id(104)}');
 insert into papa_platform_roles values('${id(104)}','president');
 insert into papa_account_legacy_players values('${id(101)}','P1');
 insert into papa_manager_account_links values('${id(103)}','streamer:papa');
 insert into papa_space_memberships values('${id(201)}','${id(101)}','space-001','player','active',null),
  ('${id(202)}','${id(102)}','space-002','player','active',null),('${id(203)}','${id(103)}','space-001','streamer_admin','active','papa');
 insert into papa_space_player_profiles values('${id(102)}','${id(202)}','space-002','P1');
 insert into papa_v2_entities values('players','P1','{"name":"Legacy player"}'),('players','P2','{"name":"Other player"}');
 insert into papa_notice_preferences values('papa','P1','{}'),('__global__','__super__','{}');`);
 await db.exec(actualFunction('papa_communication_player_exists'));
 await db.exec(actualFunction('papa_communication_context'));
 const records=[
  [1,'space-001','papa','P1','system',null],[2,'space-001','papa','P1','message',null],
  [3,'space-001','papa','P1','comment',null],[4,'space-001','papa','P1','announcement',null],
  [5,'space-001','papa','P1','future-type',null],[6,'space-001','papa','P1','completed','2026-10-10T00:00:00Z'],
  [7,'space-001','papa','P2','message',null],[8,'space-001','michelle','P1','message',null],
  [9,'space-002','other','P1','message',null],[10,'space-001','papa','__super__','message',null],
  [11,'space-001','michelle','__super__','comment',null],[12,'space-002','other','__super__','message',null],
  [13,'space-001','papa','__admin__','message',null],[14,'space-001','michelle','__admin__','message',null],
  [15,null,'unmapped','P1','message',null],[16,'space-001','other','P1','message',null]
 ];
 for(const [n,space,room,recipient,type,readAt]of records)await q('insert into papa_notifications values($1,$2,$3,$4,$5,$6,2,$7,$8,$9,$10,$11)',
  [id(n),space,room,room,recipient,type,'body '+n,id(n+1000),'2026-10-11T00:00:00Z',readAt,'never-project-secret']);
 const before=await q('select * from papa_notifications order by id'),preferences=await q('select * from papa_notice_preferences order by streamer_id,recipient');
 await db.exec(migration);
 return {db,q,rpc,before,preferences,
  page:(category='system',page=0,actor=player,space='space-001',room='papa',mode='room')=>rpc('papa_notice_category_page',[space,room,actor,category,page,mode]),
  counts:(actor=player,space='space-001',room='papa',mode='room')=>rpc('papa_notice_category_counts',[space,room,actor,mode]),
  mark:(category,ids=null,actor=player,space='space-001',room='papa',mode='room')=>rpc('papa_notice_category_read',[space,room,actor,category,ids,mode])};
}

test('additive migration preserves every notice field and preferences, excluding unknown/mismapped Space rows from reads',async t=>{
 const h=await fixture(t);assert.deepEqual(await h.q('select * from papa_notifications order by id'),h.before);assert.deepEqual(await h.q('select * from papa_notice_preferences order by streamer_id,recipient'),h.preferences);
 const page=await h.page('message');assert.deepEqual(page.rows.map(row=>row.id),[id(2)]);assert.doesNotMatch(JSON.stringify(page),/never-project-secret|server_secret|body 7|body 8|body 9|body 15|body 16/);
 assert.deepEqual((await h.counts()).totalsByCategory,{system:3,message:1,board:2});
});

test('category pages read exactly the selected 50+1 rows with deterministic ordering and an independent small count response',async t=>{
 const h=await fixture(t);
 await h.q(`insert into papa_notifications(id,space_id,streamer_id,streamer_name,recipient,type,level,body,created_at)
  select gen_random_uuid(),'space-001','papa','怕怕','P1',case n%3 when 0 then 'system' when 1 then 'message' else 'comment' end,2,
   'category '||n,'2026-10-11T00:00:00Z'::timestamptz+n*interval '1 second' from generate_series(1,363) n`);
 const first=await h.page('message'),second=await h.page('message',1),last=await h.page('message',2);
 assert.equal(first.rows.length,50);assert.equal(second.rows.length,50);assert.equal(last.rows.length,22);assert.equal(first.hasMore,true);assert.equal(last.hasMore,false);
 assert.equal(first.total,122);assert.ok(first.snapshotAt);assert.equal(second.total,122);
 assert.equal(new Set([...first.rows.slice(0,50),...second.rows.slice(0,50),...last.rows].map(row=>row.id)).size,122);
 assert.ok(first.rows.every(row=>row.type==='message'));assert.ok(first.rows.every((row,i,rows)=>!i||Date.parse(rows[i-1].created_at)>=Date.parse(row.created_at)));
 const counts=await h.counts();assert.deepEqual(counts.totalsByCategory,{system:124,message:122,board:123});assert.deepEqual(counts.unreadByCategory,{system:123,message:122,board:123});
 assert.doesNotMatch(JSON.stringify(counts),/category 1|body |never-project|rows|preferences|topic/);
 assert.equal(first.page,0);assert.equal(second.page,1);assert.equal(last.pageSize,50);
});

test('a paging snapshot excludes later arrivals so page jumps retain the same total and no duplicate records',async t=>{
 const h=await fixture(t);
 await h.q(`insert into papa_notifications(id,space_id,streamer_id,streamer_name,recipient,type,level,body,created_at)
 select gen_random_uuid(),'space-001','papa','怕怕','P1','message',2,'old '||n,
 '2026-10-10T00:00:00Z'::timestamptz+n*interval '1 second' from generate_series(1,120) n`);
 const first=await h.page('message');assert.equal(first.total,121);
 await h.q(`insert into papa_notifications(id,space_id,streamer_id,streamer_name,recipient,type,level,body,created_at)
 values($1,'space-001','papa','怕怕','P1','message',2,'new arrival',$2::timestamptz+interval '1 millisecond')`,[id(9999),first.snapshotAt]);
 await h.q(`insert into papa_notifications(id,space_id,streamer_id,streamer_name,recipient,type,level,body,created_at)
 values($1,'space-001','papa','怕怕','P1','message',2,'late commit with old timestamp','2026-10-11T00:00:00Z')`,[id(9998)]);
 const next=await h.rpc('papa_notice_category_page',['space-001','papa',player,'message',1,'room',first.snapshotAt,first.snapshotId]);
 assert.equal(next.total,121);assert.equal(next.snapshotAt,first.snapshotAt);assert.equal(next.rows.length,50);
 const firstIds=new Set(first.rows.map(row=>row.id));assert.ok(next.rows.every(row=>!firstIds.has(row.id)&&row.id!==id(9999)&&row.id!==id(9998)));
 assert.equal(next.snapshotId,first.snapshotId);assert.equal((await h.page('message')).total,123,'a fresh snapshot includes both later arrivals');
 await assert.rejects(h.rpc('papa_notice_category_page',['space-001','papa',player,'message',0,'room','2100-01-01T00:00:00Z']),/NOTICE_PAGE_INVALID/);
});

test('snapshot identity, category, preference changes and expiry cannot cross a private page boundary',async t=>{
 const h=await fixture(t),first=await h.page('message');
 const args=['space-001','papa',player,'message',0,'room',null,first.snapshotId];
 for(const replacement of [{2:president},{3:'system'},{1:'michelle'}]){
  const next=[...args];for(const [i,value]of Object.entries(replacement))next[Number(i)]=value;
  await assert.rejects(h.rpc('papa_notice_category_page',next),/NOTICE_SNAPSHOT_INVALID/);
 }
 await h.q("update papa_notice_preferences set preferences=$1 where streamer_id='papa' and recipient='P1'",[{types:{message:{center:false}}}]);
 await assert.rejects(h.rpc('papa_notice_category_page',args),/NOTICE_SNAPSHOT_INVALID/);
 await h.q("update papa_notice_preferences set preferences='{}' where streamer_id='papa' and recipient='P1'");
 await h.q("update papa_notice_page_snapshots set expires_at=now()-interval '1 second' where id=$1",[first.snapshotId]);
 await assert.rejects(h.rpc('papa_notice_category_page',args),/NOTICE_SNAPSHOT_INVALID/);
 const current=await h.page('message');assert.notEqual(current.snapshotId,first.snapshotId);
 assert.equal((await h.q('select count(*)::int count from papa_notice_page_snapshots where id=$1',[first.snapshotId]))[0].count,0);
 assert.deepEqual(await h.q('select * from papa_notifications order by id'),h.before,'cache expiry does not delete a formal notice');
 await h.db.exec('set role authenticated');await assert.rejects(h.q('select id from papa_notice_page_snapshots'),/permission denied/);await h.db.exec('reset role');
});

test('explicit Room/Space and actual actor context isolate identical player IDs and deny role or account substitution',async t=>{
 const h=await fixture(t);assert.deepEqual((await h.page('message',0,native,'space-002','other')).rows.map(row=>row.id),[id(9)]);
 await assert.rejects(h.page('message',0,player,'space-002','other'),/COMMUNICATION_ACTOR_INVALID/);
 await assert.rejects(h.page('message',0,player,'space-002','papa'),/COMMUNICATION_SCOPE_INVALID/);
 await assert.rejects(h.page('message',0,{...player,player_id:'P2'}),/COMMUNICATION_ACTOR_INVALID/);
 await assert.rejects(h.page('message',0,{...player,role:'super_admin'}),/COMMUNICATION_ACTOR_INVALID/);
 await assert.rejects(h.page('message',0,host,'space-001','michelle'),/COMMUNICATION_ACTOR_INVALID/);
 await assert.rejects(h.page('message',0,player,'space-001','papa','space'),/NOTICE_SCOPE_INVALID/);
 assert.deepEqual((await h.page('message',0,host)).rows.map(row=>row.id),[id(13)]);
});

test('President defaults to the selected Room and needs explicit space scope, never including another Space',async t=>{
 const h=await fixture(t);assert.deepEqual((await h.page('message',0,president)).rows.map(row=>row.id),[id(10)]);
 const selected=await h.counts(president,'space-001','papa','space');assert.deepEqual(selected.scope,{spaceId:'space-001',streamerId:null,mode:'space'});assert.deepEqual(selected.totalsByCategory,{system:0,message:1,board:1});
 assert.deepEqual((await h.counts(president,'space-002','other','space')).totalsByCategory,{system:0,message:1,board:0});
 await assert.rejects(h.counts(president,null,'papa','space'),/NOTICE_SCOPE_INVALID/);
 await assert.rejects(h.counts(president,'space-001','unknown','space'),/COMMUNICATION_SCOPE_INVALID/);
});

test('center preferences filter before pagination; hidden event counts remain available only in raw type unread aggregates',async t=>{
 const h=await fixture(t);await h.q("update papa_notice_preferences set preferences=$1 where streamer_id='papa' and recipient='P1'",[{muteAll:true,types:{message:{center:false},system:{center:false},announcement:{center:false}}}]);
 assert.equal((await h.page('message')).rows.length,0);assert.equal((await h.page('system')).rows.length,1,'completed stays visible; future-type follows system');
 assert.deepEqual((await h.page('board')).rows.map(row=>row.id),[id(3)]);
 const counts=await h.counts();assert.deepEqual(counts.totalsByCategory,{system:1,message:0,board:1});assert.deepEqual(counts.unreadByCategory,{system:0,message:0,board:1});
 assert.equal(counts.unreadByType.message,1);assert.equal(counts.unreadByType['future-type'],1);assert.equal(counts.unreadByType.system,1);
 assert.equal((await h.mark('message')).marked,0,'all-read cannot accidentally read hidden notices');
});

test('category-only all-read changes just visible unread rows in that actor scope and preserves all IDs, timestamps and existing read times',async t=>{
 const h=await fixture(t),marked=await h.mark('board');assert.equal(marked.marked,2);assert.equal((await h.mark('board')).marked,0);
 const after=await h.q('select * from papa_notifications order by id');
 for(let i=0;i<after.length;i++){
  const old=h.before[i],next=after[i];assert.deepEqual({...next,read_at:old.read_at},old);
  if([id(3),id(4)].includes(old.id))assert.ok(next.read_at);else assert.deepEqual(next.read_at,old.read_at);
 }
 const counts=await h.counts();assert.deepEqual(counts.unreadByCategory,{system:2,message:1,board:0});
 assert.equal((await h.mark('message',[id(2),id(7),id(8),id(9),id(3)])).marked,1,'recipient/Room/Space/category all participate in the write filter');
});

test('badge preferences remain independent from center visibility and mute-all',async t=>{
 const h=await fixture(t);
 await h.q("update papa_notice_preferences set preferences=$1 where streamer_id='papa' and recipient='P1'",[{muteAll:true,types:{message:{center:true,badge:false},comment:{center:false,badge:true}}}]);
 const counts=await h.counts();
 assert.deepEqual(counts.unreadByCategory,{system:2,message:1,board:1});
 assert.deepEqual(counts.badgeUnreadByCategory,{system:2,message:0,board:2});
 assert.equal(counts.unreadByType.message,1);
});

test('read batches and paging inputs are bounded; empty IDs are a no-op and foreign IDs cannot change another category or actor',async t=>{
 const h=await fixture(t);assert.equal((await h.mark('system',[])).marked,0);assert.equal((await h.mark('system',[id(2),id(7)])).marked,0);
 await assert.rejects(h.mark('message',Array(51).fill(id(2))),/NOTICE_READ_INVALID/);await assert.rejects(h.mark('message',[null]),/NOTICE_READ_INVALID/);
 for(const category of [null,'all','Message'])await assert.rejects(h.page(category),/NOTICE_PAGE_INVALID/);
 for(const page of [-1,100001,null])await assert.rejects(h.page('message',page),/NOTICE_PAGE_INVALID/);
 assert.equal((await h.page('message',100000)).rows.length,0);
 assert.deepEqual(await h.q('select * from papa_notifications order by id'),h.before);
});

test('revoked Membership or disabled Account rejects reads and category writes without altering any notices',async t=>{
 const h=await fixture(t);await h.q("update papa_space_memberships set status='suspended' where account_id=$1",[player.account_id]);
 await assert.rejects(h.counts(),/COMMUNICATION_ACTOR_INVALID/);await assert.rejects(h.mark('message'),/COMMUNICATION_ACTOR_INVALID/);
 await h.q("update papa_accounts set disabled_at=now() where id=$1",[president.account_id]);await assert.rejects(h.page('message',0,president),/COMMUNICATION_ACTOR_INVALID/);
 assert.deepEqual(await h.q('select * from papa_notifications order by id'),h.before);
});

test('new category RPCs and internal helpers are service-role-only',async t=>{
 const h=await fixture(t),functions=await h.q("select oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and proname in ('papa_notice_category','papa_notice_preference_type','papa_notice_category_scope','papa_notice_category_page','papa_notice_category_counts','papa_notice_category_read')");
 assert.equal(functions.length,6);
 for(const {signature}of functions){const rights=(await h.q("select has_function_privilege('anon',$1,'execute') a,has_function_privilege('authenticated',$1,'execute') b,has_function_privilege('service_role',$1,'execute') c",[signature]))[0];assert.deepEqual(rights,{a:false,b:false,c:true});}
 await h.db.exec('set role authenticated');await assert.rejects(h.counts(),/permission denied/);await h.db.exec('reset role');
});

const displayMigration=fs.readFileSync(new URL('../supabase/migrations/202610120007_message_center_preferences.sql',import.meta.url),'utf8');
test('scoped display preferences preserve legacy delivery preferences and formal notices, and isolate Account, Room, Space and role',async t=>{
 const f=await fixture(t),notices=await f.q('select * from papa_notifications order by id'),legacy=await f.q('select * from papa_notice_preferences order by streamer_id,recipient');
 await f.db.exec(displayMigration);assert.deepEqual(await f.q('select * from papa_notifications order by id'),notices);assert.deepEqual(await f.q('select * from papa_notice_preferences order by streamer_id,recipient'),legacy);
 const settings=(actor=player,space='space-001',room='papa',mode='room',value=null)=>f.rpc('papa_notice_center_preferences_set',[space,room,actor,mode,value]);
 const before=await f.counts(),nativeBefore=await f.counts(native,'space-002','other'),otherBefore=await f.counts(player,'space-001','michelle');
 const snapshot=await f.page('message');
 const hidden={types:{message:{center:false,badge:false}}};await settings(player,'space-001','papa','room',hidden);
 const after=await f.counts();assert.equal(after.unreadByCategory.message,0);assert.equal(after.badgeUnreadByCategory.message,0);assert.equal(after.unreadByCategory.system,before.unreadByCategory.system);
 assert.deepEqual(await f.counts(native,'space-002','other'),nativeBefore);assert.deepEqual(await f.counts(player,'space-001','michelle'),otherBefore);
 assert.equal((await settings(host)).settings.types.message.center,true);assert.equal((await settings(player)).settings.types.message.center,false);
 await assert.rejects(f.rpc('papa_notice_category_page',['space-001','papa',player,'message',0,'room',snapshot.snapshotAt,snapshot.snapshotId]),/NOTICE_SNAPSHOT_INVALID/);
 await settings(president,'space-001','papa','space',hidden);assert.equal((await settings(president,'space-001','michelle','space')).settings.types.message.center,false);assert.equal((await settings(president,'space-002','other','space')).settings.types.message.center,true);assert.equal((await settings(president,'space-001','papa','room')).settings.types.message.center,true);
 const saved=await f.q('select * from papa_notice_center_preferences order by account_id,space_id');
 for(const value of [{types:{unknown:{center:true,badge:true}}},{types:{message:{center:'yes',badge:true}}},{types:{message:{center:true,badge:true,push:true}}},{muteAll:true,types:{}},[],{types:[]}])await assert.rejects(settings(player,'space-001','papa','room',value),/NOTICE_CENTER_SETTINGS_INVALID/);
 await assert.rejects(settings({...player,account_id:id(104)}),/ACTOR|MEMBER|PLAYER/);await assert.rejects(settings(player,'space-002','other'),/ACTOR|MEMBER|PLAYER|SCOPE/);
 assert.deepEqual(await f.q('select * from papa_notice_center_preferences order by account_id,space_id'),saved);assert.deepEqual(await f.q('select * from papa_notifications order by id'),notices);assert.deepEqual(await f.q('select * from papa_notice_preferences order by streamer_id,recipient'),legacy);
 for(const role of ['anon','authenticated']){await f.db.exec('set role '+role);await assert.rejects(settings(),/permission denied/);await f.db.exec('reset role');}
});
