import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePlayerProvisioner} from '../src/native-player-provisioning.js';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const initialContext=()=>({active:true,role:'super_admin',accountId:uuid(1),spaceId:'native-space',roomId:'native-room'});
const row=(n=2,extra={})=>({accountId:uuid(n),membershipId:uuid(n+100),spaceId:'native-space',role:'player',status:'active',
 createdAt:'2026-10-09T04:00:00.000Z',displayLabel:'已驗證玩家 '+n,...extra});
const page=(rows=[row()],extra={})=>({rows,total:rows.length,revision:7,...extra});
const result=(name='New player',extra={})=>({revision:8,created:[{playerId:'generated-player',name}],...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>Promise.resolve();
function fixture(options={}){
 let ctx=initialContext();const calls=[],pending=[],changes=[];
 const m=createNativePlayerProvisioner({api:payload=>{calls.push(structuredClone(payload));const next=deferred();pending.push(next);return next.promise;},
  context:()=>ctx,onChange:value=>changes.push(value),...options});
 return {m,calls,pending,changes,setContext:value=>{ctx=value;}};
}
async function load(f,response=page(),options={}){const task=f.m.load(options);await tick();f.pending.at(-1).resolve(response);return task;}
async function choose(f,response=page()){await load(f,response);f.m.selectAccount(response.rows[0].accountId);}

test('construction and explicit query/page/selection edits do not read, pages are bounded and one response cache stays bounded',async()=>{
 const f=fixture(),m=f.m;assert.deepEqual(m.state(),{q:'',page:0,rows:[],total:0,revision:null,loading:false,saving:false,error:null,selectedAccountId:null,result:null});
 m.setQuery('  明選玩家  ');m.setPage(2);assert.equal(f.calls.length,0);assert.equal(m.state().q,'明選玩家');
 for(const query of [null,{},'q'.repeat(101)])assert.throws(()=>m.setQuery(query));
 for(const index of [-1,0.5,500001,Number.MAX_SAFE_INTEGER,'1'])assert.throws(()=>m.setPage(index));
 m.setPage(500000);m.setPage(2);
 await load(f,page([row()],{total:42,pageLimit:20,pageOffset:40}));
 assert.deepEqual(f.calls,[{op:'nativePlayerEligibility',spaceId:'native-space',query:'明選玩家',page:2,limit:20,management:true}]);
 const changes=f.changes.length;await m.load();assert.equal(f.calls.length,1);assert.equal(f.changes.length,changes);
 m.selectAccount(uuid(2));m.setQuery('另一位');assert.equal(m.state().page,0);assert.equal(m.state().selectedAccountId,null);assert.equal(m.state().revision,null);assert.deepEqual(m.state().rows,[]);
 await load(f,page([row(3)]));m.setPage(1);await load(f,page([row(4)],{total:21}));
 assert.deepEqual(m.state().rows.map(r=>r.accountId),[uuid(4)]);m.setPage(0);await load(f,page([row(5)]));assert.equal(f.calls.length,4,'one page is cached rather than retaining a catalog of past pages');
});

test('identical pending reads coalesce and render callbacks cannot retry success or failure in a loop',async()=>{
 const calls=[],pending=[];let m,changes=0;
 m=createNativePlayerProvisioner({api:payload=>{calls.push(payload);const next=deferred();pending.push(next);return next.promise;},context:initialContext,
  onChange:()=>{changes++;m.state();m.load();}});
 const task=m.load();assert.equal(task,m.load());assert.equal(task,m.load({force:true}));await tick();assert.equal(calls.length,1);
 pending[0].resolve(page());await task;assert.equal(changes,2);await m.load();assert.equal(calls.length,1);
 const failed=m.load({force:true});await tick();pending[1].reject(Error('查詢暫時失敗'));await failed;
 assert.equal(changes,4);assert.equal(m.state().error,'查詢暫時失敗');assert.equal(m.state().revision,null);await m.load();assert.equal(calls.length,2);
 const retry=m.load({force:true});await tick();pending[2].resolve(page());await retry;assert.equal(m.state().error,null);assert.equal(calls.length,3);assert.equal(changes,6);
});

test('only an active verified President in a nonlegacy Space can read or write; malformed contexts fail before API',()=>{
 const denied=[null,{}, {...initialContext(),active:false},{...initialContext(),active:'true'}, {...initialContext(),role:'player'},
  {...initialContext(),role:'streamer_admin'},{...initialContext(),role:'admin'},{...initialContext(),accountId:null},
  {...initialContext(),accountId:'unverified'}, {...initialContext(),spaceId:'space-001'}, {...initialContext(),spaceId:''},
  {...initialContext(),spaceId:'x'.repeat(201)},{...initialContext(),roomId:null},{...initialContext(),roomId:'\nroom'}];
 for(const ctx of denied){const f=fixture();f.setContext(ctx);assert.equal(f.m.state().revision,null);
  assert.throws(()=>f.m.load(),/登入總裁/);assert.throws(()=>f.m.provision({name:'New player'}),/登入總裁/);assert.equal(f.calls.length,0);}
 for(const options of [{api:null},{context:null},{onChange:null}])assert.throws(()=>fixture(options),/控制器/);
});

test('eligibility safely projects exact active Space choices and immutable state, normalizing UUID case without exposing extra fields',async()=>{
 const accountId='abcdefab-1234-4000-8000-abcdefabcdef',membershipId='fedcbafe-1234-4000-8000-fedcbafedcba';
 const f=fixture(),input=page([row(171,{accountId:accountId.toUpperCase(),membershipId:membershipId.toUpperCase(),password:'fixture-secret',token:'fixture-secret',
  playerId:'not-a-match',privateNotes:'fixture-secret',legacyId:'not-a-match'})],{accountId:'fixture-secret',state:{players:[{password:'fixture-secret'}]}}),before=structuredClone(input);
 await load(f,input);const view=f.m.state();assert.deepEqual(view.rows,[row(171,{accountId,membershipId})]);assert.equal(JSON.stringify(view).includes('fixture-secret'),false);
 assert.equal(Object.isFrozen(view.rows[0]),true);assert.throws(()=>view.rows.push(row(3)));assert.throws(()=>{view.rows[0].membershipId=uuid(999);});
 f.m.selectAccount(accountId.toUpperCase());assert.equal(f.m.state().selectedAccountId,accountId);f.m.selectAccount(null);assert.equal(f.m.state().selectedAccountId,null);
 assert.deepEqual(input,before,'responses are not normalized or stripped in place');
});

test('all malformed, oversized, duplicated or foreign eligibility rows reject together and remain cached until explicit retry',async()=>{
 const bad=[null,{rows:{},total:0,revision:7},page([],{total:-1}),page([],{revision:'7'}),page([],{revision:7.5}),page([],{revision:-1}),
  page([row()],{total:0}),page([row()],{pageLimit:50}),page([row()],{pageOffset:1}),page(Array.from({length:21},(_,i)=>row(i+2))),
  page([null]),page([row(2,{accountId:'bad'})]),page([row(2,{membershipId:'bad'})]),page([row(2,{spaceId:'foreign-space'})]),
  page([row(2,{role:'super_admin'})]),page([row(2,{status:'suspended'})]),page([row(2,{displayLabel:7})]),page([row(2,{displayLabel:'x'.repeat(201)})]),
  page([row(2,{createdAt:'invalid'})]),page([row(2),row(2)]),page([row(2),row(3,{membershipId:uuid(102)})]),page(Array(1))];
 for(const response of bad){const f=fixture();await load(f,response);const view=f.m.state();assert.ok(view.error);assert.deepEqual(view.rows,[]);assert.equal(view.revision,null);
  assert.throws(()=>f.m.selectAccount(uuid(2)));await f.m.load();assert.equal(f.calls.length,1);}
 const f=fixture();f.m.setPage(1);await load(f,page([row()],{total:1}));assert.ok(f.m.state().error,'count cannot omit rows before the selected page');
});

const scopeChanges=[
 ['Space',{...initialContext(),spaceId:'other-space'}],['room',{...initialContext(),roomId:'other-room'}],
 ['Account',{...initialContext(),accountId:uuid(9)}],['role',{...initialContext(),role:'streamer_admin'}],
 ['close',{...initialContext(),active:false}],['logout',null]
];

test('scope changes before read dispatch send no API and clear search, page and selection without recursive state notifications',async()=>{
 for(const [label,next] of scopeChanges){const f=fixture();f.m.setQuery('old query');f.m.setPage(2);const task=f.m.load(),notifications=f.changes.length;
  f.setContext(next);assert.equal(f.m.state().q,'',label);assert.equal(f.m.state().page,0);assert.equal(f.changes.length,notifications);
  assert.equal(await task,null);assert.equal(f.calls.length,0,label);assert.equal(f.m.state().loading,false);}
});

test('late reads and failures cannot restore an old Space, Account, role or closed selection',async()=>{
 for(const [label,next] of scopeChanges){const f=fixture();const old=f.m.load();await tick();f.setContext(next);const changes=f.changes.length;
  f.pending[0].resolve(page());assert.equal(await old,null,label);assert.deepEqual(f.m.state().rows,[]);assert.equal(f.m.state().revision,null);assert.equal(f.changes.length,changes);}
 const f=fixture(),old=f.m.load();await tick();f.setContext({...initialContext(),roomId:'other-room'});f.m.state();const current=f.m.load();await tick();
 f.pending[0].reject(Error('old failure'));assert.equal(await old,null);assert.equal(f.m.state().error,null);assert.equal(f.m.state().loading,true);
 f.pending[1].resolve(page([row(3)]));await current;assert.equal(f.m.state().rows[0].accountId,uuid(3));
});

test('changing query/page and reset discards stale pages and selected identities without any automatic reads',async()=>{
 for(const change of [m=>m.setQuery('other'),m=>m.setPage(1),m=>m.reset()]){
  const f=fixture();await choose(f);const stale=f.m.load({force:true});await tick();change(f.m);const count=f.calls.length;
  f.pending[1].resolve(page([row(4)]));assert.equal(await stale,null);assert.deepEqual(f.m.state().rows,[]);assert.equal(f.m.state().selectedAccountId,null);assert.equal(f.calls.length,count);
 }
 const f=fixture();await choose(f);const before=f.changes.length;f.m.reset();assert.equal(f.m.state().q,'');assert.equal(f.m.state().revision,null);assert.equal(f.calls.length,1);assert.equal(f.changes.length,before+1);
});

test('a single explicit Account/Membership choice writes only five allowed profile fields at the eligibility revision',async()=>{
 const f=fixture();await choose(f,page([row(2),row(3)],{revision:41}));f.m.selectAccount(uuid(3));
 const fields={name:'  Name chosen by user  ',ids:'ID-A,其他-ID',names:'Old alias',certification:'🐯',note:'Business note <b>plain data</b>'},before=structuredClone(fields);
 const task=f.m.provision(fields);assert.equal(f.m.state().saving,true);await tick();
 assert.deepEqual(f.calls[1],{op:'nativePlayerProvision',streamer:'native-room',spaceId:'native-space',revision:41,management:true,
  rows:[{accountId:uuid(3),membershipId:uuid(103),name:'Name chosen by user',ids:fields.ids,names:fields.names,certification:fields.certification,note:fields.note}]});
 f.pending[1].resolve({revision:42,created:[{playerId:'actual-generated-id',name:'Name chosen by user',password:'fixture-secret'}],state:{players:[{password:'fixture-secret'}]}});
 const saved=await task;assert.deepEqual(saved,{revision:42,created:[{playerId:'actual-generated-id',name:'Name chosen by user'}]});assert.equal(Object.isFrozen(saved.created[0]),true);
 const view=f.m.state();assert.deepEqual(view.result,saved);assert.equal(view.saving,false);assert.equal(view.selectedAccountId,null);assert.equal(view.revision,null);assert.deepEqual(view.rows,[]);
 assert.equal(f.calls.length,2,'no automatic page reload or business state read');assert.throws(()=>f.m.provision({name:'Again'}),/先讀取清單/);
 const reload=f.m.load();assert.equal(f.m.state().result,null);await tick();assert.equal(f.calls.length,3);f.pending[2].resolve(page([row(2)],{revision:42}));await reload;
 assert.deepEqual(fields,before);assert.equal(f.m.state().revision,42);
});

test('no names, platform IDs or stale page choices infer a binding; unknown fields and invalid profile inputs never reach API',async()=>{
 const f=fixture();assert.throws(()=>f.m.provision({name:'已驗證玩家 2'}),/先讀取清單/);await load(f,page([row(2,{displayLabel:'Same name'})]));
 assert.throws(()=>f.m.provision({name:'Same name',ids:uuid(2)}),/先讀取清單/);assert.throws(()=>f.m.selectAccount(uuid(3)));assert.throws(()=>f.m.selectAccount({accountId:uuid(2)}));
 f.m.selectAccount(uuid(2));
 for(const value of [null,[],{}, {name:''},{name:' '.repeat(3)},{name:7},{name:'n'.repeat(201)},
  {name:'Valid',password:''},{name:'Valid',currentPassword:'secret'},{name:'Valid',token:'secret'},{name:'Valid',accountId:uuid(3)},
  {name:'Valid',membershipId:uuid(103)},{name:'Valid',playerId:'guessed'},{name:'Valid',balance:0},{name:'Valid',test:false},
  {name:'Valid',note:{}},{name:'Valid',ids:['id']},{name:'Valid',names:null},{name:'Valid',certification:'x'.repeat(1001)}]){
  assert.throws(()=>f.m.provision(value));assert.equal(f.calls.length,1);
 }
 f.m.setQuery('different');assert.throws(()=>f.m.selectAccount(uuid(2)));assert.throws(()=>f.m.provision({name:'Valid'}));assert.equal(f.calls.length,1);
});

test('while saving a second provision and selection/search/page/load edits are blocked without losing the actual pending write',async()=>{
 const f=fixture();await choose(f);const task=f.m.provision({name:'New player'});
 for(const operation of [()=>f.m.provision({name:'New player'}),()=>f.m.provision({name:'Another'}),()=>f.m.selectAccount(null),()=>f.m.setQuery('other'),()=>f.m.setPage(1),()=>f.m.load({force:true})])
  assert.throws(operation,/建檔中/);
 await tick();assert.equal(f.calls.length,2);assert.equal(f.m.state().saving,true);f.pending[1].resolve(result());await task;assert.equal(f.m.state().saving,false);
});

test('every authority or close change before provision dispatch prevents an old profile payload from using a new identity',async()=>{
 for(const [label,next] of scopeChanges){const f=fixture();await choose(f);const task=f.m.provision({name:'New player'});f.setContext(next);
  assert.equal(await task,null,label);assert.equal(f.calls.length,1,label);assert.equal(f.m.state().selectedAccountId,null);assert.equal(f.m.state().saving,false);assert.equal(f.m.state().result,null);}
 const f=fixture();await choose(f);const task=f.m.provision({name:'New player'});f.m.reset();assert.equal(await task,null);assert.equal(f.calls.length,1);
});

test('late provision responses and failures after scope changes or close/reset do not install results, errors or stale choices',async()=>{
 for(const [label,next] of scopeChanges){const f=fixture();await choose(f);const task=f.m.provision({name:'New player'});await tick();f.setContext(next);const changes=f.changes.length;
  f.pending[1].resolve(result());assert.equal(await task,null,label);assert.equal(f.m.state().result,null);assert.equal(f.m.state().error,null);assert.equal(f.m.state().revision,null);assert.equal(f.changes.length,changes);}
 const f=fixture();await choose(f);const old=f.m.provision({name:'New player'});await tick();f.m.reset();const current=f.m.load();await tick();
 f.pending[1].reject(Error('stale write failure'));assert.equal(await old,null);assert.equal(f.m.state().error,null);assert.equal(f.m.state().loading,true);
 f.pending[2].resolve(page([row(3)],{revision:8}));await current;assert.equal(f.m.state().rows[0].accountId,uuid(3));
});

test('failed or malformed write results show an error and require a fresh explicit eligibility read before another write',async()=>{
 const bad=[null,result('New player',{revision:7}),result('New player',{revision:9}),result('New player',{revision:'8'}),
  result('New player',{created:[]}),result('New player',{created:[{playerId:'',name:'New player'}]}),result('New player',{created:[{playerId:'x',name:'Wrong name'}]}),
  result('New player',{created:[{playerId:'x',name:'New player'},{playerId:'y',name:'New player'}]})];
 for(const response of bad){const f=fixture();await choose(f);const task=f.m.provision({name:'New player'});await tick();f.pending[1].resolve(response);
  await assert.rejects(task,/建檔結果/);assert.ok(f.m.state().error);assert.deepEqual(f.m.state().rows,[]);assert.equal(f.m.state().revision,null);assert.equal(f.m.state().selectedAccountId,null);assert.equal(f.m.state().saving,false);
  assert.throws(()=>f.m.provision({name:'New player'}),/先讀取清單/);assert.equal(f.calls.length,2);}
 const f=fixture();await choose(f);const task=f.m.provision({name:'New player'});await tick();f.pending[1].reject(Error('VERSION_CONFLICT'));
 await assert.rejects(task,/VERSION_CONFLICT/);assert.equal(f.m.state().error,'VERSION_CONFLICT');assert.equal(f.calls.length,2);
 await load(f,page([row(3)],{revision:8}));assert.equal(f.m.state().error,null);assert.equal(f.m.state().revision,8);
});
