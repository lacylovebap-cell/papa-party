import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the production event handlers with an input that must keep its identity.
const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const handlers=source.slice(source.indexOf('let querySequence=0;'),source.indexOf('async function start()'));
function harness(){
 const events={},filters={q:''},pages={book:4},results=[];
 const context=vm.createContext({document:{addEventListener:(type,fn)=>events[type]=fn},WeakSet,filters,pages,isAdmin:()=>false,renderSongResults:()=>results.push(filters.q),render:()=>{throw new Error('Search must never replace the page');},toast:message=>{throw new Error(message);}});
 vm.runInContext(handlers,context);
 const input={id:'song-q',value:'',matches:()=>false};
 return {events,input,filters,pages,results};
}
test('Zhuyin composition is not searched or rerendered until the syllable is committed',()=>{
 const {events,input,filters,pages,results}=harness();
 events.compositionstart({target:input});
 input.value='ㄘㄞˋ';events.input({target:input,isComposing:true});
 // Some engines omit isComposing on their last interim input.
 events.input({target:input,isComposing:false});assert.equal(results.length,0);
 input.value='蔡';events.compositionend({target:input});assert.deepEqual(results,['蔡']);assert.equal(filters.q,'蔡');assert.equal(pages.book,1);
 input.value='蔡依林';events.input({target:input,isComposing:false});assert.deepEqual(results,['蔡','蔡依林']);
});
test('normal typing and erasing update only song results while retaining the original input',()=>{
 const {events,input,results}=harness();
 for(const value of ['R','Ro','Roly','']){input.value=value;events.input({target:input,isComposing:false});}
 assert.deepEqual(results,['R','Ro','Roly','']);assert.equal(input.id,'song-q');
});
