import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,upgradePlatform,DEFAULTS} from '../src/core.js';
import {stateChanges} from '../src/state-patch.js';
import {applyRoomImport} from '../src/room-import.js';

const admin={role:'admin'},at='2026-10-09T04:00:00Z',roomId='native-room';
function fixture(){
 const state=upgradePlatform(empty());
 state.streamers.push({id:roomId,slug:'native',display_name:'Native',active:true,spaceId:'space-002'});
 state.streamerSettings[roomId]=structuredClone(DEFAULTS);
 state.players=[{playerId:'P1',name:'Native player',ids:['native-id'],names:['Native alias']}];
 state.songs=[
  {songId:'legacy-song',streamer_id:'papa',title:'Song',artist:'Artist',tags:['Legacy'],lyrics:'Legacy private body',privateNotes:'legacy-private',_order:30},
  {songId:'own-song',streamer_id:roomId,title:'Song',artist:'Artist',tags:['Old'],cat:'華語',artistType:'其他',hidden:false,creditCost:0.5,shortMode:'both',pairSongIds:['own-pair'],_order:91},
  {songId:'own-pair',streamer_id:roomId,title:'Pair',artist:'Artist',tags:[],creditCost:0.5,shortMode:'repeat',pairSongIds:[],_order:92},
 ];
 state.ledger=[{id:'legacy-ledger',streamer_id:'papa',playerId:'P1',amount:3,note:'legacy-private',at}];
 state.queue=[{id:'legacy-queue',streamer_id:'papa',playerId:'P1',songId:'legacy-song',status:'completed',at}];
 state.crowns=[{id:'legacy-crown',streamer_id:'papa',playerId:'P1',songId:'legacy-song',tier:'金卡',note:'legacy-private'}];
 return state;
}

test('matched lean song import omits synthesized lyrics and preserves private source fields on merge',()=>{
 const before=fixture(),snapshot=structuredClone(before);
 const after=applyRoomImport(before,'songs','歌名｜歌手｜語言｜類型｜標籤｜新歌｜碎碎念\nSong｜Artist｜台語｜女歌手｜New｜是｜Updated', ['update'],admin,at,roomId);
 const song=after.songs.find(song=>song.songId==='own-song');
 assert.equal(Object.hasOwn(song,'lyrics'),false);
 assert.equal(Object.hasOwn(song,'privateNotes'),false);
 assert.equal(song.cat,'台語');assert.deepEqual(song.tags,['New']);assert.equal(song.murmur,'Updated');
 const patch=stateChanges(before,after,{preserveOrder:true});
 const changed=patch.changes.find(row=>row.kind==='songs'&&row.id==='own-song').data;
 assert.equal(Object.hasOwn(changed,'lyrics'),false);assert.equal(changed._order,91);assert.deepEqual(patch.removed,[]);
 const source={...before.songs.find(song=>song.songId==='own-song'),lyrics:'Native private body',privateNotes:{secret:'source-private'},customSource:{retained:true}};
 const merged={...source,...changed};
 assert.equal(merged.lyrics,'Native private body');assert.deepEqual(merged.privateNotes,{secret:'source-private'});assert.deepEqual(merged.customSource,{retained:true});
 assert.deepEqual(before,snapshot);
});

test('song imports preserve genuine lyrics, existing private values and unrelated legacy rows',()=>{
 const before=fixture();
 before.songs.find(song=>song.songId==='own-song').lyrics='Existing lyrics';
 before.songs.find(song=>song.songId==='own-song').privateNotes={secret:'already supplied'};
 before.songs.find(song=>song.songId==='own-pair').lyrics='';
 const after=applyRoomImport(before,'songs','Song｜Artist｜華語｜其他｜New\nPair｜Artist\nNew song｜Artist', ['update','update','add'],admin,at,'native');
 assert.equal(after.songs.find(song=>song.songId==='own-song').lyrics,'Existing lyrics');
 assert.deepEqual(after.songs.find(song=>song.songId==='own-song').privateNotes,{secret:'already supplied'});
 assert.equal(Object.hasOwn(after.songs.find(song=>song.songId==='own-pair'),'lyrics'),true);
 assert.equal(after.songs.find(song=>song.songId==='own-pair').lyrics,'');
 const created=after.songs.find(song=>song.title==='New song');assert.equal(created.streamer_id,roomId);assert.equal(created.lyrics,'');
 assert.deepEqual(after.songs.filter(song=>song.streamer_id==='papa'),before.songs.filter(song=>song.streamer_id==='papa'));
 for(const table of ['players','ledger','queue','crowns','cards','wishes'])assert.deepEqual(after[table],before[table]);
 assert.deepEqual(after.streamers,before.streamers);assert.deepEqual(after.streamerSettings.papa,before.streamerSettings.papa);
 assert.deepEqual(after.streamerSettings[roomId],{...before.streamerSettings[roomId],tags:[...before.streamerSettings[roomId].tags,'New']});
});

test('song imports reuse pairing, duplicate and manager validation atomically within the own room',()=>{
 const before=fixture(),snapshot=structuredClone(before);
 const after=applyRoomImport(before,'songs','Song｜Artist', ['update'],admin,at,roomId);
 const updated=after.songs.find(song=>song.songId==='own-song');
 assert.equal(updated.songId,'own-song');assert.equal(updated.creditCost,0.5);assert.equal(updated.shortMode,'both');assert.deepEqual(updated.pairSongIds,['own-pair']);
 assert.throws(()=>applyRoomImport(before,'songs','Song｜Artist', ['add'],admin,at,roomId),/重複/);
 assert.throws(()=>applyRoomImport(before,'songs','New｜Artist\nNew｜Artist', ['add','add'],admin,at,roomId),/重複/);
 assert.throws(()=>applyRoomImport(before,'songs','Song｜Artist', ['update'],{role:'player',playerId:'P1'},at,roomId),/管理/);
 assert.throws(()=>applyRoomImport(before,'songs','Song｜', ['update'],admin,at,roomId),/缺歌名或歌手/);
 const invalid=structuredClone(before);invalid.songs.find(song=>song.songId==='own-song').pairSongIds=['legacy-song'];invalid.songs[0].creditCost=0.5;
 assert.throws(()=>applyRoomImport(invalid,'songs','Song｜Artist', ['update'],admin,at,roomId),/本主播的其他半首歌/);
 const added=applyRoomImport(before,'songs','New｜Artist\nNew｜Artist｜台語', ['add','update'],admin,at,roomId);
 assert.equal(added.songs.filter(song=>song.title==='New').length,1);assert.equal(added.songs.find(song=>song.title==='New').cat,'台語');
 const skipped=applyRoomImport(before,'songs','Song｜Artist', ['skip'],admin,at,roomId);assert.deepEqual(skipped,before);
 assert.deepEqual(before,snapshot);
});

test('crown imports use own-room songs, existing players and core tier validation without provisioning or activation',()=>{
 const before=fixture(),snapshot=structuredClone(before);
 const after=applyRoomImport(before,'crowns','Song｜Artist｜Native alias｜金｜2026-10-01｜Imported', ['add'],admin,at,roomId);
 const crown=after.crowns.find(crown=>crown.streamer_id===roomId);
 assert.equal(crown.songId,'own-song');assert.equal(crown.playerId,'P1');assert.equal(crown.tier,'金卡');assert.equal(crown.fee,DEFAULTS.tiers[0].fee);
 assert.equal(crown.activatedAt,undefined);assert.match(crown.note,/Imported/);assert.match(crown.note,/待核對/);
 assert.deepEqual(after.players,before.players);assert.deepEqual(after.crowns.filter(crown=>crown.streamer_id==='papa'),before.crowns);
 const updated=applyRoomImport(after,'crowns','Song｜Artist｜Native player｜鉑金卡｜｜Updated', ['update'],admin,at,roomId);
 assert.equal(updated.crowns.find(row=>row.id===crown.id).tier,'鉑金卡');
 for(const text of ['Song｜Artist｜Unknown player｜金卡','Unknown song｜Artist｜Native player｜金卡','Song｜Artist｜Native player｜Unknown tier'])assert.throws(()=>applyRoomImport(before,'crowns',text,['add'],admin,at,roomId),/唯一對應/);
 assert.throws(()=>applyRoomImport(after,'crowns','Song｜Artist｜Native player｜金卡',['add'],admin,at,roomId),/重複/);
 const invalid=structuredClone(after);invalid.crowns.find(row=>row.id===crown.id).fee=-1;
 assert.throws(()=>applyRoomImport(invalid,'crowns','Song｜Artist｜Native player｜金卡',['update'],admin,at,roomId),/有效整數/);
 assert.deepEqual(before,snapshot);
});

test('room import validates kind, input, exact choices and the 2000-row boundary',()=>{
 const before=fixture(),snapshot=structuredClone(before),text='Song｜Artist';
 for(const kind of ['unknown',undefined])assert.throws(()=>applyRoomImport(before,kind,text,['skip'],admin,at,roomId),/類型不正確/);
 for(const value of ['', '  ',null,42,'歌名｜歌手'])assert.throws(()=>applyRoomImport(before,'songs',value,[],admin,at,roomId),/匯入資料/);
 for(const choices of [{0:'skip'},['new'],['unknown'],new Array(1),['skip',undefined]])assert.throws(()=>applyRoomImport(before,'songs',text,choices,admin,at,roomId),/選項不正確/);
 for(const choices of [[],['skip','skip']])assert.throws(()=>applyRoomImport(before,'songs',text,choices,admin,at,roomId),/行數不符/);
 assert.throws(()=>applyRoomImport(before,'songs',text,['skip'],admin,at,'missing-room'),/找不到主播/);
 const rows=Array(2000).fill(text).join('\n'),choices=Array(2000).fill('skip');
 assert.deepEqual(applyRoomImport(before,'songs',rows,choices,admin,at,roomId),before);
 assert.deepEqual(applyRoomImport(before,'songs','歌名｜歌手\n'+rows,choices,admin,at,roomId),before);
 assert.throws(()=>applyRoomImport(before,'songs',rows+'\n'+text,choices,admin,at,roomId),/最多匯入 2000/);
 assert.throws(()=>applyRoomImport(before,'songs','歌名｜歌手\n'+rows+'\n'+text,choices,admin,at,roomId),/最多匯入 2000/);
 assert.throws(()=>applyRoomImport(before,'songs',text,Array(2001).fill('skip'),admin,at,roomId),/選項不正確/);
 assert.deepEqual(before,snapshot);
});
