import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const read=vm.runInNewContext(source.slice(source.indexOf('function readAllocation('),source.indexOf('function updateAllocationRemaining('))+'\nreadAllocation',{state:{},isoInput:x=>x,quoteSong:(_s,id)=>({creditCost:id==='half'?0.5:1})});
const row=(id,completed=false)=>({querySelector:q=>q==='[name=songId]'?{value:id}:{checked:q==='[name=completed]'&&completed}});
function form(rows,existing=[],total=3){return {elements:{total:{value:total},playerId:{value:'p'},effective_at:{value:'2026-11-04'}},querySelectorAll:q=>q==='.allocation-row'?rows:existing};}
test('three selected songs use all three credits even with an untouched blank row',()=>{
 const result=read(form([row('a'),row('b'),row('c'),row('')]));
 assert.equal(result.stored,0);assert.equal(result.items.length,3);
});
test('linked songs and fractional costs both count toward the balance',()=>{
 assert.equal(read(form([row('half')],[{value:'q',dataset:{cost:'1'}}])).stored,1.5);
 assert.throws(()=>read(form([row('a'),row('b')],[],1)),/超過/);
 assert.throws(()=>read(form([row('',true)])),/選擇歌曲/);
});
