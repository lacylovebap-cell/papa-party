import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,upgradePlatform,mutate,publicView,matchesSong,previewImport,applyImport} from '../src/core.js';
import {NEW_PRACTICE_TAG,isNewPracticeSong,newPracticeSongTags,newPracticeDate,newPracticeSongs,setNewPracticeSong} from '../src/new-practice.js';
import {fateCategories,drawSong} from '../src/fate.js';

const admin={role:'admin'},now='2026-10-10T03:00:00.000Z',later='2026-10-11T04:00:00.000Z',old='2026-09-01T00:00:00.000Z';
function fixture(){
 const s=upgradePlatform(empty());s.revision=7;
 s.streamers.push({id:'other',slug:'other',active:true,spaceId:'space-002'});s.streamerSettings.other=structuredClone(s.settings);
 s.songs=[
  {songId:'a',streamer_id:'papa',title:'A',artist:'Artist',tags:['甜歌'],new:false,lyrics:'PRIVATE_BODY',privateNotes:'PRIVATE_NOTE',key:'Am',creditCost:0.5,shortMode:'both',pairSongIds:['b'],catalogVariantId:'shared-master',sourceHash:'source-hash',sort_order:17},
  {songId:'b',streamer_id:'papa',title:'B',artist:'Artist',new:true,tags:[],creditCost:0.5},
  {songId:'c',streamer_id:'papa',title:'C',artist:'Artist',new:true,tags:['嗨歌','新練'],newPracticeAt:old},
  {songId:'foreign',streamer_id:'other',title:'Foreign',artist:'Other',tags:[],new:false}
 ];return s;
}
const set=(s,songIds,enabled,time=now,actor=admin)=>mutate(s,{streamer:'papa',type:'newPracticeSet',data:{songIds,enabled}},actor,time);
const song=(s,id)=>s.songs.find(row=>row.songId===id);

test('one batch adds only selected room songs, dates only first membership, and keeps every protected field',()=>{
 const s=fixture(),before=structuredClone(s),next=set(s,['a','b','c'],true);
 assert.equal(next.revision,8);assert.equal(song(next,'a').newPracticeAt,now);assert.equal(song(next,'b').newPracticeAt,undefined);assert.equal(song(next,'c').newPracticeAt,old);
 assert.deepEqual(song(next,'a').tags,['甜歌','新練']);assert.deepEqual(song(next,'b').tags,['新練']);
 for(const key of ['lyrics','privateNotes','key','creditCost','shortMode','pairSongIds','catalogVariantId','sourceHash','sort_order'])assert.deepEqual(song(next,'a')[key],song(s,'a')[key]);
 assert.deepEqual(song(next,'foreign'),song(s,'foreign'));assert.deepEqual(next.players,s.players);assert.deepEqual(next.queue,s.queue);assert.deepEqual(next.ledger,s.ledger);
 assert.deepEqual(s,before);const again=set(next,['a','b','c'],true,later);
 assert.equal(song(again,'a').newPracticeAt,now);assert.equal(song(again,'b').newPracticeAt,undefined);assert.equal(song(again,'c').newPracticeAt,old);
 const removed=set(again,['a','b'],false,later);for(const id of ['a','b']){assert.equal(song(removed,id).new,false);assert.equal(song(removed,id).newPracticeAt,null);assert.equal(song(removed,id).tags.includes(NEW_PRACTICE_TAG),false);}
 const joined=set(removed,['a','b'],true,later);assert.equal(song(joined,'a').newPracticeAt,later);assert.equal(song(joined,'b').newPracticeAt,later);
});

test('batch membership validates all IDs, uniqueness, the 100 cap and authority before touching source',()=>{
 const s=fixture(),before=structuredClone(s);
 for(const data of [{songIds:[],enabled:true},{songIds:['a','missing'],enabled:true},{songIds:['a','foreign'],enabled:true},
  {songIds:['a','a'],enabled:true},{songIds:Array(1),enabled:true},{songIds:['a'],enabled:'true'},
  {songIds:['a'],enabled:true,newPracticeAt:old},{songIds:[{}],enabled:true}])assert.throws(()=>mutate(s,{type:'newPracticeSet',data},admin,now));
 assert.throws(()=>set(s,['a'],true,now,{role:'player',playerId:'P1'}),/管理/);assert.deepEqual(s,before);
 s.songs=Array.from({length:101},(_,index)=>({songId:'S'+index,streamer_id:'papa',new:false,tags:[]}));
 assert.equal(set(s,s.songs.slice(0,100).map(row=>row.songId),true).songs.filter(isNewPracticeSong).length,100);
 assert.throws(()=>set(s,s.songs.map(row=>row.songId),true),/100/);assert.ok(s.songs.every(row=>row.new===false));
});

test('legacy flags and reserved tags are recognized in lists, search, public fields and AND draws without backfilling',()=>{
 const s=fixture();s.songs.push({songId:'tag-only',streamer_id:'papa',title:'Tag only',artist:'Artist',new:false,tags:['甜歌','新練']});const before=structuredClone(s);
 assert.equal(isNewPracticeSong(song(s,'b')),true);assert.deepEqual(newPracticeSongTags(song(s,'b')),['新練']);assert.equal(newPracticeDate(song(s,'b')),null);
 assert.ok(newPracticeSongs(s.songs).some(row=>row.songId==='tag-only'));assert.equal(matchesSong(song(s,'b'),'新練'),true);assert.equal(matchesSong(song(s,'b'),'', ['新練']),true);
 const view=publicView(s,null,now);assert.equal(song(view,'b').newPracticeAt,undefined);assert.deepEqual(song(view,'b').tags,['新練']);assert.equal(song(view,'tag-only').new,true);
 assert.ok(fateCategories({},view.songs).includes('新練'));assert.equal(drawSong(view.songs,['tag:新練','tag:甜歌'],[],null,()=>0).song.songId,'tag-only');
 assert.equal(drawSong(view.songs,'tag:甜歌',[],null,()=>0).song.songId,'a');assert.deepEqual(s,before);
});

test('song edits use explicit new as authority, otherwise the reserved tag controls membership and dates',()=>{
 let s=fixture();s=mutate(s,{type:'song',data:{...song(s,'a'),new:true,newPracticeAt:old}},admin,now);
 assert.equal(song(s,'a').newPracticeAt,now);assert.deepEqual(song(s,'a').tags,['甜歌','新練']);
 s=mutate(s,{type:'song',data:{songId:'a',title:'A',artist:'Artist',new:true,lyrics:'PRIVATE_BODY'}},admin,later);
 assert.equal(song(s,'a').newPracticeAt,now);assert.deepEqual(song(s,'a').tags,['甜歌','新練']);
 s=mutate(s,{type:'song',data:{...song(s,'a'),new:false}},admin,later);assert.equal(song(s,'a').newPracticeAt,null);assert.deepEqual(song(s,'a').tags,['甜歌']);
 s=mutate(s,{type:'song',data:{songId:'a',title:'A',artist:'Artist',tags:['甜歌','新練']}},admin,later);
 assert.equal(song(s,'a').new,true);assert.equal(song(s,'a').newPracticeAt,later);
 assert.throws(()=>mutate(s,{type:'tag',data:{tag:'新練',remove:true}},admin,later),/保留標籤/);
});

test('bulk tag changes synchronize reserved membership while ordinary edits preserve dates and private data',()=>{
 let s=fixture();s=mutate(s,{type:'songsBulk',data:{songIds:['a'],tagMode:'add',tags:['新練']}},admin,now);
 assert.equal(song(s,'a').new,true);assert.equal(song(s,'a').newPracticeAt,now);
 s=mutate(s,{type:'songsBulk',data:{songIds:['a'],tagMode:'add',tags:['嗨歌']}},admin,later);assert.equal(song(s,'a').newPracticeAt,now);
 s=mutate(s,{type:'songsBulk',data:{songIds:['a'],tagMode:'remove',tags:['新練']}},admin,later);assert.equal(song(s,'a').new,false);assert.equal(song(s,'a').newPracticeAt,null);
 s=mutate(s,{type:'songsBulk',data:{songIds:['a'],tagMode:'replace',tags:['新練'],new:false}},admin,later);assert.equal(song(s,'a').new,false);assert.deepEqual(song(s,'a').tags,[]);
 assert.equal(song(s,'a').lyrics,'PRIVATE_BODY');assert.equal(song(s,'a').key,'Am');assert.equal(song(s,'a').creditCost,0.5);
});

test('import and learned wishes follow the same membership/date rules and reuse songs without changing private fields',()=>{
 let s=fixture();const rows=previewImport(s,'songs','Imported｜Artist｜華語｜其他｜新練,甜歌｜｜');
 s=applyImport(s,'songs',rows,['add'],admin,now);const imported=s.songs.find(row=>row.title==='Imported');assert.equal(imported.new,true);assert.equal(imported.newPracticeAt,now);assert.deepEqual(imported.tags,['甜歌','新練']);
 const explicit=previewImport(s,'songs','Plain｜Artist｜華語｜其他｜新練｜否｜');s=applyImport(s,'songs',explicit,['add'],admin,now);assert.equal(s.songs.find(row=>row.title==='Plain').new,false);
 s.wishes.push({id:'w',streamer_id:'papa',title:'A',artist:'Artist',status:'收到'});
 s=mutate(s,{type:'wishAdmin',data:{id:'w',status:'已學會',addSong:true}},admin,now);assert.equal(s.wishes[0].songId,'a');assert.equal(song(s,'a').newPracticeAt,now);assert.equal(song(s,'a').lyrics,'PRIVATE_BODY');assert.equal(song(s,'a').key,'Am');
 s=mutate(s,{type:'wishAdmin',data:{id:'w',status:'已學會',addSong:true}},admin,later);assert.equal(song(s,'a').newPracticeAt,now);
});

test('membership setter is immutable and unknown dates stay unknown; bulk undo can restore a captured date',()=>{
 const legacy={songId:'old',new:true,tags:[],privateNotes:'PRIVATE'},before=structuredClone(legacy);
 const unchanged=setNewPracticeSong(legacy,true,now);assert.equal(unchanged.newPracticeAt,undefined);assert.deepEqual(legacy,before);
 assert.equal(newPracticeDate({newPracticeAt:{secret:'PRIVATE'}}),null);
 let s=fixture();const keys=['songId','cat','artistType','tags','new','murmur','creditCost','newPracticeAt'];const capture=row=>Object.fromEntries(keys.map(key=>[key,row[key]]));
 const previous=[capture(song(s,'c'))];s=mutate(s,{type:'songsBulk',data:{songIds:['c'],new:false}},admin,now);const after=[capture(song(s,'c'))];
 s=mutate(s,{type:'restoreSongEdits',data:{before:previous,after}},admin,later);assert.equal(song(s,'c').newPracticeAt,old);assert.equal(song(s,'c').new,true);assert.ok(song(s,'c').tags.includes('新練'));
});

test('bulk undo with a date snapshot cannot overwrite a later rejoined membership with the same visible metadata',()=>{
 let s=fixture();const capture=row=>Object.fromEntries(['songId','cat','artistType','tags','new','murmur','creditCost','newPracticeAt'].map(key=>[key,row[key]]));
 const before=[capture(song(s,'c'))];s=mutate(s,{type:'songsBulk',data:{songIds:['c'],murmur:'batch edit'}},admin,now);const after=[capture(song(s,'c'))];
 s=set(set(s,['c'],false,later),['c'],true,later);const current=structuredClone(s);assert.equal(song(s,'c').newPracticeAt,later);
 assert.throws(()=>mutate(s,{type:'restoreSongEdits',data:{before,after}},admin,later),/已有其他修改/);assert.deepEqual(s,current);
});
