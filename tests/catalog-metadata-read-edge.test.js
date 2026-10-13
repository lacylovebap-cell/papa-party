import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import {accountingDay} from '../src/accounting.js';
import * as core from '../src/core.js';
import * as access from '../src/access-policy.js';
import * as patch from '../src/state-patch.js';
import * as rules from '../src/notification-rules.js';

const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
const catalog=fs.readFileSync(new URL('../supabase/functions/party-api/catalog.ts',import.meta.url),'utf8');
const metadataCode=stripTypeScriptTypes(catalog.slice(catalog.indexOf('const CATALOG_COMMON_FIELDS'),catalog.indexOf('// A local tag/note edit')));
function fixture(options={}){
 let handler,loads=0,accountingReads=0,metadataBytes=0;const requests=[];
 const state=core.upgradePlatform(core.empty());state.revision=7;
 state.players=[{playerId:'P1',name:'Player',ids:[],names:[],password:''}];
 state.songs=[{songId:'S1',streamer_id:'papa',title:'Original',artist:'Artist',tags:[],hidden:false}];
 let rows=[{songId:'S1',title:'Shared title',artist:'Shared artist',hasLyrics:true,catalogStatus:'pending'}];
 const fetch=async(url,request)=>{
  const path=new URL(url).pathname,body=request.body?JSON.parse(request.body):null;requests.push({path,body});
  if(path==='/rest/v1/papa_v2_revision')return Response.json([{revision:state.revision}]);
  if(path.endsWith('/papa_catalog_song_metadata_conditional')){
   if(options.missing)return Response.json({code:'PGRST202',message:'Could not find the function public.papa_catalog_song_metadata_conditional(room_id, known_signature) in the schema cache'},{status:404});
   const signature=createHash('sha256').update(JSON.stringify(rows)).digest('hex'),unchanged=body.known_signature===signature;
   const result={roomId:'papa',spaceId:'space-001',signature,unchanged,...(!unchanged?{rows}: {})};
   metadataBytes+=JSON.stringify(result).length;return Response.json(result);
  }
  if(path.endsWith('/papa_catalog_song_metadata_in_space'))return Response.json(rows);
  if(path.endsWith('/papa_accounting_summary')){
   accountingReads++;
   return Response.json({...core.stats(core.scopeState(state),new Date().toISOString()),
    day:accountingDay(new Date().toISOString(),19),rolloverHour:19,scope:{spaceId:body.requested_space,roomId:body.requested_room},timezone:'Asia/Taipei',revision:state.revision});
  }
  throw Error('Unexpected endpoint '+path);
 };
 const context=vm.createContext({accountingDay,...core,...access,...patch,...rules,Error,URL,Response,TextEncoder,crypto,structuredClone,fetch,
  Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://db.example':'fixture-key'},serve:fn=>handler=fn},
  EdgeRuntime:{waitUntil(){}},CATALOG_OPS:new Set(),fixtureState:state,
  fixtureWho:{role:'super_admin',accountId:'fixture-account',token:'fixture-token'}});
 vm.runInContext(metadataCode+'\n'+code,context);
 context.loadFixture=()=>{loads++;return structuredClone(state);};
 vm.runInContext('actor=async()=>fixtureWho;load=async()=>loadFixture();',context);
 const read=async(revision=state.revision-1)=>{
  const response=await handler({method:'POST',json:async()=>({op:'read',streamer:'papa',token:'fixture-token',revision,signatures:{}})});
  return {status:response.status,body:await response.json()};
 };
 return {state,requests,read,rows:value=>rows=value,switchToPlayer:()=>{context.fixtureWho={role:'player',playerId:'P1',spaceId:'space-001'};},loads:()=>loads,accountingReads:()=>accountingReads,metadataBytes:()=>metadataBytes};
}

test('shipping read always reloads/authorizes state and accounting while confirming catalog reuse; changed metadata and force refresh stay fresh',async()=>{
 const f=fixture(),first=await f.read();assert.equal(first.status,200,JSON.stringify(first.body));
 assert.equal(first.body.state.songs[0].title,'Shared title');assert.equal(first.body.state.songs[0].catalogStatus,'pending');
 const before=f.metadataBytes();f.state.revision++;
 const next=await f.read();assert.equal(next.status,200);assert.deepEqual(next.body.state.songs,first.body.state.songs);
 assert.equal(f.loads(),2);assert.equal(f.accountingReads(),2);
 assert.ok(f.metadataBytes()-before<before,'the second RPC transfers a signature rather than all metadata rows');
 f.rows([{songId:'S1',title:'Changed',hasLyrics:false,catalogStatus:'linked'}]);f.state.revision++;
 const changed=await f.read();assert.equal(changed.body.state.songs[0].title,'Changed');assert.equal(changed.body.state.songs[0].hasLyrics,false);
 await f.read(-1);assert.equal(f.requests.filter(r=>r.path.endsWith('/papa_catalog_song_metadata_conditional')).at(-1).body.known_signature,null);
 assert.equal(f.accountingReads(),4);
 assert.ok(f.requests.every(r=>!r.path.includes('commit')&&!r.path.includes('room_sync_head')));
});

test('undeployed optional metadata RPC safely retains the original read behavior and skips repeated missing-function requests',async()=>{
 const f=fixture({missing:true});
 for(let n=0;n<2;n++){const result=await f.read();assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.state.songs[0].title,'Shared title');f.state.revision++;}
 assert.equal(f.requests.filter(r=>r.path.endsWith('/papa_catalog_song_metadata_conditional')).length,1);
 assert.equal(f.requests.filter(r=>r.path.endsWith('/papa_catalog_song_metadata_in_space')).length,2);
 assert.equal(f.loads(),2);assert.equal(f.accountingReads(),2);
});

test('manager to player transition reauthorizes and reprojects cached metadata without manager-only fields or lyrics',async()=>{
 const f=fixture();f.rows([{songId:'S1',title:'Shared',hasLyrics:true,catalogStatus:'pending',catalogFamilyId:'family',otherStreamerCount:4,lyrics:'must not leave server'}]);
 const manager=await f.read();assert.equal(manager.status,200);assert.equal(manager.body.state.songs[0].catalogStatus,'pending');
 f.switchToPlayer();f.state.revision++;
 const player=await f.read();assert.equal(player.status,200,JSON.stringify(player.body));
 assert.equal(player.body.state.songs[0].title,'Shared');
 for(const field of ['catalogStatus','catalogFamilyId','otherStreamerCount','lyrics'])assert.equal(field in player.body.state.songs[0],false);
 assert.equal(f.loads(),2);assert.equal(f.accountingReads(),2);
 assert.match(f.requests.filter(r=>r.path.endsWith('/papa_catalog_song_metadata_conditional')).at(-1).body.known_signature,/^[a-f0-9]{64}$/);
});
