import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const app=fs.readFileSync('src/app.js','utf8'),catalog=fs.readFileSync('supabase/functions/party-api/catalog.ts','utf8');
const labels=app.split(/\r?\n/).filter(line=>line.startsWith('const songArtistLabel=')||line.startsWith('const songLabel=')).join('\n');
const code=stripTypeScriptTypes(catalog.slice(catalog.indexOf('const CATALOG_COMMON_FIELDS'),catalog.indexOf('// A local tag/note edit')));
test('confirmed catalog metadata reaches queue items and versions without changing stored snapshots or private fields',()=>{
 const ctx=vm.createContext({});
 vm.runInContext(code,ctx);
 const snapshot={songs:[{songId:'dj',title:'時光走散1',artist:'怕怕',tags:['DJ'],hostNote:'私人'}],
  queue:[{id:'q',songId:'dj',title:'時光走散1',items:[{songId:'dj',title:'時光走散1',performances:2,creditCost:1}],price:300},
   {id:'removed',songId:'missing',title:'保留歷史名稱'},
   {id:'pair',songId:'dj',title:'雙曲組合',items:[{songId:'dj',title:'舊名'},{songId:'missing',title:'另一首'}]}]};
 const original=structuredClone(snapshot);
 const result=ctx.catalogMetadataView(snapshot,[{songId:'dj',title:'時光走散',artist:'怕怕',version:'DJ版'}],true);
 assert.equal(result.queue[0].title,'時光走散');
 assert.equal(result.queue[0].items[0].title,'時光走散');
 assert.equal(result.queue[0].version,'DJ版');
 assert.equal(result.queue[0].items[0].version,'DJ版');
 assert.equal(result.queue[0].items[0].performances,2);
 assert.equal(result.queue[0].price,300);
 assert.equal(result.queue[1].title,'保留歷史名稱');
 assert.equal(result.queue[2].title,'雙曲組合');
 assert.equal(result.queue[2].items[0].title,'時光走散');
 assert.equal(result.queue[2].items[1].title,'另一首');
 assert.equal(result.songs[0].hostNote,'私人');
 assert.deepEqual(snapshot,original);
});
test('selected song labels and queue second line retain the exact version',()=>{
 const ctx=vm.createContext({});
 vm.runInContext(labels+';this.label=songLabel;this.artist=songArtistLabel;',ctx);
 for(const version of ['DJ版','Live版','翻唱版','自訂版']){
  const song={title:'時光走散',artist:'怕怕',version};
  assert.equal(ctx.label(song),'時光走散－怕怕（'+version+'）');
  assert.equal(ctx.artist(song),'怕怕（'+version+'）');
 }
 assert.equal(ctx.label({title:'時光走散',artist:'怕怕'}),'時光走散－怕怕');
 assert.equal(ctx.label({title:'時光走散',artist:'怕怕',catalogVariantId:'original'}),'時光走散－怕怕（原版）');
 const pick=app.split(/\r?\n/).find(line=>line.startsWith("case 'pickEntity':"));
 assert.match(pick,/songLabel\(record\)/);
 assert.match(app.split(/\r?\n/).find(line=>line.startsWith('function restoreProxyDraft(')),/songLabel\(row\)/);
});
