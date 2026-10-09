import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {listenedSongs} from '../src/listening-history.js';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const start=source.indexOf('const listeningView='),end=source.indexOf('function playerManagementPanel()',start);
assert.ok(start>=0&&end>start,'the actual app listening feature is available');
const feature=source.slice(start,end);
const plain=value=>JSON.parse(JSON.stringify(value));
const rows=(offset=0,length=5)=>Array.from({length},(_,i)=>({songId:'S'+(offset+i),title:'Song '+(offset+i),artist:'Artist',listenedCount:43-offset-i,requestable:true}));

function ui({management=false,demo=false,draft=null}={}){
 const calls=[],pending=[],listeners={},nodes={
  '#listening-overview':{innerHTML:'',dataset:{player:'P1',management:String(management)}},
  '#dialog':{addEventListener:(type,listener)=>{listeners[type]=listener;}}
 };
 const state={schemaVersion:3,revision:1,currentStreamer:{id:'papa',spaceId:'space-001'},
  songs:Array.from({length:43},(_,i)=>({songId:'S'+i,title:'Song '+i,artist:'Artist',streamer_id:'papa'})),
  queue:Array.from({length:43},(_,i)=>({id:'Q'+i,playerId:'P1',streamer_id:'papa',songId:'S'+i,status:'completed',items:[{songId:'S'+i,performances:43-i}],creditCost:900,venue:i%2?'radio':'shengma'}))};
 state.queue.push({id:'foreign',playerId:'P1',streamer_id:'other',songId:'S0',status:'completed',items:[{songId:'S0',performances:900}]},
  {id:'other-player',playerId:'P2',streamer_id:'papa',songId:'S0',status:'completed',items:[{songId:'S0',performances:900}]});
 let context;
 context=vm.createContext({state,listenedSongs,streamerSlug:'papa',demo,draft,
  session:{role:'player',accountId:'account-one',playerId:'P1',streamer_id:'papa',spaceId:'space-001'},
  admin:{role:'streamer_admin',accountId:'manager-one',streamer_id:'papa',spaceId:'space-001'},
  $:key=>nodes[key]||null,h:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  blank:value=>'<p>'+value+'</p>',button:(label,act,id='',cls='',extra='')=>'<button data-act="'+act+'" data-id="'+id+'" '+extra+'>'+label+'</button>',
  isAdmin:()=>['streamer_admin','president','admin'].includes(context.admin?.role),
  modal:(title,html)=>{calls.push({modal:title});nodes['#listening-panel']={innerHTML:html};},
  api:payload=>{calls.push(plain(payload));return new Promise((resolve,reject)=>pending.push({resolve,reject,payload:plain(payload)}));}
 });
 vm.runInContext(feature,context,{filename:'isolated-listening-app.js'});
 return {state,nodes,calls,pending,context,run:code=>vm.runInContext(code,context),view:()=>vm.runInContext('listeningView',context),
  apiCalls:()=>calls.filter(call=>call.op),next:()=>pending.shift(),close:()=>listeners.close?.(),
  openPage:(page=0,isManager=management)=>{
   nodes['#listening-panel']={innerHTML:''};
   vm.runInContext('Object.assign(listeningView,{open:true,playerId:"P1",management:'+isManager+',page:'+page+'})',context);
  }};
}

test('overview reads Top 5 once; explicit More and navigation read independent 20-song pages',async()=>{
 const h=ui(),one=h.run('loadListeningOverview()'),two=h.run('loadListeningOverview()');
 assert.equal(one,two);await Promise.resolve();
 assert.deepEqual(h.apiCalls(),[{op:'listeningHistoryPage',playerId:'P1',page:0,limit:5}]);
 h.next().resolve({rows:rows(),total:43});await one;
 assert.match(h.nodes['#listening-overview'].innerHTML,/Song 4/);
 assert.doesNotMatch(h.nodes['#listening-overview'].innerHTML,/Song 5/);
 assert.match(h.nodes['#listening-overview'].innerHTML,/data-act="listeningMore"/);
 for(let i=0;i<6;i++)h.run('renderListeningPanels();listeningOverviewHtml("P1")');
 await h.run('loadListeningOverview()');assert.equal(h.apiCalls().length,1);
 const more=h.run('openListening("P1")');await Promise.resolve();
 assert.deepEqual(h.apiCalls()[1],{op:'listeningHistoryPage',playerId:'P1',page:0,limit:20});
 h.next().resolve({rows:rows(0,20),total:43});await more;
 assert.match(h.nodes['#listening-panel'].innerHTML,/Song 19/);
 assert.doesNotMatch(h.nodes['#listening-panel'].innerHTML,/Song 20/);
 assert.match(h.nodes['#listening-panel'].innerHTML,/共 43 首/);
 h.run('listeningView.page=1');const next=h.run('loadListeningPage("P1",false,1)');await Promise.resolve();
 assert.deepEqual(h.apiCalls()[2],{op:'listeningHistoryPage',playerId:'P1',page:1,limit:20});
 h.next().resolve({rows:rows(20,20),total:43});await next;
 h.run('listeningView.page=0');await h.run('loadListeningPage("P1")');
 assert.equal(h.apiCalls().length,3);assert.equal(h.view().cache.size,3);
 assert.match(h.nodes['#listening-panel'].innerHTML,/Song 0/);
 assert.doesNotMatch(h.nodes['#listening-panel'].innerHTML,/Song 20/);
});

test('cache holds at most four pages and an evicted page reads only when explicitly requested',async()=>{
 const h=ui();h.openPage();
 for(let page=0;page<5;page++){
  h.run('listeningView.page='+page);const load=h.run('loadListeningPage("P1",false,'+page+')');await Promise.resolve();
  h.next().resolve({rows:[{...rows()[0],songId:'page-'+page,title:'Page '+page}],total:120});await load;
  assert.ok(h.view().cache.size<=4);
 }
 assert.equal(h.view().cache.size,4);assert.equal(h.apiCalls().length,5);
 for(let i=0;i<6;i++)h.run('renderListeningPanels();listeningPanelHtml()');
 assert.equal(h.apiCalls().length,5);
 h.run('listeningView.page=0');const reload=h.run('loadListeningPage("P1")');await Promise.resolve();
 assert.equal(h.apiCalls().length,6);h.next().resolve({rows:rows(0,1),total:120});await reload;
 assert.equal(h.view().cache.size,4);
});

test('account, player, room, Space and revision changes before dispatch prevent the old read',async()=>{
 for(const change of ['session.accountId="account-two"','session.playerId="P2"','state.currentStreamer.id="other"','state.currentStreamer.spaceId="space-two"','state.revision++']){
  const h=ui(),load=h.run('loadListeningOverview()');h.run(change);await load;
  assert.equal(h.apiCalls().length,0,change);
  h.run('renderListeningPanels()');assert.doesNotMatch(h.nodes['#listening-overview'].innerHTML,/Song 0/);
 }
 for(const change of ['admin.accountId="manager-two"','admin.streamer_id="other"','admin.role="player"']){
  const h=ui({management:true}),load=h.run('loadListeningOverview()');h.run(change);await load;
  assert.equal(h.apiCalls().length,0,change);
 }
 const absent=ui(),notVisible=absent.run('loadListeningOverview()');delete absent.nodes['#listening-overview'];await notVisible;
 assert.equal(absent.apiCalls().length,0);assert.equal(absent.view().cache.size,0);
 const closed=ui();closed.openPage();const load=closed.run('loadListeningPage("P1")');closed.run('listeningView.open=false');await load;
 assert.equal(closed.apiCalls().length,0);assert.equal(closed.view().cache.size,0);
});

test('late successes and errors cannot replace a fresh account, player, room, Space or revision result',async()=>{
 for(const change of ['session.accountId="account-two"','session.playerId="P2"','state.currentStreamer.id="other"','state.currentStreamer.spaceId="space-two"','state.revision++']){
  for(const outcome of ['success','error']){
   const h=ui(),old=h.run('loadListeningOverview()');await Promise.resolve();const deferred=h.next();
   h.run(change);if(change.includes('playerId'))h.nodes['#listening-overview'].dataset.player='P2';
   h.run('renderListeningPanels()');assert.doesNotMatch(h.nodes['#listening-overview'].innerHTML,/Old private title/);
   const fresh=h.run('loadListeningOverview()');await Promise.resolve();
   h.next().resolve({rows:[{...rows()[0],title:'Current title'}],total:1});await fresh;
   if(outcome==='success')deferred.resolve({rows:[{...rows()[0],title:'Old private title'}],total:1});else deferred.reject(Error('Old private failure'));
   await old;
   assert.equal(h.view().cache.size,1,change+' '+outcome);
   assert.match(h.nodes['#listening-overview'].innerHTML,/Current title/);
   assert.doesNotMatch(h.nodes['#listening-overview'].innerHTML,/Old private|重新讀取/);
   assert.deepEqual(plain([...h.view().cache.values()][0].rows),[{...rows()[0],title:'Current title'}]);
  }
 }
});

test('closing More rejects its late response or error; responses for old pages cannot change the visible page',async()=>{
 for(const outcome of ['success','error']){
  const h=ui(),load=h.run('openListening("P1")');await Promise.resolve();const deferred=h.next();h.close();
  if(outcome==='success')deferred.resolve({rows:rows(),total:5});else deferred.reject(Error('Closed error'));
  await load;assert.equal(h.view().open,false);assert.equal(h.view().cache.size,0);
  assert.doesNotMatch(h.nodes['#listening-panel'].innerHTML,/Song 0|Closed error/);
 }
 const h=ui();h.openPage();const old=h.run('loadListeningPage("P1")');await Promise.resolve();const deferred=h.next();
 h.run('listeningView.page=1');const fresh=h.run('loadListeningPage("P1",false,1)');await Promise.resolve();
 h.next().resolve({rows:rows(20,1),total:43});await fresh;
 deferred.resolve({rows:rows(0,1),total:43});await old;
 assert.match(h.nodes['#listening-panel'].innerHTML,/Song 20/);assert.doesNotMatch(h.nodes['#listening-panel'].innerHTML,/Song 0<\/b>/);
});

test('forced refresh and errors clear old rows; renders never retry and explicit retry is bounded',async()=>{
 const h=ui(),initial=h.run('loadListeningOverview()');await Promise.resolve();h.next().resolve({rows:rows(),total:43});await initial;
 const retry=h.run('loadListeningOverview(true)');assert.doesNotMatch(h.nodes['#listening-overview'].innerHTML,/Song 0/);
 await Promise.resolve();h.next().reject(Error('Read failed'));await retry;
 assert.match(h.nodes['#listening-overview'].innerHTML,/Read failed|重新讀取/);
 assert.doesNotMatch(h.nodes['#listening-overview'].innerHTML,/Song 0/);
 const entry=[...h.view().cache.values()][0];assert.equal(entry.rows.length,0);assert.equal(entry.total,0);
 for(let i=0;i<6;i++)h.run('renderListeningPanels()');await h.run('loadListeningOverview()');assert.equal(h.apiCalls().length,2);
 const explicit=h.run('loadListeningOverview(true)');await Promise.resolve();assert.equal(h.apiCalls().length,3);
 h.next().resolve({rows:rows(0,1),total:1});await explicit;assert.match(h.nodes['#listening-overview'].innerHTML,/Song 0/);
});

test('API rows retain only the five listening fields and malformed responses display no old or private content',async()=>{
 const h=ui(),load=h.run('loadListeningOverview()');await Promise.resolve();
 h.next().resolve({rows:[{...rows()[0],lyrics:'private lyrics',password:'secret',privateNotes:'private note',accountId:'foreign-account',favorite:true,venue:'radio'}],total:1});await load;
 assert.deepEqual(plain([...h.view().cache.values()][0].rows),rows(0,1));
 assert.doesNotMatch(JSON.stringify(plain([...h.view().cache.values()])),/private lyrics|secret|foreign-account|favorite|venue/);
 const invalid=[{rows:rows(0,6),total:6},{rows:rows(),total:4},{rows:rows(),total:1.5},{rows:null,total:0},
  {rows:[rows()[0],rows()[0]],total:2},
  ...[{songId:''},{songId:'S'.repeat(129)},{title:''},{artist:null},{listenedCount:0},{listenedCount:1.5},{requestable:'true'}].map(patch=>({rows:[{...rows()[0],...patch,title:patch.title??'Unsafe private title'}],total:1}))];
 for(const result of invalid){
  const bad=ui(),reading=bad.run('loadListeningOverview()');await Promise.resolve();bad.next().resolve(result);await reading;
  assert.match(bad.nodes['#listening-overview'].innerHTML,/重新讀取/);
  assert.doesNotMatch(bad.nodes['#listening-overview'].innerHTML,/Unsafe private title|Song 0/);
  assert.equal([...bad.view().cache.values()][0].rows.length,0);assert.equal(bad.apiCalls().length,1);
 }
 for(const invalidPage of ['-1','0.5','500001','Number.MAX_SAFE_INTEGER'])assert.throws(()=>h.run('loadListeningPage("P1",false,'+invalidPage+')'),/頁碼/);
 assert.throws(()=>h.run('loadListeningPage("P1",false,0,50)'),/頁碼/);
});

test('saved and live buttons appear only for requestable player rows; managers remain read-only',()=>{
 const h=ui(),data=[{...rows()[0],title:'<Private & title>',artist:'<Artist>'},{...rows()[1],requestable:false}];h.context.data=data;
 const player=h.run('listeningRowsHtml(data)'),manager=h.run('listeningRowsHtml(data,true)');
 assert.equal((player.match(/data-act="request"/g)||[]).length,2);
 assert.match(player,/data-kind="saved"/);assert.match(player,/data-kind="live"/);
 assert.match(player,/目前無法點歌/);assert.match(player,/&lt;Private &amp; title&gt;/);assert.match(player,/&lt;Artist&gt;/);
 assert.doesNotMatch(manager,/data-act="request"|data-kind=/);assert.match(manager,/×43/);
 h.run('session=null');assert.equal(h.run('listeningScope("P1")'),'');
 h.run('session={playerId:"P2"}');assert.equal(h.run('listeningScope("P1")'),'');
 h.run('admin=null');assert.equal(h.run('listeningScope("P1",true)'),'');
});

test('demo and scoped manager draft pages use the original local helper with zero API calls',async()=>{
 for(const options of [{demo:true},{management:true,draft:{roomId:'papa'}}]){
  const h=ui(options),expected=listenedSongs(h.state,'P1');
  await h.run('loadListeningOverview()');assert.equal(h.apiCalls().length,0);
  assert.deepEqual(plain([...h.view().cache.values()][0].rows),expected.slice(0,5));
  assert.match(h.nodes['#listening-overview'].innerHTML,/×43/);
  h.openPage(1,!!options.management);await h.run('loadListeningPage("P1",'+!!options.management+',1)');
  assert.equal(h.apiCalls().length,0);
  const entry=[...h.view().cache.values()].find(row=>row.rows[0]?.songId==='S20');
  assert.deepEqual(plain(entry.rows),expected.slice(20,40));assert.equal(entry.total,43);
  assert.equal(/data-act="request"/.test(h.nodes['#listening-panel'].innerHTML),!options.management);
 }
 assert.doesNotMatch(feature,/setInterval|setTimeout|subscribe\(|favorite|fetch\(|select\(/);
});
