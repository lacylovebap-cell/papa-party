import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';import {execFileSync} from 'node:child_process';
test('complete edge bundle compiles, preserves URL validators and isolates chat before database access',async()=>{
 execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
 const source=fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};');
 let handler;const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.supabase.co':'test'},serve:h=>handler=h},EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('unexpected fetch');}});
 vm.runInContext(stripTypeScriptTypes(source),context);assert.equal(typeof handler,'function');
 assert.equal(vm.runInContext("validateHome({...normalizeHome(),imageMode:'custom',imageUrl:'https://example.com/photo.webp'}).imageMode",context),'custom');
 assert.equal(vm.runInContext("validPushSubscription({endpoint:'https://fcm.googleapis.com/test',keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}})",context),true);
 await assert.rejects(vm.runInContext("chatOperation({op:'chatMessages',streamer:'papa',playerId:'P2'},{role:'player',playerId:'P1'},upgradePlatform(empty()))",context),/無法查看/);
 await assert.rejects(vm.runInContext("chatOperation({op:'chatInbox',streamer:'papa'},{role:'streamer_admin',streamer_id:'other'},upgradePlatform(empty()))",context),/自己的主播/);
});
