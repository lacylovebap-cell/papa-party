import test from 'node:test';
import assert from 'node:assert/strict';
import {installSearchShortcuts,eventDescription} from '../src/catalog-tools.js';
test('Enter invokes the local search once while IME, textareas and unrelated forms retain their behavior',()=>{
 let handle,clicks=0,prevented=0;
 const root={addEventListener:(name,fn)=>{assert.equal(name,'keydown');handle=fn;}};
 const scope={querySelectorAll:()=>[{textContent:'搜尋',click:()=>clicks++}]};
 const input={tagName:'INPUT',type:'search',closest:sel=>sel==='.entity-picker'?null:scope};
 installSearchShortcuts(root);
 const send=extra=>handle({key:'Enter',target:input,preventDefault:()=>prevented++,...extra});
 send();assert.equal(clicks,1);assert.equal(prevented,1);
 for(const extra of [{isComposing:true},{keyCode:229},{repeat:true},{shiftKey:true},{ctrlKey:true},{defaultPrevented:true},{target:{tagName:'TEXTAREA'}},{key:'Escape'}])send(extra);
 assert.equal(clicks,1);
 input.closest=()=>null;send();assert.equal(clicks,1);
 input.closest=()=>({});send();assert.equal(clicks,1,'entity pickers do not submit their parent form');
});
test('Enter flushes an existing debounce callback once without a second button action',()=>{
 let handler,calls=0;
 installSearchShortcuts({addEventListener:(_,fn)=>handler=fn},{'common-book-q':()=>calls++});
 handler({key:'Enter',target:{tagName:'INPUT',type:'search',id:'common-book-q',closest:()=>null},preventDefault:()=>{}});
 assert.equal(calls,1);
});
test('bulk deletion audit uses the retained song snapshot in its plain-language summary',()=>{
 const text=eventDescription({action:'songsBulk',entity_kind:'songs',entity_id:'id',actor_role:'admin',before_data:{title:'Belief',artist:'S.H.E'},after_data:null});
 assert.match(text,/刪除歌曲/);assert.match(text,/Belief/);assert.match(text,/S.H.E/);
});
