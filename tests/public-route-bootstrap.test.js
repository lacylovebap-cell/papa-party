import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePublicPage,loadPublicTemplate,publicRouteDestination} from '../src/public-route-bootstrap.js';
import {lobbyQuery} from '../src/public-lobby.js';

const metadata=(matchedPath,canonicalPath='/pa',extra={})=>({version:1,kind:'streamer',spaceId:'space-001',streamerId:'streamer-stable',streamerSlug:'papa',canonicalPath,matchedPath,isAlias:matchedPath!==canonicalPath,code:'pa',spaceCode:'sm',revision:1,configured:true,layout:'flat',...extra});

test('lookup uses only bounded aliases and server stable IDs; an old home goes directly to its latest home',async()=>{
 const calls=[];
 const result=await resolvePublicPage('https://paparty.app/OLD/center?tab=ledger&token=private&notificationId=n#admin',{resolve:async path=>{calls.push(path);return path==='/OLD'?metadata(path,'/PAPA520',{accessToken:'private'}):null;}});
 assert.deepEqual(calls,['/OLD/center','/OLD']);
 assert.equal(result.destination,'https://paparty.app/PAPA520/center?tab=ledger');
 assert.equal(result.section,'center');assert.equal(result.metadata.streamerId,'streamer-stable');
 assert.equal(Object.hasOwn(result.metadata,'accessToken'),false);
 assert.equal(JSON.stringify(result).includes('private'),false);
});

test('exact historical two-segment aliases win before a possible shorter-page interpretation',async()=>{
 const calls=[];
 const result=await resolvePublicPage('https://paparty.app/old/book',{resolve:async path=>{calls.push(path);return metadata(path,'/qq.Singer');}});
 assert.deepEqual(calls,['/old/book']);assert.equal(result.destination,'https://paparty.app/qq.Singer');
});

test('dotted halls, independent homes, old slash aliases and case variants keep subpages',async()=>{
 for(const path of ['/qq.OLD','/pa.OLD','/hall/OLD','/OLD']){
  const result=await resolvePublicPage('https://paparty.app'+path+'/admin?adminTab=players&player=P1&tab=achievements',{resolve:async matched=>matched===path?metadata(path,'/qq.NewCode'):null});
  assert.equal(result.destination,'https://paparty.app/qq.NewCode/admin?adminTab=players&player=P1&tab=achievements');
 }
 const result=await resolvePublicPage('https://paparty.app/Pa.OLD/#book',{resolve:async path=>metadata(path.toLowerCase(),'/pa.NewCode')});
 assert.equal(result.destination,'https://paparty.app/pa.NewCode/book');
});

test('hall stable identity and former hash routes are preserved without guessing a room',async()=>{
 const hall=await resolvePublicPage('https://paparty.app/OLD-HALL?streamer=wrong',{resolve:async path=>metadata(path,'/qq',{kind:'hall',streamerId:null,streamerSlug:null})});
 assert.equal(hall.metadata.streamerId,null);assert.equal(hall.destination,'https://paparty.app/qq');
 const former=await resolvePublicPage('https://paparty.app/OLD?adminTab=queue&queue=history#admin',{resolve:async path=>metadata(path)});
 assert.equal(former.destination,'https://paparty.app/pa/admin?adminTab=queue&queue=history');
});

test('hall pretty reload keeps bounded search, filters, pages and the selected login UI intent',async()=>{
 const href='https://paparty.app/old-hall?portalLogin=player&q=%E6%84%9B%E4%BD%A0&language=%E8%8F%AF%E8%AA%9E&performerType=male&versionKind=cover&roomQ=%E6%80%95%E6%80%95&sort=oldest&page=4&roomPage=3&token=secret&spaceId=wrong&adminTab=players&notificationId=n#admin';
 const result=await resolvePublicPage(href,{resolve:async path=>metadata(path,'/sm',{kind:'hall',streamerId:null,streamerSlug:null})});
 const url=new URL(result.destination);assert.equal(url.pathname,'/sm');assert.equal(url.hash,'');assert.equal(result.section,'home');assert.equal(url.searchParams.get('portalLogin'),'player');
 assert.deepEqual(lobbyQuery(result.destination),lobbyQuery(href));
 for(const key of ['token','spaceId','adminTab','notificationId'])assert.equal(url.searchParams.has(key),false,key);
 const again=await resolvePublicPage(result.destination,{resolve:async path=>metadata(path,'/sm',{kind:'hall',streamerId:null,streamerSlug:null})});
 assert.equal(again.destination,result.destination,'reloading normalized public state is stable');
});

test('public route destinations reject duplicate/invalid login hints and clamp existing lobby query bounds',()=>{
 const hall=metadata('/sm','/sm',{kind:'hall',streamerId:null,streamerSlug:null});
 for(const tail of ['portalLogin=president','portalLogin=admin&portalLogin=player','portalLogin=player&portalLogin=player']){
  const url=new URL(publicRouteDestination('https://paparty.app/sm?'+tail,hall,{route:'home'}));assert.equal(url.searchParams.has('portalLogin'),false);
 }
 const href='https://paparty.app/sm?portalLogin=admin&q='+('a'.repeat(150))+'&roomQ='+('b'.repeat(150))+'&page=999999&roomPage=999999&versionKind=invalid&language=%20%E8%8F%AF%E8%AA%9E%20&token=private';
 const url=new URL(publicRouteDestination(href,hall,{route:'home'}));
 assert.equal(url.searchParams.get('q').length,100);assert.equal(url.searchParams.get('roomQ').length,100);assert.equal(url.searchParams.get('page'),'834');assert.equal(url.searchParams.get('roomPage'),'501');assert.equal(url.searchParams.get('versionKind'),null);assert.equal(url.searchParams.get('language'),'華語');assert.equal(url.searchParams.has('token'),false);
 assert.equal(publicRouteDestination(href,hall,{route:'book'}),null);
});

test('streamer aliases keep exactly one player/admin login hint and only the existing page state',async()=>{
 for(const mode of ['player','admin']){
  const result=await resolvePublicPage('https://paparty.app/old?portalLogin='+mode+'&q=hall-search&roomPage=5&token=private&spaceId=wrong#book',{resolve:async path=>metadata(path,'/pa')});
  assert.equal(result.destination,'https://paparty.app/pa/book?portalLogin='+mode);assert.equal(result.section,'book');
 }
 for(const tail of ['portalLogin=president','portalLogin=player&portalLogin=admin']){
  const destination=publicRouteDestination('https://paparty.app/old?'+tail,metadata('/old'),{route:'admin',tab:'queue',queueHistory:true});
  assert.equal(destination,'https://paparty.app/pa/admin?adminTab=queue&queue=history');
 }
});

test('public route admin detail IDs are bounded before becoming navigation state',()=>{
 const info=metadata('/pa'),base='https://paparty.app/pa/admin';
 for(const selectedPlayer of ['a'.repeat(201),'player with space','player\u0000','player\n','player\u0085']){
  const url=new URL(publicRouteDestination(base,info,{route:'admin',tab:'players',subtab:'ledger',selectedPlayer}));
  assert.equal(url.searchParams.get('adminTab'),'players');assert.equal(url.searchParams.has('player'),false);assert.equal(url.searchParams.has('tab'),false);
 }
 const valid=new URL(publicRouteDestination(base,info,{route:'admin',tab:'players',subtab:'ledger',selectedPlayer:'P中文'}));assert.equal(valid.searchParams.get('player'),'P中文');
});

test('system paths, malformed paths, misses, and resolver failures do not silently switch identity',async()=>{
 let calls=0;
 for(const path of ['/','/login','/sm%2fPAPA','/solo/singer','/hall/singer/unknown'])assert.equal(await resolvePublicPage('https://paparty.app'+path,{resolve:async()=>{calls++;return null;}}),null);
 assert.equal(calls,0);
 assert.equal(await resolvePublicPage('https://paparty.app/UNKNOWN/book',{resolve:async()=>{calls++;return null;}}),null);assert.equal(calls,2);
 await assert.rejects(()=>resolvePublicPage('https://paparty.app/pa',{resolve:async()=>{throw new Error('offline');}}),/offline/);
 for(const bad of [metadata('/OTHER'),metadata('/pa','//evil.test/path'),metadata('/pa','/pa',{streamerId:null}),metadata('/pa','/pa',{spaceId:''})])await assert.rejects(()=>resolvePublicPage('https://paparty.app/pa',{resolve:async()=>bad}),/RESPONSE_INVALID/);
});

test('browser alias resolution fails closed for missing version, disabled configuration or invalid stable room metadata',async()=>{
 const cases=[
  {version:undefined},{version:2},{configured:false},{configured:undefined},{canonicalPath:'/pa/'},
  {spaceId:'space 001'},{spaceId:'space\u0000'},{streamerId:'room\nother'},{streamerId:' room'},
  {streamerSlug:'Papa'},{streamerSlug:'papa/other'},{streamerSlug:'papa_'},{streamerSlug:'papa\u0000'},
  {kind:'hall',streamerId:'papa',streamerSlug:null},{kind:'hall',streamerId:null,streamerSlug:'papa'},
  {kind:'hall',streamerId:null,streamerSlug:undefined}
 ];
 for(const invalid of cases){const value=metadata('/pa','/pa',invalid);await assert.rejects(()=>resolvePublicPage('https://paparty.app/pa',{resolve:async()=>value}),/PUBLIC_ROUTE_RESPONSE_INVALID/,JSON.stringify(invalid));}
});

// A deliberately small DOM double verifies the loader's browser API contract,
// including inert scripts becoming executable exactly once after HTML adoption.
class Element{
 constructor(tag,attributes={},text=''){this.tagName=tag;this.attrs={...attributes};this.textContent=text;this.parent=null;this.children=[];}
 get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value}));}
 getAttribute(key){return Object.hasOwn(this.attrs,key)?this.attrs[key]:null;}
 setAttribute(key,value){this.attrs[key]=String(value);}
 append(child){child.parent=this;this.children.push(child);}
 prepend(child){child.parent=this;this.children.unshift(child);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);}
 replaceWith(next){const parent=this.parent,index=parent.children.indexOf(this);parent.children[index]=next;next.parent=parent;const document=parent.document;document.executed.push(next.getAttribute('src')||next.textContent);queueMicrotask(()=>{if(document.scriptFailure)next.onerror?.();else next.onload?.();});}
}
class Document{
 constructor({scripts=[['module','src/app.js'],['module','src/site-footer.js']],stale=true,scriptFailure=false}={}){
  this.executed=[];this.scriptFailure=scriptFailure;this.replaced=0;this.documentElement=new Element('html');this.head=new Element('head');this.body=new Element('body');this.documentElement.append(this.head);this.documentElement.append(this.body);
  if(stale){this.head.append(new Element('base',{href:'https://wrong.test/'}));this.head.append(new Element('script',{id:'public-route-data',type:'application/json'},'{"token":"stale"}'));}
  for(const [type,src]of scripts)this.body.append(new Element('script',{...(type?{type}:{}),...(src?{src}:{})},src?'':'window.loaded=true'));
  this.adopt(this.documentElement);
 }
 adopt(node){node.document=this;for(const child of node.children)this.adopt(child);}
 createElement(tag){return new Element(tag);}
 all(){const found=[];const walk=node=>{found.push(node);for(const child of node.children)walk(child);};walk(this.documentElement);return found;}
 querySelectorAll(selector){return this.all().filter(node=>selector==='script'?node.tagName==='script':selector==='script[src]'?node.tagName==='script'&&node.getAttribute('src')!==null:selector==='base, #public-route-data'?node.tagName==='base'||node.getAttribute('id')==='public-route-data':false);}
 importNode(node){return node;}
 replaceChild(next,previous){assert.equal(previous,this.documentElement);this.documentElement=next;this.head=next.children.find(node=>node.tagName==='head');this.body=next.children.find(node=>node.tagName==='body');this.adopt(next);this.replaced++;}
}
function environment({parsed=new Document(),scriptFailure=false,response={}}={}){
 const document=new Document({scripts:[],stale:false,scriptFailure}),calls=[];
 const window={location:{href:'https://paparty.app/OLD/book?token=private'},history:{replaceState:(_state,_title,url)=>{calls.push(['replace',url]);window.location.href=url;}}};
 class DOMParser{parseFromString(value,type){calls.push(['parse',type]);return parsed;}}
 const fetch=async(url,options)=>{calls.push(['fetch',url,options]);return {ok:true,url,headers:{get:()=> 'text/html; charset=utf-8'},text:async()=>'<html>trusted public template</html>',...response};};
 return {document,window,DOMParser,fetch,calls};
}
const streamerResult=()=>({metadata:metadata('/OLD'),section:'book',view:{route:'book',tab:'queue',subtab:'overview',selectedPlayer:null,queueHistory:false},destination:'https://paparty.app/pa/book'});

test('template bootstrap keeps the pretty URL, uses only a same-origin clean shell, and runs scripts once',async()=>{
 const env=environment(),result=streamerResult();
 const [first,second]=await Promise.all([loadPublicTemplate(result,env),loadPublicTemplate(result,env)]);
 assert.equal(first,second);assert.equal(first.templateUrl,'https://paparty.app/v2.html');assert.equal(env.document.replaced,1);
 const requests=env.calls.filter(row=>row[0]==='fetch');assert.equal(requests.length,1);assert.equal(requests[0][1],'https://paparty.app/v2.html');assert.equal(requests[0][2].credentials,'omit');
 assert.equal(env.window.location.href,'https://paparty.app/pa/book');
 const bases=env.document.all().filter(node=>node.tagName==='base');assert.equal(bases.length,1);assert.equal(bases[0].getAttribute('href'),'/');
 const data=env.document.all().filter(node=>node.getAttribute('id')==='public-route-data');assert.equal(data.length,1);assert.equal(JSON.parse(data[0].textContent).section,'book');assert.equal(data[0].textContent.includes('token'),false);
 assert.deepEqual(env.document.executed,['https://paparty.app/src/app.js','https://paparty.app/src/site-footer.js']);
});

test('hall loads its original lobby shell; fixed root base prevents nested relative asset paths',async()=>{
 const env=environment({parsed:new Document({scripts:[['module','src/lobby-entry.js']]})});
 const result={metadata:metadata('/OLD','/qq',{kind:'hall',streamerId:null,streamerSlug:null}),section:'home',view:{route:'home'},destination:'https://paparty.app/qq'};
 const loaded=await loadPublicTemplate(result,env);assert.equal(loaded.templateUrl,'https://paparty.app/lobby.html');assert.deepEqual(env.document.executed,['https://paparty.app/src/lobby-entry.js']);
});

test('template expected-destination validation uses the same login and bounded lobby state as route resolution',async()=>{
 const env=environment({parsed:new Document({scripts:[['module','src/lobby-entry.js']]})});
 env.window.location.href='https://paparty.app/sm?portalLogin=player&roomQ=%E6%80%95%E6%80%95&roomPage=2&q=%E6%84%9B%E4%BD%A0&page=4&token=private';
 const result=await resolvePublicPage(env.window.location.href,{resolve:async path=>metadata(path,'/sm',{kind:'hall',streamerId:null,streamerSlug:null})});
 await loadPublicTemplate(result,env);assert.equal(env.window.location.href,result.destination);assert.equal(new URL(env.window.location.href).searchParams.get('portalLogin'),'player');assert.equal(lobbyQuery(env.window.location.href).roomPage,1);assert.equal(lobbyQuery(env.window.location.href).page,3);
 const copied=JSON.parse(env.document.all().find(node=>node.getAttribute('id')==='public-route-data').textContent);assert.equal(copied.kind,'hall');assert.equal(copied.section,'home');assert.equal(copied.token,undefined);
 const streamerEnv=environment();streamerEnv.window.location.href='https://paparty.app/old?portalLogin=admin&token=private#book';
 const streamer=await resolvePublicPage(streamerEnv.window.location.href,{resolve:async path=>metadata(path)});await loadPublicTemplate(streamer,streamerEnv);assert.equal(streamerEnv.window.location.href,'https://paparty.app/pa/book?portalLogin=admin');
});

test('external scripts, fetch redirects, oversized HTML and bad responses fail before page or history mutation',async()=>{
 const cases=[
  {parsed:new Document({scripts:[['module','https://evil.test/script.js']]})},
  {response:{url:'https://evil.test/v2.html'}},
  {response:{ok:false}},
  {response:{headers:{get:()=> 'application/json'}}},
  {response:{text:async()=> 'x'.repeat(262145)}}
 ];
 for(const options of cases){const env=environment(options);await assert.rejects(()=>loadPublicTemplate(streamerResult(),env),/PUBLIC_ROUTE_TEMPLATE/);assert.equal(env.document.replaced,0);assert.equal(env.calls.some(row=>row[0]==='replace'),false);}
 const env=environment();await assert.rejects(()=>loadPublicTemplate(streamerResult(),{...env,mountUrl:'https://evil.test/'}),/TEMPLATE_ORIGIN/);assert.equal(env.calls.length,0);
});

test('template loader refuses invalid route protocol before fetching or injecting the app shell',async()=>{
 for(const invalid of [{version:undefined},{configured:false},{canonicalPath:'/pa/'},{streamerSlug:'../papa'},{spaceId:'bad space'},{kind:'hall',streamerId:'papa',streamerSlug:null}]){
  const env=environment(),result=streamerResult();result.metadata={...result.metadata,...invalid};
  await assert.rejects(()=>loadPublicTemplate(result,env),/PUBLIC_ROUTE_RESPONSE_INVALID/);assert.equal(env.calls.length,0);assert.equal(env.document.replaced,0);
 }
});

test('partial script failure is retained to prevent duplicate app startup or duplicate requests',async()=>{
 const env=environment({scriptFailure:true}),result=streamerResult();
 const first=loadPublicTemplate(result,env);await assert.rejects(()=>first,/SCRIPT_FAILED/);
 const second=loadPublicTemplate(result,env);assert.equal(first,second);await assert.rejects(()=>second,/SCRIPT_FAILED/);
 assert.equal(env.calls.filter(row=>row[0]==='fetch').length,1);assert.equal(env.document.executed.length,1);
 await assert.rejects(()=>loadPublicTemplate({...result,destination:'https://paparty.app/other'},env),/ALREADY_LOADED/);
});
