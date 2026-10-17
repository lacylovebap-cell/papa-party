import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicLobby,installPublicLobbyLifecycle,lobbyQuery,lobbyLocation,lobbyRoomDestination,lobbyRoomsHtml,lobbySongsHtml,LOBBY_VERSIONS} from '../src/public-lobby.js';
const base='https://paparty.app/lobby.html';
const family={title:'愛你',variants:[{artist:'歌手',versionLabel:'LIVE版',language:'華語',performerType:'團體',streamers:[{slug:'host',name:'主播',songId:'song1'}]}]};
test('lobby reload preserves filters and independent pages, and drops authority hints',()=>{
 const before={q:'愛你',language:'華語',performerType:'團體',versionKind:'live',sort:'oldest',page:2,roomQ:'主播',roomPage:1};
 const url=lobbyLocation(base+'?token=secret&spaceId=private&adminTab=ledger#admin',before);
 assert.deepEqual(lobbyQuery(url),before);assert.doesNotMatch(url,/secret|private|token|adminTab|#/);
 assert.equal(lobbyQuery(base+'?page=-5&roomPage=abc&versionKind=unknown&sort=bad').page,0);
 assert.deepEqual(LOBBY_VERSIONS.map(([v])=>v),['','original','cover','dj','live','remix','other']);
});
test('room and exact song links preserve source IDs without carrying another streamer or login context',()=>{
 for(const kind of ['live','saved']){
  const u=new URL(lobbyRoomDestination(base+'?token=secret&space=other#admin',{slug:'mimi'},'原歌/ID',kind));
  assert.equal(u.pathname,'/index.html');assert.equal(u.searchParams.get('streamer'),'mimi');assert.equal(u.searchParams.get('commonRequest'),'原歌/ID');assert.equal(u.searchParams.get('commonKind'),kind);assert.equal(u.hash,'#book');
  assert.equal(u.searchParams.size,3);
 }
 assert.equal(new URL(lobbyRoomDestination(base,{slug:'host'})).hash,'#home');
 assert.throws(()=>lobbyRoomDestination(base,{slug:'javascript:alert(1)'}));
 assert.throws(()=>lobbyRoomDestination(base,{slug:'host'},'s','delete'));
 const html=lobbySongsHtml({rows:[family],total:25,page:1},base);
 assert.match(html,/LIVE版/);assert.match(html,/華語 · 團體/);assert.match(html,/共 3 頁/);assert.match(html,/data-lobby-jump="songs"/);
 assert.match(lobbyRoomsHtml({rows:[{slug:'host',display_name:'<script>bad</script>'}],total:1,page:0},base),/&lt;script&gt;/);
});
test('controller requests bounded pages, reuses cached reads and only invalidates the affected list',async()=>{
 const calls=[],draws=[],urls=[];
 const lobby=createPublicLobby({href:base,replaceLocation:u=>urls.push(u),render:(k,v)=>draws.push([k,v]),api:async b=>{calls.push(b);return {rows:b.op==='publicLobbySongs'?[family]:[{id:'r',slug:'host',display_name:'主播'}],total:41,filters:{languages:['華語']}};}});
 await lobby.start();assert.equal(calls.length,2);assert.equal(calls[1].limit,12);assert.equal(calls[1].offset,0);
 await lobby.update({page:2});assert.equal(calls.length,3);assert.equal(calls.at(-1).offset,24);
 await lobby.update({language:'華語',versionKind:'live',sort:'oldest'});assert.equal(calls.at(-1).offset,0);assert.equal(calls.at(-1).versionKind,'live');assert.equal(calls.at(-1).sort,'oldest');
 await lobby.update({roomQ:'主播'});assert.equal(calls.at(-1).op,'publicLobbyRooms');assert.equal(calls.at(-1).q,'主播');
 await lobby.update({page:1});assert.equal(calls.at(-1).language,'華語');assert.equal(calls.at(-1).offset,12);
 const count=calls.length;await lobby.update({page:0});assert.equal(calls.length,count,'existing page and filters use bounded cache');
 assert.equal(urls.at(-1).includes('language='),true);assert.equal(Object.hasOwn(calls.at(-1),'token'),false);assert.equal(Object.hasOwn(calls.at(-1),'streamer'),false);
 assert.equal(draws.filter(([k])=>k==='rooms').length,4);
});
test('late search responses and stopped pages cannot replace newer results',async()=>{
 const pending=[],rendered=[];
 const lobby=createPublicLobby({href:base,render:(k,v)=>rendered.push([k,v]),api:b=>b.op==='publicLobbyRooms'?Promise.resolve({rows:[],total:0}):new Promise(resolve=>pending.push({b,resolve}))});
 const started=lobby.start();await new Promise(setImmediate);
 const moved=lobby.update({q:'新的歌'});await new Promise(setImmediate);
 pending[1].resolve({rows:[family],total:1});await moved;
 const before=rendered.length;pending[0].resolve({rows:[],total:0});await started;assert.equal(rendered.length,before);
 const stopped=lobby.update({q:'離開了'});await new Promise(setImmediate);lobby.stop();const stoppedCount=rendered.length;
 pending[2].resolve({rows:[],total:0});await stopped;assert.equal(rendered.length,stoppedCount);
});
test('out-of-range pages clamp once and malformed public links fail closed',async()=>{
 const calls=[],views=[];
 const lobby=createPublicLobby({href:base+'?page=10',render:(k,v)=>views.push([k,v]),api:async b=>{calls.push(b);return {rows:[],total:0};}});
 await lobby.start();assert.equal(lobby.state().page,0);assert.equal(calls.filter(x=>x.op==='publicLobbySongs').length,2);
 const bad=createPublicLobby({href:base,render:(k,v)=>views.push([k,v]),api:async b=>({rows:b.op==='publicLobbySongs'?[{...family,variants:[{...family.variants[0],streamers:[{slug:'https://evil.test',name:'壞連結',songId:'s'}]}]}]:[],total:1})});
 await bad.start();assert.match(views.at(-1)[1].error,/歌曲資料尚未確認/);
});

test('Back/Forward cache restoration keeps search usable and reuses fresh data without fixed polling',async()=>{
 const events={},calls=[];let cleared=0;
 const lobby=createPublicLobby({href:base,render:()=>{},api:async b=>{calls.push(b);return{rows:[],total:0};}});
 const target={addEventListener:(name,fn)=>events[name]=fn,removeEventListener:(name,fn)=>{if(events[name]===fn)delete events[name];}};
 const dispose=installPublicLobbyLifecycle({target,lobby,cancelSearch:()=>cleared++});
 await lobby.start();assert.equal(calls.length,2);
 events.pagehide({persisted:true});events.pageshow({persisted:true});await new Promise(setImmediate);
 assert.equal(calls.length,2);assert.equal(cleared,1);
 await lobby.update({q:'返回後找歌'});assert.equal(calls.length,3);assert.equal(calls.at(-1).q,'返回後找歌');
 events.pagehide({persisted:false});await lobby.update({q:'已關閉'});assert.equal(calls.length,3);
 dispose();assert.deepEqual(Object.keys(events),[]);
});

test('revisiting cached pages cannot keep old song metadata alive beyond its fixed TTL',async()=>{
 let clock=0;const calls=[];
 const lobby=createPublicLobby({href:base,now:()=>clock,render:()=>{},api:async b=>{calls.push(b);return{rows:[],total:41};}});
 await lobby.start();clock=30000;await lobby.update({page:1});assert.equal(calls.length,3);
 clock=45000;await lobby.update({page:0});clock=59000;await lobby.update({page:1});assert.equal(calls.length,3);
 clock=61000;await lobby.update({page:0});assert.equal(calls.length,4);assert.equal(calls.at(-1).offset,0);
});
