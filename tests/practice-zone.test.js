import test from 'node:test';
import assert from 'node:assert/strict';
import {mutate,upgradePlatform,empty,scopeState,publicView} from '../src/core.js';
const admin={role:'admin'},T='2026-11-03T01:00:00.000Z';
const run=(s,type,data)=>mutate(s,{type,streamer:'papa',data},admin,T);
test('practiceZone is saved for the streamer, sanitised, and hidden from players',()=>{
 let s=run(upgradePlatform(empty()),'settings',{...scopeState(upgradePlatform(empty()),'papa').settings,practiceZone:[{id:'a',title:' 歌 ',artist:'手',stage:'bad',tags:['抒情'],lyrics:'x'.repeat(9000),due:'nope'}]});
 const z=scopeState(s,'papa').settings.practiceZone;
 assert.equal(z.length,1);assert.equal(z[0].title,'歌');assert.equal(z[0].stage,'want');assert.equal(z[0].lyrics.length,8000);assert.equal(z[0].due,'');
 const room=scopeState(s,'papa');assert.throws(()=>run(s,'settings',{...room.settings,practiceZone:[{id:'a',title:'',artist:''}]}),/歌名與歌手/);
 assert.throws(()=>run(s,'settings',{...room.settings,practiceZone:[{id:'a',title:'t',artist:'a'},{id:'a',title:'t2',artist:'a'}]}),/重複/);
});

test('player view never carries the practice zone',async()=>{
 const core=await import('../src/core.js');
 let s=upgradePlatform(empty());const room=scopeState(s,'papa');
 s=run(s,'settings',{...room.settings,practiceZone:[{id:'a',title:'祕密歌',artist:'手',lyrics:'私密歌詞'}]});
 const v=core.publicView(s,{role:'player',playerId:'x'},T,'papa');
 assert.ok(v.settings);
 assert.doesNotMatch(JSON.stringify(v),/私密歌詞|祕密歌/);
});
