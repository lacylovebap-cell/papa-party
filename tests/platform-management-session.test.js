import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {readManagementSession,validateManagementSession} from '../supabase/functions/party-api/management-session.js';
import {createManagementEntry} from '../src/management-entry.js';
const all={version:1,allowed:true,president:true,permissions:{streamers:true,administrators:true,reports:true},sections:['overview','halls','streamers','accounts','cleanup']};
const denied={version:1,allowed:false,president:false,permissions:{streamers:false,administrators:false,reports:false},sections:[]};
const accountId='12345678-1234-1234-1234-123456789abc';

test('management login bridge reads only enabled scoped authority and never promotes the business identity',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('create role anon;create role authenticated;create role service_role;create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,24);');
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await db.exec('create table papa_manager_account_links(manager_key text primary key,account_id uuid unique);create table papa_streamer_accounts(streamer_id text primary key,enabled boolean);');
 await db.exec(fs.readFileSync('ops/platform-management-proposed.sql','utf8'));
 await db.exec(fs.readFileSync('ops/platform-management-directory-proposed.sql','utf8'));
 await db.exec(fs.readFileSync('ops/platform-management-session-proposed.sql','utf8'));
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const president=await account(),owner=await account(),admin=await account(),reporter=await account(),roomManager=await account(),outsider=await account();
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("update papa_spaces set owner_account_id=$1 where id='space-001'",[owner]);
 await q("insert into papa_spaces(id,slug,display_name) values('other','other','Other Hall')");
 await q("insert into papa_space_memberships(account_id,space_id,role,permissions,permissions_explicit) values($1,'space-001','space_admin',array['administrators'],true),($2,'space-001','space_admin',array['reports'],true)",[admin,reporter]);
 await q("insert into papa_space_streamers(streamer_id,space_id) values('room','space-001')");
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id,permissions,permissions_explicit) values($1,'space-001','streamer_admin','room',array['songs','queue','players','announcements','reports'],true)",[roomManager]);
 const read=who=>q('select papa_management_session($1) data',[who]).then(r=>validateManagementSession(r[0].data));
 assert.deepEqual(await read(president),all);
 assert.deepEqual(await read(owner),{...all,president:false});
 assert.deepEqual((await read(admin)).sections,['overview','halls','accounts']);
 assert.deepEqual((await read(reporter)).sections,['overview']);
 assert.deepEqual(await read(roomManager),denied); // existing own-room authority is not hall-wide management
 assert.deepEqual(await read(outsider),denied);
 assert.deepEqual(await read(accountId),denied);
 const halls=(await q("select papa_management_directory($1,'halls','',1) data",[admin]))[0].data;
 assert.deepEqual(halls.rows.map(r=>r.id),['space-001']); // grant editor can select its own hall only
 await assert.rejects(q("select papa_management_detail($1,'other',null,'',1)",[admin]),/ACCESS_DENIED/);
 await q("update papa_space_memberships set status='suspended' where account_id=$1",[admin]);assert.deepEqual(await read(admin),denied);
 await q("update papa_spaces set status='suspended' where id='space-001'");assert.deepEqual(await read(owner),denied);assert.deepEqual(await read(reporter),denied);assert.deepEqual(await read(president),all);
 await q('update papa_accounts set disabled_at=now() where id=$1',[president]);assert.deepEqual(await read(president),denied);
 assert.equal((await q('select count(*)::int n from papa_management_audit'))[0].n,0);
 assert.equal((await q("select count(*)::int n from papa_space_memberships where role='streamer_admin'"))[0].n,1);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(read(owner),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');assert.deepEqual(await read(outsider),denied);
});

test('management session Edge adapter uses verified Account only and projects bounded non-secret capabilities',async()=>{
 const who={accountId,role:'super_admin',token:'existing-token'},copy={...who};let calls=0;
 const api=async(path,args)=>{calls++;assert.equal(path,'/rest/v1/rpc/papa_management_session');assert.deepEqual(args,{subject:accountId});return {...all,accountId:'must-not-leak',token:'must-not-leak',role:'super_admin'};};
 assert.deepEqual(await readManagementSession(api,who),all);assert.deepEqual(who,copy);assert.equal(calls,1);
 for(const role of ['player','streamer_admin','space_admin'])assert.deepEqual(await readManagementSession(api,{accountId,role}),denied);assert.equal(calls,1);
 for(const bad of [null,{accountId:'bad'},{role:'super_admin'}])await assert.rejects(readManagementSession(api,bad),/登入/);
 assert.equal(calls,1);
 for(const bad of [{...all,sections:['overview','overview']},{...denied,allowed:true},{...all,president:true,permissions:{streamers:false,administrators:true,reports:true}},{...all,sections:['overview','halls','streamers','accounts','cleanup','private']},null])assert.throws(()=>validateManagementSession(bad),/尚未確認/);
});

test('management capability loader coalesces, caches, explicitly refreshes and drops late responses after identity change',async()=>{
 let identity={role:'player',token:'existing-player'},resolve,calls=0;
 const initial=identity;const entry=createManagementEntry({identity:()=>identity,api:body=>{assert.deepEqual(body,{op:'platformManagementSession'});calls++;return new Promise(r=>{resolve=r;});}});
 const first=entry.load(),coalesced=entry.load();assert.equal(calls,1);resolve(all);assert.deepEqual(await first,all);assert.deepEqual(await coalesced,all);assert.equal(entry.identity(),identity);assert.equal(identity.role,'player');
 await entry.load();assert.equal(calls,1);
 const forced=entry.load({force:true});assert.equal(calls,2);identity={role:'streamer_admin',token:'other'};resolve(all);assert.equal(await forced,null);assert.equal(entry.identity(),null);
 const next=entry.load();assert.equal(calls,3);identity=null;entry.sync();resolve(all);assert.equal(await next,null);assert.equal(entry.state().capabilities,null);assert.equal(initial.role,'player');
});

test('management capability failure is quiet until explicit retry, with no render-triggered request loop',async()=>{
 const identity={role:'player',token:'same'};let calls=0;
 const entry=createManagementEntry({identity:()=>identity,api:async()=>{calls++;throw Error('offline');}});
 assert.equal(await entry.load(),null);assert.equal(entry.state().error,'offline');await entry.load();await entry.load();assert.equal(calls,1);
 await entry.load({force:true});assert.equal(calls,2);
});

test('synchronous render callbacks cannot reenter the capability loader before its request is reserved',async()=>{
 const identity={role:'player',token:'same'};let calls=0,reentries=0,entry;
 entry=createManagementEntry({identity:()=>identity,api:async()=>{calls++;return all;},changed:()=>{reentries++;if(reentries>5)throw Error('render loop');void entry.load();}});
 await entry.load();assert.equal(calls,1);assert.equal(reentries,2);assert.equal(entry.state().ready,true);
});
