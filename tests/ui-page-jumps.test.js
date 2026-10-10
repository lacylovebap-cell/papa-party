import test from 'node:test';import assert from 'node:assert/strict';import {checkedPage} from '../src/ui-page-jumps.js';
test('jump pages are absolute zero-based pages with strict integer and known-total bounds',()=>{
 assert.equal(checkedPage('1',3),0);assert.equal(checkedPage('3',3),2);
 for(const value of ['0','-1','1.5','x','',4,Infinity,9007199254740992])assert.throws(()=>checkedPage(value,3));
});
