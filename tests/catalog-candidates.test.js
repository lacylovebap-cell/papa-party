import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogNormalize,catalogSongIndex,compareCatalogCandidates,scanCatalogCandidatePage} from '../src/catalog-candidates.js';

const song=(songId,title='愛你',artist='王心凌',extra={})=>({songId,streamer_id:'papa',title,artist,cat:'國語',...extra});
const compare=(a,b,options)=>compareCatalogCandidates(...catalogSongIndex([a,b],options));

test('candidate normalization handles width, case, spacing, punctuation and explicit Chinese folds',()=>{
 assert.equal(catalogNormalize(' ＡＢＣ・臺灣！ '),'abc台灣');
 assert.equal(catalogNormalize('爱你',{爱:'愛'}),'愛你');
 // No undocumented claim of comprehensive Chinese conversion.
 assert.equal(catalogNormalize('爱你'),'爱你');
});
test('scan preparation never changes song IDs or any private business data',()=>{
 const source=[song('S1','愛你','王心凌',{tags:['私有'],lyrics:'秘密歌詞',note:'換氣',murmur:'私有',key:'C',creditCost:0.5,short:true})];
 const before=structuredClone(source);Object.freeze(source[0]);Object.freeze(source);
 const index=catalogSongIndex(source);
 assert.deepEqual(source,before);
 assert.equal(index[0].songId,'S1');
 for(const key of ['lyrics','note','murmur','tags','key','creditCost','short'])assert.equal(Object.hasOwn(index[0],key),false);
});
test('same title and artist produce a pending suggestion only',()=>{
 const row=compare(song('a'),song('b','愛 你！','王心凌',{streamer_id:'other'}));
 assert.equal(row.kind,'possible_same');assert.equal(row.status,'pending');
 assert.equal(row.familyId,undefined);assert.equal(row.variantId,undefined);
});
test('same title with different or absent artist is not a same-song decision',()=>{
 assert.equal(compare(song('a'),song('b','愛你','其他人')).kind,'same_title');
 assert.equal(compare(song('a','愛你',''),song('b','愛你','')).kind,'same_title');
});
test('language and version differences stay visible for president review',()=>{
 assert.equal(compare(song('a'),song('b','愛你','王心凌',{cat:'日語'})).kind,'possible_version');
 assert.equal(compare(song('a'),song('b','愛你','王心凌',{version:'Live'})).kind,'possible_version');
 assert.equal(compare(song('a'),song('b','愛你','王心凌',{cat:'華語'})).kind,'possible_same');
});
test('reviewed aliases and folds match without replacing source metadata',()=>{
 const index=catalogSongIndex([song('a'),song('b','爱你','Cyndi')],{folds:{爱:'愛'},artistAliases:{cyndi:'王心凌'}});
 assert.equal(compareCatalogCandidates(...index).kind,'possible_same');
 assert.equal(index[1].artist,'Cyndi');assert.equal(index[1].title,'爱你');
});
test('similar title requires a matching artist and leaves version judgment pending',()=>{
 assert.equal(compare(song('a','愛很簡單','陶喆'),song('b','愛很簡單Live','陶喆')).kind,'possible_version');
 assert.equal(compare(song('a','愛很簡單','陶喆'),song('b','愛很簡單Live','他人')),null);
 assert.equal(compare(song('a','愛','甲'),song('b','愛情','甲')),null);
 assert.equal(compare(song('a',''),song('b','')),null);
});
test('bounded scan resumes exactly once per pair, including pages with no matches',()=>{
 const index=catalogSongIndex([song('d','不同'),song('b'),song('a'),song('c')]);
 const whole=scanCatalogCandidatePage(index,{snapshotId:'r1',maxComparisons:500});
 let cursor=null,comparisons=0;const rows=[];
 do {const page=scanCatalogCandidatePage(index,{snapshotId:'r1',cursor,maxComparisons:1});
   assert.equal(page.comparisons,1);comparisons+=page.comparisons;rows.push(...page.candidates);cursor=page.nextCursor;
 }while(cursor);
 assert.equal(comparisons,6);assert.deepEqual(rows,whole.candidates);
 assert.equal(new Set(rows.map(x=>x.id)).size,rows.length);
 assert.equal(JSON.stringify(rows).includes('秘密'),false);
});
test('scan order is stable across source ordering and rooms preserve distinct IDs',()=>{
 const songs=[song('1'),song('1','愛你','王心凌',{streamer_id:'other'})];
 assert.deepEqual(catalogSongIndex(songs),catalogSongIndex([...songs].reverse()));
 assert.throws(()=>catalogSongIndex([songs[0],songs[0]]),/重複/);
 assert.throws(()=>catalogSongIndex([{songId:'1'}]),/識別碼/);
});
test('snapshot changes and malformed cursors cannot silently resume',()=>{
 const index=catalogSongIndex([song('a'),song('b'),song('c')]);
 const {nextCursor}=scanCatalogCandidatePage(index,{snapshotId:'r1',maxComparisons:1});
 assert.throws(()=>scanCatalogCandidatePage(index,{snapshotId:'r2',cursor:nextCursor}),/快照/);
 assert.throws(()=>scanCatalogCandidatePage(index,{snapshotId:'r1',cursor:{...nextCursor,left:-1}}),/游標/);
 assert.throws(()=>scanCatalogCandidatePage(index,{snapshotId:'r1',maxComparisons:5001}),/限制/);
 assert.throws(()=>scanCatalogCandidatePage(index,{}),/快照/);
});
test('empty and singleton books complete without candidates',()=>{
 for(const songs of [[],[song('a')]])assert.deepEqual(scanCatalogCandidatePage(catalogSongIndex(songs),{snapshotId:'r1'}),{candidates:[],comparisons:0,nextCursor:null});
});
