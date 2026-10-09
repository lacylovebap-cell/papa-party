import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const lines=source.split(/\r?\n/);
function segment(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,`missing app segment ${start}`);
 return source.slice(a,b);
}
function line(start){const value=lines.find(row=>row.startsWith(start));assert.ok(value,`missing app helper ${start}`);return value;}
const plain=value=>JSON.parse(JSON.stringify(value));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,id='',classes='')=>`<button data-act="${action}" data-id="${id}" class="${classes}">${label}</button>`;

function harness({songs=[],respond,values={}}={}){
 const calls=[],timers=[],cleared=[],dispatches=[],toasts=[],counts={render:0,results:0};
 let context;
 context=vm.createContext({
  JSON,Date,Map,Set,admin:{role:'streamer',accountId:'account-a',streamer_id:'room-a'},session:null,
  state:{currentStreamer:{spaceId:'space-a',id:'room-a'},revision:7,songs},streamerSlug:'room-a',
  route:'admin',tab:'songs',demo:false,draft:null,filters:{q:'',tags:[],language:''},
  songCatalogStatusFilter:'all',songVisibilityFilter:'visible',pages:{songs:1},selectedSongs:new Set(),songUndo:null,
  roomSearch:{songs:null,book:null,home:null,unsupported:false,generation:0,timer:null,cache:new Map()},
  isAdmin:()=>!!context.admin,song:id=>context.state.songs.find(row=>row.songId===id),
  matchesSong:(row,q,tags=[])=>!q||`${row.title} ${row.artist}`.includes(q)||tags.some(tag=>row.tags?.includes(tag)),
  api:body=>{calls.push(plain(body));return respond?respond(body,calls.length-1):Promise.resolve({songIds:[],total:0});},
  setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:value=>cleared.push(value),
  render:()=>counts.render++,renderSongResults:()=>counts.results++,
  dispatch:async(action,data)=>dispatches.push({action,data:plain(data)}),toast:value=>toasts.push(value),
  plays:row=>row.plays||0,h:escape,button,blank:text=>`<p>${text}</p>`,songRows:()=>'',
  $:selector=>selector==='#home-search'?{value:context.filters.q}:null,
  ...values
 });
 vm.runInContext(line('function paginate('),context);
 vm.runInContext(segment('function filteredSongs()','function visibleLanguages()'),context);
 for(const name of ['function songStatusToolbar()','function adminSongPage()','function adminSongList()','function adminSongResults(','function songBatchBar()'])vm.runInContext(line(name),context);
 const cases=[segment("case 'songVisibilityMode':","case 'songHide':"),segment("case 'songHide':","case 'songOtherSingers':"),segment("case 'selectFilteredSongs':","case 'clearSongSelection':")].join('');
 vm.runInContext(`async function visibilityAction(action,id){switch(action){${cases}}}`,context);
 return {context,calls,timers,cleared,dispatches,toasts,counts,run:code=>vm.runInContext(code,context)};
}

function fixtureSongs(){
 return [
  ...Array.from({length:46},(_,i)=>({songId:`hidden-${String(i).padStart(2,'0')}`,title:`隱藏歌 ${i}`,artist:'歌手',cat:'日語',tags:[],hidden:true,catalogStatus:'linked',plays:i})),
  {songId:'visible',title:'顯示歌',artist:'歌手',cat:'日語',tags:[],hidden:false,catalogStatus:'linked'},
  {songId:'unlinked',title:'未綁定隱藏歌',artist:'歌手',cat:'日語',tags:[],hidden:true},
  {songId:'other-language',title:'其他語言隱藏歌',artist:'歌手',cat:'華語',tags:[],hidden:true,catalogStatus:'linked'}
 ];
}

test('ordinary songs default to visible and hidden songs have their own active tab',async()=>{
 const defaults=vm.createContext({});vm.runInContext(line('let songCatalogStatusFilter='),defaults);
 assert.equal(vm.runInContext('songVisibilityFilter',defaults),'visible');
 const h=harness({songs:fixtureSongs()});
 assert.match(h.run('songStatusToolbar()'),/data-id="visible" class="active">歌曲/);
 assert.match(h.run('songStatusToolbar()'),/data-id="hidden" class="">隱藏歌曲/);
 assert.deepEqual(plain(h.run('filteredSongs().map(row=>row.songId)')),['visible']);
 h.context.selectedSongs.add('visible');h.context.pages.songs=3;h.context.roomSearch.timer='pending-debounce';
 await h.run("visibilityAction('songVisibilityMode','hidden')");
 assert.equal(h.context.songVisibilityFilter,'hidden');assert.equal(h.context.selectedSongs.size,0);
 assert.equal(h.context.pages.songs,1);assert.equal(h.context.roomSearch.generation,1);
 assert.deepEqual(h.cleared,['pending-debounce']);assert.equal(h.counts.render,1);
 const hidden=h.run('songStatusToolbar()');
 assert.match(hidden,/data-id="hidden" class="active">隱藏歌曲/);
 assert.match(hidden,/可恢復顯示/);assert.doesNotMatch(hidden,/data-id="visible" class="active"/);
 assert.equal(h.run('filteredSongs().length'),48);
 await h.run("visibilityAction('songVisibilityMode','visible')");
 assert.deepEqual(plain(h.run('filteredSongs().map(row=>row.songId)')),['visible']);
});

test('restore calls the existing song update with original fields and does not delete the song',async()=>{
 const song={songId:'hidden',title:'原歌名',artist:'歌手',cat:'日語',tags:['甜歌'],hidden:true,new:true,catalogStatus:'linked',catalogVariantId:'shared-version',plays:42,murmur:'保留資料'};
 const before=structuredClone(song),h=harness({songs:[song]});
 const html=h.run('adminSongResults(state.songs)');
 assert.match(html,/data-act="songHide" data-id="hidden" class="tiny">恢復顯示/);
 await h.run("visibilityAction('songHide','hidden')");
 assert.deepEqual(h.dispatches,[{action:'song',data:{...before,hidden:false}}]);
 assert.deepEqual(song,before);assert.deepEqual(h.toasts,['已恢復顯示']);
 await h.run("visibilityAction('songHide','missing')");assert.equal(h.dispatches.length,1);
});

test('blank manager lists send visibility and catalog status before requesting one server page',async()=>{
 const songs=fixtureSongs(),h=harness({songs,respond:async body=>{
  const filtered=songs.filter(row=>row.hidden&&row.catalogStatus==='linked'&&row.cat===body.language);
  return {songIds:filtered.slice(body.offset,body.offset+body.limit).map(row=>row.songId),total:filtered.length,hasMore:body.offset+body.limit<filtered.length};
 }});
 h.context.songVisibilityFilter='hidden';h.context.songCatalogStatusFilter='linked';h.context.filters.language='日語';
 await h.run("loadRoomSongSearch('songs','',[],0)");
 assert.deepEqual(h.calls[0],{op:'songSearchRoom',q:'',tags:[],limit:20,offset:0,language:'日語',visibility:'hidden',catalogStatus:'linked'});
 let page=h.run('adminSongPage()');
 assert.equal(page.loading,false);assert.equal(page.rows.length,20);
 assert.deepEqual(plain(page.rows.map(row=>row.songId)),songs.slice(0,20).map(row=>row.songId));
 assert.match(page.nav,/共 46 首/);
 await h.run("loadRoomSongSearch('songs','',[],1)");
 assert.equal(h.calls[1].offset,20);assert.equal(h.calls[1].limit,20);
 page=h.run('adminSongPage()');assert.deepEqual(plain(page.rows.map(row=>row.songId)),songs.slice(20,40).map(row=>row.songId));
 await h.run("loadRoomSongSearch('songs','',[],1)");assert.equal(h.calls.length,2,'unchanged page should reuse the bounded cached result');
});

test('public book and home requests cannot carry manager visibility or catalog status filters',async()=>{
 const h=harness({values:{admin:null,session:{accountId:'player-account',playerId:'player-a',role:'player'},route:'book'}});
 h.context.songVisibilityFilter='hidden';h.context.songCatalogStatusFilter='pending';h.context.filters.q='歌';h.context.filters.language='日語';
 await h.run("loadRoomSongSearch('book','歌',[],0)");
 h.context.route='home';await h.run("loadRoomSongSearch('home','歌',[],0)");
 assert.deepEqual(h.calls,[{op:'songSearchRoom',q:'歌',tags:[],limit:20,offset:0,language:'日語'},{op:'songSearchRoom',q:'歌',tags:[],limit:5,offset:0}]);
 h.context.filters.q='';h.context.route='book';
 await h.run("loadRoomSongSearch('book','',[],0)");
 assert.equal(h.run('bookSearchResult()'),null);assert.equal(h.calls.length,2);assert.equal(h.timers.length,0);
});

test('room search cache keys separate identities, scopes and every active manager filter',()=>{
 const h=harness(),c=h.context,key=()=>h.run("roomSearchKey(' 歌 ',['甜歌','嗨歌'],0,'songs')"),baseline=key();
 const changes=[
  [()=>c.state.currentStreamer.spaceId='space-b',()=>c.state.currentStreamer.spaceId='space-a'],
  [()=>c.state.currentStreamer.id='room-b',()=>c.state.currentStreamer.id='room-a'],
  [()=>c.admin.accountId='account-b',()=>c.admin.accountId='account-a'],
  [()=>c.admin.role='super',()=>c.admin.role='streamer'],
  [()=>c.admin.streamer_id='room-b',()=>c.admin.streamer_id='room-a'],
  [()=>c.streamerSlug='room-b',()=>c.streamerSlug='room-a'],
  [()=>c.state.revision=8,()=>c.state.revision=7],
  [()=>c.filters.language='日語',()=>c.filters.language=''],
  [()=>c.songVisibilityFilter='hidden',()=>c.songVisibilityFilter='visible'],
  [()=>c.songCatalogStatusFilter='linked',()=>c.songCatalogStatusFilter='all']
 ];
 for(const [change,restore] of changes){change();assert.notEqual(key(),baseline);restore();assert.equal(key(),baseline);}
 assert.equal(h.run("roomSearchKey('歌',['嗨歌','甜歌'],0,'songs')"),baseline,'query whitespace and tag order are normalized');
 for(const expression of ["roomSearchKey('別首',['甜歌','嗨歌'],0,'songs')","roomSearchKey('歌',['甜歌'],0,'songs')","roomSearchKey('歌',['甜歌','嗨歌'],1,'songs')","roomSearchKey('歌',['甜歌','嗨歌'],0,'book')"])assert.notEqual(h.run(expression),baseline);
 c.admin=null;c.session={accountId:'a',playerId:'p1',role:'player'};
 const publicKey=h.run("roomSearchKey('歌',[],0,'book')");
 c.session.playerId='p2';assert.notEqual(h.run("roomSearchKey('歌',[],0,'book')"),publicKey);
 c.session.playerId='p1';c.songVisibilityFilter='hidden';c.songCatalogStatusFilter='pending';assert.equal(h.run("roomSearchKey('歌',[],0,'book')"),publicKey);
});

test('identical pending reads coalesce and old scope or filter responses never render',async()=>{
 const changes=[
  ['visibility',async h=>h.run("visibilityAction('songVisibilityMode','hidden')")],
  ['Space',h=>h.context.state.currentStreamer.spaceId='space-b'],
  ['room',h=>h.context.state.currentStreamer.id='room-b'],
  ['Account',h=>h.context.admin.accountId='account-b'],
  ['logout',h=>h.context.admin=null],
  ['revision',h=>h.context.state.revision++],
  ['catalog status',h=>h.context.songCatalogStatusFilter='pending'],
  ['language',h=>h.context.filters.language='日語'],
  ['query',h=>h.context.filters.q='new'],
  ['admin page',h=>h.context.tab='players']
 ];
 for(const [name,change] of changes){
  let finish;const h=harness({respond:()=>new Promise(resolve=>finish=resolve)});
  const pending=h.run("loadRoomSongSearch('songs','',[],0)");
  await h.run("loadRoomSongSearch('songs','',[],0)");assert.equal(h.calls.length,1,name);
  await change(h);finish({songIds:['old-result'],total:1});await pending;
  assert.equal(h.context.roomSearch.songs,null,name);assert.equal(h.counts.results,0,name);
 }
});

test('an old response cannot replace a newly loaded hidden-song page or clear its pending request',async()=>{
 for(const oldFirst of [true,false]){
  const pending=[],songs=[{songId:'old',title:'舊頁',hidden:false},{songId:'new',title:'隱藏頁',hidden:true}];
  const h=harness({songs,respond:()=>new Promise(resolve=>pending.push(resolve))});
  const first=h.run("loadRoomSongSearch('songs','',[],0)");
  await h.run("visibilityAction('songVisibilityMode','hidden')");
  const second=h.run("loadRoomSongSearch('songs','',[],0)");
  const latestKey=h.context.roomSearch.pendingKey;
  if(oldFirst){
   pending[0]({songIds:['old'],total:1});await first;
   assert.equal(h.context.roomSearch.pendingKey,latestKey);assert.equal(h.context.roomSearch.songs,null);
  }
  pending[1]({songIds:['new'],total:1});await second;
  if(!oldFirst){pending[0]({songIds:['old'],total:1});await first;}
  assert.deepEqual(plain(h.run('adminSongPage().rows.map(row=>row.songId)')),['new']);assert.equal(h.counts.results,1);
 }
});

test('missing result renders share the existing debounce and stale scheduled modes do not read',async()=>{
 const h=harness();
 for(let i=0;i<5;i++)assert.equal(h.run('adminSongPage().loading'),true);
 assert.equal(h.calls.length,0);assert.equal(h.timers.length,1);assert.equal(h.timers[0].ms,350);
 await h.run("visibilityAction('songVisibilityMode','hidden')");h.run('adminSongPage()');
 assert.equal(h.timers.length,2);
 h.timers[0].fn();assert.equal(h.calls.length,0,'the old tab debounce must not send a read');
 h.timers[1].fn();await new Promise(setImmediate);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].visibility,'hidden');
 for(let i=0;i<5;i++)assert.equal(h.run('adminSongPage().loading'),false);
 assert.equal(h.calls.length,1);assert.equal(h.timers.length,2,'completed renders must not create repeated reads or timers');
});

test('filtered and checkbox selection use only the returned page while preserving earlier selections',async()=>{
 const songs=fixtureSongs(),h=harness({songs,respond:async()=>({songIds:songs.slice(20,40).map(row=>row.songId),total:46,hasMore:true})});
 h.context.songVisibilityFilter='hidden';await h.run("loadRoomSongSearch('songs','',[],1)");
 h.context.selectedSongs.add('visible');await h.run("visibilityAction('selectFilteredSongs','')");
 assert.deepEqual([...h.context.selectedSongs],['visible',...songs.slice(20,40).map(row=>row.songId)]);
 assert.match(h.run('songBatchBar()'),/選取本頁搜尋結果（20）/);
 let change;h.context.document={addEventListener:(type,listener)=>{assert.equal(type,'change');change=listener;}};
 vm.runInContext(line("document.addEventListener('change',e=>{if(e.target.matches('[data-song-select]'))"),h.context);
 change({target:{checked:false,matches:selector=>selector==='[data-select-song-page]'}});
 assert.deepEqual([...h.context.selectedSongs],['visible']);
 change({target:{checked:true,matches:selector=>selector==='[data-select-song-page]'}});
 assert.equal(h.context.selectedSongs.size,21);assert.equal(h.context.selectedSongs.has('hidden-00'),false);
});

test('demo and draft song lists keep the existing local filtered paging and perform no API reads',async()=>{
 for(const mode of ['demo','draft']){
  const songs=fixtureSongs(),h=harness({songs});h.context[mode]=mode==='demo'?true:{local:true};
  h.context.songVisibilityFilter='hidden';h.context.songCatalogStatusFilter='linked';h.context.filters.language='日語';h.context.pages.songs=2;
  await h.run("loadRoomSongSearch('songs','',[],0)");
  assert.equal(h.run('bookSearchResult()'),null,mode);
  const page=h.run('adminSongPage()');assert.deepEqual(plain(page.rows.map(row=>row.songId)),songs.slice(20,40).map(row=>row.songId),mode);
  assert.equal(h.calls.length,0,mode);assert.equal(h.timers.length,0,mode);
 }
});
