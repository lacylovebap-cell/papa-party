import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {empty,mutate,publicView,searchAcrossStreamers} from '../src/core.js';
const now='2026-10-01T00:00:00Z', secret='只有後端可以比對的歌詞';
function fixture(){
 let s=mutate(empty(),{type:'song',data:{title:'普通歌曲',artist:'歌手',lyrics:secret,tags:['標籤'],creditCost:0.5}}, {role:'admin'},now);
 s.songs[0].lyricNotes='私人換氣提示';s.songs[0].futureSecret={body:'未來私有內容'};
 return s;
}
test('anonymous/player song projection omits lyrics and unknown private fields while preserving ordering data',()=>{
 const source=fixture(), before=structuredClone(source);
 for(const actor of [null,{role:'player',playerId:'P1'}]){
   const view=publicView(source,actor,now);
   for(const key of ['lyrics','lyricNotes','futureSecret'])assert.equal(Object.hasOwn(view.songs[0],key),false);
   assert.equal(JSON.stringify(view).includes(secret),false);
   assert.equal(view.songs[0].songId,source.songs[0].songId);
   assert.equal(view.songs[0].creditCost,0.5);assert.deepEqual(view.songs[0].tags,['標籤']);
 }
 assert.deepEqual(source,before);
 assert.equal(publicView(source,{role:'admin'},now).songs[0].lyrics,secret);
});
test('server search can match lyrics and emits only ordinary song results',()=>{
 const source=fixture(), rows=searchAcrossStreamers(source,secret);
 assert.equal(rows.length,1);assert.equal(rows[0].title,'普通歌曲');
 assert.deepEqual(Object.keys(rows[0]).sort(),['artist','slug','songId','streamer','title']);
 assert.equal(JSON.stringify(rows).includes(secret),false);
 source.streamers[0].active=false;assert.deepEqual(searchAcrossStreamers(source,secret),[]);
});
test('bundled read and songSearch APIs never return lyric text to anonymous/player callers; managers retain room access',async()=>{
 execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
 const code=fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};');
 let handler;const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.supabase.co':'test'},serve:h=>handler=h},EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('unexpected network');}});
 vm.runInContext(stripTypeScriptTypes(code),context);
 context.snapshot=fixture();context.testActor=null;
 vm.runInContext('actor=async()=>testActor;load=async()=>structuredClone(snapshot);api=async()=>[];',context);
 for(const actor of [null,{role:'player',playerId:'P1'}]){
   context.testActor=actor;
   for(const op of ['read','songSearch']){
     const response=await handler({method:'POST',json:async()=>({op,streamer:'papa',query:secret})});
     assert.equal(response.status,200);const body=await response.text();
     assert.equal(body.includes(secret),false);assert.equal(body.includes('私人換氣提示'),false);assert.equal(body.includes('未來私有內容'),false);
   }
 }
 for(const actor of [{role:'super_admin'},{role:'streamer_admin',streamer_id:'papa'}]){
   context.testActor=actor;const response=await handler({method:'POST',json:async()=>({op:'read',streamer:'papa'})});
   assert.equal(response.status,200);assert.equal((await response.text()).includes(secret),false,'ordinary manager lists also load lyrics on demand');
 }
 context.testActor={role:'streamer_admin',streamer_id:'other'};
 assert.equal((await handler({method:'POST',json:async()=>({op:'read',streamer:'papa'})})).status,400);
});
