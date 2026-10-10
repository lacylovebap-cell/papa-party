import test from 'node:test';
import assert from 'node:assert/strict';
import {drawSong} from '../src/fate.js';

const songs=[
 {songId:'high',tags:['嗨歌']},
 {songId:'sweet',tags:['甜歌']},
 {songId:'both',tags:['嗨歌','甜歌']},
 {songId:'sad',tags:['傷感']},
 {songId:'untagged'}
];
const choose=(category,seen=[],previous=null,random=()=>0)=>drawSong(songs,category,seen,previous,random);
function cycle(category,count){
 const ids=[];let seen=[],previous=null;
 for(let i=0;i<count;i++){const result=choose(category,seen,previous);ids.push(result.song?.songId);seen=result.seen;previous=result.song?.songId;}
 return ids;
}

test('multiple tags require their intersection without giving duplicate tags extra chances',()=>{
 const tags=['tag:嗨歌','tag:甜歌'];
 assert.deepEqual(cycle(tags,3),['both','both','both']);
 assert.equal(choose(tags,[],null,()=>0.5).song.songId,'both');
 assert.equal(choose(tags,[],null,()=>0.99).song.songId,'both');
});

test('duplicate tag keys and selection order do not duplicate or reorder candidates',()=>{
 const original=cycle(['tag:嗨歌','tag:甜歌'],3);
 assert.deepEqual(cycle(['tag:甜歌','tag:嗨歌','tag:甜歌','tag:嗨歌'],3),original);
});

test('an unknown selected tag cannot be ignored when every selected tag is required',()=>{
 assert.deepEqual(choose(['tag:不存在'],['high'],'high'),{song:null,seen:[]});
 assert.deepEqual(choose(['tag:不存在','tag:甜歌']),{song:null,seen:[]});
 assert.deepEqual(choose(['unknown'],['high'],'high'),{song:null,seen:[]});
});

test('empty selection or all includes the entire supplied catalog including untagged songs',()=>{
 for(const tags of [[],['all'],['all','tag:不存在'],['tag:嗨歌','all']]){
  assert.deepEqual(cycle(tags,5),['high','sweet','both','sad','untagged']);
  assert.equal(choose(tags,[],null,()=>0.999).song.songId,'untagged');
 }
});

test('legacy single tag, all and fate strings preserve their existing results and cycles',()=>{
 for(const [oldCategory,newCategories] of [['tag:甜歌',['tag:甜歌']],['all',[]],['fate',['all']]]){
  const count=oldCategory==='tag:甜歌'?5:8;
  assert.deepEqual(cycle(newCategories,count),cycle(oldCategory,count));
 }
 assert.deepEqual(choose('tag:不存在'),{song:null,seen:[]});
});

test('changing selected tags drops stale seen entries and the intersection remains bounded to matching songs',()=>{
 const result=choose(['tag:甜歌'],['sad','high','sweet'],'high');
 assert.equal(result.song.songId,'both');assert.deepEqual(result.seen,['sweet','both']);
 const repeated=choose(['tag:嗨歌','tag:甜歌'],['high','sweet','both'],'high');
 assert.equal(repeated.song.songId,'both');assert.deepEqual(repeated.seen,['both']);
 const single=drawSong([songs[2]],['tag:嗨歌','tag:甜歌'],['both'],'both',()=>0);
 assert.equal(single.song.songId,'both');assert.deepEqual(single.seen,['both']);
});

test('empty catalogs return no result and draws leave supplied songs, selections and history untouched',()=>{
 assert.deepEqual(drawSong([],[],['old'],'old'),{song:null,seen:[]});
 const selections=['tag:嗨歌','tag:甜歌'],seen=['high'],before=structuredClone({songs,selections,seen});
 const result=choose(selections,seen,'high');assert.equal(result.song,songs[2]);
 assert.deepEqual({songs,selections,seen},before);
});
