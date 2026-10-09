import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const prefixes=['function favoriteButton(','function syncFavoriteButtons(','function loadVisibleFavoriteFlags(','function favoritesPanelHtml(','function loadFavorites(','async function setSongFavorite(','function songRows(','function playerTabs('];
const functions=prefixes.map(prefix=>source.split(/\r?\n/).find(line=>line.startsWith(prefix))).join('\n');
function ui(){
 const calls=[],view={page:0,rows:[{songId:'S1',title:'Not previously requested',artist:'Singer',tags:[]}],total:1,loading:false,error:null,flags:{S1:true},pendingSongIds:[]};
 const state={settings:{},players:[{playerId:'P1',name:'Owner',ids:[],names:[]},{playerId:'P2',name:'Other',ids:[],names:[]}],songs:[{songId:'S1',plays:7}],queue:[],crowns:[],cards:[],wishes:[],ledger:[]};
 const nodes=Array.from({length:70},(_,i)=>({dataset:{id:'S'+i},setAttribute(key,value){this[key]=value;}}));
 const context=vm.createContext({state,session:{playerId:'P1'},route:'center',subtab:'favorites',demo:false,
  songFavorites:{state:()=>view,loadFlags:async ids=>calls.push({flags:ids}),load:async options=>calls.push({load:options}),setFavorite:async(songId,favorite)=>{calls.push({songId,favorite});return {songId,favorite,changed:true};}},
  document:{querySelectorAll:()=>nodes},h:x=>String(x??''),blank:x=>'<p>'+x+'</p>',say:()=>'',clock:()=>'',plays:s=>s.plays||0,crownFor:()=>null,song:id=>state.songs.find(s=>s.songId===id),
  button:(label,action,id='',cls='',extra='')=>'<button data-act="'+action+'" data-id="'+id+'" '+extra+'>'+label+'</button>',toast:x=>calls.push({toast:x}),loginDialog:async()=>calls.push({login:true})});
 vm.runInContext(functions,context);return {calls,view,context,nodes,run:code=>vm.runInContext(code,context)};
}

test('favorites are private to the signed-in owner and distinct from listened history',()=>{
 const h=ui();const own=h.run('playerTabs("P1")');assert.match(own,/我的最愛/);assert.match(own,/Not previously requested/);assert.match(own,/7 次/);assert.match(own,/data-kind="saved"/);assert.match(own,/data-kind="live"/);
 assert.doesNotMatch(h.run('playerTabs("P2")'),/我的最愛|Not previously requested/);assert.doesNotMatch(h.run('playerTabs("P1",true)'),/我的最愛|Not previously requested/);
});

test('visible favorite flags use one bounded batch and are never loaded for manager or guest views',async()=>{
 const h=ui();h.run('loadVisibleFavoriteFlags()');assert.equal(h.calls.length,1);assert.equal(h.calls[0].flags.length,50);assert.equal(new Set(h.calls[0].flags).size,50);
 h.context.route='admin';h.run('loadVisibleFavoriteFlags()');assert.equal(h.calls.length,1);assert.equal(h.run('favoriteButton("S1")'),'');h.context.route='book';h.context.session=null;h.run('loadVisibleFavoriteFlags()');assert.equal(h.calls.length,1);
});

test('explicit favorite actions preserve desired state and refresh only the open bounded favorites page',async()=>{
 const h=ui();await h.run('setSongFavorite("S1",false)');assert.deepEqual(h.calls[0],{songId:'S1',favorite:false});assert.equal(h.calls.filter(x=>x.load).length,1);
 h.context.route='book';await h.run('setSongFavorite("S2",true)');assert.equal(h.calls.filter(x=>x.load).length,1);
 h.context.session=null;await h.run('setSongFavorite("S3",true)');assert.equal(h.calls.filter(x=>x.songId).length,2);assert.equal(h.calls.at(-1).login,true);
});

test('loading/errors do not show stale rows or initiate reads; retry remains explicit',()=>{
 const h=ui();h.view.loading=true;assert.doesNotMatch(h.run('favoritesPanelHtml()'),/Not previously requested/);h.view.loading=false;h.view.error='Offline';const html=h.run('favoritesPanelHtml()');assert.match(html,/Offline/);assert.match(html,/favoritesRetry/);assert.doesNotMatch(html,/Not previously requested/);assert.equal(h.calls.length,0);
});

test('favorite buttons show acknowledged state and disable only the pending song',()=>{
 const h=ui();h.view.pendingSongIds=['S1'];assert.match(h.run('favoriteButton("S1")'),/已收藏/);assert.match(h.run('favoriteButton("S1")'),/disabled/);h.run('syncFavoriteButtons()');assert.equal(h.nodes[1].disabled,true);assert.equal(h.nodes[2].disabled,false);assert.equal(h.nodes[1].dataset.favorite,'false');
});
