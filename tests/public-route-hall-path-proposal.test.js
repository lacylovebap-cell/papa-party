import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {parsePublicRoutePath,publicPageDestination} from '../src/public-route-location.js';

const president='11111111-1111-4111-8111-111111111111';
const baseline=fs.readFileSync('supabase/migrations/202610190001_public_routes.sql','utf8');
const proposed=fs.readFileSync('ops/public-route-hall-path-proposed.sql','utf8');
async function fixture(t){
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
 insert into papa_accounts values('${president}',null);
 insert into papa_spaces values('space-001','active'),('space-Q','active'),('independent','active');
 insert into papa_space_streamers values('papa','space-001'),('artist','space-Q'),('indie','independent');
 insert into papa_platform_roles values('${president}','president');
 insert into papa_manager_account_links values('president','${president}');
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa","slug":"papa","active":true},{"id":"artist","slug":"artist","active":true},{"id":"indie","slug":"indie","active":true}]}',null),
 ('ledger','keep','{"amount":3,"memo":"original"}','space-Q');`);
 await db.exec(baseline);
 const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const call=async(name,args)=> (await q('select papa_public_route_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args))[0].v;
 const actor={role:'super_admin',account_id:president,space_id:null,actor_streamer_id:null};
 await call('save',['space-Q',null,actor,'hall','qq',0,'hall']);
 await call('save',['space-Q','artist',actor,'streamer','Artist',1,null]);
 await call('save',['independent',null,actor,'hall','pa',0,'independent']);
 await call('save',['independent','indie',actor,'streamer','IndependentArtist',1,null]);
 const apply=()=>db.exec(proposed.replace('begin;','begin;\nset local papa.approved_route_actor = \''+president+'\';'));
 return {db,q,call,actor,apply};
}

test('proposed hall path update preserves stable IDs, every old alias, independent/flat URLs and subpages',async t=>{
 const f=await fixture(t),beforeAliases=await f.q('select * from papa_public_route_aliases order by path_key'),business=await f.q('select * from papa_v2_entities order by kind,id');
 assert.equal((await f.call('resolve',['/qq.Artist'])).canonicalPath,'/qq.Artist');
 await f.apply();
 for(const alias of beforeAliases)assert.deepEqual((await f.q('select * from papa_public_route_aliases where path_key=$1',[alias.path_key]))[0],alias);
 for(const path of ['/qq.Artist','/QQ/ARTIST']){
  const result=await f.call('resolve',[path]);assert.equal(result.canonicalPath,'/qq/Artist');assert.equal(result.spaceId,'space-Q');assert.equal(result.streamerId,'artist');
 }
 const candidates=parsePublicRoutePath('https://paparty.app/qq.Artist/book').candidates;
 assert.equal(candidates.at(-1).homepagePath,'/qq.Artist');assert.equal(candidates.at(-1).section,'book');
 assert.equal(publicPageDestination('https://paparty.app/qq.Artist/book','https://paparty.app/qq/Artist',{route:'book'}),'https://paparty.app/qq/Artist/book');
 assert.equal((await f.call('resolve',['/pa'])).canonicalPath,'/pa');assert.equal((await f.call('resolve',['/sm'])).canonicalPath,'/sm');assert.equal((await f.call('resolve',['/pa.IndependentArtist'])).canonicalPath,'/pa.IndependentArtist');
 assert.deepEqual(await f.q('select * from papa_v2_entities order by kind,id'),business);
 assert.equal((await f.q("select count(*)::int n from papa_public_route_audit where before_path='/qq.Artist' and after_path='/qq/Artist'"))[0].n,1);
 const changed=await f.q('select * from papa_public_route_spaces order by space_id'),auditCount=(await f.q('select count(*)::int n from papa_public_route_audit'))[0].n;
 await f.apply();assert.deepEqual(await f.q('select * from papa_public_route_spaces order by space_id'),changed);assert.equal((await f.q('select count(*)::int n from papa_public_route_audit'))[0].n,auditCount);
 const revision=Number(changed.find(row=>row.space_id==='space-Q').revision);
 const renamed=await f.call('save',['space-Q','artist',f.actor,'streamer','New',revision,null]);assert.equal(renamed.canonicalPath,'/qq/New');assert.equal((await f.call('resolve',['/qq.Artist'])).canonicalPath,'/qq/New');assert.equal((await f.call('resolve',['/qq/Artist'])).canonicalPath,'/qq/New');
 await f.call('save',['space-Q',null,f.actor,'hall','NewHall',renamed.revision,null]);
 for(const old of ['/qq.Artist','/qq/Artist','/qq/New'])assert.equal((await f.call('resolve',[old])).canonicalPath,'/NewHall/New','all aliases resolve the current stable owner directly after a hall rename');
 for(const role of ['anon','authenticated','service_role'])assert.equal((await f.q('select has_function_privilege($1,\'papa_public_route_home(text,text,text)\',\'execute\') v',[role]))[0].v,false);
});

test('a reserved child URL conflict rolls back the whole path update without deleting history',async t=>{
 const f=await fixture(t);await f.call('activate',['/qq/Artist','space-001','papa','streamer']);
 const aliases=await f.q('select * from papa_public_route_aliases order by path_key'),spaces=await f.q('select * from papa_public_route_spaces order by space_id');
 await assert.rejects(f.apply(),/ALREADY_RESERVED/);await f.db.exec('rollback');
 assert.equal((await f.call('resolve',['/qq.Artist'])).canonicalPath,'/qq.Artist');assert.deepEqual(await f.q('select * from papa_public_route_aliases order by path_key'),aliases);assert.deepEqual(await f.q('select * from papa_public_route_spaces order by space_id'),spaces);
});

test('the proposal refuses unapproved or disabled actors before changing the helper',async t=>{
 const f=await fixture(t);await assert.rejects(f.db.exec(proposed),/APPROVED_ACTOR_REQUIRED/);await f.db.exec('rollback');
 await f.q('update papa_accounts set disabled_at=now() where id=$1',[president]);await assert.rejects(f.apply(),/APPROVED_ACTOR_REQUIRED/);await f.db.exec('rollback');
 assert.equal((await f.call('resolve',['/qq.Artist'])).canonicalPath,'/qq.Artist');
});
