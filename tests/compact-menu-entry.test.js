import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {streamerAdminDestination} from '../src/streamer-admin-route.js';
const source=fs.readFileSync('src/streamer-menu-entry.js','utf8').replace(/^import .*\r?\n/gm,'').replaceAll('import.meta.url',"'https://paparty.app/src/streamer-menu-entry.js'");
test('independent entry restores menus rebuilt by an older cached app, without observing menu descendants',()=>{
 let callback,observed,calls=0,compact=false;
 const menu={classList:{contains:()=>compact},querySelector:()=>null,querySelectorAll:()=>[]},header={querySelector:()=>menu};
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
 vm.runInNewContext(source,{URL,document:{getElementById:()=>null},MutationObserver:class{constructor(){assert.fail('No header must not start observation');}}});
});
test('cached admin button becomes an explicit streamer queue link while platform entry stays separate',()=>{
 let replacement;
 const button={className:'tiny',replaceWith:link=>replacement=link};
 const platform={textContent:'平台管理中心',dataset:{act:'platformOpen'}};
 const menu={classList:{contains:()=>true},querySelector:()=>null,querySelectorAll:selector=>selector==='button[data-act="admin"]'?[button]:[]};
 const document={getElementById:id=>id==='header'?{querySelector:()=>menu}:null,createElement:tag=>({tag,dataset:{}})};
 vm.runInNewContext(source,{URL,document,window:{},location:{href:'https://paparty.app/v2.html?streamer=papa&adminTab=platform#home',hash:'#home'},
  MutationObserver:class{observe(){}},readPublicRouteContext:()=>null,streamerAdminDestination});
 assert.equal(replacement.tag,'a');assert.equal(replacement.textContent,'主播後台');assert.equal(replacement.dataset.act,undefined);
 assert.equal(new URL(replacement.href).searchParams.get('adminTab'),'queue');
 assert.equal(new URL(replacement.href).searchParams.get('portalLogin'),'admin');
 assert.equal(platform.dataset.act,'platformOpen');assert.equal(platform.textContent,'平台管理中心');
});
test('a signed-in player menu keeps one ordinary backend login entry without granting a role',()=>{
 let replacement,callback,added=0;
 const account={querySelector:selector=>selector==='h3'?{textContent:'帳號與管理'}:{append(){added++;}}};
 const menu={classList:{contains:()=>true},querySelector:()=>replacement||null,querySelectorAll:selector=>selector==='section'?[account]:[]};
 const document={getElementById:id=>id==='header'?{querySelector:()=>menu}:null,createElement:tag=>({tag,dataset:{},replaceWith:link=>replacement=link})};
 const context={URL,document,window:{},location:{href:'https://paparty.app/v2.html?streamer=papa#home',hash:'#home'},
  MutationObserver:class{constructor(fn){callback=fn;}observe(){}},readPublicRouteContext:()=>null,streamerAdminDestination};
 vm.runInNewContext(source,context);callback();
 assert.equal(added,1);assert.equal(replacement.textContent,'主播後台');
 assert.equal(new URL(replacement.href).searchParams.get('portalLogin'),'admin');
 assert.equal(Object.hasOwn(context,'admin'),false);
});
