import test from 'node:test';
import assert from 'node:assert/strict';
import {sendReceiptedOperation,supportsOperationReceipt} from '../src/operation-recovery.js';
const id='11111111-1111-4111-8111-111111111111';
const payload={op:'mutate',streamer:'papa',token:'private-token',action:{type:'queue',data:{id:'q1',operation:'complete'}}};
const success=data=>({response:{ok:true,status:200},data});
const rejected=data=>({response:{ok:false,status:400},data});
function fixture(steps){const calls=[];let current=true;return {calls,change:()=>current=false,run:body=>sendReceiptedOperation(body||payload,{uuid:()=>id,isCurrent:()=>current,send:async b=>{calls.push(structuredClone(b));const next=steps.shift();if(next instanceof Error)throw next;if(typeof next==='function')return next(b);return next;}})};}

test('receipt recovery sends the business operation exactly once, then reads confirmed current state',async()=>{
 const f=fixture([Error('lost acknowledgment'),success({committed:true,revision:8}),success({state:{revision:9,queue:[{id:'q1',status:'completed'}]}})]);
 const result=await f.run();assert.equal(result.data.operationRecovered,true);assert.equal(result.data.state.revision,9);
 assert.deepEqual(f.calls.map(c=>c.op),['mutate','operationReceipt','read']);
 assert.equal(f.calls[0].operationId,id);assert.equal(f.calls[1].operationId,id);
 assert.deepEqual(f.calls[1].intent,{op:'mutate',action:payload.action});assert.equal(f.calls[2].revision,-1);assert.deepEqual(f.calls[2].signatures,{});
});
test('missing receipts, lookup failures, stale state or failed current reads never permit a write replay',async()=>{
 for(const steps of [
  [Error('lost'),success({committed:false})],
  [rejected({outcome:'unknown'}),Error('lookup timeout')],
  [Error('lost'),success({committed:true,revision:8}),success({state:{revision:7}})],
  [Error('lost'),success({committed:true,revision:8}),Error('read timeout')],
 ]){
  const f=fixture(steps);await assert.rejects(f.run(),error=>error.outcomeUnknown===true);
  assert.equal(f.calls.filter(c=>c.op==='mutate').length,1);
 }
});
test('known validation/CAS rejection and authentication expiry never trigger receipt recovery',async()=>{
 for(const result of [rejected({notCommitted:true,error:'invalid'}),{response:{ok:false,status:401},data:{error:'expired'}}]){
  const f=fixture([result]);assert.equal(await f.run(),result);assert.equal(f.calls.length,1);
 }
});
test('a login/Space change during send or lookup discards all old-scope data before another request',async()=>{
 for(const stage of [0,1]){
  let f;const steps=stage===0?[()=>{f.change();throw Error('lost');}]:[Error('lost'),()=>{f.change();return success({committed:true,revision:8});}];
  f=fixture(steps);await assert.rejects(f.run(),error=>error.staleResponse===true);assert.equal(f.calls.length,stage+1);
 }
});
test('batch acknowledgments recover per-room receipts without resending successful or uncertain rooms',async()=>{
 const body={op:'requestsBatch',streamer:'papa',token:'token',jobs:[{streamer:'a',rows:[{songId:'s1'}]},{streamer:'b',rows:[{songId:'s2'}]}]};
 const f=fixture([Error('lost'),success({committed:true,revision:8}),success({committed:false})]);
 const result=await f.run(body);assert.equal(result.data.results[0].ok,true);assert.equal(result.data.results[0].count,1);assert.equal(result.data.results[1].unknown,true);
 assert.deepEqual(f.calls.map(c=>c.op),['requestsBatch','operationReceipt','operationReceipt']);assert.deepEqual(f.calls.slice(1).map(c=>c.streamer),['a','b']);
 const known={streamer:'a',ok:true,count:1,revision:8};
 const partial=fixture([success({results:[known,{streamer:'b',ok:false,unknown:true}]}),success({committed:true,revision:9})]);
 const done=await partial.run(body);assert.equal(partial.calls.length,2);assert.equal(partial.calls[1].streamer,'b');assert.equal(done.data.results[1].ok,true);
});
test('operation recovery excludes unrelated writes and metadata/admin imports',()=>{
 assert.equal(supportsOperationReceipt(payload),true);
 assert.equal(supportsOperationReceipt({op:'ownQueueBatch'}),true);
 for(const body of [{op:'read'},{op:'noticeTest'},{op:'import'},{op:'mutate',action:{type:'song'}},{op:'mutate',action:{type:'extraQuota'}},{op:'mutate',action:{type:'wishAdmin',data:{addSong:true}}}])assert.equal(supportsOperationReceipt(body),false);
});
