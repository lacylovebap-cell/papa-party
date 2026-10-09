import test from 'node:test';
import assert from 'node:assert/strict';
import {listenedSongs} from '../src/listening-history.js';
import {empty,scopeState,songPlays} from '../src/core.js';

const song=(songId,extra={})=>({songId,title:'歌曲 '+songId,artist:'歌手 '+songId,streamer_id:'papa',...extra});
const completed=(songId,extra={})=>({id:'q-'+songId,playerId:'P1',songId,title:'舊歌曲 '+songId,artist:'舊歌手 '+songId,kind:'saved',status:'completed',streamer_id:'papa',...extra});
const room=(songs,queue)=>({schemaVersion:3,currentStreamer:{id:'papa'},songs,queue});

test('paired half songs, twice-performed half songs and repeated items count actual performances',()=>{
 const songs=[song('a'),song('b'),song('long')],queue=[
  completed('a',{creditCost:1,items:[{songId:'a',performances:2}]}),
  completed('a',{creditCost:1,items:[{songId:'a',performances:1},{songId:'b',performances:1}]}),
  completed('b',{creditCost:2,items:[{songId:'b',performances:1},{songId:'b',performances:2}]}),
  completed('long',{creditCost:3,items:[{songId:'long',performances:1}]})
 ];
 const s=room(songs,queue),history=listenedSongs(s,'P1');
 assert.deepEqual(history.map(row=>[row.songId,row.listenedCount]),[['b',4],['a',3],['long',1]]);
 for(const row of history)assert.equal(row.listenedCount,songPlays(s,row.songId));
});

test('radio and shengma completions merge into one listening count independent of storage pool',()=>{
 const s=room([song('a')],[completed('a',{venue:'radio',consumed_storage_pool:'radio'}),completed('a',{venue:'radio',consumed_storage_pool:'shengma',kind:'live'}),completed('a',{venue:'shengma'}),completed('a')]);
 assert.equal(listenedSongs(s,'P1')[0].listenedCount,4);
});

test('waiting, pending, canceled, stored, test, self-provided, self and another player rows are excluded',()=>{
 const queue=[completed('a'),...['waiting','pending','cancelled','stored'].map(status=>completed('a',{status})),completed('a',{test:true}),completed('a',{selfProvided:true}),completed('a',{kind:'self',selfProvided:false}),completed('a',{playerId:'P2'})];
 assert.equal(listenedSongs(room([song('a')],queue),'P1')[0].listenedCount,1);
 assert.equal(listenedSongs(room([song('a')],queue),'P2')[0].listenedCount,1);
 assert.deepEqual(listenedSongs(room([song('a')],queue),'unknown'),[]);
});

test('legacy non-array items rows count once while empty arrays or malformed performances count zero',()=>{
 const s=room([song('a')],[completed('a',{creditCost:3}),completed('a',{items:null}),completed('a',{items:[]}),completed('a',{items:'bad'}),completed('a',{items:[{songId:'a',performances:0},{songId:'a',performances:'2'},{songId:'a'},{songId:'a',performances:Infinity}]})]);
 assert.equal(listenedSongs(s,'P1')[0].listenedCount,3);
 assert.deepEqual(listenedSongs(s,null),[]);
});

test('removed snapshot metadata comes from the latest completion and queue/item ties are deterministic',()=>{
 const queue=[
  completed('removed',{id:'old',completedAt:'2026-10-01T12:00:00Z',title:'舊快照',artist:'舊歌手'}),
  completed('removed',{id:'a',completedAt:'2026-10-02T12:00:00Z',title:'同時間較早編號',artist:'歌手甲'}),
  completed('removed',{id:'b',completedAt:'2026-10-02T12:00:00Z',items:[{songId:'removed',performances:1,title:'同一筆第一項',artist:'歌手乙'},{songId:'removed',performances:1,title:'同一筆後項',artist:'歌手丙'}]}),
  completed(5,{items:[{songId:7,performances:2}]})
 ];
 const expected=[{songId:'removed',title:'同一筆後項',artist:'歌手丙',listenedCount:4,requestable:false}];
 assert.deepEqual(listenedSongs(room([],queue),'P1'),expected);assert.deepEqual(listenedSongs(room([],[...queue].reverse()),'P1'),expected);
 queue[0].history_effective_at='2026-10-03T12:00:00Z';
 assert.equal(listenedSongs(room([],queue),'P1')[0].title,'舊快照');
});

test('current catalog metadata wins; hidden and unavailable songs remain history without request buttons',()=>{
 const songs=[song('renamed',{title:'現在歌名',artist:'現在歌手',playAdjustment:100}),song('hidden',{hidden:true}),song('deleted',{deleted:true}),song('disabled',{disabled:true}),song('inactive',{active:false}),song('unavailable',{available:false})];
 const history=listenedSongs(room(songs,songs.map(s=>completed(s.songId))),'P1');
 const renamed=history.find(row=>row.songId==='renamed');assert.deepEqual(renamed,{songId:'renamed',title:'現在歌名',artist:'現在歌手',listenedCount:1,requestable:true});
 assert.ok(history.filter(row=>row.songId!=='renamed').every(row=>row.requestable===false));
});

test('deleted main and paired songs retain their own queue/item snapshots without private fields',()=>{
 const s=room([], [completed('removed',{title:'刪除前歌名',artist:'刪除前歌手',note:'private queue note',venue:'radio',items:[{songId:'removed',title:'主要快照歌名',artist:'主要快照歌手',performances:2,lyrics:'private lyrics'},{songId:'pair',title:'搭配快照歌名',artist:'搭配快照歌手',performances:1,creditCost:0.5}]}),completed('legacy-removed',{note:'private'})]);
 const history=listenedSongs(s,'P1');
 assert.deepEqual(history,[{songId:'removed',title:'主要快照歌名',artist:'主要快照歌手',listenedCount:2,requestable:false},{songId:'legacy-removed',title:'舊歌曲 legacy-removed',artist:'舊歌手 legacy-removed',listenedCount:1,requestable:false},{songId:'pair',title:'搭配快照歌名',artist:'搭配快照歌手',listenedCount:1,requestable:false}]);
 assert.equal(JSON.stringify(history).includes('private'),false);assert.ok(history.every(row=>Object.keys(row).length===5));
});

test('ties are deterministic by song ID and favorites, global play adjustments and source order have no effect',()=>{
 const s=room([song('z',{playAdjustment:99}),song('a')],[completed('z'),completed('a')]);s.favorites=['z'];
 assert.deepEqual(listenedSongs(s,'P1').map(row=>row.songId),['a','z']);
 assert.deepEqual(listenedSongs({...s,queue:[...s.queue].reverse()},'P1'),listenedSongs(s,'P1'));
});

test('scopeState isolates two rooms and two players; full platform aggregation is refused',()=>{
 const source=empty();source.schemaVersion=3;source.streamers=[{id:'papa',slug:'papa',active:true},{id:'other',slug:'other',active:true}];source.streamerSettings={papa:source.settings,other:source.settings};
 source.songs=[song('papa-song'),song('other-song',{streamer_id:'other'})];
 source.queue=[completed('papa-song'),completed('papa-song',{playerId:'P2'}),completed('other-song',{streamer_id:'other',items:[{songId:'other-song',performances:2}]})];
 assert.deepEqual(listenedSongs(scopeState(source,'papa'),'P1').map(row=>[row.songId,row.listenedCount]),[['papa-song',1]]);
 assert.deepEqual(listenedSongs(scopeState(source,'other'),'P1').map(row=>[row.songId,row.listenedCount]),[['other-song',2]]);
 assert.deepEqual(listenedSongs(scopeState(source,'other'),'P2'),[]);assert.throws(()=>listenedSongs(source,'P1'),/目前主播/);
 const scoped=scopeState(source,'papa');scoped.queue.push(source.queue[2]);scoped.songs.push(source.songs[1]);assert.equal(listenedSongs(scoped,'P1').length,1);
});

test('reading listening history never writes snapshots or exposes profiles, ledgers, lyrics and notes',()=>{
 const s=room([song('a',{lyrics:'private catalog lyrics',note:'private catalog note'})],[completed('a')]);
 s.players=[{playerId:'P1',password:'secret'}];s.ledger=[{playerId:'P1',amount:99}];const before=structuredClone(s);
 const history=listenedSongs(s,'P1');assert.deepEqual(s,before);assert.equal(JSON.stringify(history).includes('private'),false);assert.equal(JSON.stringify(history).includes('secret'),false);
 history[0].title='changed output';assert.equal(s.songs[0].title,'歌曲 a');assert.equal(s.queue[0].title,'舊歌曲 a');
});
