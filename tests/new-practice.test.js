import test from 'node:test';
import assert from 'node:assert/strict';
import {newPracticeRank,newPracticeSongs,newPracticeRanks,newPracticeReorder} from '../src/new-practice.js';

const row=(songId,extra={})=>({songId,streamer_id:'papa',new:true,title:'歌曲 '+songId,artist:'歌手',...extra});
const ids=songs=>newPracticeSongs(songs).map(song=>song.songId);
const move=(songs,songId,targetId,position)=>newPracticeReorder(songs,{songId,targetId,position});

test('display follows safe private ranks and deterministic original-order fallbacks without reordering source rows',()=>{
 const songs=[row('c',{_order:2}),row('normal',{new:false}),row('a',{_order:0}),row('b',{_order:1}),row('first',{sort_order:-1024,_order:4})];
 const before=structuredClone(songs);
 assert.deepEqual(ids(songs),['first','a','b','c']);assert.deepEqual(songs,before);
 assert.equal(newPracticeSongs(songs)[0],songs[4]);
});

test('missing or invalid original orders use canonical IDs and safe original-order scaling',()=>{
 const songs=[row('z',{_order:'1'}),row('b',{_order:-1}),row('a'),row('q',{_order:8796093022208}),row('last',{_order:8796093022207})];
 assert.deepEqual(ids(songs),['a','b','q','z','last']);
 assert.deepEqual(ids([...songs].reverse()),ids(songs));
 assert.equal(newPracticeRank(-9007199254740991),-9007199254740991);
 for(const value of [null,undefined,'0',0.5,NaN,Infinity,9007199254740992])assert.equal(newPracticeRank(value),null);
 assert.deepEqual(ids([row('b',{sort_order:'-100'}),row('a',{sort_order:Infinity})]),['a','b']);
});

test('rank ties use original-order keys then IDs consistently across input array order',()=>{
 const songs=[row('z',{_order:1,sort_order:7}),row('b',{_order:0,sort_order:7}),row('a',{_order:0,sort_order:7})];
 assert.deepEqual(ids(songs),['a','b','z']);assert.deepEqual(ids([...songs].reverse()),['a','b','z']);
});

test('fallback positions include non-new and hidden rows before public visibility is filtered',()=>{
 const songs=[row('b',{hidden:true}),row('a',{new:false}),row('c'),row('explicit',{sort_order:1536,_order:8})];
 assert.deepEqual(ids(songs),['b','explicit','c']);
 assert.deepEqual(newPracticeSongs(songs).filter(song=>!song.hidden).map(song=>song.songId),['explicit','c']);
 assert.deepEqual(ids([...songs].reverse()),ids(songs));
});

test('virtual full-room ranks preserve public subset ordering without persisting fallback ranks',()=>{
 const songs=[row('c'),row('b',{hidden:true}),row('a',{new:false}),row('explicit',{sort_order:1536,_order:8})],before=structuredClone(songs);
 const ranks=newPracticeRanks(songs);assert.deepEqual(Object.fromEntries(ranks),{b:1024,explicit:1536,c:2048});
 const publicSongs=songs.filter(song=>song.new&&!song.hidden).map(song=>({songId:song.songId,new:true,sort_order:ranks.get(song.songId)}));
 assert.deepEqual(ids(publicSongs),['explicit','c']);assert.deepEqual(ids([...publicSongs].reverse()),['explicit','c']);
 assert.deepEqual(songs,before);assert.equal(songs[0].sort_order,undefined);assert.equal(ranks.has('a'),false);
});

test('desktop moves before or after a known anchor normally change only the moved private rank',()=>{
 const songs=[row('a',{_order:0}),row('b',{_order:1}),row('c',{_order:2}),row('d',{_order:3})];
 const before=move(songs,'d','b','before');assert.deepEqual(ids(before.songs),['a','d','b','c']);
 assert.deepEqual(before.changes,[{songId:'d',sort_order:512}]);assert.equal(before.renumbered,false);
 const after=move(before.songs,'a','c','after');assert.deepEqual(ids(after.songs),['d','b','c','a']);
 assert.deepEqual(after.changes,[{songId:'a',sort_order:3072}]);assert.equal(after.renumbered,false);
 assert.deepEqual(before.songs.map(song=>song.songId),songs.map(song=>song.songId));
});

test('mobile adjacent up/down moves and moving before first work without changing new flags',()=>{
 const songs=[row('a',{_order:0}),row('b',{_order:1}),row('c',{_order:2})];
 const up=move(songs,'b','a','before');assert.deepEqual(ids(up.songs),['b','a','c']);assert.equal(up.changes.length,1);
 const down=move(up.songs,'b','a','after');assert.deepEqual(ids(down.songs),['a','b','c']);assert.equal(down.changes.length,1);
 assert.ok(down.songs.every(song=>song.new===true));assert.equal(up.changes[0].sort_order,-1024);
});

test('same-song and already-adjacent placements are no-ops, including ranks needing normalization',()=>{
 const songs=[row('a',{sort_order:0}),row('b',{sort_order:1}),row('c',{sort_order:2})];
 for(const [songId,targetId,position] of [['a','a','before'],['a','b','before'],['b','a','after'],['c','b','after']]){
  const result=move(songs,songId,targetId,position);assert.deepEqual(result.changes,[]);assert.equal(result.renumbered,false);assert.deepEqual(result.songs,songs);
 }
});

test('no-gap compaction changes only necessary ranks and preserves private metadata, masters and source order',()=>{
 const songs=[row('a',{sort_order:0,lyrics:'private',tags:['甜歌'],master_id:'master-a'}),row('b',{sort_order:1}),row('c',{sort_order:2,hidden:true}),row('normal',{new:false,sort_order:55,note:'keep'})];
 const original=structuredClone(songs),result=move(songs,'c','b','before');
 assert.equal(result.renumbered,true);assert.deepEqual(ids(result.songs),['a','c','b']);assert.deepEqual(result.changes,[{songId:'c',sort_order:1024},{songId:'b',sort_order:2048}]);
 for(let i=0;i<songs.length;i++){
  const {sort_order:oldRank,...oldFields}=songs[i],{sort_order:newRank,...newFields}=result.songs[i];assert.deepEqual(newFields,oldFields);
 }
 assert.equal(result.songs[0],songs[0]);assert.equal(result.songs[3],songs[3]);assert.deepEqual(songs,original);
});

test('boundary ranks use an available one-unit gap before considering compaction',()=>{
 const low=[row('a',{sort_order:-9007199254740990}),row('b',{sort_order:0})];
 const first=move(low,'b','a','before');assert.equal(first.renumbered,false);assert.equal(first.changes[0].sort_order,-9007199254740991);
 const high=[row('a',{sort_order:0}),row('b',{sort_order:9007199254740990})];
 const last=move(high,'a','b','after');assert.equal(last.renumbered,false);assert.equal(last.changes[0].sort_order,9007199254740991);
 const extremes=[row('a',{sort_order:-9007199254740991}),row('b',{sort_order:9007199254740991}),row('c',{sort_order:0})];
 const middle=move(extremes,'b','c','before');assert.equal(middle.renumbered,false);assert.ok(Number.isSafeInteger(middle.changes[0].sort_order));assert.deepEqual(ids(middle.songs),['a','b','c']);
});

test('large catalogs permit one-row moves but safely deny no-gap renumbering above the cap',()=>{
 const songs=Array.from({length:2001},(_,index)=>row(String(index).padStart(4,'0'),{sort_order:index})),before=structuredClone(songs);
 assert.throws(()=>move(songs,'2000','0001','before'),/安全整理上限/);assert.deepEqual(songs,before);
 const simple=move(songs,'2000','0000','before');assert.equal(simple.renumbered,false);assert.equal(simple.changes.length,1);
});

test('untrusted payloads, non-new songs, unknown IDs, duplicate IDs and cross-room anchors are rejected atomically',()=>{
 const songs=[row('a'),row('b'),row('old',{new:false}),row('foreign',{streamer_id:'other'})],before=structuredClone(songs);
 const bad=[null,[],{}, {songId:'a',targetId:'b',position:'up'}, {songId:'a',targetId:'b',position:'before',new:false}, {songId:5,targetId:'b',position:'after'}, {songId:'',targetId:'b',position:'after'}, {songId:'unknown',targetId:'b',position:'before'}, {songId:'old',targetId:'b',position:'before'}, {songId:'a',targetId:'foreign',position:'before'}];
 for(const payload of bad)assert.throws(()=>newPracticeReorder(songs,payload));
 assert.deepEqual(songs,before);assert.throws(()=>move([row('a'),row('a'),row('b')],'a','b','after'),/重複/);
 assert.throws(()=>newPracticeSongs({}));
});
