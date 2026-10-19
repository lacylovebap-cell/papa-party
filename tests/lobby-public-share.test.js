import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {lobbyPublicScope,lobbyLoginIntent,lobbyLoginLocation,lobbyLoginPrompt,openLobbyPublicShare} from '../src/lobby-public-share.js';
import {createPublicLinkClient} from '../src/public-links.js';
import {lobbyRoomDestination,lobbyLocation,lobbyQuery} from '../src/public-lobby.js';

const mountUrl='https://paparty.app/';
const hall={kind:'hall',spaceId:'space-001',canonicalPath:'/sm',section:'home'};
test('only validated 聲瑪 hall or exact legacy lobby can load its existing discovery API',()=>{
 assert.equal(lobbyPublicScope({context:hall,href:mountUrl+'sm',mountUrl}).supported,true);
 assert.equal(lobbyPublicScope({context:null,href:mountUrl+'lobby.html',mountUrl}).supported,true);
 for(const context of [{...hall,spaceId:'other-space'},{...hall,kind:'streamer'},null])assert.equal(lobbyPublicScope({context,href:mountUrl+'other-hall',mountUrl}).supported,false);
 for(const href of [mountUrl+'sm',mountUrl+'unknown',mountUrl+'lobby.html?spaceId=other-space',mountUrl+'lobby.html?space=other'])assert.equal(lobbyPublicScope({context:null,href,mountUrl}).supported,false);
});
test('lobby header logins preserve selected mode and filters without platform category step or secrets',()=>{
 for(const kind of ['player','admin']){
  const href=lobbyLoginLocation(mountUrl+'sm?q=情歌&roomQ=怕怕&token=secret#admin',kind),url=new URL(href);
  assert.equal(url.pathname,'/sm');assert.equal(url.searchParams.get('portalLogin'),kind);assert.equal(url.searchParams.get('roomQ'),'怕怕');assert.equal(url.searchParams.has('token'),false);assert.equal(url.hash,'');
  assert.equal(lobbyLoginIntent(href),kind);assert.match(lobbyLoginPrompt(href),kind==='admin'?/選擇.*聲瑪主播.*管理登入/:/選擇.*聲瑪主播.*玩家登入/);
  const room=lobbyRoomDestination(href,{slug:'papa'});assert.equal(new URL(room).searchParams.get('portalLogin'),kind);assert.equal(new URL(room).searchParams.get('streamer'),'papa');
  const pager=lobbyLocation(href,{...lobbyQuery(href),roomPage:1});assert.equal(new URL(pager).searchParams.get('portalLogin'),kind);
 }
 assert.equal(lobbyLoginPrompt(mountUrl+'sm'),'');assert.equal(lobbyLoginIntent(mountUrl+'sm?portalLogin=admin&portalLogin=player'),null);
});
test('hall share requests only current stable scope on demand and uses configured canonical URL',async()=>{
 const calls=[],opened=[];const links=createPublicLinkClient({api:async body=>{calls.push(body);return {version:1,kind:'hall',spaceId:'space-001',streamerId:null,configured:true,canonicalPath:'/sm-new'};}}),share={open:async input=>opened.push(input)};
 assert.equal(calls.length,0);await openLobbyPublicShare({scope:{supported:true,...hall,name:'聲瑪'},links,share});
 assert.deepEqual(calls,[{op:'publicRouteInfo',kind:'hall',spaceId:'space-001',streamerId:null}]);assert.deepEqual(opened,[{name:'聲瑪',url:mountUrl+'sm-new',kind:'hall'}]);
 await openLobbyPublicShare({scope:{supported:true,...hall,name:'聲瑪'},links,share});assert.equal(calls.length,1,'repeat open reuses bounded metadata cache');
});
test('unknown or unconfigured hall never fabricates a /sm share URL',async()=>{
 let requests=0;const share={open:()=>assert.fail('unconfigured or foreign scope must not open share')};
 await assert.rejects(openLobbyPublicShare({scope:{supported:false,spaceId:'other'},links:{info:()=>requests++},share}),/尚未開放/);assert.equal(requests,0);
 const links=createPublicLinkClient({api:async()=>({version:1,kind:'hall',spaceId:'space-001',streamerId:null,configured:false,canonicalPath:null})});
 await assert.rejects(openLobbyPublicShare({scope:{supported:true,...hall,name:'聲瑪'},links,share}),/尚未啟用/);
 const failed=createPublicLinkClient({api:async()=>{throw Error('資料庫功能尚未啟用');}});
 await assert.rejects(openLobbyPublicShare({scope:{supported:true,...hall,name:'聲瑪'},links:failed,share}),/尚未啟用/);
});
test('unsupported pretty hall stops before creating discovery or making network calls',()=>{
 const src=fs.readFileSync(new URL('../src/lobby-entry.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(mountUrl+'src/lobby-entry.js'));
 const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,{setAttribute(){},removeAttribute(){},disabled:false,innerHTML:''});return nodes.get(selector);};
 const document={title:'',querySelector:node};
 vm.runInNewContext(src,{URL,document,location:{href:mountUrl+'other-hall'},readPublicRouteContext:()=>({...hall,spaceId:'other'}),lobbyPublicScope,createPublicLobby:()=>assert.fail('must not query 聲瑪'),fetch:()=>assert.fail('must not send API request')});
 assert.match(node('main').innerHTML,/此廳目前尚未開放/);assert.equal(node('#lobby-share').disabled,true);
});
test('lobby removes only redundant intro wordmark and provides all small header controls plus accessible modal',()=>{
 const html=fs.readFileSync(new URL('../lobby.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/<section class="lobby-intro"><small>/);assert.match(html,/class="brand-logo"/);
 for(const label of ['回官網','玩家登入','管理登入','分享'])assert.ok(html.includes('>'+label+'<'),label);
 assert.match(html,/<dialog id="dialog" aria-modal="true">/);assert.match(html,/src\/share-dialog\.css/);
});
