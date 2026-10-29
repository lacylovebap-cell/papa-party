import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const fn=prefix=>source.split(/\r?\n/).find(l=>l.startsWith(prefix));
const load=source.slice(source.indexOf('async function loadCatalogReview()'),source.indexOf('async function catalogReviewAction('));
test('all / missing / added preserve independent pages and selected rows',()=>{
 const view={membership:'missing',membershipViews:new Map(),page:3,selected:new Set(['v']),selectedRows:new Map([['v',{}]]),generation:0};
 const c=vm.createContext({view});vm.runInContext(fn('function switchCatalogMembership('),c);
 vm.runInContext("switchCatalogMembership(view,'all')",c);assert.equal(view.membership,'all');assert.equal(view.page,0);assert.equal(view.selected.size,0);
 vm.runInContext("switchCatalogMembership(view,'added');switchCatalogMembership(view,'missing')",c);assert.equal(view.page,3);assert.ok(view.selected.has('v'));
});
test('review languages use bounded catalog facets, cache across pages and refresh for a different scope',async()=>{
 const calls=[],view={section:'singles',page:0,pageSize:20,search:'',language:'',items:[],membership:'all'};
 const state={currentStreamer:{id:'papa',spaceId:'space-001'}};
 const c=vm.createContext({catalogView:view,state,admin:{accountId:'admin'},tab:'catalog',demo:false,draft:null,render:()=>{},api:async b=>{calls.push(b);return b.status==='families'?{filters:{languages:['華語','越南語']}}:{items:[],total:0};}});
 vm.runInContext(load,c);await vm.runInContext('loadCatalogReview()',c);
 assert.deepEqual(view.filterOptions.languages,['華語','越南語']);assert.equal(calls[1].limit,1);assert.equal(calls[1].membership,'all');
 view.page=1;await vm.runInContext('loadCatalogReview()',c);assert.equal(calls.length,3);
 state.currentStreamer={id:'other',spaceId:'space-002'};await vm.runInContext('loadCatalogReview()',c);assert.equal(calls.length,5);
});
test('late language facets do not overwrite another review section',async()=>{
 let finish;const view={section:'singles',page:0,search:'',language:'',items:[],membership:'all'};
 const c=vm.createContext({catalogView:view,state:{currentStreamer:{id:'papa'}},admin:true,tab:'catalog',demo:false,draft:null,render:()=>{},api:async b=>b.status==='families'?new Promise(r=>finish=r):{items:[],total:0}});
 vm.runInContext(load,c);const pending=vm.runInContext('loadCatalogReview()',c);await new Promise(r=>setImmediate(r));view.section='approved';finish({filters:{languages:['old']}});await pending;assert.equal(view.languageFacets,undefined);
});
