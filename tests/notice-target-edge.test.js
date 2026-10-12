import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as core from '../src/core.js';
import * as access from '../src/access-policy.js';
import * as patch from '../src/state-patch.js';
import * as rules from '../src/notification-rules.js';
import * as chat from '../src/chat-policy.js';
import * as board from '../src/board-policy.js';

const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
const ids={notice:'00000000-0000-4000-8000-000000000001',message:'00000000-0000-4000-8000-000000000002',post:'00000000-0000-4000-8000-000000000003',root:'00000000-0000-4000-8000-000000000004'};
const post=(extra={})=>({id:ids.post,seq:80,space_id:'space-001',scope:'streamer',streamer_id:'papa',origin_room:'papa',root_id:null,
 author_key:'player:P2',anonymous:false,visibility:'public',targets:[],deleted:false,moderated:false,body:'must not leave server',...extra});
function fixture(options={}){
 let handler;const calls=[],role=options.role||'player',space=options.actorSpace||'space-001',room=options.actorRoom||'papa';
 const recipient=role==='player'?'P1':role==='super_admin'?'__super__':'__admin__';
 const actor={role,accountId:'00000000-0000-4000-8000-000000000009',spaceId:role==='super_admin'?null:space,
  playerId:role==='player'?'P1':null,streamerId:role==='streamer_admin'?room:null};
 const notice={id:ids.notice,type:options.type||'message',entity_id:options.type&&options.type!=='message'?ids.post:ids.message,
  streamer_id:'papa',space_id:'space-001',recipient,...options.notice};
 const message={id:ids.message,seq:101,player_id:'P1',streamer_id:'papa',body:'private message body',...options.message};
 const posts=new Map((options.posts||[post()]).map(item=>[item.id,item]));
 const fetch=async(url,request)=>{
  const target=new URL(url),path=target.pathname,params=target.searchParams,body=request.body?JSON.parse(request.body):undefined;
  calls.push({path,params,body,method:request.method});
  if(path.endsWith('/papa_verified_session_actor'))return Response.json(options.expired?null:actor);
  if(path.endsWith('/papa_streamer_directory_in_space')||path.endsWith('/papa_streamer_directory'))return Response.json([
   {id:'papa',slug:'papa',display_name:'Room',active:options.active!==false,spaceId:'space-001'},
   {id:'michelle',slug:'michelle',display_name:'Other',active:true,spaceId:'space-001'}]);
  assert.equal(request.method,'GET','target lookup never writes, reads receipts or sends a notification');
  assert.equal(params.get('limit'),path.endsWith('/papa_board_blocks')?'2':'1');
  if(path.endsWith('/papa_notifications')){
   assert.equal(params.get('id'),'eq.'+ids.notice);assert.equal(params.get('streamer_id'),'eq.papa');
   assert.equal(params.get('space_id'),'eq.space-001');assert.equal(params.get('recipient'),'eq.'+recipient);
   assert.equal(params.get('select'),'id,type,entity_id,streamer_id,space_id,recipient');
   return Response.json(options.missingNotice?[]:[notice]);
  }
  if(path.endsWith('/papa_chat_messages')){
   assert.equal(params.get('id'),'eq.'+ids.message);assert.equal(params.get('streamer_id'),'eq.papa');
   assert.equal(params.get('select'),'id,seq,player_id,streamer_id');
   assert.equal(params.get('player_id'),role==='player'?'eq.P1':null);
   return Response.json(options.missingMessage?[]:[message]);
  }
  if(path.endsWith('/papa_board_posts')){
   assert.equal(params.get('space_id'),'eq.space-001');assert.equal(params.get('select').includes('body'),false);
   const row=posts.get(params.get('id').slice(3));return Response.json(row?[row]:[]);
  }
  if(path.endsWith('/papa_board_blocks')){
   assert.equal(params.get('space_id'),'eq.space-001');assert.equal(params.get('select'),'target_key');
   assert.equal(params.get('owner_key'),'eq.'+(role==='player'?'player:P1':role==='super_admin'?'super':'streamer:'+room));
   return Response.json((options.blocks||[]).map(target_key=>({target_key})));
  }
  throw Error('Unexpected target endpoint '+path);
 };
 const context=vm.createContext({...core,...access,...patch,...rules,...chat,...board,Error,URL,Response,TextEncoder,crypto,structuredClone,fetch,
  CATALOG_OPS:new Set(),Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://db.example':'fixture-key'},serve:fn=>handler=fn},
  EdgeRuntime:{waitUntil(){throw Error('Read-only target must not schedule work');}}});
 vm.runInContext(code,context);
 const invoke=async(extra={})=>{
  const token=(role==='super_admin'?'admin:':role==='streamer_admin'?'streamer:':'player:')+'fixture';
  const response=await handler({method:'POST',json:async()=>({op:'noticeTarget',token,streamer:'papa',notificationId:ids.notice,...extra})});
  return {status:response.status,body:await response.json()};
 };
 return {calls,invoke};
}
const noContent=result=>{for(const field of ['body','author_key','targets','managedAuthor','recipient','read_at'])assert.equal(JSON.stringify(result.body).includes('"'+field+'"'),false);};
const unavailable=(result,kind)=>{assert.equal(result.status,200);assert.deepEqual(result.body,{found:false,kind});noContent(result);};

test('message locator binds the actual own notice and filters player before returning a peer',async()=>{
 const f=fixture(),result=await f.invoke({entityId:ids.post,entityType:'comment',playerId:'P2',recipient:'__super__'});
 assert.equal(result.status,200);assert.deepEqual(result.body,{found:true,kind:'chat',spaceId:'space-001',streamerId:'papa',playerId:'P1',messageId:ids.message,seq:101});
 assert.equal(f.calls.length,4);noContent(result);
 assert.equal(f.calls.some(call=>/reads|snapshot|entities|inbox/.test(call.path)),false);
});

test('room manager and president resolve a message peer only after their own recipient notice',async()=>{
 for(const role of ['streamer_admin','super_admin']){
  const f=fixture({role,message:{player_id:'P2'}}),result=await f.invoke();
  assert.equal(result.status,200);assert.equal(result.body.playerId,'P2');noContent(result);
 }
});

test('wrong recipient, Space or Room notice and unknown IDs reveal no entity target',async()=>{
 for(const options of [{missingNotice:true},{notice:{recipient:'P2'}},{notice:{space_id:'space-002'}},{notice:{streamer_id:'michelle'}}]){
  const f=fixture(options),result=await f.invoke();unavailable(result,'generic');assert.equal(f.calls.length,3);
 }
});

test('foreign player conversation, missing message or unsafe locator fails without private metadata',async()=>{
 for(const options of [{message:{player_id:'P2'}},{message:{streamer_id:'michelle'}},{missingMessage:true},
  {message:{seq:-1}},{message:{seq:Number.MAX_SAFE_INTEGER+1}},{message:{player_id:'P2)&id=neq.P1'}}]){
  const f=fixture(options),result=await f.invoke();unavailable(result,'chat');
 }
});

test('foreign manager, invalid/expired identity and native activation remain denied',async()=>{
 for(const options of [{role:'streamer_admin',actorRoom:'michelle'},{expired:true},{actorSpace:'space-002'}]){
  const f=fixture(options),result=await f.invoke();assert.equal(result.status,400);assert.equal('playerId'in result.body,false);
  assert.equal(f.calls.some(call=>call.path.endsWith('/papa_notifications')),false);
 }
});

test('malformed notice UUID and noncommunication entity are never arbitrary target lookups',async()=>{
 const f=fixture(),invalid=await f.invoke({notificationId:'x)&select=*'});assert.equal(invalid.status,400);
 assert.equal(f.calls.some(call=>call.path.endsWith('/papa_notifications')),false);
 for(const options of [{type:'system'},{type:'announcement',notice:{entity_id:'announcement'}}]){
  const g=fixture(options),result=await g.invoke();unavailable(result,options.type==='system'?'generic':'board');assert.equal(g.calls.length,3);
 }
});

test('reply locator resolves its original root with bounded reads and no content projection',async()=>{
 const f=fixture({type:'comment',posts:[post({root_id:ids.root}),post({id:ids.root,seq:20,author_key:'player:P3'})]}),result=await f.invoke();
 assert.equal(result.status,200);assert.deepEqual(result.body,{found:true,kind:'board',spaceId:'space-001',streamerId:'papa',scope:'streamer',rootId:ids.root,postId:ids.post,seq:80,canReply:true});
 assert.equal(f.calls.filter(call=>call.path.endsWith('/papa_board_posts')).length,2);
 const blockCalls=f.calls.filter(call=>call.path.endsWith('/papa_board_blocks'));assert.equal(blockCalls.length,1);
 assert.equal(blockCalls[0].params.get('target_key'),'in.("player:P2","player:P3")');noContent(result);
});

test('both root and reply visibility are required, with the established root-owner exception',async()=>{
 for(const posts of [
  [post({root_id:ids.root}),post({id:ids.root,visibility:'include',targets:['player:P3']})],
  [post({root_id:ids.root,visibility:'include',targets:['player:P3']}),post({id:ids.root})],
 ]){const f=fixture({type:'comment',posts}),result=await f.invoke();unavailable(result,'board');}
 const f=fixture({type:'comment',posts:[post({root_id:ids.root,visibility:'include',targets:['player:P3']}),post({id:ids.root,author_key:'player:P1'})]}),result=await f.invoke();
 assert.equal(result.body.found,true);assert.equal(result.body.rootId,ids.root);noContent(result);
});

test('blocks, wrong post scope and missing/mismatched roots use one unavailable reply',async()=>{
 for(const options of [
  {blocks:['player:P2']},{posts:[post({space_id:'space-002'})]},
  {posts:[post({streamer_id:'michelle',origin_room:'michelle'})]},
  {posts:[post({root_id:ids.root})]},
  {posts:[post({root_id:ids.root}),post({id:ids.root,origin_room:'michelle'})]},
  {posts:[post({root_id:ids.root}),post({id:ids.root,root_id:ids.message})]},
 ]){const f=fixture({type:'comment',...options}),result=await f.invoke();unavailable(result,'board');}
});

test('anonymous post locator does not query or expose author identity, even for moderators',async()=>{
 for(const role of ['player','streamer_admin','super_admin']){
  const f=fixture({role,type:'comment',posts:[post({anonymous:true,author_key:'player:SECRET'})]}),result=await f.invoke();
  assert.equal(result.body.found,true);assert.equal(JSON.stringify(result.body).includes('SECRET'),false);
  assert.equal(f.calls.some(call=>call.path.endsWith('/papa_board_blocks')),false);noContent(result);
 }
});

test('global board, real announcement post and deleted/moderated root keep existing scoped semantics',async()=>{
 const f=fixture({type:'announcement',posts:[post({scope:'global',streamer_id:'__global__',origin_room:'michelle'})]}),result=await f.invoke();
 assert.equal(result.body.found,true);assert.equal(result.body.scope,'global');noContent(result);
 for(const flag of ['deleted','moderated']){
  const g=fixture({type:'comment',posts:[post({[flag]:true})]}),target=await g.invoke();
  assert.equal(target.body.found,true);assert.equal(target.body.canReply,false);noContent(target);
 }
});
