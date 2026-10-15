import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {matchesSong} from '../src/core.js';
import {drawSong} from '../src/fate.js';

test('book and manager search send all-tag matching to existing bounded RPC and reject stale filter results',async()=>{
 const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),calls=[];let resolve;
 const songs=[{songId:'both',title:'歌',tags:['甜歌','慢歌']},{songId:'one',title:'歌',tags:['甜歌']},{songId:'practice',title:'歌',tags:['甜歌'],new:true}];
 const ctx=vm.createContext({JSON,Date,Map,Set,streamerSlug:'papa',state:{revision:1,currentStreamer:{id:'papa',spaceId:'space-001'},songs},
  admin:null,session:null,route:'book',tab:'songs',demo:false,draft:null,filters:{q:'歌',tags:['甜歌','慢歌'],language:''},listSorts:{book:'newest',songs:'newest'},songCatalogStatusFilter:'all',songVisibilityFilter:'visible',
  roomSearch:{generation:0,cache:new Map()},isAdmin:()=>!!ctx.admin,matchesSong,song:id=>songs.find(s=>s.songId===id),renderSongResults(){},
  api:body=>{calls.push(JSON.parse(JSON.stringify(body)));return new Promise(done=>resolve=done);}});
 vm.runInContext(app.slice(app.indexOf('function filteredSongs()'),app.indexOf('function visibleLanguages()')),ctx);
 assert.deepEqual([...vm.runInContext('filteredSongs().map(s=>s.songId)',ctx)],['both']);
 let pending=vm.runInContext('loadRoomSongSearch("book",filters.q,filters.tags,0)',ctx);
 assert.equal(calls[0].tagMatch,'all');assert.deepEqual(calls[0].tags,['甜歌','慢歌']);assert.equal(calls[0].limit,20);
 ctx.filters.tags=['甜歌','新練'];resolve({songIds:['both'],total:1});await pending;
 assert.equal(ctx.roomSearch.book,undefined,'late old-tag result must not replace the current list');
 assert.deepEqual([...vm.runInContext('filteredSongs().map(s=>s.songId)',ctx)],['practice']);
 pending=vm.runInContext('loadRoomSongSearch("book",filters.q,filters.tags,1)',ctx);
 assert.equal(calls[1].offset,20);assert.equal(calls[1].tagMatch,'all');resolve({songIds:['practice'],total:21});await pending;
 ctx.admin={role:'streamer_admin'};ctx.route='admin';pending=vm.runInContext('loadRoomSongSearch("songs",filters.q,filters.tags,0)',ctx);
 assert.equal(calls[2].tagMatch,'all');assert.equal(calls[2].visibility,'visible');resolve({songIds:['practice'],total:1});await pending;
 const draw=drawSong(songs,['tag:甜歌','tag:慢歌'],[],null,()=>0);assert.equal(draw.song.songId,'both');
 assert.equal(matchesSong(songs[0],'',['不存在','慢歌']),false);assert.equal(matchesSong(songs[0],'',[]),true);
});
