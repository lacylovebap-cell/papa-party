import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {newPracticeSongs} from '../src/new-practice.js';
import {empty,mutate,publicView,scopeState} from '../src/core.js';
import {stateChanges,scopedRoomMutationAction} from '../src/state-patch.js';
import {authorizeManagerOperation} from '../src/access-policy.js';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const feature=source.slice(source.indexOf('const newPracticeView='),source.indexOf('function renderHome(){'));
function ui(){
 const nodes={'#new-practice-panel':{innerHTML:''}},calls=[],pending=[];
 const state={revision:1,currentStreamer:{id:'papa',spaceId:'space-001'},songs:Array.from({length:43},(_,i)=>({songId:'S'+i,title:'Song '+i,artist:'Artist',new:true,_order:i,streamer_id:'papa',plays:i}))};
 const context=vm.createContext({state,newPracticeSongs,streamerSlug:'papa',admin:{role:'streamer_admin',streamer_id:'papa'},session:null,demo:false,draft:null,
  $:key=>nodes[key]||null,h:x=>String(x??''),blank:x=>'<p>'+x+'</p>',button:(label,act,id='',cls='',extra='')=>'<button data-act="'+act+'" data-id="'+id+'" '+extra+'>'+label+'</button>',
  song:id=>state.songs.find(s=>s.songId===id),songRows:rows=>rows.map(s=>'<b>'+s.title+'</b><button data-act="request">提歌</button><button data-act="request">現點</button>').join(''),isAdmin:()=>true,
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
