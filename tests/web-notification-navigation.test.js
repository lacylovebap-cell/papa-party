import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {canonicalNoticeLink} from '../src/notification-rules.js';
import {validateNotificationTarget,parseNotificationTarget,notificationTargetPath,notificationTargetView} from '../src/notification-target.js';
import {noticeTargetMatchesRoom,planNotificationLanding} from '../src/notification-landing.js';
import {venuePolicySettings,venuePolicyLedgerPool,venuePolicyHistoryVenue,venuePolicyConsumedPool} from '../src/venue-policy.js';
import {timeValue,queueConfirmed,queuePrepared,queuePreparation} from '../src/core.js';

// Execute the shipping app's navigation and render functions. Keep normal view
// rendering and unrelated API refreshes outside this harness; target planning,
// auth deferral, URL mutation and asynchronous landing guards remain real.
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const start=app.indexOf('function render(){const landing=prepareNoticeLanding();');
const end=app.indexOf('\nasync function loginDialog()',start);
assert.ok(start>=0&&end>start,'the app navigation integration is present');
const integration=app.slice(start,end);
const queueRendering=app.split(/\r?\n/).filter(line=>['function renderCenter(','function playerTabs(','function queueRows(','function paginate(','function sortControl(','const statusName='].some(prefix=>line.startsWith(prefix))).join('\n');
const target=(changes={})=>({version:1,spaceId:'space-001',streamerId:'papa',streamerSlug:'papa',section:'center',entityType:'completed',entityId:'q15',notificationId:'notice-1',...changes});
const queues=()=>Array.from({length:26},(_,i)=>({id:'q'+i,streamer_id:'papa',playerId:'P1',status:i<5?'waiting':'completed',at:new Date(Date.UTC(2026,0,i+1)).toISOString()}));

function harness(overrides={}){
 const effects={views:[],banners:[],toasts:[],frames:[],modals:[],chat:0,board:0,focus:[],scroll:[],history:[]};
 const location={href:'https://paparty.app/?v=test&streamer=papa#home'};
 const dialog={open:false},appNode={insertAdjacentHTML(position,html){assert.equal(position,'afterbegin');effects.banners.push(html);},set innerHTML(html){effects.banners=[];effects.html=html;rowNodes.splice(0,rowNodes.length,...[...html.matchAll(/data-(queue|ledger)-id="([^"]+)"/g)].map(match=>makeRow(match[1],match[2])));},get innerHTML(){return effects.html||'';}};
 const makeRow=(kind,id)=>({dataset:{[kind+'Id']:id},classList:{add(value){this.value=value;}},focus(options){effects.focus.push({id,options});},scrollIntoView(options){effects.scroll.push({id,options});}});
 const rowNodes=[makeRow('queue','q15'),makeRow('queue','q1'),makeRow('ledger','l1')];
 const history={replaceState(_state,_title,url){location.href=String(url);effects.history.push(location.href);}};
 const context=vm.createContext({
  URL,Date,JSON,canonicalNoticeLink,validateNotificationTarget,parseNotificationTarget,notificationTargetPath,notificationTargetView,noticeTargetMatchesRoom,planNotificationLanding,venuePolicySettings,venuePolicyLedgerPool,venuePolicyHistoryVenue,venuePolicyConsumedPool,timeValue,queueConfirmed,queuePrepared,queuePreparation,
  location,history,spaceMount:'https://paparty.app/',streamerSlug:'papa',demo:false,draft:null,entryPending:false,
  session:{playerId:'P1',accountId:'account-1',sessionId:'device-1',token:'token-1'},admin:null,
  state:{currentStreamer:{id:'papa',spaceId:'space-001'},streamers:[{id:'papa',slug:'papa',spaceId:'space-001'},{id:'mi',slug:'michelle',spaceId:'space-002'}],settings:{current_space:'shengma'},queue:queues(),ledger:[],players:[{playerId:'P1',name:'玩家甲'}],songs:[],crowns:[],cards:[],wishes:[]},
  route:'home',tab:'songs',subtab:'overview',selectedPlayer:'other',queueHistory:false,ledgerQuery:'old search',pages:{},listSorts:{queueHistory:'newest'},pendingNoticeTarget:null,noticeLanding:null,
  nativePlayerView:{open:false},playerArchiveView:{open:false},unavailableReadScope:null,syncReadIdentity:()=>'fixture-scope',isAdmin:()=>Boolean(context.admin&&context.route==='admin'),api:async()=>({found:false}),
  $:selector=>selector==='#dialog'?dialog:selector==='#app'?appNode:null,
  document:{querySelector:selector=>selector==='dialog[open]'&&dialog.open?dialog:null,querySelectorAll(selector){return rowNodes.filter(row=>selector==='[data-ledger-id]'?'ledgerId'in row.dataset:'queueId'in row.dataset);}},
  h:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  button:(label,action)=>'<button data-act="'+action+'">'+label+'</button>',toast:message=>effects.toasts.push(message),
  requestAnimationFrame:callback=>effects.frames.push(callback),modal:(...args)=>effects.modals.push(args),playerName:id=>'player '+id,venueName:pool=>pool,time:value=>String(value??''),
  clock:()=> '2026-10-12T00:00:00Z',song:id=>context.state.songs.find(row=>row.songId===id),me:()=>context.state.players.find(row=>row.playerId===context.session?.playerId),card:(_title,body)=>'<section>'+body+'</section>',blank:()=>'<p>沒有資料</p>',selectedQueue:new Set(),
  chat:{open:async()=>{effects.chat++;}},board:{open:async()=>{effects.board++;}},
  applyHomeTheme(){},header(){},loadVisibleFavoriteFlags(){},loadFavoriteAudience(){},loadFavorites(){},loadListeningOverview(){},achievementPanel:{load:async()=>{}},medalManagement:{load:async()=>{}},activityPage:{load:async()=>{}},loadPlayerManagement(){},syncPhotoCarousel(){},
  ...Object.fromEntries(['Admin','Center','Home','CommonBook','Book','Gallery'].map(view=>['render'+view,function(){effects.banners=[];effects.views.push({view,route:context.route,tab:context.tab,subtab:context.subtab});}])),
  ...overrides
 });
 vm.runInContext(integration,context,{filename:'app-notification-navigation.js'});
 return {context,effects,dialog,rowNodes,render:()=>vm.runInContext('render()',context),useActualQueueRendering(){vm.runInContext(queueRendering,context,{filename:'app-player-queue-rendering.js'});},navigate:notice=>context.navigateNotice(notice),flush(){for(const callback of effects.frames.splice(0))callback();}};
}
const notice=(changes={})=>({id:'notice-2',space_id:'space-001',streamer_id:'papa',recipient:'P1',type:'completed',entity_id:'q15',...changes});

test('player notice waits for login, then the actual render opens the authorized history page',()=>{
 const h=harness({session:null,pendingNoticeTarget:target()});h.render();
 assert.equal(h.context.pendingNoticeTarget.entityId,'q15');assert.equal(h.context.noticeLanding,null);
 assert.equal(h.effects.views.at(-1).view,'Home');assert.match(h.effects.banners[0],/請先登入/);assert.equal(h.effects.frames.length,0);
 h.context.session={playerId:'P1',sessionId:'new-login'};h.render();h.flush();
 assert.equal(h.context.pendingNoticeTarget,null);assert.equal(h.context.route,'center');assert.equal(h.context.subtab,'queue');assert.equal(h.context.pages['queue-history'],2);
 assert.equal(h.effects.views.at(-1).view,'Center');assert.equal(h.context.noticeLanding.id,'q15');assert.equal(h.effects.focus[0].id,'q15');assert.equal(new URL(h.context.location.href).hash,'#center');
});

test('manager notice requires manager login even when a player is signed in',()=>{
 const h=harness({pendingNoticeTarget:target({section:'admin',entityType:'saved',entityId:'q1'})});h.render();
 assert.equal(h.context.noticeLanding,null);assert.ok(h.context.pendingNoticeTarget);assert.match(h.effects.banners[0],/請先登入/);
 h.context.admin={role:'streamer_admin',streamerSlug:'papa',accountId:'manager',sessionId:'manager-device'};h.render();h.flush();
 assert.equal(h.context.route,'admin');assert.equal(h.context.tab,'queue');assert.equal(h.context.queueHistory,false);assert.equal(h.context.pages.queue,1);assert.equal(h.context.selectedPlayer,null);assert.equal(h.effects.views.at(-1).view,'Admin');
});

test('empty current queue cannot clamp a notification history target from page 2 to page 1',()=>{
 const h=harness({pendingNoticeTarget:target()});h.useActualQueueRendering();h.context.state.queue=queues().map(row=>({...row,status:'completed'}));h.context.selectedQueue.add('q25');
 h.render();h.flush();
 assert.equal(h.context.pages.queue,1,'the empty current list maintains its own first page');assert.equal(h.context.pages['queue-history'],2,'rendering the empty current list must not clamp the planned history page');
 assert.equal(h.context.noticeLanding.page,2);assert.match(h.effects.html,/data-queue-id="q15"/);assert.doesNotMatch(h.effects.html,/data-queue-id="q25"/);assert.equal(h.effects.focus[0].id,'q15');assert.equal(h.context.selectedQueue.has('q25'),true,'navigation retains cross-page selections');
});

test('empty history queue cannot clamp an active notification target on page 2',()=>{
 const h=harness({pendingNoticeTarget:target({entityType:'ready'})});h.useActualQueueRendering();h.context.state.queue=queues().map(row=>({...row,status:'waiting'}));
 h.render();h.flush();
 assert.equal(h.context.pages.queue,2);assert.equal(h.context.pages['queue-history'],1);assert.match(h.effects.html,/data-queue-id="q15"/);assert.doesNotMatch(h.effects.html,/data-queue-id="q0"/);assert.equal(h.effects.focus[0].id,'q15');
});

for(const change of [{spaceId:'another-space'},{streamerId:'another-room'},{streamerSlug:'another-slug'}])test('target mismatch cannot redirect current authorized view: '+JSON.stringify(change),()=>{
 const h=harness({pendingNoticeTarget:target(change)});h.render();h.flush();
 assert.equal(h.context.pendingNoticeTarget,null);assert.equal(h.context.noticeLanding,null);assert.equal(h.context.route,'home');assert.equal(h.context.subtab,'overview');assert.equal(h.effects.history.length,0);assert.equal(h.effects.toasts.length,1);assert.equal(h.effects.frames.length,0);
});

test('rejecting a new mismatched target clears an older landing banner',()=>{
 const h=harness({pendingNoticeTarget:target()});h.render();h.flush();assert.ok(h.context.noticeLanding);
 h.context.pendingNoticeTarget=target({spaceId:'another-space'});h.render();h.flush();
 assert.equal(h.context.noticeLanding,null);assert.equal(h.effects.banners.length,0);
});

test('a missing record falls back to a finite history list and does not focus another row',()=>{
 const h=harness({pendingNoticeTarget:target({entityId:'deleted-record'})});h.render();h.flush();
 assert.equal(h.context.route,'center');assert.equal(h.context.subtab,'queue');assert.equal(h.context.pages['queue-history'],1);assert.equal(h.context.noticeLanding.found,false);assert.match(h.effects.banners[0],/已移除或目前無法查看/);assert.equal(h.effects.focus.length,0);
});

test('another player record in the same room is unavailable through URL target identity',()=>{
 const h=harness({pendingNoticeTarget:target()});h.context.state.queue[15].playerId='P2';h.render();h.flush();
 assert.equal(h.context.noticeLanding.found,false);assert.equal(h.context.pages['queue-history'],1);assert.equal(h.effects.focus.length,0);
});

test('a credit in another pool opens only that authorized read-only detail and escapes its note',()=>{
 const h=harness({pendingNoticeTarget:target({entityType:'credit',entityId:'l1'})});h.context.state.ledger=[{id:'l1',playerId:'P1',streamer_id:'papa',storage_pool:'radio',amount:2,at:'2026-01-01T00:00:00Z',note:'<script>bad</script>'}];
 h.render();h.flush();assert.equal(h.context.route,'center');assert.equal(h.context.subtab,'ledger');assert.equal(h.context.noticeLanding.detail,true);assert.equal(h.effects.modals.length,1);assert.match(h.effects.modals[0][1],/&lt;script&gt;bad&lt;\/script&gt;/);assert.equal(h.effects.focus.length,0);
});

for(const kind of ['message','comment','credit'])for(const invalidation of ['identity','route','tab','dismiss','dialog'])test(kind+' deferred landing cannot act after '+invalidation+' changes',()=>{
 const h=harness({pendingNoticeTarget:target({entityType:kind,entityId:'l1'})});h.context.state.ledger=[{id:'l1',playerId:'P1',streamer_id:'papa',storage_pool:'radio',amount:2,at:'2026-01-01T00:00:00Z'}];h.render();assert.equal(h.effects.frames.length,1);
 if(invalidation==='identity')h.context.session={...h.context.session,sessionId:'different-device'};
 if(invalidation==='route')h.context.route='book';
 if(invalidation==='tab')h.context.subtab='favorites';
 if(invalidation==='dismiss')h.context.noticeLanding=null;
 if(invalidation==='dialog')h.dialog.open=true;
 h.flush();assert.equal(h.effects.chat,0);assert.equal(h.effects.board,0);assert.equal(h.effects.modals.length,0);assert.equal(h.effects.focus.length,0);
});

test('supported chat and board targets open their authorized recent lists once',async()=>{
 for(const [kind,count]of [['message','chat'],['comment','board']]){const h=harness({pendingNoticeTarget:target({entityType:kind})});h.render();h.flush();await new Promise(setImmediate);assert.equal(h.effects[count],1);h.render();h.flush();await new Promise(setImmediate);assert.equal(h.effects[count],1,'ordinary rerender must not reopen a dismissed communication dialog');}
});

test('opening a new notice clears omitted canonical URL fields and preserves ordinary app parameters',async()=>{
 const h=harness();h.context.location.href='https://paparty.app/?v=test&streamer=papa&streamerId=old&spaceId=old&entityType=credit&entityId=old-ledger&notificationId=old-notice&q=keep#center';
 await h.navigate(notice({type:'system',entity_id:null,id:null}));
 const url=new URL(h.context.location.href),parsed=parseNotificationTarget(url.href,{baseUrl:url.href,mountUrl:h.context.spaceMount});
 assert.equal(url.searchParams.get('v'),'test');assert.equal(url.searchParams.get('q'),'keep');assert.equal(url.searchParams.get('entityId'),null);assert.equal(url.searchParams.get('notificationId'),null);
 assert.equal(parsed.entityType,'system');assert.equal(parsed.entityId,null);assert.equal(parsed.notificationId,null);assert.equal(parsed.streamerId,'papa');assert.equal(parsed.spaceId,'space-001');
});

test('navigate does not replace an active editing dialog or unknown streamer',async()=>{
 const h=harness();h.dialog.open=true;await assert.rejects(h.navigate(notice()),/關閉目前/);h.dialog.open=false;await assert.rejects(h.navigate(notice({streamer_id:'unknown'})),/目前無法查看/);
 assert.equal(h.effects.history.length,0);assert.equal(h.effects.frames.length,0);assert.equal(h.context.pendingNoticeTarget,null);
});

test('cross-room navigation uses canonical mount URL and retains preview isolation',async()=>{
 const h=harness({demo:true});await h.navigate(notice({streamer_id:'mi',space_id:'space-002'}));
 const url=new URL(h.context.location.href);assert.equal(url.origin,'https://paparty.app');assert.equal(url.searchParams.get('streamer'),'michelle');assert.equal(url.searchParams.get('spaceId'),'space-002');assert.equal(url.searchParams.get('demo'),'1');assert.equal(url.searchParams.get('entityId'),'q15');assert.equal(h.effects.views.length,0);assert.equal(h.context.pendingNoticeTarget,null);
});
