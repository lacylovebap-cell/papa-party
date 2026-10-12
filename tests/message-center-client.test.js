import test from 'node:test';import assert from 'node:assert/strict';
import {createMessageCenter,messageCategory} from '../src/message-center.js';
import {messageCenterHtml,messageCenterSettingsHtml} from '../src/message-center-view.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const calls=[],c={accountId:'owner',role:'player',streamer:'papa',streamerId:'papa',spaceId:'space-001'},scope=b=>({spaceId:c.spaceId,streamerId:b.scopeMode==='space'?null:c.streamerId,mode:b.scopeMode});
 const row=(category='system',read_at=null)=>({id:id(category==='system'?1:category==='message'?2:3),space_id:c.spaceId,streamer_id:c.streamerId,streamer_name:'主播',type:category==='message'?'message':category==='board'?'comment':'completed',body:'Original <script> text',created_at:'2026-10-12T00:00:00Z',read_at});
 const page=b=>({version:1,scope:scope(b),category:b.category,page:b.page,pageSize:50,total:151,snapshotId:b.snapshotId||id(100+(b.category==='system'?1:b.category==='message'?2:3)),snapshotAt:'2026-10-12T00:00:00Z',hasMore:(b.page+1)*50<151,rows:[row(b.category)]});
 const counts=b=>({version:1,scope:scope(b),unreadByCategory:{system:3,message:2,board:1},badgeUnreadByCategory:{system:3,message:0,board:1}});
 let respond=async b=>b.op==='messageCenter'?page(b):b.op==='messageCenterCounts'?counts(b):{version:1,scope:scope(b),category:b.category,marked:1};
 const center=createMessageCenter({identity:()=>JSON.stringify(c),context:()=>({...c}),api:async b=>{calls.push(structuredClone(b));return respond(b);}});
 return {c,center,calls,page,counts,row,setResponse:f=>respond=f};
}
test('categories preserve separate snapshots/pages, counts have separate display and badge semantics, and idle count refresh never builds snapshots',async()=>{
 const f=fixture();await f.center.open();const first=f.center.snapshot();assert.equal(first.unread.message,2);assert.equal(first.badges.message,0);assert.equal(f.calls.filter(b=>b.op==='messageCenter').length,1);
 await f.center.loadPage(2);assert.equal(f.calls.at(-1).snapshotId,first.snapshotId);await f.center.setCategory('message');assert.equal(f.center.snapshot().page,0);
 await f.center.loadPage(1);await f.center.setCategory('system');assert.equal(f.center.snapshot().page,2);assert.equal(f.center.snapshot().snapshotId,first.snapshotId);
 const reads=f.calls.filter(b=>b.op==='messageCenter').length;await f.center.refreshCounts();await f.center.refreshCounts();assert.equal(f.calls.filter(b=>b.op==='messageCenter').length,reads);
});
test('snapshot expiry restarts only the chosen category at page one and does not retry generic failures',async()=>{
 const f=fixture();await f.center.open();let attempts=0;f.setResponse(async b=>{if(b.op==='messageCenter'){attempts++;if(b.snapshotId)throw Object.assign(Error('Expired'),{code:'NOTICE_SNAPSHOT_INVALID'});return f.page(b);}return f.counts(b);});
 await f.center.loadPage(2);assert.equal(attempts,2);assert.equal(f.center.snapshot().page,0);assert.equal(f.calls.at(-1).snapshotId,null);
 attempts=0;f.setResponse(async()=>{attempts++;throw Error('Unavailable');});await f.center.loadPage(1);assert.equal(attempts,1);assert.match(f.center.snapshot().error,/Unavailable/);assert.equal(f.center.snapshot().rows.length,0);
});
test('replaced accounts, category switches and closed/reopened views discard delayed private rows and acknowledgments',async()=>{
 const f=fixture(),old=defer();f.setResponse(b=>b.op==='messageCenter'?old.promise:f.counts(b));const pending=f.center.open();f.c.accountId='other';f.setResponse(async b=>b.op==='messageCenter'?f.page(b):f.counts(b));await f.center.open();old.resolve({...f.page({category:'system',page:0,scopeMode:'room'}),rows:[{...f.row(),body:'old account private text'}]});await pending;assert.ok(f.center.snapshot().rows.every(r=>r.body!=='old account private text'));
 const write=defer();f.setResponse(()=>write.promise);const marked=f.center.mark([id(1)]);f.center.cancelPending();f.setResponse(async b=>b.op==='messageCenter'?f.page(b):f.counts(b));await f.center.open();const count=f.calls.length;write.resolve({version:1,scope:{spaceId:'space-001',streamerId:'papa',mode:'room'},category:'system',marked:1});await marked;assert.equal(f.calls.length,count);assert.equal(f.center.snapshot().writeBusy,false);
});
test('uncertain reads are not resent, malformed scope/category data fails closed, and known totals clamp page jumps',async()=>{
 const f=fixture();await f.center.open();let writes=0;f.setResponse(async b=>{if(b.op==='messageCenterRead'){writes++;throw Error('Network interrupted');}return f.page(b);});await f.center.mark([id(1)]);assert.equal(writes,1);await assert.rejects(f.center.mark([id(1)]),/更新訊息/);assert.equal(writes,1);
 f.setResponse(async b=>({...f.page(b),scope:{spaceId:'foreign',streamerId:'papa',mode:'room'}}));await f.center.loadPage(0,true);assert.equal(f.center.snapshot().rows.length,0);assert.match(f.center.snapshot().error,/範圍/);
 f.setResponse(async b=>({...f.page(b),total:0,rows:[],hasMore:false}));await f.center.loadPage(99,true);assert.equal(f.center.snapshot().page,0);
 await assert.rejects(f.center.setScope('space'),/範圍/);await assert.rejects(f.center.setCategory('constructor'),/分類/);
});
test('read calls bind the explicit category/scope without touching chat receipts; each category-all action is explicit',async()=>{
 const f=fixture();await f.center.open();await f.center.mark([id(1)]);let read=f.calls.find(b=>b.op==='messageCenterRead');assert.deepEqual(read,{op:'messageCenterRead',streamer:'papa',scopeMode:'room',category:'system',ids:[id(1)]});
 await f.center.setCategory('message');await f.center.mark(null,true);read=f.calls.filter(b=>b.op==='messageCenterRead').at(-1);assert.equal(read.category,'message');assert.equal(read.all,true);assert.equal('ids'in read,false);assert.ok(f.calls.every(b=>b.op!=='chatRead'));
});
test('the shipped shell escapes notice bodies, has fixed category/list/footer regions, scoped labels, empty states and bounded jumps',()=>{
 const f=fixture(),v=f.center.snapshot();Object.assign(v,{total:151,page:2,countsReady:true,rows:[f.row()],unread:{system:4,message:2,board:0}});
 const html=messageCenterHtml(v,{scopeLabel:'此主播 · <unsafe>',canUseSpace:true,canNavigate:true,canOpenCategory:true});assert.doesNotMatch(html,/<script>|<unsafe>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/role="tablist"/);assert.match(html,/notice-center-list/);assert.match(html,/notice-center-footer/);assert.match(html,/max="4" value="3"/);assert.match(html,/此分類全部已讀/);assert.equal((html.match(/data-notice="centerCategory"/g)||[]).length,3);
 v.rows=[];v.total=0;v.page=0;assert.match(messageCenterHtml(v,{scopeLabel:'Room'}),/目前沒有系統通知/);assert.match(messageCenterHtml(v,{scopeLabel:'Room'}),/max="1" value="1"/);
 const settings=messageCenterSettingsHtml({types:{message:{center:false,badge:true}}},{message:['私人訊息']},'Scope');assert.match(settings,/notice-center-settings/);assert.doesNotMatch(settings,/name="message.center" checked/);assert.match(settings,/name="message.badge" checked/);assert.equal(messageCategory('future-unknown'),'system');
});
