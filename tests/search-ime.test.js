import test from 'node:test';
import assert from 'node:assert/strict';
import {installImeSubmitGuard} from '../src/search-ime.js';

test('IME confirmation leaves Enter alone and suppresses an implicit submit after compositionend',()=>{
 const listeners={};
 const root={addEventListener:(name,handler)=>{listeners[name]=handler;}};
 const form={ownerDocument:{}},input={form};
 form.ownerDocument.activeElement=input;
 const blocked=installImeSubmitGuard(root);
 listeners.compositionstart({target:input});
 assert.equal(blocked(form),true);
 listeners.keydown({key:'Enter',target:input});
 listeners.compositionend({target:input});
 assert.equal(blocked(form),true);
 assert.equal(blocked({}),false);
 listeners.keydown({key:'Enter',target:input});
 assert.equal(blocked(form),false);
 listeners.keydown({key:'Enter',keyCode:229,target:input});
 assert.equal(blocked(form),true);
});
