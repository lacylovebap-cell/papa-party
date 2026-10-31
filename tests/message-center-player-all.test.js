import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageCenter} from '../src/message-center.js';
import {messageCenterHtml} from '../src/message-center-view.js';

const player={role:'player',recipient:'P1',spaceId:'space-001',streamer:'papa',streamerId:'papa',accountId:'a'};
function center(){
 const calls=[];
 const api=async b=>{calls.push(b);const scope={spaceId:'space-001',mode:b.scopeMode,streamerId:b.scopeMode==='space'?null:(b.streamer==='mi'?'mi-id':'papa')};
  if(b.op==='messageCenterCounts')return {version:1,scope,unreadByCategory:{system:3},badgeUnreadByCategory:{system:3}};
  const rows=[{id:'00000000-0000-4000-8000-000000000001',space_id:'space-001',streamer_id:'papa',streamer_name:'怕怕',type:'call',body:'📣 怕怕呼叫中，速回！',created_at:'2026-10-31T15:00:00Z',read_at:null},
   {id:'00000000-0000-4000-8000-000000000002',space_id:'space-001',streamer_id:'mi-id',streamer_name:'咪醬',type:'ready',body:'咪醬｜《小幸運》準備好演唱囉',created_at:'2026-10-31T14:00:00Z',read_at:null}];
  const chosen=b.scopeMode==='space'?rows:rows.filter(r=>r.streamer_id===scope.streamerId);
  return {version:1,scope,category:b.category,page:0,pageSize:50,total:chosen.length,snapshotId:'00000000-0000-4000-8000-0000000000aa',snapshotAt:'2026-10-31T15:01:00Z',hasMore:false,rows:chosen};};
 const c=createMessageCenter({api,context:()=>player,identity:()=>'P1',canUseSpace:c=>c.role==='player',defaultScope:()=>'space'});
 return {c,calls};
}
test('a player opens one list with every streamer, and can narrow it to one streamer',async()=>{
 const {c,calls}=center();await c.open();
 assert.equal(c.snapshot().scopeMode,'space');assert.equal(c.snapshot().rows.length,2);
 await c.setFilter({slug:'mi',id:'mi-id',name:'咪醬'});
 const page=calls.filter(b=>b.op==='messageCenter').at(-1);assert.equal(page.streamer,'mi');assert.equal(page.scopeMode,'room');
 assert.deepEqual(c.snapshot().rows.map(r=>r.streamer_name),['咪醬']);
 assert.equal(calls.filter(b=>b.op==='messageCenterCounts').at(-1).scopeMode,'space','unread counts still cover every streamer');
 await c.setFilter(null);assert.equal(c.snapshot().rows.length,2);
});
test('the player view shows 全部 + one chip per streamer and tags each notice with its streamer',()=>{
 const v={category:'system',scopeMode:'space',rows:[{id:'x',streamer_name:'咪醬',type:'ready',body:'咪醬｜《小幸運》準備好演唱囉',created_at:'2026-10-31T14:00:00Z',read_at:null}],page:0,total:1,hasMore:false,countsReady:true,unread:{system:1,message:0,board:0},badges:{system:1,message:0,board:0}};
 const html=messageCenterHtml(v,{scopeLabel:'全部主播的通知',streamerFilters:[{slug:'',label:'全部',active:true},{slug:'mi',label:'咪醬',active:false}]});
 assert.match(html,/data-notice="centerStreamer" data-streamer="" aria-pressed="true"[^>]*>全部/);assert.match(html,/data-streamer="mi"[^>]*>咪醬/);
 assert.match(html,/notice-streamer-tag">咪醬<\/span>/);assert.match(html,/<p>《小幸運》準備好演唱囉<\/p>/,'the name is not repeated in the text');
 assert.doesNotMatch(html,/data-notice="centerScope"/);
});
