import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createPublicRoutes} from '../supabase/functions/party-api/public-routes.js';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const manager={role:'streamer_admin',accountId:A,spaceId:'space-001',streamer_id:'papa'},president={role:'super_admin',accountId:B};
const migration=fs.readFileSync('supabase/migrations/202610190001_public_routes.sql','utf8');
async function fixture(t,{beforeMigration=null}={}){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_accounts(id uuid primary key,disabled_at timestamptz);
 create table papa_spaces(id text primary key,status text not null);
 create table papa_space_streamers(streamer_id text primary key,space_id text references papa_spaces(id),unique(streamer_id,space_id));
 create table papa_space_memberships(account_id uuid,space_id text,role text,streamer_id text,status text);
 create table papa_platform_roles(account_id uuid,role text);
 create table papa_manager_account_links(manager_key text,account_id uuid);
 create table papa_streamer_accounts(streamer_id text,enabled boolean);
 create table papa_v2_entities(kind text,id text,data jsonb,space_id text);
 create table papa_events(id int primary key,data jsonb);
 create table papa_v2_revision(id int,revision int);
 insert into papa_accounts values('${A}',null),('${B}',null),('${C}',null);
 insert into papa_spaces values('space-001','active'),('space-002','active'),('space-003','active');
 insert into papa_space_streamers values('papa','space-001'),('mimi','space-001'),('other','space-002'),('other2','space-002'),('indie','space-003');
 insert into papa_space_memberships values('${A}','space-001','streamer_admin','papa','active'),('${C}','space-002','streamer_admin','other','active');
 insert into papa_platform_roles values('${B}','president');
 insert into papa_manager_account_links values('president','${B}'),('streamer:papa','${A}'),('streamer:other','${C}');
 insert into papa_streamer_accounts values('papa',true),('other',true);
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa","slug":"papa","display_name":"怕怕","active":true},{"id":"mimi","slug":"mimi","active":true},{"id":"other","slug":"other","active":true},{"id":"other2","slug":"other2","active":true},{"id":"indie","slug":"indie","active":true}],"streamerSettings":{"papa":{"password":"never-public"}}}',null),
 ('ledger','L1','{"amount":3,"memo":"preserve"}','space-001'),('queue','Q1','{"status":"completed","at":"2026-10-12T12:30:00Z"}','space-001');
 insert into papa_events values(1,'{"original":"private-audit"}');insert into papa_v2_revision values(1,100);`);
 const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const snapshot=async()=>Promise.all(['papa_accounts','papa_spaces','papa_space_streamers','papa_space_memberships','papa_platform_roles','papa_manager_account_links','papa_streamer_accounts','papa_v2_entities','papa_events','papa_v2_revision'].map(table=>q('select coalesce(jsonb_agg(t order by t::text),\'[]\'::jsonb) v from (select to_jsonb(x) t from '+table+' x) z')));
 if(beforeMigration){await beforeMigration({db,q,snapshot});return {db,q,snapshot};}
 const before=await snapshot();await db.exec(migration);assert.deepEqual(await snapshot(),before,'migration must not alter existing business/auth/Audit');
 const call=async(name,args)=> (await q('select papa_public_route_'+name+'('+Object.keys(args).map((key,i)=>key+'=> $'+(i+1)).join(',')+') v',Object.values(args)))[0].v;
 const requests=[],api=async(path,body)=>{requests.push({path,body});return call(path.split('papa_public_route_')[1],body);};
 const routes=createPublicRoutes({api});
 const target={spaceId:'space-001',streamerId:'papa'};
 const configure=(spaceId,code,layout='hall')=>routes.save(president,{spaceId,kind:'hall',code,layout,revision:0});
 return {db,q,call,routes,target,requests,snapshot,before,configure};
}

test('confirmed seeds resolve stable IDs only; service-only functions and RLS expose no private tables or helpers',async t=>{
 const f=await fixture(t),r=await f.routes.resolve('/PA');
 assert.equal(r.canonicalPath,'/pa');assert.equal(r.streamerId,'papa');assert.equal(r.spaceId,'space-001');assert.equal(r.isAlias,true);
 assert.equal((await f.routes.resolve('/sm')).kind,'hall');assert.equal(await f.routes.resolve('/solo/indie'),null);
 assert.equal(await f.routes.resolve('/sm/PAPA'),null);assert.equal(await f.routes.resolve('/unknown'),null);
 assert.doesNotMatch(JSON.stringify(r),/password|streamerSettings|private-audit|account/);
 assert.equal((await f.routes.info(f.target)).canonicalPath,'/pa');
 for(const role of ['anon','authenticated'])for(const fn of ['papa_public_route_resolve(text)','papa_public_route_info(text,text,text)','papa_public_route_settings(text,text,jsonb,text)','papa_public_route_save(text,text,jsonb,text,text,bigint,text)'])
  assert.equal((await f.q('select has_function_privilege($1,$2,\'execute\') v',[role,fn]))[0].v,false);
 for(const table of ['spaces','streamers','aliases','audit']){
  assert.equal((await f.q('select relrowsecurity v from pg_class where relname=$1',['papa_public_route_'+table]))[0].v,true);
  assert.equal((await f.q('select has_table_privilege(\'service_role\',$1,\'select\') v',['papa_public_route_'+table]))[0].v,false);
 }
 await f.db.exec('set role service_role');assert.equal((await f.routes.resolve('/pa')).streamerId,'papa');
 await assert.rejects(f.q('select * from papa_public_route_aliases'),/permission denied/);
 await assert.rejects(f.q("select papa_public_route_result('space-001','papa','streamer')"),/permission denied/);await f.db.exec('reset role');
});

test('missing confirmed stable mapping aborts migration without changing business records or leaving a partial registry',async t=>{
 const f=await fixture(t,{beforeMigration:async({q})=>q("delete from papa_space_streamers where streamer_id='papa'")});
 const before=await f.snapshot();await assert.rejects(f.db.exec(migration),/CONFIRMED_SEED_SCOPE_MISSING/);await f.db.exec('rollback');
 assert.deepEqual(await f.snapshot(),before);assert.equal((await f.q("select to_regclass('public.papa_public_route_aliases') is null v"))[0].v,true);
});

test('verified streamer edits own code; repeated and case-insensitive paths remain immutable direct aliases to latest identity',async t=>{
 const f=await fixture(t);
 let r=await f.routes.save(manager,{...f.target,code:'PAPA',revision:0});assert.equal(r.canonicalPath,'/PAPA');assert.equal(r.revision,1);
 r=await f.routes.save(manager,{...f.target,code:'PAPA520',revision:1});assert.equal(r.canonicalPath,'/PAPA520');assert.equal(r.revision,2);
 for(const path of ['/pa','/PAPA','/pApA','/papa520']){const resolved=await f.routes.resolve(path);assert.equal(resolved.canonicalPath,'/PAPA520');assert.equal(resolved.streamerId,'papa');}
 assert.equal((await f.routes.save(manager,{...f.target,code:'PAPA520',revision:1})).changed,false,'retry same committed value is a no-op even if old revision');
 assert.equal((await f.q('select count(*)::int n from papa_public_route_audit'))[0].n,2);
 await assert.rejects(f.routes.save(manager,{...f.target,code:'Next',revision:0}),/VERSION_CONFLICT/);
 await assert.rejects(f.q("delete from papa_public_route_aliases where path_key='/pa'"),/HISTORY_IMMUTABLE/);
 await assert.rejects(f.q("update papa_public_route_aliases set streamer_id='mimi' where path_key='/pa'"),/HISTORY_IMMUTABLE/);
 assert.deepEqual(await f.snapshot(),f.before);
});

test('historical aliases cannot be reassigned and all invalid/system codes are refused without writes',async t=>{
 const f=await fixture(t);
 await f.routes.save(manager,{...f.target,code:'PAPA520',revision:0});
 for(const code of ['PA','pa','sm','admin','assets','book','home','solo','pa.ID','a/b','a?x=1','a#admin','%61','a_b','-a','a-','', '中']){
  const result=await f.routes.check(president,{spaceId:'space-001',streamerId:'mimi',code});assert.equal(result.available,false,code);
 }
 await assert.rejects(f.routes.check(president,{spaceId:'space-001',streamerId:'mimi',code:'a'.repeat(41)}),/正確/);
 assert.equal((await f.routes.check(president,{spaceId:'space-001',streamerId:'mimi',code:'pApA520'})).available,false);
 await assert.rejects(f.routes.save(president,{spaceId:'space-001',streamerId:'mimi',code:'pApA520',revision:1}),/UNAVAILABLE/);
 await f.routes.save(president,{spaceId:'space-001',streamerId:'mimi',code:'Another',revision:1});
 assert.equal((await f.routes.check(president,{spaceId:'space-001',streamerId:'mimi',code:'PAPA520'})).available,false);
 assert.equal((await f.q('select count(*)::int n from papa_public_route_audit'))[0].n,2);
 assert.deepEqual(await f.snapshot(),f.before);
});

test('other hall dot homes and independent pa dot namespace use explicit Space configuration; hall renames preserve every old URL in one hop',async t=>{
 const f=await fixture(t);
 assert.equal((await f.routes.check(president,{spaceId:'space-002',streamerId:'other',code:'Singer'})).reason,'space_not_configured');
 await f.configure('space-002','qq');
 await f.routes.save(president,{spaceId:'space-002',streamerId:'other',code:'Singer',revision:1});
 await f.routes.save(president,{spaceId:'space-002',streamerId:'other',code:'Singer2',revision:2});
 await f.routes.save(president,{spaceId:'space-002',kind:'hall',code:'QQ2',revision:3});
 for(const path of ['/qq.Singer','/qq.Singer2','/qq2.SINGER2'])assert.equal((await f.routes.resolve(path)).canonicalPath,'/QQ2.Singer2');
 assert.equal((await f.routes.resolve('/qq')).canonicalPath,'/QQ2');
 await f.routes.save(president,{spaceId:'space-002',kind:'hall',code:'QQ3',revision:4});
 assert.equal((await f.routes.resolve('/qq.Singer')).canonicalPath,'/QQ3.Singer2');
 assert.equal((await f.routes.resolve('/QQ2')).canonicalPath,'/QQ3');
 assert.equal((await f.routes.check(president,{spaceId:'space-002',streamerId:'other2',code:'Singer'})).available,false,'an old room code stays owned after a hall rename even if new exact URL was never activated');
 await f.configure('space-003','pa','independent');
 const indie=await f.routes.save(president,{spaceId:'space-003',streamerId:'indie',code:'Singer',revision:1});assert.equal(indie.canonicalPath,'/pa.Singer');
 assert.equal((await f.routes.resolve('/PA.singer')).streamerId,'indie');assert.equal((await f.routes.info({spaceId:'space-003',streamerId:'indie'})).layout,'independent');
 assert.equal(await f.routes.info({spaceId:'space-003',kind:'hall'}),null);
 assert.equal((await f.routes.resolve('/pa')).streamerId,'papa','independent prefix cannot steal Papa homepage');
 assert.deepEqual(await f.snapshot(),f.before);
});

test('forged role, stale memberships, disabled accounts/rooms, cross-Space targets and layout changes cannot gain authority',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.routes.settings({...manager,role:'super_admin'},f.target),/ACTOR_INVALID/);
 await assert.rejects(f.routes.save(manager,{spaceId:'space-001',streamerId:'mimi',code:'Mimi',revision:0}),/SCOPE_DENIED/);
 await assert.rejects(f.routes.save(manager,{spaceId:'space-002',streamerId:'other',code:'Other',revision:0}),/SCOPE_DENIED/);
 await assert.rejects(f.routes.save(manager,{spaceId:'space-001',kind:'hall',code:'OtherHall',revision:0}),/MANAGER_REQUIRED/);
 await assert.rejects(f.routes.save(manager,{...f.target,layout:'independent',code:'Papa',revision:0}),/LAYOUT_INVALID/);
 await assert.rejects(f.routes.settings({role:'player',accountId:A},f.target),/請先/);
 await f.q("update papa_space_memberships set status='suspended' where account_id=$1",[A]);
 await assert.rejects(f.routes.settings(manager,f.target),/SCOPE_DENIED/);await f.q("update papa_space_memberships set status='active'");
 await f.q('update papa_accounts set disabled_at=now() where id=$1',[A]);await assert.rejects(f.routes.settings(manager,f.target),/ACTOR_INVALID/);
 await f.q('update papa_accounts set disabled_at=null where id=$1',[A]);await f.q("update papa_streamer_accounts set enabled=false where streamer_id='papa'");
 await assert.rejects(f.routes.settings(manager,f.target),/SCOPE_DENIED/);
 await f.q("update papa_v2_entities set data=jsonb_set(data,'{streamers,0,active}','false') where kind='meta'");
 assert.equal(await f.routes.resolve('/pa'),null);assert.equal(await f.routes.info(f.target),null);
 await f.q("update papa_spaces set status='suspended' where id='space-001'");assert.equal(await f.routes.resolve('/sm'),null);
 assert.equal((await f.q('select count(*)::int n from papa_public_route_audit'))[0].n,0);
});

test('transaction failure rolls back code, aliases, scoped revision and Audit together; serialized stale edits cannot double apply',async t=>{
 const f=await fixture(t),before=await f.routes.settings(manager,f.target);
 await f.db.exec(`create function fail_url_audit() returns trigger language plpgsql as $$begin raise exception 'FORCED_AUDIT_FAILURE';end$$;
 create trigger fail_url_audit before insert on papa_public_route_audit for each row execute function fail_url_audit();`);
 await assert.rejects(f.routes.save(manager,{...f.target,code:'NewPapa',revision:0}),/FORCED_AUDIT_FAILURE/);
 assert.deepEqual(await f.routes.settings(manager,f.target),before);assert.equal(await f.routes.resolve('/NewPapa'),null);
 await f.db.exec('drop trigger fail_url_audit on papa_public_route_audit');
 const results=await Promise.allSettled(['One','Two'].map(code=>f.routes.save(manager,{...f.target,code,revision:0})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
 assert.equal((await f.q('select count(*)::int n from papa_public_route_audit'))[0].n,1);
 assert.equal((await f.routes.settings(manager,f.target)).revision,1);assert.deepEqual(await f.snapshot(),f.before);
});

test('a child-path reservation failure during hall rename rolls back the hall and every child path',async t=>{
 const f=await fixture(t);await f.configure('space-002','qq');
 await f.routes.save(president,{spaceId:'space-002',streamerId:'other',code:'Singer',revision:1});
 await f.routes.save(president,{spaceId:'space-002',streamerId:'other2',code:'Singer2',revision:2});
 const before=await f.routes.settings(president,{spaceId:'space-002',kind:'hall'});
 await f.db.exec(`create function fail_url_child() returns trigger language plpgsql as $$begin if new.path_key='/newhall.singer2' then raise exception 'FORCED_CHILD_FAILURE';end if;return new;end$$;
 create trigger fail_url_child before insert on papa_public_route_aliases for each row execute function fail_url_child();`);
 await assert.rejects(f.routes.save(president,{spaceId:'space-002',kind:'hall',code:'NewHall',revision:3}),/FORCED_CHILD_FAILURE/);
 assert.deepEqual(await f.routes.settings(president,{spaceId:'space-002',kind:'hall'}),before);assert.equal(await f.routes.resolve('/NewHall'),null);assert.equal(await f.routes.resolve('/NewHall.Singer'),null);
 assert.equal((await f.routes.resolve('/qq.Singer')).canonicalPath,'/qq.Singer');
 assert.equal((await f.q('select count(*)::int n from papa_public_route_audit'))[0].n,3);
});

test('Edge adapter ignores untrusted authority fields, validates before calls, whitelists outputs and uses only bounded RPCs',async t=>{
 const f=await fixture(t);await f.routes.check(manager,{...f.target,code:'PapaNew',actor_context:{role:'super_admin',account_id:B},accountId:B,role:'super_admin'});
 const request=f.requests.at(-1);assert.equal(request.path,'/rest/v1/rpc/papa_public_route_check');assert.deepEqual(request.body.actor_context,{role:'streamer_admin',account_id:A,space_id:'space-001',actor_streamer_id:'papa'});
 assert.equal((await f.routes.info({spaceId:'space-001',kind:'hall',streamer:'papa'})).kind,'hall');
 assert.equal((await f.routes.info({...f.target,streamer:'outdated-slug'})).streamerId,'papa');
 await assert.rejects(f.routes.info({spaceId:'space-001',streamer:'papa'}),/範圍/);
 const calls=f.requests.length;for(const path of ['/pa?token=secret','https://paparty.app/pa','/pa#admin','/../../admin','/%70a'])assert.equal(await f.routes.resolve(path),null);
 await assert.rejects(f.routes.save(manager,{...f.target,code:'Name',revision:'0'}),/版本/);await assert.rejects(f.routes.settings({...manager,accountId:null,account_id:A},f.target),/身分/);
 assert.equal(f.requests.length,calls);
 const base=await f.routes.settings(manager,f.target),safe=createPublicRoutes({api:async()=>({...base,secret:'no',privatePlayer:'no'})});
 assert.equal((await safe.settings(manager,f.target)).secret,undefined);
 await assert.rejects(createPublicRoutes({api:async()=>({...base,canonicalPath:'https://evil.test/'})}).settings(manager,f.target),/尚未確認/);
 await assert.rejects(createPublicRoutes({api:async()=>({...base,spaceId:'space-002',streamerId:'other'})}).info(f.target),/尚未確認/);
 assert.ok(f.requests.every(r=>r.path.startsWith('/rest/v1/rpc/papa_public_route_')));
});
