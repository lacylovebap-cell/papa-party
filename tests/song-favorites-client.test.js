import test from 'node:test';
import assert from 'node:assert/strict';
import {createSongFavorites} from '../src/song-favorites.js';

const row=(songId='S1',extra={})=>({songId,streamer_id:'papa',title:'歌曲 '+songId,artist:'歌手',tags:['甜歌'],favorite:true,...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>Promise.resolve();
function fixture(options={}){
 let ctx={accountId:'account-1',playerId:'P1',spaceId:'space-001',roomId:'papa',revision:1},time=1000;
 const calls=[],pending=[],changes=[];
 const manager=createSongFavorites({api:payload=>{calls.push(payload);const next=deferred();pending.push(next);return next.promise;},context:()=>ctx,now:()=>time,onChange:value=>changes.push(value),...options});
 return {manager,calls,pending,changes,setContext:next=>{ctx=next;},setTime:value=>{time=value;}};
}
async function page(f,response={rows:[row()],total:1},options){const task=f.manager.load(options);await tick();f.pending.at(-1).resolve(response);await task;}
async function flags(f,ids,response,options){const task=f.manager.loadFlags(ids,options);await tick();f.pending.at(-1).resolve(response);await task;}
async function set(f,songId,favorite,response={songId,favorite,changed:true}){const task=f.manager.setFavorite(songId,favorite);await tick();f.pending.at(-1).resolve(response);return task;}

test('state and pagination are silent reads; page requests forward only bounded operation data',async()=>{
 const f=fixture(),m=f.manager;m.state();m.setPage(2);assert.equal(f.calls.length,0);
 await page(f,{rows:[row()],total:50});assert.deepEqual(f.calls,[{op:'favoritesPage',page:2,limit:20}]);
 assert.equal(m.state().page,2);assert.equal(m.state().total,50);assert.equal(m.state().flags.S1,true);
 assert.throws(()=>m.setPage(-1));assert.throws(()=>m.setPage(1.5));assert.throws(()=>m.setPage(500001));assert.throws(()=>m.setFavorite('S1','true'));
});

test('page loads coalesce, cache on render, and expire only when explicitly used after the age limit',async()=>{
 const f=fixture(),m=f.manager,first=m.load();assert.equal(first,m.load());assert.equal(first,m.load({force:true}));
 await tick();assert.equal(f.calls.length,1);f.pending[0].resolve({rows:[row()],total:1});await first;
 const events=f.changes.length;await m.load();assert.equal(f.calls.length,1);assert.equal(f.changes.length,events);
 f.setTime(30999);await m.load();assert.equal(f.calls.length,1);f.setTime(31000);assert.equal(f.calls.length,1);
 await page(f);assert.equal(f.calls.length,2);
});

test('page failures stay cached until force or explicit-use expiry without render retry loops',async()=>{
 let m,time=0;const calls=[],pending=[];
 m=createSongFavorites({api:payload=>{calls.push(payload);const next=deferred();pending.push(next);return next.promise;},context:()=>({playerId:'legacy',spaceId:'space-001',roomId:'papa',revision:0}),now:()=>time,onChange:()=>{m.state();m.load();}});
 const failed=m.load();await tick();pending[0].reject(Error('暫時無法讀取'));await failed;await m.load();assert.equal(calls.length,1);assert.equal(m.state().error,'暫時無法讀取');
 const retry=m.load({force:true});await tick();pending[1].resolve({rows:[],total:0});await retry;assert.equal(calls.length,2);
 time=30000;const expired=m.load();await tick();pending[2].resolve({rows:[],total:0});await expired;assert.equal(calls.length,3);
});

test('flags lookup skips fresh known page/set values and requests only unknown IDs',async()=>{
 const f=fixture(),m=f.manager;await page(f);await set(f,'S2',true);
 await m.loadFlags(['S1','S2','S1']);assert.equal(f.calls.length,2);
 await flags(f,['S1','S2','S3'],{songIds:[]});assert.deepEqual(f.calls[2],{op:'favoriteFlags',songIds:['S3']});assert.equal(m.state().flags.S3,false);
 await m.loadFlags(['S3','S2','S1']);assert.equal(f.calls.length,3);
 f.setTime(31000);assert.equal(f.calls.length,3);await flags(f,['S1','S2','S3'],{songIds:['S2']});assert.equal(f.calls.length,4);assert.equal(m.state().flags.S1,false);assert.equal(m.state().flags.S2,true);
});

test('identical flags reads coalesce independent of request order and install false values explicitly',async()=>{
 const f=fixture(),m=f.manager,first=m.loadFlags(['A','B','A']);assert.equal(first,m.loadFlags(['B','A']));
 await tick();assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{op:'favoriteFlags',songIds:['A','B']});
 f.pending[0].resolve({songIds:['B']});await first;assert.equal(m.state().flags.A,false);assert.equal(m.state().flags.B,true);
 await m.loadFlags(['A','B']);assert.equal(f.calls.length,1);
});

test('flag errors do not leak unrequested IDs and are retried only by force or explicit-use expiry',async()=>{
 const f=fixture(),m=f.manager;await flags(f,['A'],{songIds:['OTHER-PLAYER-SONG']});
 assert.match(m.state().flagsError,/不正確/);assert.deepEqual(m.state().flags,{});await m.loadFlags(['A']);assert.equal(f.calls.length,1);
 await flags(f,['A'],{songIds:[]},{force:true});assert.equal(m.state().flags.A,false);
 f.setTime(31000);await flags(f,['A'],{songIds:['A']});assert.equal(f.calls.length,3);assert.equal(m.state().flags.A,true);
});

test('desired-state writes are pessimistic, duplicate writes coalesce and conflicting pending writes reject',async()=>{
 const f=fixture(),m=f.manager,first=m.setFavorite('A',true);assert.equal(first,m.setFavorite('A',true));
 assert.equal(m.state().flags.A,undefined);assert.deepEqual(m.state().pendingSongIds,['A']);
 await assert.rejects(m.setFavorite('A',false),/正在更新/);await tick();assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0],{op:'favoriteSet',songId:'A',favorite:true});
 f.pending[0].resolve({songId:'A',favorite:true,changed:true,playerId:'foreign',password:'secret'});assert.deepEqual(await first,{songId:'A',favorite:true});
 assert.equal(m.state().flags.A,true);assert.deepEqual(m.state().pendingSongIds,[]);assert.equal(m.state().dirty,true);
});

test('unfavorite removes only a known current row and decrements its count once',async()=>{
 const f=fixture(),m=f.manager;await page(f,{rows:[row('A'),row('B')],total:8});
 await set(f,'A',false);assert.deepEqual(m.state().rows.map(song=>song.songId),['B']);assert.equal(m.state().total,7);assert.equal(m.state().flags.A,false);
 await set(f,'A',false,{songId:'A',favorite:false,changed:false});assert.equal(m.state().total,7);
 await set(f,'not-on-page',false);assert.equal(m.state().total,7);
 await set(f,'new-favorite',true);assert.equal(m.state().total,7);assert.deepEqual(m.state().rows.map(song=>song.songId),['B']);
 const calls=f.calls.length;await m.load();assert.equal(f.calls.length,calls,'write notifications must not fan out into page reads');
 await page(f,{rows:[row('B'),row('new-favorite')],total:8},{force:true});assert.equal(m.state().dirty,false);
});

test('write acknowledgments invalidate older page/flags responses and require an explicit page refresh',async()=>{
 const f=fixture(),m=f.manager,oldPage=m.load(),oldFlags=m.loadFlags(['A']);await tick();const write=m.setFavorite('A',false);await tick();
 f.pending[2].resolve({songId:'A',favorite:false,changed:true});await write;
 f.pending[0].resolve({rows:[row('A')],total:1});f.pending[1].resolve({songIds:['A']});await oldPage;await oldFlags;
 assert.deepEqual(m.state().rows,[]);assert.equal(m.state().flags.A,false);assert.equal(m.state().loading,false);assert.equal(m.state().flagsLoading,false);
 await m.load();await m.loadFlags(['A']);assert.equal(f.calls.length,3);
 await page(f,{rows:[],total:0},{force:true});assert.equal(f.calls.length,4);
});

test('Account/player/Space/room identity changes silently reset caches and discard earlier page/flags/writes',async()=>{
 const base={accountId:'account-1',playerId:'P1',spaceId:'space-001',roomId:'papa',revision:1};
 for(const next of [{...base,accountId:'account-2'},{...base,playerId:'P2'},{...base,spaceId:'space-002'},{...base,roomId:'other'}]){
  const f=fixture(),m=f.manager;m.setPage(2);const oldPage=m.load(),oldFlags=m.loadFlags(['A']),oldWrite=m.setFavorite('B',true);await tick();
  const events=f.changes.length;f.setContext(next);assert.equal(m.state().page,0);assert.deepEqual(m.state().flags,{});assert.deepEqual(m.state().pendingSongIds,[]);assert.equal(f.changes.length,events);
  f.pending[0].resolve({rows:[row('A')],total:1});f.pending[1].resolve({songIds:['A']});f.pending[2].resolve({songId:'B',favorite:true});await oldPage;await oldFlags;assert.equal(await oldWrite,null);
  assert.deepEqual(m.state().rows,[]);assert.deepEqual(m.state().flags,{});assert.equal(m.state().error,null);assert.equal(m.state().setError,null);
 }
});

test('revision changes keep the page but invalidate ages, flags and pending results',async()=>{
 const f=fixture(),m=f.manager;m.setPage(2);await page(f,{rows:[row('A')],total:45});
 const old=m.load({force:true});await tick();f.setContext({accountId:'account-1',playerId:'P1',spaceId:'space-001',roomId:'papa',revision:2});
 assert.equal(m.state().page,2);assert.deepEqual(m.state().flags,{});f.pending[1].resolve({rows:[row('stale')],total:45});await old;assert.deepEqual(m.state().rows,[]);
 await flags(f,['A'],{songIds:[]});assert.equal(m.state().flags.A,false);assert.equal(f.calls.length,3);
});

test('scope changes or logout before dispatch prevent all three operations from using the next API identity',async()=>{
 const base={accountId:'account-1',playerId:'P1',spaceId:'space-001',roomId:'papa',revision:1};
 for(const next of [null,{...base,accountId:'account-2'},{...base,playerId:'P2'},{...base,spaceId:'space-002'},{...base,roomId:'other'},{...base,revision:2}]){
  const f=fixture(),m=f.manager,pageTask=m.load(),flagTask=m.loadFlags(['A']),writeTask=m.setFavorite('B',true);
  f.setContext(next);await pageTask;await flagTask;assert.equal(await writeTask,null);assert.equal(f.calls.length,0);
  f.setContext(base);assert.deepEqual(m.state().rows,[]);assert.deepEqual(m.state().flags,{});assert.equal(m.state().loading,false);assert.deepEqual(m.state().pendingSongIds,[]);
 }
});

test('page changes discard old results and late errors without disturbing the current page',async()=>{
 const f=fixture(),m=f.manager,old=m.load();await tick();m.setPage(1);const current=m.load();await tick();
 f.pending[0].reject(Error('old failure'));await old;assert.equal(m.state().loading,true);assert.equal(m.state().error,null);
 f.pending[1].resolve({rows:[row('current')],total:30});await current;assert.equal(m.state().rows[0].songId,'current');assert.equal(m.state().page,1);
});

test('page projection preserves public metadata, denies foreign/hidden rows and strips private content',async()=>{
 const f=fixture();await page(f,{rows:[row('safe',{lyrics:'private body',custom_lyrics:'private',note:'private note',source_hash:'secret',accountId:'foreign',playerId:'foreign',version:'Live版',catalogVariantId:'v1',hasLyrics:true,hasSharedLyrics:true,hasCustomLyrics:false,lyricsMode:'public',creditCost:0.5,favoritedAt:'2026-10-09T02:00:00Z'})],total:1});
 const value=f.manager.state();assert.equal(value.rows[0].version,'Live版');assert.equal(value.rows[0].hasSharedLyrics,true);assert.equal(value.rows[0].favoritedAt,'2026-10-09T02:00:00Z');
 assert.equal(JSON.stringify(value).includes('private'),false);assert.equal(JSON.stringify(value).includes('foreign'),false);assert.equal(JSON.stringify(value).includes('secret'),false);
 assert.throws(()=>value.rows[0].tags.push('forged'));assert.throws(()=>{value.rows[0].title='forged';});assert.equal(f.manager.state().rows[0].title,'歌曲 safe');
 for(const invalid of [row('foreign',{streamer_id:'other'}),row('hidden',{hidden:true})]){
  await page(f,{rows:[invalid],total:1},{force:true});assert.match(f.manager.state().error,/不正確/);assert.equal(f.manager.state().rows[0].songId,'safe');
 }
});

test('malformed pages, flags and writes never partially install unsafe or foreign data',async()=>{
 const badPages=[null,{rows:[],total:-1},{rows:[],total:0.5},{rows:[row()],total:0},{rows:Array(1),total:1},{rows:[row('A'),row('A')],total:2},{rows:[row('A'),row('bad',{artist:9})],total:2},{rows:[row('bad',{tags:Array(101).fill('x')})],total:1},{rows:[row('bad',{creditCost:'2'})],total:1},{rows:Array.from({length:21},(_,i)=>row('S'+i)),total:21}];
 for(const response of badPages){const f=fixture();await page(f,response);assert.ok(f.manager.state().error);assert.deepEqual(f.manager.state().rows,[]);assert.deepEqual(f.manager.state().flags,{});await f.manager.load();assert.equal(f.calls.length,1);}
 for(const response of [null,{songIds:'A'},{songIds:['A','A']},{songIds:['unknown']},{songIds:[5]}]){const f=fixture();await flags(f,['A','B'],response);assert.ok(f.manager.state().flagsError);assert.deepEqual(f.manager.state().flags,{});}
 for(const response of [{songId:'other',favorite:true},{songId:'A',favorite:false},{songId:'A',favorite:true,changed:'yes'}]){
  const f=fixture(),task=f.manager.setFavorite('A',true);await tick();f.pending[0].resolve(response);await assert.rejects(task,/回應不正確/);assert.deepEqual(f.manager.state().flags,{});assert.deepEqual(f.manager.state().pendingSongIds,[]);
 }
});

test('flag memory remains bounded across pages and queries; invalid inputs never reach the API',async()=>{
 const f=fixture(),m=f.manager;await page(f,{rows:Array.from({length:20},(_,i)=>row('page'+i)),total:20});
 for(let batch=0;batch<4;batch++){
  const ids=Array.from({length:50},(_,i)=>'batch'+batch+'-'+i);await flags(f,ids,{songIds:[]});assert.ok(Object.keys(m.state().flags).length<=70);
 }
 const calls=f.calls.length;for(const input of [Array(51).fill('A'),{},[''],[5]])assert.throws(()=>m.loadFlags(input));assert.equal(f.calls.length,calls);
 assert.throws(()=>fixture({maxAgeMs:0}));assert.throws(()=>fixture({maxAgeMs:1.5}));
});
