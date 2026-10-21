import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/compact-menu-entry.js','utf8').replace(/^import .*\n/,'').replaceAll('import.meta.url',"'https://paparty.app/src/compact-menu-entry.js'");
test('independent entry restores menus rebuilt by an older cached app, without observing menu descendants',()=>{
 let callback,observed,calls=0,compact=false;
 const menu={classList:{contains:()=>compact}},header={querySelector:()=>menu};
 const style={href:'https://paparty.app/src/compact-menu.css?v=1021-menu-2'};
 const context={URL,window:{},location:{hash:'#home'},document:{getElementById:id=>id==='header'?header:style},
  MutationObserver:class{constructor(fn){callback=fn;}observe(target,options){observed={target,options};}},
  installCompactMenu({route}){assert.equal(route,'home');compact=true;calls++;}};
 vm.runInNewContext(source,context);
 assert.equal(calls,1);assert.equal(observed.target,header);assert.deepEqual({...observed.options},{childList:true});
 assert.equal(style.href,'https://paparty.app/src/compact-menu.css?v=1021-menu-3');
 callback();assert.equal(calls,1,'already decorated headers are not reinstalled');
 compact=false;callback();assert.equal(calls,2,'legacy header replacement is decorated');
});
test('entry has no side effect on pages without the application header',()=>{
 vm.runInNewContext(source,{document:{getElementById:()=>null},MutationObserver:class{constructor(){assert.fail('No header must not start observation');}}});
});
