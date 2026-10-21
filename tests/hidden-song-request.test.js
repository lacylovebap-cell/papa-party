import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,publicView} from '../src/core.js';
import {drawSong} from '../src/fate.js';
const admin={role:'admin'},at='2026-10-21T12:00:00Z';
function fixture(){let s=mutate(empty(),{type:'player',data:{name:'Fixture',balance:10}},admin,at);s=mutate(s,{type:'song',data:{title:'Hidden',artist:'Fixture',creditCost:2,hidden:true}},admin,at);return s;}
test('player direct request cannot select hidden songs; manager manual request preserves configured cost',()=>{
 const s=fixture(),songId=s.songs[0].songId,playerId=s.players[0].playerId;
 for(const kind of ['saved','live'])assert.throws(()=>mutate(s,{type:'request',data:{songId,kind,giftConfirmed:true,allowHidden:true}},{role:'player',playerId},at),/找不到歌曲/);
 const next=mutate(s,{type:'onBehalf',data:{playerId,songId,kind:'live',giftConfirmed:true}},admin,at);
 assert.equal(next.queue[0].creditCost,2);assert.equal(next.songs[0].hidden,true);assert.equal(s.queue.length,0);
 assert.equal(publicView(next,{role:'player',playerId},at).songs.length,0);
});
test('draw filters hidden songs before building history and refuses forged hidden draw',()=>{
 const s=fixture(),hidden=s.songs[0];
 assert.equal(drawSong([hidden],'all').song,null);
 const shown={songId:'visible',tags:['x']};
 assert.equal(drawSong([{...hidden,tags:['x']},shown],['tag:x'],[],null,()=>0).song.songId,'visible');
 assert.throws(()=>mutate(s,{type:'streamerDraw',data:{songId:hidden.songId}},admin,at),/可用歌曲/);
});
test('hidden paired song cannot bypass the player request guard',()=>{
 let s=fixture();s=mutate(s,{type:'song',data:{...s.songs[0],creditCost:0.5}},admin,at);
 const pair=s.songs[0];s=mutate(s,{type:'song',data:{title:'Visible half',artist:'Fixture',creditCost:0.5,shortMode:'pair',pairSongIds:[pair.songId]}},admin,at);
 assert.throws(()=>mutate(s,{type:'request',data:{songId:s.songs[1].songId,pairSongId:pair.songId,kind:'live',giftConfirmed:true}},{role:'player',playerId:s.players[0].playerId},at),/搭配歌曲目前未開放/);
});
