import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const lines=source.split(/\r?\n/);
function declaration(name){
 const start=lines.findIndex(line=>line.startsWith('function '+name+'(')||line.startsWith('async function '+name+'('));
 assert.ok(start>=0,'actual UI declaration exists: '+name);
 if(lines[start].endsWith('}'))return lines[start];
 const end=lines.findIndex((line,index)=>index>start&&line==='}');
 assert.ok(end>start,'declaration closes: '+name);return lines.slice(start,end+1).join('\n');
}
function load(context,names){vm.runInContext(names.map(declaration).join('\n'),context);}
const json=value=>JSON.parse(JSON.stringify(value));
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,act,id='',classes='',extra='')=>'<button data-act="'+act+'" data-id="'+h(id)+'" class="'+classes+'" '+extra+'>'+label+'</button>';
const run=(ctx,code)=>vm.runInContext(code,ctx);
function membershipView(extra={}){return {membership:'missing',membershipViews:new Map(),generation:0,page:3,selected:new Set(),selectedRows:new Map(),items:[],total:81,hasMore:true,loaded:true,loading:false,...extra};}

test('version facets include actual DJ labels and display each selected original or DJ option once',()=>{
 const ctx=vm.createContext({h});load(ctx,['versionOptions']);
 ctx.facets={versionKinds:['original','dj','cover','live'],versionLabels:['原版','DJ版','DJ加速版','DJ加速版']};
 for(const kind of ['original','dj']){
  ctx.view={versionKind:kind,versionLabel:''};const html=run(ctx,'versionOptions(facets,view)');
  assert.equal((html.match(/>原版<\/option>/g)||[]).length,1);
  assert.equal((html.match(/>DJ版<\/option>/g)||[]).length,1);
  assert.equal((html.match(/>DJ加速版<\/option>/g)||[]).length,1);
  assert.match(html,new RegExp('value="kind:'+kind+'" selected'));
 }
 ctx.view={versionKind:'',versionLabel:'DJ加速版'};assert.match(run(ctx,'versionOptions(facets,view)'),/value="label:DJ加速版" selected/);
});

test('membership tabs keep independent page and typed selection maps for both catalog controllers',()=>{
 const ctx=vm.createContext({});load(ctx,['switchCatalogMembership']);
 for(const relation of [false,true]){
  const view=membershipView(relation?{selectedSources:new Map(),selectedVariants:new Map(),versionSelected:new Set(),versionRows:new Map()}:{});
  view.selected.add('missing-1');view.selectedRows.set('missing-1',{id:'missing-1'});
  if(relation){view.versionSelected.add('v-missing');view.versionRows.set('v-missing',{id:'v-missing'});view.selectedSources.set('missing-1','hash');}
  ctx.view=view;run(ctx,"switchCatalogMembership(view,'added')");
  assert.equal(view.page,0);assert.equal(view.selected.size,0);assert.equal(typeof view.selectedRows.set,'function');
  if(relation){assert.equal(typeof view.versionRows.set,'function');assert.equal(typeof view.selectedSources.get,'function');}
  view.page=6;view.selected.add('added-1');view.selectedRows.set('added-1',{id:'added-1'});
  run(ctx,"switchCatalogMembership(view,'missing')");assert.equal(view.page,3);assert.deepEqual([...view.selected],['missing-1']);assert.equal(view.selectedRows.get('missing-1').id,'missing-1');
  if(relation){assert.deepEqual([...view.versionSelected],['v-missing']);assert.equal(view.versionRows.get('v-missing').id,'v-missing');assert.equal(view.selectedSources.get('missing-1'),'hash');}
  run(ctx,"switchCatalogMembership(view,'added')");assert.equal(view.page,6);assert.deepEqual([...view.selected],['added-1']);assert.equal(view.total,0);assert.equal(view.items.length,0);assert.equal(view.loaded,false);
  const generation=view.generation;run(ctx,"switchCatalogMembership(view,'other');switchCatalogMembership(view,'added')");assert.equal(view.generation,generation);
 }
});

test('shared membership search sends one server-filtered page and ignores a late response from another tab',async()=>{
 const calls=[],pending=[],sharedBrowse=membershipView({q:'愛',sort:'newest',versionKind:'',versionLabel:'DJ版',language:'華語',performerType:'女歌手',searchMode:'metadata',pageSize:20,error:''});
 const ctx=vm.createContext({sharedBrowse,demo:false,draft:null,$:()=>({}),renderSharedBrowse:()=>{},api:body=>{calls.push(json(body));return new Promise(resolve=>pending.push(resolve));}});
 load(ctx,['loadSharedBrowse','switchCatalogMembership']);
 const old=run(ctx,'loadSharedBrowse(3)');run(ctx,"switchCatalogMembership(sharedBrowse,'added')");const current=run(ctx,'loadSharedBrowse(0)');
 assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>[c.membership,c.offset,c.limit]),[['missing',60,20],['added',0,20]]);
 assert.equal(calls[1].versionLabel,'DJ版');assert.equal(calls[1].sort,'newest');assert.equal(calls[1].management,true);
 pending[1]({items:[{id:'canonical-added',alreadyAdded:true}],total:61,hasMore:true,filters:{versionLabels:['DJ版']}});await current;
 pending[0]({items:[{id:'stale-missing'}],total:999});await old;
 assert.equal(sharedBrowse.items[0].id,'canonical-added');assert.equal(sharedBrowse.total,61);assert.equal(sharedBrowse.page,0);
});

test('changing shared browse text clears saved membership selections and pages before the debounced read',()=>{
 const timers=[],sharedBrowse=membershipView({q:'old'});sharedBrowse.selected.add('old');sharedBrowse.selectedRows.set('old',{id:'old'});sharedBrowse.membershipViews.set('added',{page:8,selected:new Set(['stale'])});
 const ctx=vm.createContext({sharedBrowse,clearTimeout:()=>{},setTimeout:fn=>timers.push(fn),loadSharedBrowse:()=>{},catalogBrowseTimer:null});
 vm.runInContext(lines.find(line=>line.startsWith('let catalogBrowseTimer;')).replace('let catalogBrowseTimer;',''),ctx);
 ctx.input={value:'new'};run(ctx,'scheduleSharedBrowse(input)');assert.equal(sharedBrowse.page,0);assert.equal(sharedBrowse.membershipViews.size,0);assert.equal(sharedBrowse.selected.size,0);assert.equal(sharedBrowse.selectedRows.size,0);assert.equal(timers.length,1);
});

test('shared browse language, performer and search-mode changes clear saved tab selections',()=>{
 for(const id of ['catalog-browse-mode','catalog-browse-language','catalog-browse-performer']){
  const sharedBrowse=membershipView();sharedBrowse.selected.add('old');sharedBrowse.selectedRows.set('old',{id:'old'});sharedBrowse.membershipViews.set('added',{page:8});let callback,reads=0;
  const ctx=vm.createContext({sharedBrowse,catalogBrowseTimer:null,clearTimeout:()=>{},loadSharedBrowse:async()=>reads++,toast:()=>{},document:{addEventListener:(_type,fn)=>callback=fn}});
  vm.runInContext(lines.find(line=>line.startsWith("document.addEventListener('change',e=>{const key=({'catalog-browse-mode'")),ctx);callback({target:{id,value:'new'}});
  assert.equal(sharedBrowse.page,0);assert.equal(sharedBrowse.membershipViews.size,0);assert.equal(sharedBrowse.selected.size,0);assert.equal(sharedBrowse.selectedRows.size,0);assert.equal(reads,1);
 }
});

function autocompleteHarness(){
 const calls=[],timers=[],closeHandlers=[],fields=new Map();let responder=null,refreshes=0,invalidations=0,closed=0;
 const node=extra=>({value:'',textContent:'',innerHTML:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},focus(){this.focused=true;},...extra});
 const label={replaceWith:()=>{}},input=node({closest:()=>label}),box=node(),submit=node();
 for(const key of ['title','artist','cat','artistType','version','catalogCandidateFamily'])fields.set(key,key==='title'?input:node());
 const form={isConnected:true,querySelector:selector=>selector==='[type=submit]'?submit:fields.get(selector.slice(6,-1))};
 const dialog={addEventListener:(type,fn)=>{if(type==='close')closeHandlers.push(fn);},close(){closed++;form.isConnected=false;for(const fn of closeHandlers)fn();}};
 const ctx=vm.createContext({h,button,admin:{accountId:'admin1',role:'streamer_admin',streamer_id:'room1',spaceId:'space1'},state:{currentStreamer:{id:'room1',spaceId:'space1'},songs:[]},streamerSlug:'room1',demo:false,draft:null,proxyDraft:null,
  $:selector=>selector==='#modal-form'?form:selector==='#song-catalog-candidates'?box:dialog,document:{createElement:()=>({append:()=>{},insertAdjacentHTML:()=>{}})},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},toast:()=>{},invalidateCatalogTabs:()=>invalidations++,refresh:async()=>refreshes++,
  api:async body=>{calls.push(json(body));return responder?responder(body):{items:[{variantId:body.membership+'-'+body.offset,familyId:'f1',title:'共同歌',artist:'歌手',language:'華語',performerType:'男歌手',versionLabel:'DJ版',alreadyAdded:body.membership==='added'}],total:35};},
 });
 load(ctx,['installSongAutocomplete']);run(ctx,'installSongAutocomplete()');
 const click=async(dataset,disabled=false)=>box.onclick({target:{closest:()=>({dataset,disabled,hasAttribute:key=>Object.hasOwn(dataset,key.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase()))})}});
 return {ctx,input,box,fields,form,submit,calls,timers,dialog,click,setResponder:fn=>responder=fn,get refreshes(){return refreshes;},get invalidations(){return invalidations;},get closed(){return closed;},type:async(q,{composing=false}={})=>{input.value=q;input.handlers.input({isComposing:composing});},flush:async()=>{const task=timers.pop();timers.length=0;if(task)await task();}};
}

test('song autocomplete has independent membership pages/counts and bounded server filtering',async()=>{
 const u=autocompleteHarness();await u.type('共同歌');await u.flush();assert.deepEqual(u.calls[0],{op:'catalogSearch',q:'共同歌',membership:'missing',limit:10,offset:0,management:true});assert.match(u.box.innerHTML,/尚未加入/);assert.match(u.box.innerHTML,/已在我的歌本/);assert.match(u.box.innerHTML,/共 35 首/);
 await u.click({songCatalogPage:'2'});assert.equal(u.calls[1].offset,20);assert.match(u.box.innerHTML,/第 3 頁/);
 await u.click({songCatalogMembership:'added'});assert.equal(u.calls[2].membership,'added');assert.equal(u.calls[2].offset,0);assert.match(u.box.innerHTML,/data-add-variant="added-0" disabled/);
 await u.box.handlers.change({target:{hasAttribute:()=>true,value:'2'}});await new Promise(resolve=>setImmediate(resolve));assert.equal(u.calls[3].offset,10);
 let prevented=false,stopped=false;u.box.handlers.keydown({key:'Enter',isComposing:false,target:{hasAttribute:()=>true,value:'3'},preventDefault:()=>prevented=true,stopPropagation:()=>stopped=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(u.calls[4].offset,20);
 await u.click({songCatalogMembership:'missing'});assert.equal(u.calls.length,5,'returning to a loaded tab retains that page');assert.match(u.box.innerHTML,/第 3 頁/);
 await u.click({newVersion:'missing-20'});assert.equal(u.fields.get('catalogCandidateFamily').value,'f1');assert.equal(u.fields.get('artist').value,'歌手');assert.equal(u.fields.get('version').focused,true);assert.match(u.submit.textContent,/同一首、不同版本/);
});

test('song autocomplete waits for IME completion and discards older searches and changed authority',async()=>{
 const u=autocompleteHarness();await u.type('共同',{composing:true});assert.equal(u.timers.length,0);u.input.handlers.compositionend({});await u.flush();assert.equal(u.calls.length,1);
 let finish;u.setResponder(()=>new Promise(resolve=>finish=resolve));await u.type('舊查詢');const old=u.flush();await u.type('新查詢');finish({items:[{variantId:'private-old',title:'old'}],total:1});await old;assert.doesNotMatch(u.box.innerHTML,/private-old|>old</);
 const fresh=u.flush();u.ctx.admin={accountId:'admin2',role:'streamer_admin',streamer_id:'room1',spaceId:'space1'};finish({items:[{variantId:'private-new',title:'private'}],total:1});await fresh;assert.doesNotMatch(u.box.innerHTML,/private-new|>private</);
 await u.click({addVariant:'private-new'});assert.equal(u.calls.some(c=>c.op==='catalogBatchAdd'),false);
});

test('autocomplete preserves explicit add flow and ignores a late add response after room changes',async()=>{
 for(const changed of [false,true]){
  const u=autocompleteHarness();await u.type('共同歌');await u.flush();let finish;
  u.setResponder(body=>body.op==='catalogBatchAdd'?new Promise(resolve=>finish=resolve):{items:[],total:0});const pending=u.click({addVariant:'missing-0'});
  assert.deepEqual(u.calls.at(-1),{op:'catalogBatchAdd',variantIds:['missing-0'],lyricsMode:'shared',management:true});
  if(changed)u.ctx.state.currentStreamer={id:'room2',spaceId:'space1'};finish({added:1});await pending;
  assert.equal(u.closed,changed?0:1);assert.equal(u.refreshes,changed?0:1);assert.equal(u.invalidations,changed?0:1);
 }
});

function favoritesHarness(){
 const calls=[],handlers=[],view={page:0,rows:[{songId:'s1',title:'第一首',artist:'甲',plays:3}],total:40,loading:false,error:null,flags:{s1:true},pendingSongIds:[]},panel={innerHTML:''};let modal;
 const ctx=vm.createContext({h,button,state:{revision:7,currentStreamer:{id:'r1',spaceId:'space1'},songs:[],crowns:[]},session:{accountId:'a1',playerId:'p1'},route:'center',subtab:'favorites',demo:false,streamerSlug:'room1',
  selectedFavorites:new Set(),selectedFavoriteRows:new Map(),favoriteSelectionIdentity:'',songFavorites:{state:()=>view,setBatch:async(ids,value)=>{calls.push({ids:[...ids],value});},load:async()=>{}},song:()=>null,crownFor:()=>null,clock:()=>'',plays:s=>s.plays||0,blank:s=>'<p>'+h(s)+'</p>',say:()=>'',hostName:()=>'',check:()=>'',confirm:()=>true,toast:()=>{},refresh:async()=>{},
  api:async b=>{calls.push(json(b));return {results:[{ok:true,count:b.jobs[0].rows.length}]};},modal:(title,html,submit)=>modal={title,html,submit},$:()=>panel,document:{addEventListener:(type,fn)=>{if(type==='change')handlers.push(fn);}},
 });
 load(ctx,['favoritesIdentity','favoriteButton','songRows','favoritesPanelHtml','requestSelectedFavorites','favoritePairOptions','removeSelectedFavorites']);
 // This is the real selection event handler, without evaluating application boot.
 const start=source.indexOf("document.addEventListener('change',async e=>{try{\n if(e.target.dataset.listSort)");
 const end=source.indexOf("document.addEventListener('keydown',e=>{if(e.key!=='Enter'",start);
 assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),ctx);
 run(ctx,'favoritesPanelHtml()');
 return {ctx,view,calls,panel,run:code=>run(ctx,code),get modal(){return modal;},select:async(id,checked=true)=>{for(const fn of handlers)await fn({target:{dataset:{favoriteSelect:id},checked}});}};
}

test('favorite hearts occupy the gutter and selections retain canonical metadata across pages',async()=>{
 const u=favoritesHarness();await u.select('s1');u.view.page=1;u.view.rows=[{songId:'s2',title:'第二首',artist:'乙',plays:2}];await u.select('s2');
 const html=u.run('favoritesPanelHtml()'),gutter=html.match(/<span class="song-gutter">([\s\S]*?)<div class="info">/)[1],actions=html.match(/<div class="actions">([\s\S]*?)<\/div>/)[1];
 assert.match(gutter,/data-favorite-select="s2"/);assert.match(gutter,/data-act="favoriteSet"/);assert.doesNotMatch(actions,/favoriteSet/);assert.match(html,/已選 2 首/);
 await u.run("requestSelectedFavorites('saved')");assert.match(u.modal.html,/第一首/);assert.match(u.modal.html,/第二首/);
 await u.modal.submit(new Map());assert.equal(u.calls.length,1);assert.deepEqual(u.calls[0].jobs[0].rows.map(r=>r.songId),['s1','s2']);assert.equal(u.ctx.selectedFavorites.size,0);
});

test('favorite selections clear when account or room changes and cannot submit an old modal before a render',async()=>{
 const u=favoritesHarness();await u.select('s1');await u.run("requestSelectedFavorites('saved')");u.ctx.state.currentStreamer={id:'r2',spaceId:'space1'};u.ctx.streamerSlug='room2';
 await assert.rejects(u.modal.submit(new Map()),/變更|重新選取/);assert.equal(u.calls.length,0);
 u.run('favoritesPanelHtml()');assert.equal(u.ctx.selectedFavorites.size,0);assert.equal(u.ctx.selectedFavoriteRows.size,0);
 u.view.rows=[{songId:'s2',title:'第二首',artist:'乙'}];await u.select('s2');u.ctx.session={accountId:'a2',playerId:'p2'};u.run('favoritesPanelHtml()');assert.equal(u.ctx.selectedFavorites.size,0);
});

test('late favorite request and removal responses preserve selections belonging to a new identity',async()=>{
 for(const remove of [false,true]){
  const u=favoritesHarness();await u.select('s1');let finish;
  if(remove)u.ctx.songFavorites.setBatch=()=>new Promise(resolve=>finish=resolve);
  else{u.ctx.api=()=>new Promise(resolve=>finish=resolve);await u.run("requestSelectedFavorites('saved')");}
  const pending=remove?u.run('removeSelectedFavorites()'):u.modal.submit(new Map());
  u.ctx.session={accountId:'a2',playerId:'p2'};u.view.rows=[{songId:'fresh',title:'新身分收藏',artist:'歌手'}];u.run('favoritesPanelHtml()');await u.select('fresh');
  finish(remove?{}:{results:[{ok:true,count:1}]});await pending;
  assert.deepEqual([...u.ctx.selectedFavorites],['fresh']);assert.equal(u.ctx.selectedFavoriteRows.get('fresh').title,'新身分收藏');
 }
});

function crossHarness(){
 const calls=[],controls=[{disabled:false},{disabled:false}],error={textContent:''},results={innerHTML:''},rowNodes=new Map();let modal,readResponder=null,writeResponder=null,refreshes=0;
 const form={gift:false,querySelector:selector=>selector==='#cross-error'?error:selector.startsWith('[data-cross-pair=')?{value:''}:null,querySelectorAll:()=>controls};
 class FormData{constructor(form){this.form=form;}has(name){return name==='gift'&&this.form.gift;}}
 const crossView={key:'',generation:0,page:0,rows:[],total:0,loading:false,error:'',open:false,selected:new Map(),drafts:new Map(),submitted:false};
 const ctx=vm.createContext({h,button,FormData,crossView,session:{accountId:'a1',playerId:'p1'},state:{revision:5,currentStreamer:{id:'room-current',spaceId:'space1'}},demo:false,draft:null,blank:x=>'<p>'+h(x)+'</p>',check:()=>'',toast:()=>{},
  modal:(title,html)=>{modal={title,html};for(const id of crossView.drafts.keys()){const fields=new Map(['data-cross-query','data-cross-tags','data-cross-song','data-cross-results','data-cross-self'].map(k=>[k,{value:'愛',innerHTML:'',checked:false}]));rowNodes.set(id,{dataset:{crossRow:id},querySelector:selector=>fields.get(selector.slice(1,-1)),querySelectorAll:()=>[]});}},
  $:selector=>selector==='#cross-request-form'?form:selector==='#cross-results'?results:selector==='#dialog'?{open:true}:null,document:{querySelectorAll:()=>[...rowNodes.values()]},refresh:async()=>{refreshes++;},
  api:async body=>{calls.push(json(body));if(body.op==='requestsBatch')return writeResponder?writeResponder(body):{results:body.jobs.map(j=>({streamer:j.streamer,ok:true,count:j.rows.length}))};if(body.op==='playerStreamerSummary')return readResponder?readResponder(body):{rows:[],total:0};return readResponder?readResponder(body):{rows:[{songId:body.streamer+'-song',title:'歌',artist:'演唱者',tags:['甜歌'],creditCost:1}],total:1,tagOptions:['甜歌']};},
 });
 load(ctx,['crossIdentity','crossSummaryHtml','renderCrossStreamers','centerWaitingHtml','loadCrossSummary','openCrossRequest','crossRowElement','renderCrossSong','loadCrossSongs','chooseCrossSong','crossPairOptions']);
 vm.runInContext("const crossStatusName={idle:'空閒中',preparing:'準備中',busy:'忙碌中',paused:'暫停點歌'};",ctx);
 return {ctx,crossView,calls,error,results,form,controls,rowNodes,run:code=>run(ctx,code),setRead:fn=>readResponder=fn,setWrite:fn=>writeResponder=fn,get refreshes(){return refreshes;},get modal(){return modal;}};
}
const room=(id,status='idle')=>({streamerId:id,slug:id+'-slug',name:'主播 '+id,status,storedCredits:8,waitingCount:0});
function selectRooms(u,rows){for(const r of rows)u.crossView.selected.set(r.streamerId,r);}

test('paused cross-streamers are disabled and refreshed server status removes an old selection',async()=>{
 const u=crossHarness(),a=room('a'),b=room('b','paused');u.crossView.rows=[a,b];u.crossView.selected.set('a',a);
 assert.match(u.run('crossSummaryHtml()'),/data-cross-room="b"[^>]*disabled/);
 u.setRead(async()=>({rows:[{...a,status:'paused'},room('b')],total:2}));await u.run('loadCrossSummary(0,true)');assert.equal(u.crossView.selected.has('a'),false);
 selectRooms(u,[{...a,status:'paused'}]);await assert.rejects(u.run("openCrossRequest('saved')"),/暫停點歌/);assert.equal(u.crossView.drafts.size,0);
});

test('cross-summary responses are bound to player and Space identity',async()=>{
 const u=crossHarness();let finish;u.setRead(()=>new Promise(resolve=>finish=resolve));selectRooms(u,[room('old')]);
 const pending=u.run('loadCrossSummary(0,true)');u.ctx.session={accountId:'a2',playerId:'p2'};finish({rows:[room('private-old')],total:1});await pending;assert.equal(u.crossView.rows.length,0);
 const next=u.run('loadCrossSummary(0,true)');assert.equal(u.crossView.selected.size,0);finish({rows:[room('fresh')],total:1});await next;assert.equal(u.crossView.rows[0].streamerId,'fresh');
 u.ctx.state.currentStreamer.spaceId='space2';const spaceRead=u.run('loadCrossSummary(0,true)');assert.equal(u.crossView.rows.length,0);finish({rows:[],total:0});await spaceRead;assert.equal(u.crossView.total,0);
});

test('cross-song searches use bounded server pages and dice retains selected tags',async()=>{
 const u=crossHarness();selectRooms(u,[room('a')]);await u.run("openCrossRequest('saved')");const d=u.crossView.drafts.get('a');d.tags=['甜歌','新練'];
 await u.run("loadCrossSongs('a',false,2)");const search=u.calls.at(-1);assert.equal(search.op,'playerSongChoices');assert.equal(search.page,2);assert.equal(search.limit,20);assert.equal(search.streamer,'a-slug');assert.deepEqual(search.tags,['甜歌','新練']);
 await u.run("loadCrossSongs('a',true,0)");const dice=u.calls.at(-1);assert.equal(dice.random,true);assert.equal(dice.q,'');assert.equal(dice.limit,1);assert.deepEqual(dice.tags,['甜歌','新練']);assert.equal(d.chosen.songId,'a-slug-song');
 let finish;u.setRead(()=>new Promise(resolve=>finish=resolve));const old=u.run("loadCrossSongs('a',false,0)");u.ctx.session={accountId:'other',playerId:'other'};finish({rows:[{songId:'private-old',title:'old',artist:'old'}],total:1});await old;assert.equal(d.chosen.songId,'a-slug-song');assert.equal(d.rows.some(s=>s.songId==='private-old'),false);
});

test('cross submission validates every row before one whole write and never retries an uncertain result',async()=>{
 const u=crossHarness();selectRooms(u,[room('a'),room('b')]);await u.run("openCrossRequest('saved')");
 await u.form.onsubmit({preventDefault(){}});assert.match(u.error.textContent,/請為/);assert.equal(u.calls.some(c=>c.op==='requestsBatch'),false);assert.equal(u.crossView.submitted,false);
 for(const id of ['a','b'])u.run("chooseCrossSong('"+id+"','"+id+"-slug-song')");
 u.setWrite(async()=>{throw Error('Network interrupted');});await u.form.onsubmit({preventDefault(){}});await u.form.onsubmit({preventDefault(){}});
 const writes=u.calls.filter(c=>c.op==='requestsBatch');assert.equal(writes.length,1);assert.deepEqual(writes[0].jobs.map(j=>[j.streamer,j.rows.length]),[['a-slug',1],['b-slug',1]]);assert.equal(writes[0].revision,5);assert.equal(u.crossView.submitted,true);assert.equal(u.controls.every(c=>c.disabled),true);assert.match(u.error.textContent,/勿重複送出/);assert.equal(u.refreshes,0);
});

test('cross live submission requires gift confirmation and ignores a success arriving after an identity switch',async()=>{
 const u=crossHarness();selectRooms(u,[room('a')]);await u.run("openCrossRequest('live')");u.run("chooseCrossSong('a','a-slug-song')");await u.form.onsubmit({preventDefault(){}});assert.match(u.error.textContent,/禮物/);assert.equal(u.calls.some(c=>c.op==='requestsBatch'),false);
 u.form.gift=true;let finish;u.setWrite(()=>new Promise(resolve=>finish=resolve));const pending=u.form.onsubmit({preventDefault(){}});u.ctx.state.currentStreamer.spaceId='space2';finish({results:[{streamer:'a-slug',ok:true,count:1}]});await pending;
 assert.equal(u.calls.filter(c=>c.op==='requestsBatch').length,1);assert.equal(u.results.innerHTML,'');assert.equal(u.refreshes,0);
});
