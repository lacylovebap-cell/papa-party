import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate} from '../src/core.js';
const admin={role:'admin'},t='2026-09-17T11:00:00Z';
test('an existing same-name song stays editable, but a rename into a duplicate is still refused',()=>{
 let s=empty();
 s=mutate(s,{type:'song',data:{title:'時光走散',artist:'怕怕'}},admin,t);
 s.songs.push({...s.songs[0],songId:'dup-version'});
 const edited=mutate(s,{type:'song',data:{...s.songs[1],tags:['抒情','苦情']}},admin,t);
 assert.deepEqual(edited.songs[1].tags,['抒情','苦情']);
 s=mutate(s,{type:'song',data:{title:'別首',artist:'某人'}},admin,t);
 assert.throws(()=>mutate(s,{type:'song',data:{...s.songs[2],title:'時光走散',artist:'怕怕'}},admin,t),/同名同歌手/);
 assert.throws(()=>mutate(empty(),{type:'song',data:{title:'a',artist:'b'}},admin,t)&&mutate(mutate(empty(),{type:'song',data:{title:'a',artist:'b'}},admin,t),{type:'song',data:{title:'a',artist:'b'}},admin,t),/同名同歌手/);
});
test('same title and artist with a different version can coexist',()=>{
 let s=empty();
 s=mutate(s,{type:'song',data:{title:'時光走散',artist:'怕怕'}},admin,t);
 s=mutate(s,{type:'song',data:{title:'時光走散',artist:'怕怕',version:'DJ版'}},admin,t);
 assert.equal(s.songs.length,2);
 assert.throws(()=>mutate(s,{type:'song',data:{title:'時光走散',artist:'怕怕',version:'dj版'}},admin,t),/同版本/);
});
import {previewImport,applyImport} from '../src/core.js';
test('import: a version column makes a same-title row a separate song, not a duplicate',()=>{
 let s=empty();s=mutate(s,{type:'song',data:{title:'時光走散',artist:'怕怕'}},admin,t);
 const plain=previewImport(s,'songs','時光走散｜怕怕');assert.ok(plain[0].match||plain[0].matches?.length);
 const rows=previewImport(s,'songs','時光走散｜怕怕｜華語｜女歌手｜｜｜｜DJ版');
 const m=rows[0].match??(rows[0].matches||[])[0];assert.ok(!m);
 const n=applyImport(s,'songs',rows,['add'],admin,t);assert.equal(n.songs.length,2);assert.equal(n.songs[1].version,'DJ版');
});
