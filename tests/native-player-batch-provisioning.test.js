import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePlayerProvisioner} from '../src/native-player-provisioning.js';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const initialContext=()=>({active:true,role:'super_admin',accountId:uuid(1),spaceId:'native-space',roomId:'native-room'});
const eligible=(n=2,extra={})=>({accountId:uuid(n),membershipId:uuid(n+100),spaceId:'native-space',role:'player',status:'active',createdAt:'2026-10-09T04:00:00Z',displayLabel:'Verified '+n,...extra});
const page=(rows=[eligible(2),eligible(3)],extra={})=>({rows,total:rows.length,revision:7,...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>Promise.resolve();
function fixture(){
 let ctx=initialContext();const calls=[],pending=[],changes=[];
 const m=createNativePlayerProvisioner({api:payload=>{calls.push(structuredClone(payload));const next=deferred();pending.push(next);return next.promise;},context:()=>ctx,onChange:value=>changes.push(value)});
 return {m,calls,pending,changes,setContext:value=>{ctx=value;}};
}
async function load(f,response=page(),options={}){const task=f.m.load(options);await tick();f.pending.at(-1).resolve(response);return task;}
async function bound(f){
 await load(f);f.m.previewBatch(' First |ID-1|Alias|Certified|Business note\nSecond||||');
 f.m.bindBatchAccount(uuid(2));f.m.chooseBatchRow(1);f.m.bindBatchAccount(uuid(3));
}
const result=(names=['First','Second'],revision=8)=>({revision,created:names.map((name,index)=>({playerId:'new-player-'+index,name}))});

test('five-column pipe, fullwidth and TSV previews preserve source lines, validate fields and never infer or expose Account authority',async()=>{
 const f=fixture();await load(f);
 const text='\n First |ID-1,ID-2|Alias|Certified|Business note \r\n\r\nSecond｜｜｜｜\nThird\tID-3\tAlias | literal\tCertified\tNote';
 const before=f.calls.length;f.m.previewBatch(text);const batch=f.m.state().batch;
 assert.equal(batch.text,text);assert.equal(batch.revision,7);assert.equal(batch.activeIndex,0);assert.deepEqual(batch.rows.map(row=>row.line),[2,4,5]);
 assert.deepEqual(batch.rows[0],{line:2,fields:{name:'First',ids:'ID-1,ID-2',names:'Alias',certification:'Certified',note:'Business note'},error:null,skip:false,binding:null});
 assert.equal(batch.rows[2].fields.names,'Alias | literal');assert.ok(batch.rows.every(row=>!row.binding));assert.equal(f.calls.length,before);
 assert.equal(Object.isFrozen(batch.rows[0].fields),true);assert.throws(()=>{batch.rows[0].fields.name='Mutated';});
 assert.throws(()=>f.m.provisionBatch(),/明確選擇/);assert.equal(f.calls.length,before);
});

test('malformed rows stay visible, can be explicitly skipped and cannot select or submit themselves',async()=>{
 const f=fixture();await load(f);f.m.previewBatch('Bad|only|three\n||||\n'+('n'.repeat(201))+'||||\nName|'+('i'.repeat(1001))+'|||\nGood||||\nName|id|alias|cert|note|password');
 const rows=f.m.state().batch.rows;assert.equal(rows.length,6);assert.equal(f.m.state().batch.activeIndex,4);assert.deepEqual(rows.map(row=>!!row.error),[true,true,true,true,false,true]);
 assert.ok(rows.every(row=>row.fields&&typeof row.fields==='object'));assert.throws(()=>f.m.chooseBatchRow(0),/修正資料/);
 f.m.bindBatchAccount(uuid(2));assert.throws(()=>f.m.provisionBatch(),/修正每筆資料/);assert.equal(f.calls.length,1);
 for(const index of [0,1,2,3,5])f.m.skipBatchRow(index,true);
 const task=f.m.provisionBatch();await tick();assert.equal(f.calls[1].rows.length,1);assert.equal(f.calls[1].rows[0].name,'Good');f.pending[1].resolve(result(['Good']));await task;
});

test('preview import bound is 100 rows and 500000 characters; invalid replacement clears old bindings and no alternate formats are guessed',async()=>{
 const f=fixture();await bound(f);
 for(const text of [null,{},'', '\n \r\n',Array.from({length:101},(_,i)=>'Name '+i+'||||').join('\n'),'x'.repeat(500001)]){
  assert.throws(()=>f.m.previewBatch(text));assert.deepEqual(f.m.state().batch,{text:'',rows:[],revision:null,activeIndex:null});
 }
 f.m.previewBatch(Array.from({length:100},(_,i)=>'Name '+i+'||||').join('\n'));assert.equal(f.m.state().batch.rows.length,100);
 f.m.previewBatch('Comma,id,alias,cert,note\n{"name":"JSON","password":"secret"}');assert.ok(f.m.state().batch.rows.every(row=>row.error));
 assert.equal(f.calls.length,1);f.m.clearBatch();assert.deepEqual(f.m.state().batch.rows,[]);
});

test('only validated current active own-Space choices bind and duplicate Accounts or Memberships across rows are rejected',async()=>{
 const f=fixture();f.m.previewBatch('First||||\nSecond||||');assert.throws(()=>f.m.bindBatchAccount(uuid(2)));await load(f);
 for(const account of [null,'bad',uuid(99),{accountId:uuid(2)}])assert.throws(()=>f.m.bindBatchAccount(account));
 f.m.bindBatchAccount(uuid(2));f.m.chooseBatchRow(1);assert.throws(()=>f.m.bindBatchAccount(uuid(2)),/只能綁定一位/);
 f.m.setQuery('different');const pending=f.m.load();assert.throws(()=>f.m.bindBatchAccount(uuid(3)));await tick();
 f.pending[1].resolve(page([eligible(3,{membershipId:uuid(102)})]));await pending;
 assert.throws(()=>f.m.bindBatchAccount(uuid(3)),/只能綁定一位/);assert.equal(f.m.state().batch.rows[0].binding.accountId,uuid(2));
 f.m.skipBatchRow(0,true);f.m.bindBatchAccount(uuid(3));assert.equal(f.m.state().batch.rows[1].binding.accountId,uuid(3));
 f.m.skipBatchRow(1,true);assert.equal(f.m.state().batch.activeIndex,null);assert.throws(()=>f.m.bindBatchAccount(uuid(3)));
 assert.throws(()=>f.m.provisionBatch(),/1 至 100/);assert.equal(f.calls.filter(call=>call.op==='nativePlayerProvision').length,0);
});

test('query/page jumps retain explicit bindings only when their response revision matches and no full eligibility directory is cached',async()=>{
 const f=fixture();await bound(f);const original=f.m.state().batch;
 f.m.setPage(1);assert.equal(f.m.state().revision,null);assert.deepEqual(f.m.state().batch,original);
 await load(f,page([eligible(4)],{total:21}));assert.deepEqual(f.m.state().batch,original);assert.deepEqual(f.m.state().rows.map(row=>row.accountId),[uuid(4)]);
 f.m.setQuery('Third');await load(f,page([eligible(5)]));assert.deepEqual(f.m.state().batch,original);assert.deepEqual(f.m.state().rows.map(row=>row.accountId),[uuid(5)]);
 const task=f.m.provisionBatch();await tick();assert.deepEqual(f.calls.at(-1).rows.map(row=>row.accountId),[uuid(2),uuid(3)]);f.pending.at(-1).resolve(result());await task;
});

test('a changed revision, new preview, text edit or skip edit invalidates obsolete binding proofs',async()=>{
 const f=fixture();await bound(f);await load(f,page(undefined,{revision:8}),{force:true});
 assert.equal(f.m.state().batch.revision,8);assert.ok(f.m.state().batch.rows.every(row=>!row.binding));assert.throws(()=>f.m.provisionBatch(),/明確選擇/);
 f.m.chooseBatchRow(0);f.m.bindBatchAccount(uuid(2));f.m.previewBatch('First||||\nSecond||||');assert.ok(f.m.state().batch.rows.every(row=>!row.binding));
 f.m.bindBatchAccount(uuid(2));f.m.skipBatchRow(0,true);assert.equal(f.m.state().batch.rows[0].binding,null);f.m.skipBatchRow(0,false);assert.equal(f.m.state().batch.rows[0].binding,null);
 for(const index of [-1,2,0.5,'0',null])assert.throws(()=>f.m.chooseBatchRow(index));assert.throws(()=>f.m.skipBatchRow(0,'true'));
 f.m.clearBatch();assert.equal(f.m.state().batch.text,'');assert.equal(f.calls.length,2);
});

test('an empty eligibility response returns to page one without an extra read and respects batch revision invalidation',async()=>{
 const f=fixture();await bound(f);const batch=f.m.state().batch;f.m.setPage(2);
 await load(f,page([],{total:0,pageLimit:20,pageOffset:40}));assert.equal(f.m.state().page,0);assert.deepEqual(f.m.state().batch,batch);
 assert.equal(f.calls.at(-1).page,2);await f.m.load();assert.equal(f.calls.length,2,'the empty list also satisfies page zero cache');
 f.m.setPage(2);await load(f,page([],{total:0,revision:8,pageLimit:20,pageOffset:40}));
 assert.equal(f.m.state().page,0);assert.equal(f.m.state().batch.revision,8);assert.ok(f.m.state().batch.rows.every(row=>!row.binding));
 assert.equal(f.m.state().batch.text,batch.text);assert.throws(()=>f.m.provisionBatch(),/明確選擇/);assert.equal(f.calls.length,3);
});

test('nonzero eligibility shrink reads its last valid page exactly once and caches only that separately validated response',async()=>{
 const f=fixture();await bound(f);f.m.setQuery('retained query');f.m.setPage(1);const task=f.m.load();await tick();
 f.pending[1].resolve(page([],{total:1,revision:8,pageLimit:20,pageOffset:20}));
 for(let step=0;step<10&&f.calls.length<3;step++)await tick();
 assert.equal(f.calls.length,3);assert.deepEqual(f.calls[2],{op:'nativePlayerEligibility',spaceId:'native-space',query:'retained query',page:0,limit:20,management:true});
 assert.equal(f.m.state().loading,true);assert.equal(f.m.state().page,0);assert.equal(f.m.state().revision,null);assert.ok(f.m.state().batch.rows.every(row=>!row.binding));
 f.pending[2].resolve(page([eligible(5)],{total:1,revision:8,pageLimit:20,pageOffset:0}));await task;
 assert.deepEqual(f.m.state().rows.map(row=>row.accountId),[uuid(5)]);assert.equal(f.m.state().page,0);assert.equal(f.m.state().q,'retained query');
 await f.m.load();assert.equal(f.calls.length,3,'out-of-range initial response never satisfies the corrected page cache');
});

test('scope change after recognizing a shrinking page but before correction dispatch suppresses the old API',async()=>{
 const f=fixture();await bound(f);f.m.setPage(1);const task=f.m.load();await tick();
 f.pending[1].resolve(page([],{total:1,revision:8,pageLimit:20,pageOffset:20}));
 for(let step=0;step<10&&f.m.state().page!==0;step++)await tick();
 assert.equal(f.m.state().page,0);assert.equal(f.calls.length,2,'correction has been recognized but has not dispatched');
 f.setContext({...initialContext(),spaceId:'other-space'});assert.equal(await task,null);assert.equal(f.calls.length,2);assert.deepEqual(f.m.state().batch.rows,[]);assert.equal(f.m.state().revision,null);
});

test('correction rejects foreign rows and repeated shrink without following more pages or caching a false successful page',async()=>{
 for(const corrected of [page([eligible(5,{spaceId:'foreign-space'})],{revision:8}),page([eligible(5)],{revision:8,pageOffset:20})]){
  const f=fixture();await bound(f);f.m.setPage(1);const task=f.m.load();await tick();f.pending[1].resolve(page([],{total:1,revision:8}));
  for(let step=0;step<10&&f.calls.length<3;step++)await tick();f.pending[2].resolve(corrected);await task;
  assert.equal(f.calls.length,3);assert.ok(f.m.state().error);assert.equal(f.m.state().revision,null);assert.deepEqual(f.m.state().rows,[]);await f.m.load();assert.equal(f.calls.length,3);
 }
 const f=fixture();await bound(f);f.m.setPage(3);const task=f.m.load();await tick();f.pending[1].resolve(page([],{total:41,revision:8}));
 for(let step=0;step<10&&f.calls.length<3;step++)await tick();assert.equal(f.calls[2].page,2);f.pending[2].resolve(page([],{total:1,revision:9}));await task;
 assert.equal(f.calls.length,3);assert.equal(f.m.state().page,0);assert.match(f.m.state().error,/剛更新/);assert.equal(f.m.state().revision,null);assert.ok(f.m.state().batch.rows.every(row=>!row.binding));
 await f.m.load();assert.equal(f.calls.length,3,'a repeated shrink requires an explicit read instead of a correction loop');
});

test('batch submits one exact allowlisted rows transaction at the eligibility revision, sanitizes complete result and cannot repeat',async()=>{
 const f=fixture();await bound(f);const task=f.m.provisionBatch();assert.equal(f.m.state().saving,true);await tick();
 assert.deepEqual(f.calls[1],{op:'nativePlayerProvision',streamer:'native-room',spaceId:'native-space',revision:7,management:true,rows:[
  {accountId:uuid(2),membershipId:uuid(102),name:'First',ids:'ID-1',names:'Alias',certification:'Certified',note:'Business note'},
  {accountId:uuid(3),membershipId:uuid(103),name:'Second',ids:'',names:'',certification:'',note:''}
 ]});
 f.pending[1].resolve({...result(),password:'secret',created:result().created.map(row=>({...row,password:'secret',balance:99}))});
 const saved=await task;assert.deepEqual(saved,result());assert.equal(JSON.stringify(f.m.state()).includes('secret'),false);assert.equal(Object.isFrozen(saved.created[0]),true);
 assert.deepEqual(f.m.state().batch,{text:'',rows:[],revision:null,activeIndex:null});assert.deepEqual(f.m.state().result,result());assert.equal(f.calls.length,2);
 assert.throws(()=>f.m.provisionBatch(),/先讀取清單/);assert.equal(f.calls.length,2);
});

test('saving locks every single and batch edit, second write, page read and binding method until completion',async()=>{
 const f=fixture();await bound(f);const task=f.m.provisionBatch();
 for(const operation of [()=>f.m.previewBatch('Other||||'),()=>f.m.clearBatch(),()=>f.m.chooseBatchRow(0),()=>f.m.skipBatchRow(0,true),()=>f.m.bindBatchAccount(uuid(2)),
  ()=>f.m.selectAccount(uuid(2)),()=>f.m.setQuery('Other'),()=>f.m.setPage(1),()=>f.m.load(),()=>f.m.provisionBatch(),()=>f.m.provision({name:'Other'})])assert.throws(operation,/建檔中/);
 await tick();assert.equal(f.calls.length,2);f.pending[1].resolve(result());await task;assert.equal(f.m.state().saving,false);
});

const scopeChanges=[['Space',{...initialContext(),spaceId:'other-space'}],['room',{...initialContext(),roomId:'other-room'}],['Account',{...initialContext(),accountId:uuid(9)}],
 ['role',{...initialContext(),role:'streamer_admin'}],['close',{...initialContext(),active:false}],['logout',null]];
test('batch scope changes before dispatch suppress the request and discard every row and binding',async()=>{
 for(const [label,next] of scopeChanges){const f=fixture();await bound(f);const task=f.m.provisionBatch();f.setContext(next);
  assert.equal(await task,null,label);assert.equal(f.calls.length,1,label);assert.deepEqual(f.m.state().batch.rows,[]);assert.equal(f.m.state().saving,false);}
 const f=fixture();await bound(f);const task=f.m.provisionBatch();f.m.reset();assert.equal(await task,null);assert.equal(f.calls.length,1);
});

test('late batch write success or rejection cannot change another scope, closed dialog or replacement read',async()=>{
 for(const [label,next] of scopeChanges){const f=fixture();await bound(f);const task=f.m.provisionBatch();await tick();f.setContext(next);const changes=f.changes.length;
  f.pending[1].resolve(result());assert.equal(await task,null,label);assert.equal(f.m.state().result,null);assert.equal(f.m.state().error,null);assert.equal(f.changes.length,changes);}
 const f=fixture();await bound(f);const old=f.m.provisionBatch();await tick();f.m.reset();const current=f.m.load();await tick();
 f.pending[1].reject(Error('late unknown write'));assert.equal(await old,null);assert.equal(f.m.state().loading,true);assert.equal(f.m.state().error,null);
 f.pending[2].resolve(page([eligible(5)],{revision:8}));await current;assert.equal(f.m.state().revision,8);assert.deepEqual(f.m.state().batch.rows,[]);
});

test('lost acknowledgement invalidates all bindings and revision, retains preview and requires fresh read plus explicit rebindings without automatic retry',async()=>{
 const f=fixture();await bound(f);const original=f.m.state().batch;const task=f.m.provisionBatch();await tick();f.pending[1].reject(Error('network lost'));
 await assert.rejects(task,/network lost.*確認是否已建檔/);const view=f.m.state();assert.equal(view.revision,null);assert.equal(view.batch.revision,null);
 assert.equal(view.batch.text,original.text);assert.ok(view.batch.rows.every(row=>!row.binding));assert.equal(view.saving,false);assert.match(view.error,/重新選擇帳號/);
 assert.throws(()=>f.m.provisionBatch(),/先讀取清單/);assert.equal(f.calls.length,2);await load(f,page(undefined,{revision:8}));
 assert.ok(f.m.state().batch.rows.every(row=>!row.binding));assert.throws(()=>f.m.provisionBatch(),/明確選擇/);
 f.m.chooseBatchRow(0);f.m.bindBatchAccount(uuid(2));f.m.chooseBatchRow(1);f.m.bindBatchAccount(uuid(3));const retry=f.m.provisionBatch();await tick();
 assert.equal(f.calls.at(-1).revision,8);f.pending.at(-1).resolve(result(undefined,9));await retry;assert.equal(f.calls.length,4);
});

test('malformed batch acknowledgements reject missing, reordered or extra names and duplicate player IDs as a whole',async()=>{
 const bad=[null,{...result(),revision:7},{...result(),revision:'8'},{...result(),created:[]},result(['First']),result(['First','Second','Third']),result(['Second','First']),
  {...result(),created:[{playerId:'same',name:'First'},{playerId:'same',name:'Second'}]},
  {...result(),created:[{playerId:'valid',name:'First'},{playerId:'',name:'Second'}]},
  {...result(),created:[{playerId:'valid',name:'First'},null]}];
 for(const response of bad){const f=fixture();await bound(f);const task=f.m.provisionBatch();await tick();f.pending[1].resolve(response);
  await assert.rejects(task,/建檔結果/);assert.equal(f.m.state().result,null);assert.equal(f.m.state().revision,null);assert.ok(f.m.state().batch.rows.every(row=>!row.binding));assert.equal(f.calls.length,2);}
});

test('stale eligibility responses cannot invalidate newer page bindings or resurrect an old preview',async()=>{
 const f=fixture();await bound(f);const old=f.m.load({force:true});await tick();f.m.setQuery('new query');const current=f.m.load();await tick();
 f.pending[2].resolve(page([eligible(5)]));await current;f.m.chooseBatchRow(1);f.m.bindBatchAccount(uuid(5));const batch=f.m.state().batch;
 f.pending[1].resolve(page(undefined,{revision:8}));assert.equal(await old,null);assert.deepEqual(f.m.state().batch,batch);
 const loading=f.m.load({force:true});await tick();f.m.clearBatch();f.pending[3].resolve(page());await loading;assert.deepEqual(f.m.state().batch.rows,[]);
});

test('denied native scope prevents every batch API before reading or changing the controller',()=>{
 for(const context of [null,{...initialContext(),active:false},{...initialContext(),role:'player'},{...initialContext(),spaceId:'space-001'},{...initialContext(),accountId:'bad'}]){
  const f=fixture();f.setContext(context);
  for(const operation of [()=>f.m.previewBatch('Name||||'),()=>f.m.clearBatch(),()=>f.m.chooseBatchRow(0),()=>f.m.skipBatchRow(0,true),()=>f.m.bindBatchAccount(uuid(2)),()=>f.m.provisionBatch()])assert.throws(operation,/登入總裁/);
  assert.equal(f.calls.length,0);assert.deepEqual(f.m.state().batch.rows,[]);
 }
});
