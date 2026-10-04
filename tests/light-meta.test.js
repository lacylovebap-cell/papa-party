import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';

test('communication room lookup fetches only the service-scoped streamer directory',async()=>{
 execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
 const source=fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};');
 const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,Deno:{env:{get:()=>''},serve:()=>{}},EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('Unexpected network request');}});
 vm.runInContext(stripTypeScriptTypes(source),context);
 vm.runInContext(`
  var requests=[];
  api=async(path)=>{
   requests.push(path);
   if(path.includes('papa_streamer_directory'))return [{id:'papa',slug:'papa',display_name:'怕怕',active:true},{id:'michelle',slug:'michelle',display_name:'米雪',active:true}];
   throw Error('Unexpected path '+path);
  };
 `,context);
 const state=await vm.runInContext('loadCommunicationState()',context);
 assert.equal(state.streamers.length,2);
 assert.equal(state.players.length,0);
 assert.equal(state.songs.length,0);
 assert.equal(vm.runInContext("scopeState(state,'michelle').currentStreamer.display_name",vm.createContext({...context,state})),'米雪');
 const requests=vm.runInContext('requests',context);
 assert.equal(requests.length,1);
 assert.ok(requests[0].includes('papa_streamer_directory'));
 assert.ok(!requests[0].includes('papa_v2_snapshot'));
 assert.ok(!requests[0].includes('papa_v2_entities'));
});

test('directory RPC is granted to service role only',()=>{
 const sql=fs.readFileSync(new URL('../supabase/migrations/202610010003_light_meta.sql',import.meta.url),'utf8');
 assert.match(sql,/data->'streamers'/);
 assert.match(sql,/revoke all on function public\.papa_streamer_directory\(\) from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public\.papa_streamer_directory\(\) to service_role/);
});
