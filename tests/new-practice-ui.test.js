import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {newPracticeSongs,isNewPracticeSong,newPracticeDate} from '../src/new-practice.js';
import {empty,mutate,publicView,scopeState,matchesSong} from '../src/core.js';
import {stateChanges,scopedRoomMutationAction} from '../src/state-patch.js';
import {authorizeManagerOperation} from '../src/access-policy.js';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const feature=source.slice(source.indexOf('const newPracticeView='),source.indexOf('function renderHome(){'));
function ui(){
 const nodes={'#new-practice-panel':{innerHTML:''}},calls=[],pending=[];
 const state={revision:1,currentStreamer:{id:'papa',spaceId:'space-001'},songs:Array.from({length:43},(_,i)=>({songId:'S'+i,title:'Song '+i,artist:'Artist',new:true,_order:i,streamer_id:'papa',plays:i}))};
 const context=vm.createContext({state,newPracticeSongs,isNewPracticeSong,newPracticeDate,matchesSong,streamerSlug:'papa',admin:{role:'streamer_admin',accountId:'account-a',streamer_id:'papa'},session:null,demo:false,draft:null,time:x=>'DATE '+x,
  $:key=>nodes[key]||null,h:x=>String(x??''),blank:x=>'<p>'+x+'</p>',button:(label,act,id='',cls='',extra='')=>'<button data-act="'+act+'" data-id="'+id+'" '+extra+'>'+label+'</button>',
  song:id=>state.songs.find(s=>s.songId===id),songRows:rows=>rows.map(s=>'<b>'+s.title+'</b><button data-act="request">提歌</button><button data-act="request">現點</button>').join(''),isAdmin:()=>!!context.admin,
  api:payload=>{calls.push(payload);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},dispatch:async(type,data)=>{calls.push({type,data});state.revision++;},toast:()=>{}});
 vm.runInContext(feature,context);vm.runInContext('newPracticeView.open=true',context);
 return {state,nodes,calls,pending,context,run:code=>vm.runInContext(code,context),view:()=>vm.runInContext('newPracticeView',context)};
}

test('new-practice pages read only on explicit opening/navigation, coalesce and reuse bounded pages',async()=>{
 const h=ui(),one=h.run('loadNewPractice(0)'),two=h.run('loadNewPractice(0)');assert.equal(one,two);await Promise.resolve();assert.equal(h.calls.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{op:'newPracticePage',management:false,page:0,limit:20});
 h.pending.shift().resolve({rows:h.state.songs.slice(0,20),total:43});await one;
 assert.match(h.nodes['#new-practice-panel'].innerHTML,/Song 19/);assert.doesNotMatch(h.nodes['#new-practice-panel'].innerHTML,/Song 20/);
 await h.run('loadNewPractice(0)');assert.equal(h.calls.length,1);
 const three=h.run('loadNewPractice(1)');await Promise.resolve();h.pending.shift().resolve({rows:h.state.songs.slice(20,40),total:43});await three;
 await h.run('loadNewPractice(0)');assert.equal(h.calls.length,2);assert.equal(h.view().cache.size,2);
});

test('obsolete responses cannot cross page, revision, room or closed modal boundaries',async()=>{
 for(const changed of ['newPracticeView.open=false','state.currentStreamer.id="other"','state.currentStreamer.spaceId="space-002"','state.revision++']){
  const h=ui(),load=h.run('loadNewPractice(0)');await Promise.resolve();h.run(changed);h.pending.shift().resolve({rows:h.state.songs.slice(0,1),total:1});await load;assert.equal(h.view().rows.length,0);
 }
 const h=ui(),old=h.run('loadNewPractice(0)');await Promise.resolve();const fresh=h.run('loadNewPractice(1)');await Promise.resolve();
 h.pending[1].resolve({rows:h.state.songs.slice(20,21),total:43});await fresh;h.pending[0].resolve({rows:h.state.songs.slice(0,1),total:43});await old;assert.equal(h.view().rows[0].songId,'S20');
});

test('local previews paginate original rows and public actions, manager arrows retain cross-page anchors',async()=>{
 const h=ui();h.context.demo=true;await h.run('loadNewPractice(2)');assert.equal(h.view().rows.length,3);assert.match(h.nodes['#new-practice-panel'].innerHTML,/提歌/);assert.match(h.nodes['#new-practice-panel'].innerHTML,/現點/);
 h.run('newPracticeView.management=true');await h.run('loadNewPractice(1)');const html=h.nodes['#new-practice-panel'].innerHTML;
 assert.match(html,/draggable="true"/);assert.match(html,/data-id="S20" data-target="S19" data-position="before"/);assert.match(html,/data-id="S39" data-target="S40" data-position="after"/);assert.equal(h.calls.length,0);
});

test('explicit errors/malformed or foreign responses hide old rows and never retry automatically',async()=>{
 const h=ui(),load=h.run('loadNewPractice()');await Promise.resolve();h.pending.shift().resolve({rows:[{songId:'X',title:'Private',artist:'X',streamer_id:'other'}],total:1});await load;
 assert.match(h.nodes['#new-practice-panel'].innerHTML,/重新讀取/);assert.doesNotMatch(h.nodes['#new-practice-panel'].innerHTML,/Private/);assert.equal(h.calls.length,1);h.run('renderNewPractice()');assert.equal(h.calls.length,1);
});

test('original Core transaction changes only a private rank and preserves scope, flags, lyrics and shared identifiers',()=>{
 let s=mutate(empty(),{type:'streamer',data:{slug:'other',display_name:'Other'}},{role:'admin'});const other=s.streamers.find(r=>r.slug==='other').id;
 s.songs=[{songId:'A',streamer_id:'papa',title:'A',artist:'Artist',new:true,_order:0,lyrics:'custom',privateNotes:'note',catalogVariantId:'variant-A'},
  {songId:'B',streamer_id:'papa',title:'B',artist:'Artist',new:true,_order:1},
  {songId:'C',streamer_id:other,title:'C',artist:'Artist',new:true,_order:2}];
 const action={type:'newPracticeOrder',data:{songId:'B',targetId:'A',position:'before'},streamer:'papa'};
 assert.equal(scopedRoomMutationAction(action),true);authorizeManagerOperation({role:'streamer_admin',streamer_id:'papa'},{op:'mutate',action},'papa');
 const next=mutate(s,action,{role:'admin'},'2026-10-09T00:00:00Z'),patch=stateChanges(s,next,{preserveOrder:true});
 assert.equal(patch.changes.filter(r=>r.kind==='songs').length,1);assert.deepEqual(newPracticeSongs(scopeState(next).songs).map(x=>x.songId),['B','A']);
 assert.deepEqual(next.songs.find(x=>x.songId==='A'),s.songs[0]);assert.deepEqual(next.songs.find(x=>x.songId==='C'),s.songs[2]);assert.equal(next.songs.find(x=>x.songId==='B').new,true);
 assert.throws(()=>mutate(s,{...action,data:{...action.data,targetId:'C'}},{role:'admin'}),/目前主播/);assert.throws(()=>mutate(s,action,{role:'player',playerId:'P'}),/登入管理/);
 assert.throws(()=>authorizeManagerOperation({role:'streamer_admin',streamer_id:other},{op:'mutate',action},'papa'),/自己的主播/);
 const view=publicView(next,null);assert.deepEqual(newPracticeSongs(view.songs).map(x=>x.songId),['B','A']);assert.equal(JSON.stringify(view).includes('custom'),false);
});

test('homepage retains five visible rows and uses a more dialog; desktop drag and mobile arrows share the same mutation',()=>{
 assert.match(source,/songRows\(newPracticeSongs\(state\.songs\)\.filter\(s=>!s\.hidden\)\.slice\(0,5\)\)/);assert.match(source,/button\('查看更多','newPractice'\)/);
 assert.match(feature,/addEventListener\('dragstart'/);assert.match(feature,/addEventListener\('drop'/);assert.match(feature,/dispatch\('newPracticeOrder',\{songId,targetId,position\}\)/);
 assert.doesNotMatch(feature,/setInterval|setTimeout|subscribe\(|select\(\s*['"]\*/);
});

const plain=value=>JSON.parse(JSON.stringify(value));
async function managerPage(h,page=0){h.run('newPracticeView.management=true');const pending=h.run('loadNewPractice('+page+')');await Promise.resolve();h.pending.shift().resolve({rows:h.state.songs.slice(page*20,page*20+20),total:h.state.songs.length});await pending;}

test('add mode consumes exact songIds pages, includes hidden original songs and rejects unknown or malformed IDs without a second read',async()=>{
 const h=ui();h.state.songs[0].new=false;h.state.songs[0].hidden=true;h.run('newPracticeView.management=true;newPracticeView.mode="add";newPracticeView.q="Song"');
 const load=h.run('loadNewPractice(1)');await Promise.resolve();
 assert.deepEqual(plain(h.calls[0]),{op:'songSearchRoom',q:'Song',tags:[],visibility:'all',catalogStatus:'all',limit:20,offset:20,management:true});
 h.pending.shift().resolve({songIds:['S0','S21'],total:43});await load;
 assert.deepEqual(plain(h.view().rows.map(s=>s.songId)),['S0','S21']);assert.match(h.nodes['#new-practice-panel'].innerHTML,/已隱藏/);assert.doesNotMatch(h.nodes['#new-practice-panel'].innerHTML,/data-act="newPracticeMove"|draggable="true"/);
 for(const result of [{ids:['S0'],total:1},{songIds:['missing'],total:1},{songIds:['S0','S0'],total:2},{songIds:['S0'],total:null}]){
  const bad=ui();bad.run('newPracticeView.management=true;newPracticeView.mode="add"');const read=bad.run('loadNewPractice()');await Promise.resolve();bad.pending.shift().resolve(result);await read;
  assert.ok(bad.view().error);assert.equal(bad.view().rows.length,0);assert.equal(bad.calls.length,1);bad.run('renderNewPractice()');assert.equal(bad.calls.length,1);
 }
});

test('demo add mode filters every current-room song, renders sanitized dates and never downloads metadata',async()=>{
 const h=ui();h.context.demo=true;h.state.songs=[
  {songId:'plain',title:'Wanted plain',artist:'Artist',new:false,tags:[],streamer_id:'papa'},
  {songId:'legacy',title:'Wanted legacy',artist:'Artist',new:true,tags:[],streamer_id:'papa'},
  {songId:'tag',title:'Wanted tag',artist:'Artist',new:false,tags:['新練'],newPracticeAt:{secret:'PRIVATE_DATE'},streamer_id:'papa'},
  {songId:'dated',title:'Wanted dated',artist:'Artist',new:true,tags:['新練'],newPracticeAt:'2026-10-10T03:00:00.000Z',streamer_id:'papa'},
  {songId:'unmatched',title:'Unmatched',artist:'Artist',new:false,streamer_id:'papa'},
  {songId:'foreign',title:'Wanted foreign',artist:'Private',new:false,streamer_id:'other'}
 ];
 h.run('newPracticeView.management=true;newPracticeView.mode="add";newPracticeView.q="Wanted"');await h.run('loadNewPractice()');
 assert.deepEqual(plain(h.view().rows.map(s=>s.songId)),['plain','legacy','tag','dated']);assert.equal(h.calls.length,0);
 const html=h.nodes['#new-practice-panel'].innerHTML;assert.match(html,/尚未設為新練/);assert.match(html,/新練日期尚未記錄/);assert.match(html,/DATE 2026-10-10T03:00:00.000Z/);assert.doesNotMatch(html,/PRIVATE_DATE|Wanted foreign|data-act="newPracticeMove"/);
});

test('returning to a cached page cancels another pending page before it can replace the visible rows',async()=>{
 const h=ui();await managerPage(h);
 const old=h.run('loadNewPractice(1)');await Promise.resolve();assert.equal(h.calls.length,2);
 await h.run('loadNewPractice(0)');assert.equal(h.view().pending,null);assert.equal(h.view().page,0);
 h.pending.shift().resolve({rows:h.state.songs.slice(20,40),total:43});await old;
 assert.equal(h.view().rows[0].songId,'S0');assert.equal(h.view().page,0);assert.equal(h.calls.length,2);
});

test('selected membership rows survive bounded page searches but never exceed 100 or cross a revision or identity',async()=>{
 const h=ui();h.context.demo=true;h.state.songs=Array.from({length:120},(_,i)=>({songId:'S'+i,title:'Song '+i,artist:'Artist',new:false,tags:[],streamer_id:'papa'}));
 h.run('newPracticeView.management=true;newPracticeView.mode="add"');await h.run('loadNewPractice(0)');h.run('selectNewPracticePage()');
 await h.run('loadNewPractice(1)');h.run('selectNewPracticePage()');assert.equal(h.view().selected.size,40);
 h.run('newPracticeView.q="Song 3"');await h.run('loadNewPractice(0)');assert.equal(h.view().selected.size,40);
 h.run('newPracticeView.q=""');await h.run('loadNewPractice(5)');h.view().selected=new Set(Array.from({length:100},(_,i)=>'S'+i));
 h.run('selectNewPracticePage();selectNewPractice("S100",true)');assert.equal(h.view().selected.size,100);
 for(const change of ['state.revision++','admin.accountId="account-b"','admin.role="super_admin"','admin.streamer_id="other"','state.currentStreamer.spaceId="space-002"']){
  h.view().selected.add('S1');h.run(change);await h.run('loadNewPractice(0)');assert.equal(h.view().selected.size,0,change);
 }
 assert.equal(h.calls.length,0);
});

test('manager binding changes or close before dispatch send no read, and stale selections send no mutation',async()=>{
 for(const change of ['newPracticeView.open=false','admin.accountId="account-b"','admin.role="super_admin"','admin.streamer_id="other"','admin=null','state.currentStreamer.spaceId="space-002"','state.revision++']){
  const h=ui();h.run('newPracticeView.management=true');const read=h.run('loadNewPractice()');h.run(change);await read;assert.equal(h.calls.length,0,change);
 }
 for(const change of ['newPracticeView.open=false','admin.accountId="account-b"','admin.role="super_admin"','admin.streamer_id="other"','admin=null','state.currentStreamer.spaceId="space-002"','state.revision++','newPracticeView.loading=true','newPracticeView.error="stale"']){
  const h=ui();await managerPage(h);h.view().selected.add('S0');h.run(change);
  await assert.rejects(h.run('setSelectedNewPractice(false)'),/異動|讀取/);assert.equal(h.calls.length,1,change);
 }
});

test('a selected batch writes once and reloads one bounded page; closing during a dispatched write never reloads',async()=>{
 const h=ui();await managerPage(h);h.run('selectNewPractice("S0",true);selectNewPractice("S1",true)');
 const write=h.run('setSelectedNewPractice(false)');await new Promise(setImmediate);
 assert.deepEqual(plain(h.calls[1]),{type:'newPracticeSet',data:{songIds:['S0','S1'],enabled:false}});assert.equal(h.calls.length,3);assert.deepEqual(plain(h.calls[2]),{op:'newPracticePage',management:true,page:0,limit:20});
 h.pending.shift().resolve({rows:h.state.songs.slice(2,22),total:41});await write;assert.equal(h.view().selected.size,0);assert.equal(h.calls.length,3);
 const closed=ui();await managerPage(closed);closed.view().selected.add('S0');let finish;
 closed.context.dispatch=(type,data)=>{closed.calls.push({type,data});return new Promise(resolve=>finish=resolve);};
 const saving=closed.run('setSelectedNewPractice(false)');closed.run('newPracticeView.open=false');finish();await saving;assert.equal(closed.calls.length,2);assert.equal(closed.pending.length,0);
});

test('bulk undo snapshots retain only an optional sanitized known new-practice date and restore it without fabricating legacy history',()=>{
 const helper=source.split(/\r?\n/).find(line=>line.startsWith('const songEditFields='));const context=vm.createContext({newPracticeDate});vm.runInContext(helper,context);
 const capture=s=>{context.row=s;return vm.runInContext('songEditFields(row)',context);};
 assert.equal(Object.hasOwn(capture({new:true,tags:[]}), 'newPracticeAt'),false);
 assert.equal(capture({new:true,newPracticeAt:{secret:'PRIVATE'}}).newPracticeAt,null);
 const time='2026-09-01T00:00:00.000Z',now='2026-10-10T03:00:00.000Z';
 let s=empty();s.songs=[{songId:'A',title:'A',artist:'Artist',cat:'華語',artistType:'其他',murmur:'',creditCost:1,new:true,tags:['新練'],newPracticeAt:time}];
 const before={songId:'A',...plain(capture(s.songs[0]))};s=mutate(s,{type:'songsBulk',data:{songIds:['A'],new:false}},{role:'admin'},now);
 const after={songId:'A',...plain(capture(s.songs[0]))};s=mutate(s,{type:'restoreSongEdits',data:{before:[before],after:[after]}},{role:'admin'},now);
 assert.equal(s.songs[0].newPracticeAt,time);assert.equal(s.songs[0].new,true);
});
