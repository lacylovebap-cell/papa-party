import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const segment=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('room lyric search is debounced by caller, bounded, room-scoped and cached without downloading lyrics',async()=>{
 const calls=[],roomSearch={book:null,home:null,unsupported:false,generation:0,timer:null,cache:new Map()},songs=[{songId:'a',title:'夜',artist:'歌手',lyrics:'MUST_NOT_TRAVEL'}];
 const context=vm.createContext({JSON,Date,Set,Map,streamerSlug:'papa',roomSearch,filters:{q:'夜',tags:[]},state:{songs},route:'book',demo:false,draft:null,
  isAdmin:()=>false,api:async body=>{calls.push(body);return {songIds:['a'],total:21,hasMore:body.offset===0};},song:id=>songs.find(s=>s.songId===id),renderSongResults:()=>{},button:()=>'',songRows:()=>'',matchesSong:()=>false,$:()=>null});
 vm.runInContext(segment('function roomSearchKey(','function songToolbar('),context);
 await vm.runInContext("loadRoomSongSearch('book','夜',[],0)",context);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{op:'songSearchRoom',q:'夜',tags:[],limit:20,offset:0});
 assert.deepEqual([...roomSearch.book.songIds],['a']);
 await vm.runInContext("loadRoomSongSearch('book','夜',[],0)",context);
 assert.equal(calls.length,1,'short-term repeat should reuse metadata-only IDs');
 await vm.runInContext("loadRoomSongSearch('book','夜',[],1)",context);
 assert.equal(calls[1].offset,20);
 assert.equal(JSON.stringify(calls).includes('MUST_NOT_TRAVEL'),false);
});

test('shared catalog browse loads only one page and never renders lyric text from search metadata',async()=>{
 const calls=[],holder={innerHTML:''},sharedBrowse={q:'愛',page:0,items:[],total:0,hasMore:false,loading:false,error:'',selected:new Set(),generation:0,reviewIds:null};
 const context=vm.createContext({JSON,Set,sharedBrowse,demo:false,draft:null,h:escape,blank:()=>'<i>empty</i>',button:(label)=>`<button>${label}</button>`,$:()=>holder,isSuperAdmin:()=>false,
  api:async body=>{calls.push(body);return {items:[{variantId:'v1',title:'愛你',artist:'歌手',lyrics:'HIDDEN_LYRICS'}],total:31,hasMore:true};}});
 vm.runInContext(segment('function sharedBrowseHtml()','async function chooseCatalogTarget('),context);
 await vm.runInContext('loadSharedBrowse(0)',context);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{op:'catalogSearch',q:'愛',limit:20,offset:0,management:true});
 assert.match(holder.innerHTML,/愛你/);assert.doesNotMatch(holder.innerHTML,/HIDDEN_LYRICS/);
 await vm.runInContext('loadSharedBrowse(1)',context);
 assert.equal(calls[1].offset,20);
});

test('unchanged reads coalesce and a full refresh is forced at most five minutes apart',async()=>{
 let now=1000000,resolvePending,reads=0;const requests=[],app={innerHTML:''};
 const context=vm.createContext({Date:{now:()=>now},demo:false,draft:null,busy:false,refreshInFlight:null,lastFullRefreshAt:0,state:{revision:7},
  api:async body=>{requests.push(body);reads++;if(reads===2)return new Promise(resolve=>{resolvePending=resolve;});return {state:{revision:7},ready:true};},render:()=>{},isAdmin:()=>false,$:()=>app,button:()=>''});
 vm.runInContext(segment('async function refresh(','async function dispatch('),context);
 await vm.runInContext('refresh(true)',context);
 assert.equal(requests[0].revision,-1);
 now+=30000;
 const first=vm.runInContext('refresh()',context),second=vm.runInContext('refresh()',context);
 assert.equal(requests.length,2,'overlapping timer and notification reads should share one request');
 resolvePending({ready:true});await Promise.all([first,second]);
 assert.equal(requests[1].revision,7);
 now+=300000;
 await vm.runInContext('refresh()',context);
 assert.equal(requests[2].revision,-1,'periodic full read catches clock-dependent changes');
});

test('home and book search caches are separated by result limit and song revision',async()=>{
 const calls=[],roomSearch={book:null,home:null,unsupported:false,generation:0,cache:new Map()},state={revision:1,songs:[]};
 const context=vm.createContext({JSON,Date,Set,Map,streamerSlug:'michelle',roomSearch,filters:{q:'愛',tags:[]},state,route:'home',demo:false,draft:null,
  isAdmin:()=>false,api:async body=>{calls.push(body);return {songIds:[],total:0};},song:()=>null,renderSongResults:()=>{},button:()=>'',songRows:()=>'',matchesSong:()=>false,$:selector=>selector==='#home-search'?{value:'愛'}:{innerHTML:''}});
 vm.runInContext(segment('function roomSearchKey(','function songToolbar('),context);
 await vm.runInContext("loadRoomSongSearch('home','愛',[],0)",context);
 context.route='book';await vm.runInContext("loadRoomSongSearch('book','愛',[],0)",context);
 assert.deepEqual(calls.map(call=>call.limit),[5,20]);
 state.revision=2;await vm.runInContext("loadRoomSongSearch('book','愛',[],0)",context);
 assert.equal(calls.length,3,'a changed song revision must not reuse stale search IDs');
});

test('president can create lyrics for a metadata-only catalog result',()=>{
 const context=vm.createContext({sharedBrowse:{items:[{id:'v',title:'新歌',artist:'歌手'}],selected:new Set(),page:0},h:escape,blank:()=>'',button:(label,action)=>`<button data-act="${action}">${label}</button>`,isSuperAdmin:()=>true});
 vm.runInContext(segment('function sharedBrowseHtml()','function renderSharedBrowse()'),context);
 assert.match(vm.runInContext('sharedBrowseHtml()',context),/data-act="catalogSharedLyrics"/);
 context.isSuperAdmin=()=>false;
 assert.doesNotMatch(vm.runInContext('sharedBrowseHtml()',context),/catalogSharedLyrics/);
});

test('candidate scan is explicit, one bounded batch, and does not overlap or auto-continue',async()=>{
 const calls=[],catalogView={scanCursor:'',scanTotal:0,scanning:false,scanComplete:false};let finish;
 const context=vm.createContext({catalogView,tab:'catalog',demo:false,draft:null,isSuperAdmin:()=>true,render:()=>{},toast:()=>{},loadCatalogReview:async()=>{},api:body=>{calls.push(body);return new Promise(resolve=>{finish=resolve;});}});
 vm.runInContext(segment('async function scanCatalogCandidates()','function catalogTemplateHtml()'),context);
 const first=vm.runInContext('scanCatalogCandidates()',context);await vm.runInContext('scanCatalogCandidates()',context);
 assert.equal(calls.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{op:'catalogScan',afterSongId:'',limit:100,management:true});
 finish({processed:100,nextCursor:'last-song'});await first;
 assert.equal(catalogView.scanCursor,'last-song');assert.equal(catalogView.scanTotal,100);assert.equal(calls.length,1);
 const next=vm.runInContext('scanCatalogCandidates()',context);assert.equal(calls[1].afterSongId,'last-song');finish({processed:4,nextCursor:null});await next;
 assert.equal(catalogView.scanComplete,true);assert.equal(catalogView.scanTotal,104);
});

test('changing review section while loading cannot display the old section response',async()=>{
 const catalogView={section:'pending',page:0,loading:false,loaded:false,items:[]};let finish;
 const context=vm.createContext({catalogView,tab:'catalog',demo:false,draft:null,isSuperAdmin:()=>true,render:()=>{},api:()=>new Promise(resolve=>{finish=resolve;})});
 vm.runInContext(segment('async function loadCatalogReview()','async function catalogReviewAction('),context);
 const loading=vm.runInContext('loadCatalogReview()',context);catalogView.section='approved';
 finish({items:[{id:'old-pending'}],total:1});await loading;
 assert.deepEqual(catalogView.items,[]);assert.equal(catalogView.loaded,false);assert.equal(catalogView.loading,false);
});

test('batch-add feedback uses the confirmed count when existing songs are skipped',async()=>{
 let submit;const messages=[],calls=[];
 const context=vm.createContext({sharedBrowse:{selected:new Set(['a','b'])},demo:false,draft:null,isAdmin:()=>true,nativeSelect:()=>'',modal:(_title,_body,fn)=>{submit=fn;},api:async body=>{calls.push(body);return {added:1,songIds:['new']};},refresh:async()=>{},toast:message=>messages.push(message)});
 vm.runInContext(segment('async function addSharedSongs()','async function editStreamerLyrics('),context);
 await vm.runInContext('addSharedSongs()',context);await submit(new Map([['lyricsMode','shared']]));
 assert.match(messages[0],/已加入 1 首/);assert.equal(calls[0].variantIds.length,2);
});

test('review sends the hashes seen at selection time even after paging or a newer list response',async()=>{
 const calls=[],catalogView={selected:new Set(['a','b']),selectedSources:new Map([['a','selected-a'],['b','selected-b']]),items:[{id:'b',sourceHash:'new-b'}],loaded:true};
 const context=vm.createContext({Object,catalogView,demo:false,draft:null,isSuperAdmin:()=>true,toast:()=>{},confirm:()=>true,api:async body=>{calls.push(body);},loadCatalogReview:async()=>{}});
 vm.runInContext(segment('async function catalogReviewAction(','async function openSharedBrowse('),context);
 await vm.runInContext("catalogReviewAction('approve_new')",context);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].expectedSources)),{a:'selected-a',b:'selected-b'});
 assert.equal(catalogView.selected.size,0);assert.equal(catalogView.selectedSources.size,0);
 catalogView.selected.add('missing');
 await assert.rejects(vm.runInContext("catalogReviewAction('unlink')",context),/重新選取/);
 assert.equal(calls.length,1,'missing source hash cannot cause an unchecked review');
});

test('queue lyrics are fetched on demand once per distinct song and stale modal results are discarded',async()=>{
 const song={songId:'a',title:'歌名',artist:'歌手'},calls=[];let finish,holder={innerHTML:''};
 const context=vm.createContext({Map,demo:false,draft:null,h:escape,state:{queue:[{id:'q',items:[song,song]}]},song:()=>song,toast:()=>{},modal:()=>{},$:()=>holder,
  api:body=>{calls.push(body);return new Promise(resolve=>{finish=resolve;});}});
 vm.runInContext(segment('async function queueLyrics(','function editQueue('),context);
 const request=vm.runInContext("queueLyrics('q')",context);assert.equal(calls.length,1);assert.equal(calls[0].op,'catalogLyrics');
 const old=holder;holder={innerHTML:'new dialog'};finish({body:'<script>private lyrics</script>',privateNote:'solo'});await request;
 assert.equal(holder.innerHTML,'new dialog');assert.equal(old.innerHTML,'');
 const next=vm.runInContext("queueLyrics('q')",context);finish({body:'<script>private lyrics</script>',privateNote:'solo'});await next;
 assert.match(holder.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(holder.innerHTML,/<script>/);assert.match(holder.innerHTML,/solo/);
});


test('manager song search uses server IDs after lyric bodies are omitted from ordinary reads',async()=>{
 const calls=[],roomSearch={songs:null,generation:0,cache:new Map()},songs=[{songId:'metadata-only',title:'Different title',artist:'歌手'}];
 const context=vm.createContext({JSON,Date,Set,Map,streamerSlug:'michelle',roomSearch,filters:{q:'共同歌詞內容',tags:[]},state:{revision:5,songs},route:'admin',tab:'songs',demo:false,draft:null,
  isAdmin:()=>true,api:async body=>{calls.push(body);return {songIds:['metadata-only'],total:1,hasMore:false};},song:id=>songs.find(s=>s.songId===id),renderSongResults:()=>{},button:()=>'',songRows:()=>'',matchesSong:()=>false,$:()=>null});
 vm.runInContext(segment('function roomSearchKey(','function songToolbar('),context);
 await vm.runInContext("loadRoomSongSearch('songs','共同歌詞內容',[],0)",context);
 const result=vm.runInContext('bookSearchResult()',context);
 assert.equal(calls[0].op,'songSearchRoom');assert.equal(calls[0].limit,20);
 assert.deepEqual(result.rows.map(row=>row.songId),['metadata-only']);assert.equal(result.loading,false);
});

test('outdated manager search response cannot replace a later query or a different admin page',async()=>{
 const roomSearch={songs:null,generation:0,cache:new Map()};let resolve;
 const context=vm.createContext({JSON,Date,Set,Map,streamerSlug:'papa',roomSearch,filters:{q:'old',tags:[]},state:{revision:1,songs:[]},route:'admin',tab:'songs',demo:false,draft:null,
  isAdmin:()=>true,api:()=>new Promise(done=>{resolve=done;}),song:()=>null,renderSongResults:()=>{throw Error('stale render');},button:()=>'',songRows:()=>'',matchesSong:()=>false,$:()=>null});
 vm.runInContext(segment('function roomSearchKey(','function songToolbar('),context);
 const first=vm.runInContext("loadRoomSongSearch('songs','old',[],0)",context);context.filters.q='new';resolve({songIds:['stale']});await first;
 assert.equal(roomSearch.songs,null);
 const second=vm.runInContext("loadRoomSongSearch('songs','new',[],0)",context);context.tab='players';resolve({songIds:['stale']});await second;
 assert.equal(roomSearch.songs,null);
});

test('catalog templates drive both single and bulk choices while preserving an existing inactive value',async()=>{
 const calls=[],catalogView={templates:null};
 const context=vm.createContext({Set,catalogView,demo:false,draft:null,api:async body=>{calls.push(body);return {languages:[{name:'日語',active:true},{name:'歷史語言',active:false}],performerTypes:[{name:'樂團',active:true}]};}});
 vm.runInContext(segment('async function catalogTemplateChoices(','async function editSong('),context);
 assert.deepEqual([...await vm.runInContext("catalogTemplateChoices('languages','歷史語言',['fallback'])",context)],['日語','歷史語言']);
 assert.deepEqual([...await vm.runInContext("catalogTemplateChoices('performerTypes','',['fallback'])",context)],['樂團']);
 assert.equal(calls.length,1,'small templates are reused across both dropdowns');
 const bulk=segment('async function bulkEditSongs()','function bulkSongData(');
 assert.ok(bulk.includes("catalogTemplateChoices('languages'"));assert.ok(bulk.includes("catalogTemplateChoices('performerTypes'"));
});


test('a background revision change refreshes active search results once without duplicate requests',async()=>{
 const timers=[],calls=[],roomSearch={book:null,generation:0,cache:new Map()},state={revision:1,songs:[]};let finish;
 const context=vm.createContext({JSON,Date,Set,Map,streamerSlug:'papa',roomSearch,filters:{q:'song',tags:[]},state,route:'book',demo:false,draft:null,setTimeout:fn=>timers.push(fn),
  isAdmin:()=>false,api:body=>{calls.push(body);return new Promise(resolve=>{finish=resolve;});},song:()=>null,renderSongResults:()=>{},button:()=>'',songRows:()=>'',matchesSong:()=>false,$:()=>null});
 vm.runInContext(segment('function roomSearchKey(','function songToolbar('),context);
 vm.runInContext('bookSearchResult();bookSearchResult()',context);assert.equal(timers.length,1);
 timers.shift()();await vm.runInContext("loadRoomSongSearch('book','song',[],0)",context);assert.equal(calls.length,1);
 finish({songIds:[],total:0});await new Promise(resolve=>setImmediate(resolve));
 state.revision=2;vm.runInContext('bookSearchResult()',context);assert.equal(timers.length,1);timers.shift()();assert.equal(calls.length,2);
 finish({songIds:[],total:0});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(vm.runInContext('bookSearchResult().loading',context),false);
});


function governanceHarness({president=true}={}){
 const calls=[],view={section:'approved',selected:new Set(),selectedSources:new Map(),selectedVariants:new Map(),templates:{languages:[{id:'zh',name:'華語',active:true}],performerTypes:[]}},browse={items:[],selected:new Set(),selectedRows:new Map()};let captured;
 const context=vm.createContext({Object,Map,Set,Number,String,demo:false,draft:null,catalogView:view,sharedBrowse:browse,sharedLyricHistory:{variantId:null,rows:[]},
  isSuperAdmin:()=>president,api:async body=>{calls.push(body);return {};},refresh:async()=>{},loadCatalogReview:async()=>{},toast:()=>{},h:escape,
  field:(name,_label,value='')=>'<input name="'+name+'" value="'+escape(value)+'">',nativeSelect:(name,_label,options)=>'<select name="'+name+'">'+options.map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</select>',check:()=>'',modal:(title,html,submit)=>{captured={title,html,submit};}});
 vm.runInContext(segment('function catalogVersions(','function editCatalogTemplate('),context);
 return {context,calls,view,browse,get modal(){return captured;},run:code=>vm.runInContext(code,context)};
}

test('shared metadata edit keeps exact concurrency token and leaves unchanged legacy classifications intact',async()=>{
 const u=governanceHarness(),updatedAt='2026-10-04T01:02:03.123456+00:00';
 u.browse.items=[{id:'v1',title:'Song',artist:'Singer',language:'舊分類',updatedAt}];
 await u.run("editCatalogMetadata('v1')");
 await u.modal.submit(new Map([['title','New'],['artist','Singer'],['versionLabel','Live'],['languageId','__keep__'],['performerTypeId','__keep__']]));
 const call=u.calls[0];assert.equal(call.op,'catalogGovernance');assert.equal(call.action,'update_variant');assert.equal(call.expectedVersions.v1,updatedAt);
 assert.equal('languageId' in call.metadata,false);assert.equal('performerTypeId' in call.metadata,false);assert.equal(call.metadata.title,'New');
 const denied=governanceHarness({president:false});await denied.run("editCatalogMetadata('v1')");assert.equal(denied.modal,undefined);assert.equal(denied.calls.length,0);
});

test('version grouping uses selected metadata across pages and an existing family selector',async()=>{
 const u=governanceHarness();u.browse.selected=new Set(['v1','v2']);u.browse.selectedRows=new Map([['v1',{id:'v1',title:'Song',familyId:'f1',updatedAt:'t1'}],['v2',{id:'v2',title:'Other version',familyId:'f2',updatedAt:'t2'}]]);
 await u.run('mergeCatalogFamilies()');assert.match(u.modal.html,/<select name="targetFamilyId">/);assert.doesNotMatch(u.modal.html,/<input/);
 await u.modal.submit(new Map([['targetFamilyId','f1']]));
 assert.equal(u.calls[0].action,'merge_family');assert.deepEqual(JSON.parse(JSON.stringify(u.calls[0].variantIds)),['v1','v2']);assert.deepEqual(JSON.parse(JSON.stringify(u.calls[0].expectedVersions)),{v1:'t1',v2:'t2'});
 assert.equal(u.browse.selected.size,0);
});

test('splitting links rejects mixed variants and sends both candidate and version concurrency tokens',async()=>{
 const u=governanceHarness();u.view.selected=new Set(['c1','c2']);u.view.selectedSources=new Map([['c1','hash1'],['c2','hash2']]);
 u.view.selectedVariants=new Map([['c1',{variantId:'v1',updatedAt:'precise1'}],['c2',{variantId:'v2',updatedAt:'precise2'}]]);
 await assert.rejects(u.run('splitCatalogVariant()'),/同一共同版本/);assert.equal(u.calls.length,0);
 u.view.selectedVariants.set('c2',{variantId:'v1',updatedAt:'precise1'});await u.run('splitCatalogVariant()');await u.modal.submit(new Map([['versionLabel','翻唱版']]));
 assert.equal(u.calls[0].action,'split_variant');assert.deepEqual(JSON.parse(JSON.stringify(u.calls[0].expectedVersions)),{v1:'precise1'});assert.deepEqual(JSON.parse(JSON.stringify(u.calls[0].expectedSources)),{c1:'hash1',c2:'hash2'});
 assert.equal(u.calls[0].metadata.versionLabel,'翻唱版');
});

test('restoring lyrics creates a new revision with escaped preview and preserves historical rows',async()=>{
 const u=governanceHarness();u.context.sharedLyricHistory={variantId:'v1',rows:[{revision:2,body:'<old lyrics>'}]};
 u.run("restoreSharedLyric('v1',2)");assert.match(u.modal.html,/&lt;old lyrics&gt;/);assert.doesNotMatch(u.modal.html,/<old lyrics>/);
 await u.modal.submit(new Map([['active','on']]));
 assert.deepEqual(JSON.parse(JSON.stringify(u.calls[0])),{op:'catalogLyricSave',variantId:'v1',body:'<old lyrics>',active:true,management:true});
 assert.equal(u.calls.length,1);
});


test('language filters use existing room categories in auto mode and chosen templates in custom mode',()=>{
 const roomLanguages={data:{mode:'auto',languages:[{name:'華語',sortOrder:1},{name:'日語',sortOrder:2}]}};
 const context=vm.createContext({Set,String,roomLanguages,state:{songs:[{cat:'華語'},{cat:'華語'},{cat:'客語'}]},filters:{language:'客語'},h:escape});
 vm.runInContext(segment('function visibleLanguages()','function scheduleRoomLanguages()'),context);
 assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('visibleLanguages().map(row=>row.name)',context))),['華語','客語']);
 roomLanguages.data={mode:'custom',languages:[{name:'日語',sortOrder:2}]};assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('visibleLanguages().map(row=>row.name)',context))),['日語']);
 assert.match(vm.runInContext('languageOptionsHtml()',context),/全部語言/);
});

test('language is sent to server before pagination and participates in search cache identity',async()=>{
 const calls=[],roomSearch={book:null,generation:0,cache:new Map()},filters={q:'愛',tags:[],language:'日語'};
 const context=vm.createContext({JSON,Date,Set,Map,streamerSlug:'papa',roomSearch,filters,state:{revision:2,songs:[]},route:'book',demo:false,draft:null,
  isAdmin:()=>false,api:async body=>{calls.push(body);return {songIds:[],total:0};},song:()=>null,renderSongResults:()=>{},button:()=>'',songRows:()=>'',matchesSong:()=>false,$:()=>null});
 vm.runInContext(segment('function roomSearchKey(','function songToolbar('),context);
 await vm.runInContext("loadRoomSongSearch('book','愛',[],1)",context);filters.language='華語';await vm.runInContext("loadRoomSongSearch('book','愛',[],1)",context);
 assert.equal(calls.length,2);assert.equal(calls[0].language,'日語');assert.equal(calls[1].language,'華語');assert.equal(calls[0].offset,20);
});

test('saving room language choices uses the dedicated scoped endpoint without modifying songs',async()=>{
 const calls=[],roomLanguages={};let submit;
 const context=vm.createContext({Set,Promise,Date,roomLanguages,filters:{language:'華語'},roomSearch:{generation:0},demo:false,draft:null,isAdmin:()=>true,
  api:async body=>{calls.push(body);return body.op==='catalogTemplates'?{languages:[{id:'zh',name:'華語',active:true}]}:{mode:'custom',languageIds:['zh'],languages:[{id:'zh',name:'華語'}]};},nativeSelect:()=>'',h:escape,check:()=>'<input name="languageIds">',modal:(_title,_html,fn)=>{submit=fn;},render:()=>{},toast:()=>{}});
 vm.runInContext(segment('async function editLanguageFilters()','function songToolbar('),context);
 await vm.runInContext('editLanguageFilters()',context);await submit({get:name=>name==='mode'?'custom':null,getAll:()=>['zh']});
 assert.deepEqual(JSON.parse(JSON.stringify(calls[2])),{op:'catalogLanguageFilterSave',mode:'custom',languageIds:['zh'],management:true});
 assert.equal(context.filters.language,'');assert.equal(calls.some(row=>row.op==='mutate'),false);
});
