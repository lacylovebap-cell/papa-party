import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createPublicAppHomes} from '../supabase/functions/party-api/pwa-homes.js';

const sql=fs.readFileSync(new URL('../ops/pwa-public-homes-rpc-20261020.sql',import.meta.url),'utf8');
const source=(room='papa',extra={})=>({v:1,kind:'streamer',spaceId:'space-001',streamerId:room,...extra});
const row=(extra={})=>({kind:'streamer',spaceId:'space-001',streamerId:'papa',streamerSlug:'papa',name:'怕怕',spaceName:'聲瑪',
 canonicalPath:'/pa',homePath:'/pa',active:true,...extra});
const page=(items,total=items.length,pageNumber=1,pageSize=12)=>({items,total,page:pageNumber,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize))});

async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_spaces(id text primary key,display_name text,status text);
 create table papa_space_streamers(streamer_id text primary key,space_id text);
 create table papa_v2_entities(kind text,id text,data jsonb);
 create table papa_public_route_spaces(space_id text primary key,layout text,code text);
 create table papa_public_route_streamers(space_id text,streamer_id text,code text);
 create function papa_public_route_home(layout text,hall_code text,room_code text) returns text
 language sql immutable as $$select case layout when 'flat' then '/'||room_code when 'hall' then '/'||hall_code||'.'||room_code when 'independent' then '/pa.'||room_code end$$;
 insert into papa_spaces values('space-001','聲瑪','active'),('space-native','新廳','active');
 insert into papa_space_streamers values('papa','space-001'),('mimi-id','space-001'),('inactive','space-001'),('native','space-native');
 insert into papa_public_route_spaces values('space-001','flat','sm'),('space-native','hall','newhall');
 insert into papa_public_route_streamers values('space-001','papa','pa'),('space-native','native','NATIVE');
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa","slug":"papa","display_name":"怕怕","active":true,"password":"secret"},{"id":"mimi-id","slug":"snow","display_name":"米雪","active":true,"private":"private"},{"id":"inactive","slug":"inactive","display_name":"停用","active":false},{"id":"native","slug":"native","display_name":"尚未開放","active":true}],"streamerSettings":{"papa":{"password":"secret"}}}'),
 ('ledger','L1','{"amount":5}'),('queue','Q1','{"status":"completed"}');
 revoke all on all tables in schema public from public,anon,authenticated,service_role;`);
 const snapshot=async()=>(await db.query("select jsonb_agg(to_jsonb(e) order by kind,id) value from papa_v2_entities e")).rows[0].value;
 const before=await snapshot();await db.exec(sql);assert.deepEqual(await snapshot(),before);
 const calls=[];
 const api=async(path,args)=>{calls.push({path,args});assert.equal(path,'/rest/v1/rpc/papa_public_app_homes');
  return (await db.query('select papa_public_app_homes('+Object.keys(args).map((key,i)=>key+'=> $'+(i+1)).join(',')+') value',Object.values(args))).rows[0].value;};
 return {db,calls,homes:createPublicAppHomes({api}),snapshot,before};
}

test('one bounded database query exposes only active public business homes, including unconfigured streamer legacy URLs',async t=>{
 const f=await fixture(t),listed=await f.homes.list({pageSize:2});
 assert.equal(listed.total,3);assert.equal(listed.totalPages,2);assert.equal(listed.items.length,2);assert.equal(f.calls.length,1);
 const second=await f.homes.list({page:2,pageSize:2});assert.equal(second.items.length,1);assert.equal(f.calls.length,2);
 const mimi=await f.homes.one(source('mimi-id'));assert.equal(mimi.name,'米雪');assert.equal(mimi.streamerSlug,'snow');
 assert.equal(mimi.canonicalPath,null);assert.equal(mimi.homePath,'/v2.html?streamer=snow#home');
 assert.equal((await f.homes.one(source())).homePath,'/pa');
 assert.equal((await f.homes.one(source(null,{kind:'hall'}))).homePath,'/sm');
 assert.doesNotMatch(JSON.stringify(listed),/secret|password|private|streamerSettings|queue|ledger/);
 assert.deepEqual(await f.snapshot(),f.before);
});

test('source resolution uses exact stable IDs, never display labels or a claimed URL, and excludes inactive/native-guarded scopes',async t=>{
 const f=await fixture(t);
 assert.equal(await f.homes.one(source('米雪')),null);
 assert.equal(await f.homes.one(source('missing')),null);
 assert.equal(await f.homes.one(source('inactive')),null);
 assert.equal(await f.homes.one(source('native',{spaceId:'space-native'})),null);
 assert.equal(await f.homes.one(source(null,{kind:'hall',spaceId:'space-native'})),null);
 const selected=await f.homes.one({...source(),name:'米雪',homePath:'https://evil.invalid/#admin',token:'private'});
 assert.equal(selected.name,'怕怕');assert.equal(selected.homePath,'/pa');
 await f.db.exec("update papa_spaces set status='suspended' where id='space-001'");
 assert.equal(await f.homes.one(source()),null);assert.equal((await f.homes.list()).total,0);
});

test('server-side search and pagination preserve literal search text, deterministic order and selected kinds',async t=>{
 const f=await fixture(t);
 const found=await f.homes.list({q:'米雪',kind:'streamer',pageSize:1});assert.equal(found.items[0].streamerId,'mimi-id');assert.equal(found.total,1);
 assert.equal((await f.homes.list({q:'snow',kind:'streamer'})).total,1);
 assert.equal((await f.homes.list({q:'%',kind:'all'})).total,0,'SQL wildcard input is a literal substring');
 assert.equal((await f.homes.list({q:"' OR true --",kind:'all'})).total,0);
 const halls=await f.homes.list({kind:'hall'});assert.equal(halls.total,1);assert.equal(halls.items[0].kind,'hall');
 const clamped=await f.homes.list({page:500,pageSize:12});assert.equal(clamped.page,1);assert.equal(clamped.items.length,3);
 assert.equal(f.calls.at(-1).args.page_offset,5988);assert.equal(f.calls.at(-1).args.page_limit,12);
});

test('read-only function is stable with fixed search_path, service-only execute, no direct table access or source writes',async t=>{
 const f=await fixture(t);
 for(const role of ['anon','authenticated']){
  assert.equal((await f.db.query("select has_function_privilege($1,'papa_public_app_homes(text,text,int,int,text,text,text)','execute') value",[role])).rows[0].value,false);
 }
 const definition=(await f.db.query("select provolatile,prosecdef,proconfig from pg_proc where proname='papa_public_app_homes'")).rows[0];
 assert.equal(definition.provolatile,'s');assert.equal(definition.prosecdef,true);assert.ok(definition.proconfig.includes('search_path=pg_catalog, public'));
 await f.db.exec('set role service_role');assert.equal((await f.homes.list()).total,3);
 await assert.rejects(f.db.query('select * from papa_v2_entities'),/permission denied/);await f.db.exec('reset role');
 assert.deepEqual(await f.snapshot(),f.before);
});

test('client and SQL both reject unbounded or malformed arguments before any business query',async t=>{
 const f=await fixture(t);
 for(const body of [{q:'x'.repeat(101)},{q:{}},{page:-1},{page:501},{page:0},{page:1.2},{pageSize:13},{pageSize:0},{kind:'private'}])await assert.rejects(f.homes.list(body),/不正確/);
 for(const body of [{...source(),v:2},{...source(),spaceId:'bad id'},{...source(),streamerId:null},source('bad\nroom'),source('papa',{kind:'hall'})])await assert.rejects(f.homes.one(body),/不正確/);
 assert.equal(f.calls.length,0);
 await assert.rejects(f.db.query("select papa_public_app_homes(page_limit=>13)"),/QUERY_INVALID/);
 await assert.rejects(f.db.query("select papa_public_app_homes(source_space=>'space-001')"),/SOURCE_INVALID/);
 await assert.rejects(f.db.query("select papa_public_app_homes(requested_kind=>'hall',source_kind=>'hall',source_space=>'space-001')"),/SOURCE_INVALID/);
});

test('adapter whitelists public metadata and rejects forged scope, private destinations and malformed response counts',async()=>{
 const calls=[],create=value=>createPublicAppHomes({api:async(path,args)=>{calls.push({path,args});return value;}});
 const projected=await create(page([{...row(),password:'secret',player:'private'}])).list();assert.deepEqual(projected.items[0],row());
 for(const bad of [row({homePath:'https://evil.invalid'}),row({homePath:'/pa/admin'}),row({active:false}),row({canonicalPath:'/pa?token=secret'}),row({kind:'hall'}),row({streamerSlug:'bad/slash'})]){
  await assert.rejects(create(page([bad])).list(),/尚未確認/);
 }
 await assert.rejects(create(page([row({spaceId:'other'})],1,1,1)).one(source()),/尚未確認/);
 await assert.rejects(create({...page([row()]),total:2}).list(),/尚未確認/);
 await assert.rejects(create({...page([row()]),totalPages:5}).list(),/尚未確認/);
 const nested=await create(page([row()],1,1,1)).one({op:'publicAppHome',source:source()});assert.equal(nested.streamerId,'papa');
});

test('network failures remain errors, while only a successful empty authoritative lookup means inactive or unavailable',async()=>{
 const failure=Error('upstream timeout'),broken=createPublicAppHomes({api:async()=>{throw failure;}});
 await assert.rejects(broken.one(source()),error=>error===failure);await assert.rejects(broken.list(),error=>error===failure);
 const missing=createPublicAppHomes({api:async()=>page([],0,1,1)});assert.equal(await missing.one(source()),null);
});
