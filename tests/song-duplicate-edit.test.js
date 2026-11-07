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
