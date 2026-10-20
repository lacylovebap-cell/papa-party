import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createPlatformDirectory} from '../src/platform-directory.js';

test('real foundation and proposed RPC enforce president, bounded literal search, revocation and read-only access',async t=>{
 const db=new PGlite();t.after(()=>db.close());const q=async(s,a=[])=>(await db.query(s,a)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));`);
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await db.exec(fs.readFileSync('ops/platform-directory-proposed.sql','utf8'));
 const president=(await q('insert into papa_accounts default values returning id'))[0].id;
 const manager=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q("insert into papa_platform_roles values($1,'president',now())",[president]);
 await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','space_admin')",[manager]);
 await db.exec("insert into papa_spaces(id,slug,display_name,status) select 'test-'||n,'test-'||n,'Tenant '||n,case when n=1 then 'suspended' else 'active' end from generate_series(1,24)n");
 const read=(id=president,text='',status='all',page=1)=>q('select papa_platform_directory($1,$2,$3,$4) result',[id,text,status,page]).then(r=>r[0].result);
 const before=await q('select * from papa_spaces order by id');
 const first=await read();assert.equal(first.total,25);assert.equal(first.rows.length,20);assert.equal(first.pages,2);
 const last=await read(president,'','all',99);assert.equal(last.page,2);assert.equal(last.rows.length,5);
 assert.equal((await read(president,'','suspended')).total,1);
 assert.equal((await read(president,'%')).total,0,'search treats wildcard literally');
 assert.equal((await read(president,'space-001','active')).rows[0].manager_count,1);
 await assert.rejects(read(manager),/PLATFORM_ACCESS_DENIED/);
 await assert.rejects(read(president,'','all',0),/PLATFORM_QUERY_INVALID/);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(read(),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');assert.equal((await read()).total,25);await db.exec('reset role');
 assert.deepEqual(await q('select * from papa_spaces order by id'),before);
 await q('delete from papa_platform_roles where account_id=$1',[president]);await assert.rejects(read(),/PLATFORM_ACCESS_DENIED/);
 await q("insert into papa_platform_roles values($1,'president',now())",[president]);await q('update papa_accounts set disabled_at=now() where id=$1',[president]);await assert.rejects(read(),/PLATFORM_ACCESS_DENIED/);
});

const result=rows=>({rows,total:rows.length,page:1,pages:1});
test('late responses cannot replace a newer search or reappear after leaving management',async()=>{
 const pending=[];const actor={};let active=actor;
 const directory=createPlatformDirectory({api:b=>new Promise(resolve=>pending.push({b,resolve})),identity:()=>active,escape:String,changed:()=>{}});
 const a=directory.load({q:'old'}),b=directory.load({q:'new'});
 pending[1].resolve(result([{id:'new'}]));await b;pending[0].resolve(result([{id:'old'}]));await a;
 assert.equal(directory.state().rows[0].id,'new');
 const c=directory.load();directory.clear();pending[2].resolve(result([{id:'private'}]));await c;assert.deepEqual(directory.state().rows,[]);
 const d=directory.load();active={};directory.sync();pending[3].resolve(result([{id:'wrong-account'}]));await d;assert.deepEqual(directory.state().rows,[]);
});
test('invalid response and missing authorization never render a tenant list',async()=>{
 const actor={};const directory=createPlatformDirectory({api:async()=>({rows:new Array(21),page:1,pages:1,total:21}),identity:()=>actor,escape:String,changed:()=>{}});
 await directory.load();assert.match(directory.state().error,/尚未確認/);assert.deepEqual(directory.state().rows,[]);
 const denied=createPlatformDirectory({api:()=>assert.fail('must not query'),identity:()=>null,escape:String,changed:()=>{}});await denied.load();assert.match(denied.state().error,/總裁/);
});

test('actual Edge handler rejects non-presidents and uses verified account rather than request identity',async()=>{
 const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8');
 const start=source.indexOf(" if(b.op==='platformDirectory'){");
 const code=source.slice(start,source.indexOf(" if(b.op==='spaceEntry'){",start));
 const invoke=new (Object.getPrototypeOf(async function(){}).constructor)('b','who','isSuper','api','respond',code);
 const calls=[];const api=async(path,args)=>{calls.push({path,args});return result([]);};
 const b={op:'platformDirectory',q:'name',status:'suspended',page:2,accountId:'forged',role:'super_admin'};
 await assert.rejects(invoke(b,{role:'streamer_admin',accountId:'manager'},w=>w.role==='super_admin',api,x=>x),/總裁/);assert.equal(calls.length,0);
 await invoke(b,{role:'super_admin',accountId:'verified'},w=>w.role==='super_admin',api,x=>x);
 assert.deepEqual(calls,[{path:'/rest/v1/rpc/papa_platform_directory',args:{subject:'verified',search_text:'name',status_filter:'suspended',requested_page:2}}]);
 await assert.rejects(invoke({...b,page:-1},{role:'super_admin',accountId:'verified'},()=>true,api,x=>x),/格式/);
});
