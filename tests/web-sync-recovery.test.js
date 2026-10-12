import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebSyncRecovery} from '../src/web-sync-recovery.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(options={}){
 const state={scope:'account1:space1:room1',readable:true,renderable:true,revision:0};
 const calls=[],applied=[],renders=[],errors=[],timers=new Map();let timerSequence=0;
 const sync=createWebSyncRecovery({
  contextKey:()=>state.scope,canRead:()=>state.readable,canRender:()=>state.renderable,
  read:(force,scope)=>{const job=deferred();calls.push({force,scope,...job});return job.promise;},
  apply:(result,scope)=>{if(result.revision<=state.revision)return false;state.revision=result.revision;applied.push({result,scope});return true;},
  render:()=>renders.push(state.revision),onError:(error,details)=>errors.push({error,details}),
  schedule:(callback,delay)=>{const id=++timerSequence;timers.set(id,{callback,delay});return id;},cancel:id=>timers.delete(id),...options
 });
 return {sync,state,calls,applied,renders,errors,timers,async success(index,revision){calls[index].resolve({revision});await tick();},async fail(index,error=new TypeError('offline')){calls[index].reject(error);await tick();},async fire(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.callback();await tick();return timer.delay;}};
}

test('concurrent refreshes share the current read and burst invalidations create one trailing read',async()=>{
 const h=harness(),first=h.sync.refresh(),joined=h.sync.refresh();await tick();assert.equal(h.calls.length,1);
 for(let i=0;i<50;i++)h.sync.invalidate('notice');await h.success(0,1);await first;await joined;
 assert.equal(h.calls.length,2);assert.equal(h.sync.snapshot().reading,true);await h.success(1,2);assert.equal(h.calls.length,2);assert.equal(h.sync.snapshot().pending,false);assert.deepEqual(h.renders,[1,2]);
});

test('force requested during a read waits for the single forced trailing read',async()=>{
 const h=harness(),first=h.sync.refresh();await tick();let forcedDone=false;
 const forced=h.sync.refresh(true).then(()=>{forcedDone=true;});h.sync.refresh(true).catch(()=>{});await h.success(0,1);await first;
 assert.equal(forcedDone,false);assert.equal(h.calls.length,2);assert.equal(h.calls[1].force,true);await h.success(1,2);await forced;assert.equal(forcedDone,true);assert.equal(h.calls.length,2);
});

test('a refresh immediately after awaiting a completed read cannot join its already settled slot',async()=>{
 const h=harness(),first=h.sync.refresh(true);await tick();h.calls[0].resolve({revision:1});await first;
 const second=h.sync.refresh();await tick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].force,false);h.calls[1].resolve({revision:2});await second;assert.deepEqual(h.renders,[1,2]);
});

test('editing forms permit state reads and apply but preserve their DOM until a safe flush',async()=>{
 const h=harness();h.state.renderable=false;const requested=h.sync.refresh();await tick();await h.success(0,1);await requested;
 assert.equal(h.state.revision,1);assert.equal(h.renders.length,0);assert.equal(h.sync.snapshot().renderPending,true);assert.equal(h.sync.flushRender(),false);
 h.state.renderable=true;assert.equal(h.sync.flushRender(),true);assert.deepEqual(h.renders,[1]);assert.equal(h.sync.flushRender(),false);
});

test('older or unchanged results do not cause a render and cannot erase a deferred newer render',async()=>{
 const h=harness();h.state.renderable=false;const one=h.sync.refresh();await tick();await h.success(0,5);await one;
 const two=h.sync.refresh();await tick();await h.success(1,3);await two;assert.equal(h.state.revision,5);assert.equal(h.applied.length,1);assert.equal(h.sync.snapshot().renderPending,true);
 h.state.renderable=true;h.sync.flushRender();assert.deepEqual(h.renders,[5]);
});

test('actor, Space or room changes discard the old result and fulfill callers from a fresh scoped read',async()=>{
 for(const nextScope of ['account2:space1:room1','account1:space2:room1','account1:space1:room2']){
  const h=harness(),requested=h.sync.refresh(true);await tick();h.state.scope=nextScope;await h.success(0,99);
  assert.equal(h.applied.length,0);assert.equal(h.renders.length,0);assert.equal(h.calls.length,2);assert.equal(h.calls[1].scope,nextScope);assert.equal(h.calls[1].force,true);
  await h.success(1,1);await requested;assert.equal(h.applied[0].scope,nextScope);assert.equal(h.state.revision,1);
 }
});

test('busy/offline/hidden gates retain one pending read and resume after they become safe',async()=>{
 const h=harness();h.state.readable=false;const requested=h.sync.refresh();for(let i=0;i<20;i++)h.sync.invalidate('offline');await tick();
 assert.equal(h.calls.length,0);assert.equal(h.sync.snapshot().pending,true);h.sync.resume();await tick();assert.equal(h.calls.length,0);
 h.state.readable=true;h.sync.resume();await tick();assert.equal(h.calls.length,1);await h.success(0,1);await requested;assert.equal(h.sync.snapshot().pending,false);
});

test('a read begun before a write became busy cannot apply over its later state',async()=>{
 const h=harness(),requested=h.sync.refresh();await tick();h.state.readable=false;h.state.revision=8;await h.success(0,2);
 assert.equal(h.state.revision,8);assert.equal(h.applied.length,0);assert.equal(h.calls.length,1);assert.equal(h.sync.snapshot().pending,true);
 h.state.readable=true;h.sync.resume();await tick();await h.success(1,9);await requested;assert.equal(h.state.revision,9);
});

test('transient read failures use bounded backoff, never periodic polling or unbounded retries',async()=>{
 const h=harness(),requested=h.sync.refresh(),rejected=assert.rejects(requested,/offline/);await tick();
 for(let i=0;i<3;i++){await h.fail(i);assert.equal(h.timers.size,1);assert.equal(h.calls.length,i+1);assert.equal(await h.fire(),3000*2**i);}
 await h.fail(3);await rejected;assert.equal(h.calls.length,4);assert.equal(h.timers.size,0);assert.equal(h.sync.snapshot().pending,false);assert.equal(h.sync.snapshot().reading,false);assert.equal(h.errors.length,4);
 await tick();assert.equal(h.calls.length,4);
});

test('offline during retry pauses it and a later resume restarts a bounded delayed read',async()=>{
 const h=harness(),requested=h.sync.refresh();await tick();await h.fail(0);h.state.readable=false;await h.fire();
 assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);assert.equal(h.sync.snapshot().retryPaused,true);
 h.state.readable=true;h.sync.resume();assert.equal(h.timers.size,1);assert.equal(h.calls.length,1);assert.equal(await h.fire(),3000);await h.success(1,2);await requested;assert.deepEqual(h.renders,[2]);assert.equal(h.sync.snapshot().retries,0);
});

test('scope change while a deferred render waits cannot render the previous account view',async()=>{
 const h=harness();h.state.renderable=false;const requested=h.sync.refresh();await tick();await h.success(0,1);await requested;
 h.state.scope='different-account';h.state.renderable=true;assert.equal(h.sync.flushRender(),false);assert.equal(h.renders.length,0);assert.equal(h.sync.snapshot().renderPending,false);
});

test('a new account does not inherit another account retry delay or failure budget',async()=>{
 const h=harness(),old=h.sync.refresh();await tick();await h.fail(0);await h.fire();await h.fail(1);assert.equal(h.sync.snapshot().retries,2);assert.equal(h.timers.size,1);
 h.state.scope='new-account:space1:room1';const current=h.sync.refresh(true);await tick();assert.equal(h.timers.size,0);assert.equal(h.calls.length,3);assert.equal(h.calls[2].scope,h.state.scope);assert.equal(h.sync.snapshot().retries,0);
 await h.fail(2);assert.equal(h.sync.snapshot().retries,1);assert.equal(await h.fire(),3000);await h.success(3,1);await old;await current;assert.deepEqual(h.renders,[1]);
});

test('permanent/auth failures and apply errors do not trigger automatic read retries',async()=>{
 for(const error of [Object.assign(Error('expired'),{authExpired:true}),Object.assign(Error('denied'),{status:403}),Object.assign(Error('stop'),{retryable:false})]){
  const h=harness(),requested=h.sync.refresh(),rejected=assert.rejects(requested);await tick();await h.fail(0,error);await rejected;assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 }
 const h=harness({apply(){throw Error('bad payload');}}),requested=h.sync.refresh(),rejected=assert.rejects(requested,/bad payload/);await tick();await h.success(0,1);await rejected;assert.equal(h.timers.size,0);assert.equal(h.errors[0].details.phase,'apply');
});

test('an explicit later resume can recover after the retry budget was exhausted',async()=>{
 const h=harness({maxRetries:0}),requested=h.sync.refresh(),rejected=assert.rejects(requested);await tick();await h.fail(0);await rejected;
 h.sync.resume();await tick();assert.equal(h.calls.length,2);await h.success(1,1);assert.deepEqual(h.renders,[1]);assert.equal(h.sync.snapshot().error,null);
});
