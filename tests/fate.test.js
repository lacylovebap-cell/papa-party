import test from 'node:test';import assert from 'node:assert/strict';
import {fateCategories,drawSong} from '../src/fate.js';
test('draw categories follow catalog and song tag edits without a fixed vocabulary',()=>{
 let songs=[{songId:'a',tags:['古風']},{songId:'b',tags:['甜歌']}];
 assert.deepEqual(fateCategories({tags:['古風','新分類','古風']},songs),['古風','新分類','甜歌']);
 songs=songs.map(s=>({...s,tags:s.tags.map(t=>t==='古風'?'古典':t)}));
 assert.deepEqual(fateCategories({tags:['古典']},songs),['古典','甜歌']);
 assert.equal(drawSong(songs,'tag:古風').song,null);assert.equal(drawSong(songs,'tag:古典').song.songId,'a');
});
test('draw cycle exhausts candidates, avoids immediate repeat and supports a single-song tag',()=>{
 const songs=[{songId:'a',tags:['慢歌']},{songId:'b',tags:['慢歌']},{songId:'c',tags:['快歌']}];
 const a=drawSong(songs,'tag:慢歌',[],null,()=>0),b=drawSong(songs,'tag:慢歌',a.seen,a.song.songId,()=>0);
 assert.equal(a.song.songId,'a');assert.equal(b.song.songId,'b');
 assert.equal(drawSong(songs,'tag:慢歌',b.seen,'b',()=>0).song.songId,'a');
 assert.equal(drawSong(songs,'tag:快歌',['c'],'c',()=>0).song.songId,'c');
});
test('all and fate include untagged songs; absent tags/rooms cannot use stale candidates',()=>{
 const songs=[{songId:'new',tags:[]}];
 for(const category of ['all','fate'])assert.equal(drawSong(songs,category,['old'],'old',()=>0).song.songId,'new');
 assert.equal(drawSong(songs,'tag:舊分類',['old']).song,null);assert.equal(drawSong([],'all').song,null);
 assert.deepEqual(fateCategories({},songs),[]);
});
