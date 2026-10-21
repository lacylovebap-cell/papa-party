import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {empty,mutate} from '../src/core.js';
import {validateRequestBatch,applyPlayerRequestBatch} from '../src/player-bulk-tools.js';
const edge=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const block=edge.slice(edge.indexOf(" if(b.op==='requestsBatch'||b.op==='requestBatchQuote'){"),edge.indexOf(" if(b.op==='listeningHistoryPage')"));
// Transpile the exact production handler; its database/auth boundaries are supplied below.
import {stripTypeScriptTypes} from 'node:module';
const code=stripTypeScriptTypes('async function handler(){'+block+'}');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const at='2026-10-21T04:00:00Z';
function setup(){let s=empty();const run=(type,data)=>s=mutate(s,{type,data},{role:'admin'},at);run('player',{name:'Fixture',balance:20});run('settings',{livePrice:1200,liveDouble:300,hourlyLimit:20});for(const cost of [.5,2])run('song',{title:'Song '+cost,artist:'Singer',creditCost:cost});return s;}
async function execute(source,b){const reads=[],writes=[];const who={role:'player',accountId:'fixture',playerId:source.players[0].playerId,spaceId:'space-001'};
 const values={b,who,t:at,validateRequestBatch,applyPlayerRequestBatch,respond:x=>x,catalogRoom:async()=>({id:'papa',spaceId:'space-001'}),load:async(...args)=>{reads.push(args);return structuredClone(source);},coreActor:x=>x,catalogSelectionContext:async state=>({state,finish:x=>x}),revisionConflictError:()=>Error('revision mismatch'),commit:async(...args)=>{writes.push(args);return {revision:source.revision+1};},operationProof:()=>{throw Error('Quote must not touch receipts');}};
 const result=await new AsyncFunction(...Object.keys(values),code+';return handler();')(...Object.values(values));return {result,reads,writes};
}
test('batch quote uses lean scoped snapshot, preserves source and never writes receipts or ledger',async()=>{
 const source=setup(),before=structuredClone(source),rows=source.songs.map(s=>({songId:s.songId,kind:'live',giftConfirmed:true}));
 const response=await execute(source,{op:'requestBatchQuote',revision:source.revision,jobs:[{streamer:'papa',rows}],operationId:'malicious-receipt'});
 assert.deepEqual(source,before);assert.deepEqual(response.writes,[]);assert.equal(response.reads.length,1);assert.deepEqual(response.reads[0],[true,'papa','space-001',null,source.players[0].playerId]);
 const item=response.result.results[0];assert.equal(item.ok,true,item.error);assert.deepEqual(item.quotes.map(q=>[q.creditCost,q.price,q.double]),[[.5,600,300],[2,2400,300]]);
 const committed=await execute(source,{op:'requestsBatch',revision:source.revision,jobs:[{streamer:'papa',rows}]});assert.equal(committed.writes.length,1);assert.deepEqual(committed.writes[0][1].queue.map(q=>q.price),item.quotes.map(q=>q.price));
});
test('quote rejects stale revisions and hidden songs without writes',async()=>{
 const source=setup(),rows=[{songId:source.songs[0].songId,kind:'live',giftConfirmed:true}];
 for(const hidden of [false,true]){source.songs[0].hidden=hidden;const r=await execute(source,{op:'requestBatchQuote',revision:source.revision+(hidden?0:1),jobs:[{streamer:'papa',rows}]});assert.equal(r.result.results[0].ok,false);assert.equal(r.writes.length,0);}
});

test('changed confirmed prices reject the batch before commit',async()=>{
 const source=setup(),rows=[{songId:source.songs[0].songId,kind:'live',giftConfirmed:true}],job={streamer:'papa',rows};
 const preview=await execute(source,{op:'requestBatchQuote',revision:source.revision,jobs:[job]});
 job.expectedQuotes=preview.result.results[0].quotes;
 // Simulate a later room snapshot changing after another room has already committed.
 source.streamerSettings.papa.livePrice=1500;
 const changed=await execute(source,{op:'requestsBatch',revision:source.revision,jobs:[job]});
 assert.equal(changed.result.results[0].ok,false);assert.match(changed.result.results[0].error,/價格已變更/);assert.equal(changed.writes.length,0);
});


test('fifty paired requests quote all one hundred distinct song IDs without full private song reads',async()=>{
 const source=setup(),rows=[];source.songs=[];
 for(let i=0;i<50;i++){const songId='half-'+i,pairSongId='pair-'+i;source.songs.push(
  {songId,title:'Half '+i,artist:'Singer',creditCost:.5,shortMode:'pair',pairSongIds:[pairSongId],streamer_id:'papa'},
  {songId:pairSongId,title:'Pair '+i,artist:'Singer',creditCost:.5,streamer_id:'papa'});
  rows.push({songId,pairSongId,kind:'live',giftConfirmed:true});
 }
 assert.equal(new Set(rows.flatMap(row=>[row.songId,row.pairSongId])).size,100);
 const result=await execute(source,{op:'requestBatchQuote',revision:source.revision,jobs:[{streamer:'papa',rows}]});
 assert.equal(result.result.results[0].ok,true,result.result.results[0].error);
 assert.equal(result.result.results[0].quotes.length,50);assert.ok(result.result.results[0].quotes.every(q=>q.creditCost===1&&q.price===1200));
 assert.equal(result.reads.length,1);assert.equal(result.reads[0][3],null);assert.deepEqual(result.writes,[]);
});
