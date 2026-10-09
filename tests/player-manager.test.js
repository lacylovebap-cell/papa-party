import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerManager} from '../src/player-manager.js';

const row=(playerId='P1',extra={})=>({playerId,name:'玩家 '+playerId,storedCredits:2,...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(options={}){
 let ctx={spaceId:'space-001',roomId:'papa',revision:1};
 const calls=[],pending=[],changes=[];
 const manager=createPlayerManager({api:payload=>{calls.push(payload);const next=deferred();pending.push(next);return next.promise;},context:()=>ctx,onChange:value=>changes.push(value),...options});
 return {manager,calls,pending,changes,setContext:next=>{ctx=next;}};
}
const tick=()=>Promise.resolve();
async function finish(f,response={rows:[row()],total:1}){
 const task=f.manager.load();await tick();f.pending.at(-1).resolve(response);await task;return task;
}

test('construction, reading state, selecting modes and editing searches/pages never read the server',()=>{
 const f=fixture(),m=f.manager;
 assert.equal(m.state().mode,'stored');m.search('  存歌玩家  ');m.setPage(2);m.setMode('all');m.search('全玩家');m.setPage(1);
 assert.equal(f.calls.length,0);assert.equal(m.state().q,'全玩家');
 assert.deepEqual({...m.state('stored'),rows:[]},{mode:'stored',q:'存歌玩家',page:2,rows:[],total:0,loading:false,error:null});
 assert.throws(()=>m.setMode('foreign'));assert.throws(()=>m.setPage(-1));assert.throws(()=>m.setPage(1.5));assert.throws(()=>m.search({password:'secret'}));
});

test('stored and all keep independent queries, absolute pages, bounded results and totals',async()=>{
 const f=fixture(),m=f.manager;m.search('存歌');m.setPage(2);
 await finish(f,{rows:[row('stored')],total:62});m.setMode('all');m.search('全部');m.setPage(1);
 await finish(f,{rows:[row('all',{storedCredits:-1})],total:45});
 assert.deepEqual(f.calls,[{op:'playerManagementPage',mode:'stored',query:'存歌',page:2,limit:20},{op:'playerManagementPage',mode:'all',query:'全部',page:1,limit:20}]);
 assert.equal(m.state().rows[0].playerId,'all');assert.equal(m.state().total,45);m.setMode('stored');
 assert.equal(m.state().q,'存歌');assert.equal(m.state().page,2);assert.equal(m.state().rows[0].playerId,'stored');assert.equal(m.state().total,62);
 const before=f.changes.length;await m.load();assert.equal(f.calls.length,2);assert.equal(f.changes.length,before);
 m.search('新的存歌搜尋');assert.equal(m.state().page,0);assert.deepEqual(m.state().rows,[]);assert.equal(m.state('all').q,'全部');
});

test('identical pending loads share one promise; successful cache and render callbacks never loop',async()=>{
 const calls=[],pending=[];let m,changes=0;
 m=createPlayerManager({api:payload=>{calls.push(payload);const next=deferred();pending.push(next);return next.promise;},context:()=>({spaceId:'space-001',roomId:'papa',revision:1}),onChange:()=>{changes++;m.state();m.load();}});
 const first=m.load();assert.equal(first,m.load());assert.equal(first,m.load({force:true}));assert.equal(m.state().loading,true);
 await tick();assert.equal(calls.length,1);pending[0].resolve({rows:[row()],total:1});await first;
 assert.equal(changes,2);await m.load();assert.equal(calls.length,1);assert.equal(changes,2);
 const force=m.load({force:true});await tick();assert.equal(calls.length,2);pending[1].resolve({rows:[row()],total:1});await force;
 assert.equal(changes,4);
});

test('failed loads are cached until explicit force retry and cannot create a render retry loop',async()=>{
 const calls=[],pending=[];let m,changes=0;
 m=createPlayerManager({api:payload=>{calls.push(payload);const next=deferred();pending.push(next);return next.promise;},context:()=>({spaceId:'space-001',roomId:'papa',revision:1}),onChange:()=>{changes++;m.state();m.load();}});
 const failed=m.load();await tick();pending[0].reject(Error('清單暫時無法讀取'));await failed;
 assert.equal(m.state().error,'清單暫時無法讀取');assert.equal(m.state().loading,false);assert.equal(changes,2);
 await m.load();await m.load();assert.equal(calls.length,1);assert.equal(changes,2);
 const retry=m.load({force:true});await tick();pending[1].resolve({rows:[row()],total:1});await retry;
 assert.equal(m.state().error,null);assert.equal(calls.length,2);assert.equal(changes,4);
});

test('Space or room changes silently reset both modes and discard earlier asynchronous responses',async()=>{
 for(const changed of [{spaceId:'space-002',roomId:'papa',revision:1},{spaceId:'space-001',roomId:'other',revision:1}]){
  const f=fixture(),m=f.manager;m.search('舊存歌');m.setPage(2);m.setMode('all');m.search('舊全玩家');m.setPage(3);
  const old=m.load();await tick();const changes=f.changes.length;f.setContext(changed);
  assert.equal(m.state().q,'');assert.equal(m.state().page,0);assert.deepEqual(m.state().rows,[]);assert.equal(m.state('stored').q,'');assert.equal(m.state('stored').page,0);
  assert.equal(f.changes.length,changes,'state reads must not notify recursively');
  const current=m.load();await tick();f.pending[0].resolve({rows:[row('old')],total:1});await old;
  assert.equal(m.state().loading,true);assert.deepEqual(m.state().rows,[]);
  f.pending[1].resolve({rows:[row('new')],total:1});await current;assert.equal(m.state().rows[0].playerId,'new');
 }
});

test('revision changes invalidate the page cache and pending work while retaining both searches/pages',async()=>{
 const f=fixture(),m=f.manager;m.search('存歌');m.setPage(2);await finish(f,{rows:[row('before')],total:60});
 m.setMode('all');m.search('全部');m.setPage(3);const old=m.load();await tick();
 f.setContext({spaceId:'space-001',roomId:'papa',revision:2});const beforeChanges=f.changes.length;
 assert.equal(m.state().q,'全部');assert.equal(m.state().page,3);assert.equal(m.state('stored').q,'存歌');assert.equal(m.state('stored').page,2);assert.deepEqual(m.state('stored').rows,[]);
 assert.equal(f.changes.length,beforeChanges);f.pending[1].resolve({rows:[row('stale')],total:80});await old;assert.deepEqual(m.state().rows,[]);
 await finish(f,{rows:[row('after')],total:80});assert.equal(f.calls.length,3);assert.equal(m.state().rows[0].playerId,'after');
});

test('mode changes, query changes and page changes prevent stale results and stale failures from applying',async()=>{
 for(const change of [m=>m.setMode('all'),m=>m.search('另一位'),m=>m.setPage(1)]){
  const f=fixture(),m=f.manager;const old=m.load();await tick();change(m);const current=m.load();await tick();
  f.pending[0].resolve({rows:[row('stale')],total:1});await old;assert.deepEqual(m.state().rows,[]);assert.equal(m.state().loading,true);
  f.pending[1].resolve({rows:[row('current')],total:22});await current;assert.equal(m.state().rows[0].playerId,'current');
 }
 const f=fixture(),m=f.manager,old=m.load();await tick();m.setMode('all');m.setMode('stored');const current=m.load();await tick();
 assert.notEqual(old,current);f.pending[0].reject(Error('stale error'));await old;assert.equal(m.state().error,null);assert.equal(m.state().loading,true);
 f.pending[1].resolve({rows:[row('current')],total:1});await current;assert.equal(m.state().error,null);
});

test('response rows are projected to safe profile fields and snapshots cannot mutate controller data',async()=>{
 const f=fixture();await finish(f,{rows:[row('safe',{ids:['123'],names:['別名'],password:'secret',token:'secret',ledger:[{amount:99}],spaceId:'foreign',account_id:'private'})],total:1,password:'secret'});
 const value=f.manager.state();assert.deepEqual(value.rows,[{playerId:'safe',name:'玩家 safe',ids:['123'],names:['別名'],certification:'',test:false,storedCredits:2}]);
 assert.equal(JSON.stringify(value).includes('secret'),false);assert.equal(Object.isFrozen(value.rows[0].ids),true);
 assert.throws(()=>value.rows[0].ids.push('forged'));assert.throws(()=>{value.rows[0].name='forged';});
 assert.equal(f.manager.state().rows[0].name,'玩家 safe');assert.deepEqual(Object.keys(f.calls[0]),['op','mode','query','page','limit']);
});

test('page size accepts only server-supported integer bounds and responses stay within that limit',async()=>{
 for(const pageLimit of [0,19,51,20.5,'20',Infinity])assert.throws(()=>fixture({pageLimit}),/20 到 50/);
 const f=fixture({pageLimit:50});await finish(f,{rows:Array.from({length:50},(_,i)=>row('P'+i)),total:100});
 assert.equal(f.calls[0].limit,50);assert.equal(f.manager.state().rows.length,50);
 const bad=fixture();await finish(bad,{rows:Array.from({length:21},(_,i)=>row('P'+i)),total:21});
 assert.match(bad.manager.state().error,/資料不正確/);assert.deepEqual(bad.manager.state().rows,[]);
});

test('malformed page rows, counts, identifiers, names, balances and large arrays never enter state',async()=>{
 const malformed=[
  null,{rows:{},total:0},{rows:[],total:-1},{rows:[],total:0.5},{rows:[row()],total:0},
  {rows:[null],total:1},{rows:[row('')],total:1},{rows:[row('x',{name:5})],total:1},
  {rows:[row('x',{storedCredits:Infinity})],total:1},{rows:[row('x',{storedCredits:Number.MAX_SAFE_INTEGER+1})],total:1},
  {rows:[row('x',{storedCredits:'2'})],total:1},{rows:[row('x',{test:'false'})],total:1},
  {rows:[row('x',{ids:Array(101).fill('id')})],total:1},{rows:[row('x',{names:{secret:true}})],total:1},
  {rows:[row('x',{ids:['']})],total:1},{rows:[row('x'),row('x')],total:2},{rows:Array(1),total:1}
 ];
 for(const response of malformed){
  const f=fixture();await finish(f,response);assert.ok(f.manager.state().error,JSON.stringify(response));assert.deepEqual(f.manager.state().rows,[]);
  await f.manager.load();assert.equal(f.calls.length,1,'invalid responses must not auto-retry');
 }
 const f=fixture();await finish(f,{rows:[{playerId:'old',name:'舊玩家'}],total:1});
 assert.deepEqual(f.manager.state().rows[0],{playerId:'old',name:'舊玩家',ids:[],names:[],certification:'',test:false,storedCredits:0});
});

const actorKey=(loggedIn=true,role='streamer',accountId='account-a',streamerId='papa')=>JSON.stringify([loggedIn,role,accountId,streamerId]);
const actorContext=key=>({spaceId:'space-001',roomId:'papa',revision:1,actorKey:key});
const changedActors=[
 ['Account',actorKey(true,'streamer','account-b')],
 ['role',actorKey(true,'super')],
 ['logout',actorKey(false,null,null,null)]
];

test('optional actor keys preserve old contexts, null compatibility and exact API payloads',async()=>{
 const f=fixture(),m=f.manager;await finish(f);
 f.setContext(actorContext(null));await m.load();assert.equal(f.calls.length,1);
 f.setContext(actorContext(undefined));await m.load();assert.equal(f.calls.length,1);
 for(const key of ['', 'a'.repeat(256)]){
  f.setContext(actorContext(key));assert.deepEqual(m.state().rows,[]);await finish(f);
 }
 assert.equal(f.calls.length,3);
 assert.deepEqual(f.calls[2],{op:'playerManagementPage',mode:'stored',query:'',page:0,limit:20});
 assert.deepEqual(Object.keys(m.state()),['mode','q','page','rows','total','loading','error']);
});

test('same-room Account, role and logout changes before dispatch prevent every old API read',async()=>{
 for(const [label,key] of changedActors){
  const f=fixture(),m=f.manager;f.setContext(actorContext(actorKey()));
  m.search('舊存歌');m.setPage(2);m.setMode('all');m.search('舊全玩家');m.setPage(3);
  const old=m.load(),notifications=f.changes.length;
  f.setContext(actorContext(key));await old;
  assert.equal(f.calls.length,0,label);assert.equal(f.changes.length,notifications,label);
  for(const mode of ['stored','all'])assert.deepEqual(m.state(mode),{mode,q:'',page:0,rows:[],total:0,loading:false,error:null},label);
 }
});

test('same-room actor changes clear both caches and prevent late old results from notifying or applying',async()=>{
 for(const [label,key] of changedActors){
  const f=fixture(),m=f.manager;f.setContext(actorContext(actorKey()));
  m.search('舊存歌');m.setPage(2);await finish(f,{rows:[row('cached-old-actor')],total:60});
  m.setMode('all');m.search('舊全玩家');m.setPage(3);const old=m.load();await tick();
  f.setContext(actorContext(key));const notifications=f.changes.length;
  for(const mode of ['stored','all'])assert.deepEqual(m.state(mode),{mode,q:'',page:0,rows:[],total:0,loading:false,error:null},label);
  assert.equal(f.changes.length,notifications,'scope reads must reset silently');
  const current=m.load();await tick();assert.equal(f.calls.length,3,label);
  f.pending[2].resolve({rows:[row('new-actor')],total:1});await current;
  const currentNotifications=f.changes.length;
  f.pending[1].resolve({rows:[row('late-old-actor')],total:80});await old;
  assert.equal(m.state().rows[0].playerId,'new-actor',label);assert.equal(f.changes.length,currentNotifications,label);
  m.setMode('stored');const stored=m.load();await tick();assert.equal(f.calls.length,4,'the old actor stored cache must not be reused');
  assert.deepEqual(f.calls[3],{op:'playerManagementPage',mode:'stored',query:'',page:0,limit:20});
  f.pending[3].resolve({rows:[row('new-stored')],total:1});await stored;
  m.search('新存歌');m.setMode('all');assert.equal(m.state().q,'');assert.equal(m.state().rows[0].playerId,'new-actor');
  assert.equal(m.state('stored').q,'新存歌');
 }
});

test('malformed optional actor keys fail before any API request or notification',()=>{
 for(const key of [false,0,{},[],Symbol('actor'),new String('actor'),'a'.repeat(257)]){
  const f=fixture();f.setContext(actorContext(key));
  assert.throws(()=>f.manager.state(),/空間資訊不正確/);
  assert.throws(()=>f.manager.load(),/空間資訊不正確/);
  assert.equal(f.calls.length,0);assert.equal(f.changes.length,0);
 }
});
