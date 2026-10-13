import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';

test('delivered Edge bundle includes card validation and preserves genre facts across replacement and archive',()=>{
 execFileSync(process.execPath,['build-edge.mjs']);
 const code=stripTypeScriptTypes(fs.readFileSync('deploy-function.txt','utf8').replace(/^import .*;\r?\n/gm,''));
 const ctx=vm.createContext({URL,Date,Uint8Array,crypto,structuredClone,TextEncoder,console,webpush:{},Deno:{env:{get:()=>''},serve(){}}});
 vm.runInContext(code,ctx);
 vm.runInContext(`
 const admin={role:'admin'},t='2026-10-14T12:00:00Z';
 let s=mutate(empty(),{type:'player',data:{name:'isolated',balance:3}},admin,t);
 for(const tag of ['傷感','甜歌'])s=mutate(s,{type:'song',data:{title:tag,artist:'fixture',tags:[tag],creditCost:1}},admin,t);
 const player={role:'player',playerId:s.players[0].playerId};
 s=mutate(s,{type:'request',data:{songId:s.songs[0].songId,kind:'live',giftConfirmed:true}},player,t);
 globalThis.before=s.queue[0].achievement_tags;
 s=mutate(s,{type:'replaceOwn',data:{id:s.queue[0].id,songId:s.songs[1].songId,giftConfirmed:true}},player,t);
 globalThis.replaced=s.queue[0].achievement_tags;
 s=mutate(s,{type:'queue',data:{id:s.queue[0].id,operation:'acknowledge',preparationMinutes:0}},admin,t);
 s=mutate(s,{type:'queue',data:{id:s.queue[0].id,operation:'complete'}},admin,t);
 s=mutate(s,{type:'song',data:{...s.songs[1],tags:['古風']}},admin,t);
 s=mutate(s,{type:'queue',data:{id:s.queue[0].id,operation:'delete'}},admin,t);
 globalThis.archived=s.queue[0].achievement_tags;
 s=mutate(s,{type:'card',data:{url:'https://example.com/fixture.mp4',mediaType:'video',startsAt:t}},admin,t);
 globalThis.cardType=s.cards[0].mediaType;
 globalThis.validVideo=validCardUpload(new Uint8Array([0,0,0,20,102,116,121,112,105,115,111,109]),'video/mp4');
 `,ctx);
 assert.deepEqual(Array.from(ctx.before),['傷感']);
 assert.deepEqual(Array.from(ctx.replaced),['甜歌']);
 assert.deepEqual(Array.from(ctx.archived),['甜歌']);
 assert.equal(ctx.cardType,'video');assert.equal(ctx.validVideo,true);
});
