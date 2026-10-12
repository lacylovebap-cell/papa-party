import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {chatAccess,chatCursor,cleanChatMessage} from '../src/chat-policy.js';
import {boardActor,boardModerator,boardVisible,boardThreadVisible,boardProjection,boardContent,boardAudience,boardUuid,boardCanChange} from '../src/board-policy.js';
import {noticeIdentity} from '../src/access-policy.js';

// Characterize the actual existing Edge helpers before Message Center V2 is
// integrated. These tests do not pretend the proposed V2 endpoints exist.
const read=name=>fs.readFileSync(new URL('../supabase/functions/party-api/'+name,import.meta.url),'utf8');
const chatSource=stripTypeScriptTypes(read('chat.ts').replace(/^import .*;\r?\n/,''));
const boardSource=stripTypeScriptTypes(read('board.ts').replace(/^import .*;\r?\n/,''));
const indexLines=read('index.ts').split(/\r?\n/),noticeStart=indexLines.findIndex(line=>line.startsWith('async function notificationOperation('));
const noticeEnd=indexLines.findIndex((line,index)=>index>noticeStart&&line==='}');
assert.ok(noticeStart>=0&&noticeEnd>noticeStart);
const noticeSource=stripTypeScriptTypes(indexLines.slice(noticeStart,noticeEnd+1).join('\n'));
const uuid='00000000-0000-4000-8000-000000000101',replyUuid='00000000-0000-4000-8000-000000000102';
const rooms=[{id:'papa',slug:'papa',active:true,display_name:'怕怕',spaceId:'space-001'},{id:'other',slug:'other',active:true,display_name:'Other',spaceId:'space-002'}];
function edge(source,operation,{posts=[],api=()=>[]}={}){
 const calls=[],ctx=vm.createContext({TextEncoder,Date,Set,Map,chatAccess,chatCursor,cleanChatMessage,boardActor,boardModerator,boardVisible,boardThreadVisible,boardProjection,boardContent,boardAudience,boardUuid,boardCanChange,noticeIdentity,
  scopeState:(_state,requested)=>({currentStreamer:rooms.find(room=>room.id===requested||room.slug===requested)}),
  api:async(path,body,method)=>{calls.push({path,body,method});if(path.startsWith('/rest/v1/papa_board_blocks?'))return [];if(path.startsWith('/rest/v1/papa_board_posts?id=eq.'))return posts.filter(post=>path.includes('id=eq.'+post.id));return api(path,body,method);}
 });vm.runInContext(source,ctx);
 return {calls,request(body,who={role:'player',playerId:'P1',spaceId:'space-001'}){ctx.body={streamer:'papa',...body};ctx.who=who;ctx.state={streamers:rooms};return vm.runInContext(operation+'(body,who,state)',ctx);}};
}
const root={id:uuid,seq:1,scope:'streamer',streamer_id:'papa',origin_room:'papa',space_id:'space-001',root_id:null,author_key:'player:P2',anonymous:false,visibility:'include',targets:['player:P2'],body:'Private root',deleted:false,version:1,created_at:'2026-10-12T00:00:00Z'};

test('chat denies cross-player, foreign-room manager and different Space before any data query',async()=>{
 const h=edge(chatSource,'chatOperation');
 await assert.rejects(h.request({op:'chatMessages',playerId:'P2'}),/無法查看/);
 await assert.rejects(h.request({op:'chatMessages',playerId:'P1'},{role:'streamer_admin',streamer_id:'other',spaceId:'space-001'}),/只能查看自己的/);
 await assert.rejects(h.request({op:'chatMessages',playerId:'P1',streamer:'other'}),/無法查看/);
 assert.equal(h.calls.length,0);
});

test('a message UUID alone cannot resolve a manager conversation through current chatMessages',async()=>{
 const h=edge(chatSource,'chatOperation');
 await assert.rejects(h.request({op:'chatMessages',entityId:uuid},{role:'streamer_admin',streamer_id:'papa',spaceId:'space-001'}),/請選擇玩家/);
 assert.equal(h.calls.length,0,'no global message UUID query or guessed player is performed');
});

test('board root reads deny private audience and foreign Room/Space without returning content or author projection',async()=>{
 const h=edge(boardSource,'boardOperation',{posts:[root]});
 await assert.rejects(h.request({op:'boardList',scope:'streamer',rootId:uuid}),/留言不存在或無權查看/);
 assert.equal(h.calls.length,2,'only the actor blocks and the one requested root are fetched');
 assert.ok(h.calls[1].path.includes('&space_id=eq.space-001&select=id,seq,'));
 const wrongRoom=edge(boardSource,'boardOperation',{posts:[{...root,streamer_id:'other'}]});
 await assert.rejects(wrongRoom.request({op:'boardList',rootId:uuid}),/留言不存在或無權查看/);
 const wrongSpace=edge(boardSource,'boardOperation',{posts:[root]});
 await assert.rejects(wrongSpace.request({op:'boardList',rootId:uuid,streamer:'other'}),/留言不存在或無權查看/);
 assert.equal(wrongSpace.calls.length,0);
});

test('current boardList accepts root IDs only and does not resolve even an authorized reply UUID',async()=>{
 const h=edge(boardSource,'boardOperation',{posts:[{...root,id:replyUuid,root_id:uuid,visibility:'public'}]});
 await assert.rejects(h.request({op:'boardList',scope:'streamer',rootId:replyUuid},{role:'streamer_admin',streamer_id:'papa',spaceId:'space-001'}),/請開啟原始留言/);
 assert.equal(h.calls.filter(call=>call.path.startsWith('/rest/v1/papa_board_posts?')).length,1);
});

test('noticeRead derives its recipient and Room from the actor and does not advance conversation receipts',async()=>{
 const h=edge(noticeSource,'notificationOperation');
 await h.request({op:'noticeRead',ids:[uuid,'invalid'],recipient:'P2',room:'other'});
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].path,'/rest/v1/papa_notifications?streamer_id=eq.papa&recipient=eq.P1&id=in.('+uuid+')');
 assert.equal(h.calls[0].method,'PATCH');assert.ok(Number.isFinite(Date.parse(h.calls[0].body.read_at)));
 assert.ok(h.calls.every(call=>!call.path.includes('papa_chat_reads')&&!call.path.includes('papa_chat_read')));
});
