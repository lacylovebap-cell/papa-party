import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function managerSessionExpired('),app.indexOf('\nasync function refresh('));
function client({legacy=true,response={error:'登入已到期，請重新登入'},status=400,networkError=false}={}){
 const saved={'papa-v2-draft-papa':'private','papa-v2-draft-other':'private','papa-v2-player':'keep'};
 const storage={...saved};Object.defineProperty(storage,'removeItem',{enumerable:false,value:key=>delete storage[key]});
 const appNode={innerHTML:''},ctx=vm.createContext({Date,JSON,Error,createWebDeviceLogin:()=>null,localStorage:storage,location:{hash:'admin'},document:{querySelectorAll:()=>[{close(){}}]},fetch:async()=>{if(networkError)throw Error('network offline');return {ok:status===200,status,json:async()=>response};}});
 vm.runInContext(`
  var deviceLogin=null,admin={token:'admin:old',legacy:${legacy},accessUntil:0,refreshToken:'old-refresh'},session={token:'player:keep'},draft={state:{private:true}},full={private:true},signatures={private:'old'},selectedPlayer='P1',state={streamers:[{id:'papa',slug:'papa'}],currentStreamer:{id:'papa'},players:[{password:'private'}]},route='admin',demo=false,offset=0,streamerSlug='papa',API='test',PUBLISHABLE_KEY='public',writes={};
  var node={innerHTML:''};
  function isAdmin(){return !!admin&&route==='admin';}function put(key,value){writes[key]=value;}function empty(){return {players:[],songs:[]};}function header(){}function card(title,body){return title+body;}function button(label,act){return '<button data-act="'+act+'">'+label+'</button>';}function $(selector){return node;}function timeValue(value){return Date.parse(value);}
 `+source,ctx);
 return {ctx,storage,async request(body={op:'read'}){return vm.runInContext('api('+JSON.stringify(body)+')',ctx);},value(expression){return vm.runInContext(expression,ctx);}};
}
test('revoked manager session clears cached admin, private state and drafts, leaving the login entry usable',async()=>{
 const c=client();await assert.rejects(c.request(),/登入已到期/);
 assert.equal(c.value('admin'),null);assert.equal(c.value('draft'),null);assert.equal(c.value('full'),null);assert.equal(c.value('state.players.length'),0);assert.equal(c.value('route'),'home');assert.equal(c.ctx.location.hash,'home');assert.equal(c.value('writes.admin'),null);assert.equal(c.value('writes.draft'),null);
 assert.equal(c.storage['papa-v2-draft-papa'],undefined);assert.equal(c.storage['papa-v2-draft-other'],undefined);assert.equal(c.storage['papa-v2-player'],'keep');assert.equal(c.value('session.token'),'player:keep');assert.match(c.value('node.innerHTML'),/data-act="admin"/);
});
test('retired Auth refresh sessions recover through password login instead of repeating refresh forever',async()=>{
 const c=client({legacy:false,response:{error:'請使用總裁密碼重新登入'}});await assert.rejects(c.request(),/重新登入/);assert.equal(c.value('admin'),null);assert.equal(c.value('route'),'home');
});
test('ordinary permission, wrong-password and network failures retain the manager login',async()=>{
 for(const response of [{error:'只能管理自己的主播資料'},{error:'目前密碼不正確'},{error:'資料庫操作失敗'}]){
  const c=client({response});await assert.rejects(c.request());assert.equal(c.value('admin.token'),'admin:old');assert.notEqual(c.value('draft'),null);
 }
 const c=client({networkError:true});await assert.rejects(c.request(),/network offline/);assert.equal(c.value('admin.token'),'admin:old');
});
test('player expiration and stale requests cannot discard a different or newly signed-in manager',async()=>{
 const c=client();c.value("route='home'");await assert.rejects(c.request());assert.equal(c.value('admin.token'),'admin:old');
 assert.equal(c.value("discardManagerSession('admin:some-older-session')"),false);assert.equal(c.value('admin.token'),'admin:old');
});
test('a successful late manager response is rejected after its manager session changed',async()=>{
 const c=client({status:200,response:{state:{private:true},signatures:{secret:'x'}}});
 c.ctx.fetch=async()=>{c.value("admin={token:'admin:new',legacy:true}");return {ok:true,status:200,json:async()=>({state:{private:true},signatures:{secret:'x'}})};};
 await assert.rejects(c.request(),/登入身分已變更/);assert.equal(c.value('admin.token'),'admin:new');assert.equal(c.value('signatures.secret'),undefined);
});

test('remembered manager restores access before its request without persisting the bearer token',async()=>{
 const c=client({status:200,response:{state:{}}});let payload;
 c.value("admin={device:true,role:'streamer_admin',spaceId:'space-001',streamerId:'papa'};deviceLogin={access:async()=> 'device:renewed'}");
 c.ctx.fetch=async(_,options)=>{payload=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({state:{}})};};
 await c.request();assert.equal(payload.token,'device:renewed');assert.equal(c.value('writes.admin'),undefined);
});

test('expired remembered identity without an in-memory token clears private manager state',async()=>{
 const c=client();c.value("admin={device:true,role:'streamer_admin'};deviceLogin={access:async()=>{throw Object.assign(Error('expired'),{authExpired:true});}};");
 await assert.rejects(c.request(),/expired/);assert.equal(c.value('admin'),null);assert.equal(c.value('draft'),null);assert.equal(c.value('session.token'),'player:keep');
});

test('late device refresh cannot replace a newly selected manager identity',async()=>{
 const c=client();c.value("admin={device:true,role:'streamer_admin'};deviceLogin={access:async()=>{admin={token:'admin:new',legacy:true};return 'device:old';}};");
 await assert.rejects(c.request(),/登入身分已變更/);assert.equal(c.value('admin.token'),'admin:new');
});
