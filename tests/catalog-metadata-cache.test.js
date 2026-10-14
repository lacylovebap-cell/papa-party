import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';

const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const factorySource=source.slice(source.indexOf('function createCatalogMetadataCache('),source.indexOf('let catalogMetadataReadCache:'));
const factory=vm.runInNewContext(stripTypeScriptTypes(factorySource)+'\ncreateCatalogMetadataCache');
const plain=value=>JSON.parse(JSON.stringify(value));
const room={id:'room-a',spaceId:'space-001'};
function fixture(options={}){
 let time=1000;const calls=[],projections=new Map();
 const rows=id=>projections.get(id)||[{songId:'s1',title:'歌曲',artist:'歌手',hasLyrics:true,catalogStatus:'pending'}];
 const transport=async(path,body)=>{
  calls.push({path,body});
  if(path.endsWith('/papa_catalog_song_metadata_in_space'))return structuredClone(rows(body.room_id));
  if(options.reject)throw options.reject;
  const resultRows=rows(body.room_id),spaceId=body.room_id==='foreign'?'space-002':'space-001';
  const signature=createHash('sha256').update(JSON.stringify([spaceId,body.room_id,resultRows])).digest('hex');
  const unchanged=body.known_signature===signature;
  const result={spaceId,roomId:body.room_id,signature,unchanged,...(!unchanged?{rows:structuredClone(resultRows)}:{})};
  return options.result?options.result(result):result;
 };
 const cache=factory(transport,{now:()=>time,...options.cache});
 return {cache,calls,projections,advance:n=>time+=n};
}

test('unchanged catalog reuses rows only after database confirmation; returned rows cannot mutate the cache',async()=>{
 const f=fixture(),first=await f.cache.read(room);
 first[0].title='local mutation';
 const second=await f.cache.read(room);
 assert.equal(second[0].title,'歌曲');assert.equal(f.calls.length,2);
 assert.equal(f.calls[0].body.known_signature,null);
 assert.match(f.calls[1].body.known_signature,/^[a-f0-9]{64}$/);
 assert.ok(f.calls.every(c=>c.path.endsWith('/papa_catalog_song_metadata_conditional')));
});

test('simultaneous metadata reads share one scoped request and independent row objects',async()=>{
 const f=fixture();const results=await Promise.all(Array.from({length:20},()=>f.cache.read(room)));
 assert.equal(f.calls.length,1);results[0][0].title='changed';assert.equal(results[1][0].title,'歌曲');
 await Promise.all([f.cache.read(room),f.cache.read({...room,id:'room-b'}),f.cache.read(room,true)]);
 assert.equal(f.calls.length,4,'other rooms and forced reads are independent');
 await f.cache.read(room);assert.equal(f.calls.length,5,'later reads still verify with database');
});

test('failed coalesced reads release pending request and may be retried',async()=>{
 let calls=0;const cache=factory(async()=>{calls++;throw Error('unavailable');});
 const outcomes=await Promise.allSettled([cache.read(room),cache.read(room)]);
 assert.equal(calls,1);assert.ok(outcomes.every(r=>r.status==='rejected'));
 await assert.rejects(cache.read(room));assert.equal(calls,2);
});

test('song, shared metadata, lyric availability and candidate changes replace cached rows without trusting diagnostic heads',async()=>{
 const f=fixture();await f.cache.read(room);
 for(const changed of [{title:'new title'},{artist:'new artist'},{hasLyrics:false},{lyricsMode:'copy'},{catalogStatus:'linked'}]){
  const rows=[{songId:'s1',...changed}];f.projections.set(room.id,rows);
  assert.deepEqual(plain(await f.cache.read(room)),rows);
 }
 assert.equal(f.calls.length,6);
 assert.doesNotMatch(JSON.stringify(f.calls),/papa_room_sync_head|ledger|queue|player/);
});

test('Room/Space separation, forced reads and expired entries never send another scope or stale signature',async()=>{
 const f=fixture();await f.cache.read(room);
 await f.cache.read({id:'foreign',spaceId:'space-002'});
 assert.equal(f.calls[1].body.known_signature,null);
 await f.cache.read(room,true);assert.equal(f.calls[2].body.known_signature,null);
 f.advance(300000);await f.cache.read(room);assert.equal(f.calls[3].body.known_signature,null);
});

test('bounded cache evicts old rooms and never retains oversized projections',async()=>{
 const f=fixture({cache:{maxEntries:1,maxBytes:1000}});
 await f.cache.read(room);await f.cache.read({...room,id:'room-b'});
 assert.equal(f.cache.snapshot().entries,1);
 await f.cache.read(room);assert.equal(f.calls.at(-1).body.known_signature,null);
 f.projections.set(room.id,[{songId:'s1',title:'x'.repeat(1000)}]);await f.cache.read(room);
 assert.equal(f.cache.snapshot().entries,0);assert.equal(f.cache.snapshot().bytes,0);
});

test('only exact unavailable migration proof enables compatibility fallback, with a bounded cooldown',async()=>{
 const error=Object.assign(Error('missing'),{catalogMetadataConditionalUnavailable:true});
 const f=fixture({reject:error});
 assert.equal((await f.cache.read(room))[0].title,'歌曲');
 await f.cache.read(room);assert.equal(f.calls.length,3);
 f.advance(300000);await f.cache.read(room);assert.equal(f.calls.length,5);
 for(const error of [Error('network'),Object.assign(Error('denied'),{rpcRejected:true})]){
  const denied=fixture({reject:error});await assert.rejects(denied.cache.read(room));
  assert.equal(denied.calls.length,1);assert.equal(denied.cache.snapshot().entries,0);
 }
});

test('scope mismatch, malformed signature and unbacked unchanged replies cannot supply cached data',async()=>{
 for(const result of [
  r=>({...r,spaceId:'space-other'}),r=>({...r,roomId:'other'}),r=>({...r,signature:'invalid'}),
  r=>({...r,unchanged:1}),r=>({...r,rows:null}),r=>({...r,unchanged:true}),
 ]){
  const f=fixture({result});await assert.rejects(f.cache.read(room));assert.equal(f.cache.snapshot().entries,0);
 }
 const f=fixture();await f.cache.read(room);
 // An actor/Space transition must not reuse a room's previous Space projection.
 await assert.rejects(f.cache.read({...room,spaceId:'space-002'}));
});

test('shipping integration limits cache to reads and retains independent accounting plus write projections',()=>{
 assert.match(source,/rows=b\.op==='read'\?await readCatalogMetadata\(base\.currentStreamer,/);
 assert.match(source,/:await api\('\/rest\/v1\/rpc\/papa_catalog_song_metadata_in_space',\{room_id:base\.currentStreamer\.id\}\),view=/);
 assert.match(source,/summary:await accountingSummary\(base\.currentStreamer,null\)/);
 assert.match(source,/scopedRealtimeV2:false,nativeApps:false/);
});

test('compatibility detection accepts only the exact absent conditional RPC, never permission or transport errors',()=>{
 const detectorSource=source.slice(source.indexOf('function missingConditionalCatalogMetadata('),source.indexOf('async function api('));
 const detect=vm.runInNewContext(stripTypeScriptTypes(detectorSource)+'\nmissingConditionalCatalogMetadata');
 const path='/rest/v1/rpc/papa_catalog_song_metadata_conditional';
 const absent={code:'PGRST202',message:'Could not find the function public.papa_catalog_song_metadata_conditional(room_id, known_signature) in the schema cache'};
 assert.equal(detect(path,404,absent),true);
 for(const [p,status,detail] of [
  [path,403,absent],[path,500,absent],[path,404,{...absent,code:'42501'}],
  [path,404,{...absent,message:'permission denied for public.papa_catalog_song_metadata_conditional'}],
  [path,404,{...absent,message:absent.message.replace('conditional(','conditional_other(')}],
  ['/rest/v1/rpc/other',404,absent],
 ])assert.equal(detect(p,status,detail),false);
});
