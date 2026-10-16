import test from 'node:test';
import assert from 'node:assert/strict';
import {createMedalManagement} from '../src/medal-management.js';
const tick=()=>new Promise(r=>setImmediate(r));
const element=()=>({innerHTML:'',textContent:'',value:'',disabled:false,hidden:false});
const row={code:'sung50',name:'50首兵郎',scope:'streamer',lifetime:'permanent',visibility:'public',manualAllowed:true,recipientCount:1};
const rooms=[{id:'papa',spaceId:'space-001',name:'怕怕'},{id:'mimi',spaceId:'space-002',name:'咪醬'}];
function fixture({superUser=true,override=null}={}){
 const calls=[],events={},toasts=[],elements={'#medal-management':element(),'#dialog':{open:true,close(){this.open=false;}}};
 let picks=[],c={active:true,spaceId:'space-001',room:'papa',actorKey:'manager',revision:1,playerId:'P1'};
 const root={querySelector:s=>elements[s]||null,querySelectorAll:()=>picks,addEventListener:(type,fn)=>(events[type]??=[]).push(fn)};
 const earned=new Set();
 const api=async b=>{calls.push(b);const overridden=override?.(b);if(overridden)return overridden;
  if(b.op==='achievementManualGrantBatch'){b.playerIds.forEach(p=>earned.add(p));return {ok:true,granted:b.playerIds.length,alreadyRecorded:0};}
  if(b.op==='achievementManualGrant')return {ok:true,alreadyRecorded:false};
  const common={version:1,scope:{spaceId:b.spaceId,streamerId:b.streamer},page:b.page||0};
  if(b.view==='catalog')return {...common,rows:[row],isSuper:superUser,rooms:superUser?rooms:[rooms[0]]};
  if(b.view==='recipients')return {...common,total:1,rows:[{playerKey:'a'.repeat(32),name:'不不',earned:true,source:'自動達成',canViewRooms:superUser,roomCount:2}]};
  if(b.view==='recipientRooms')return {...common,total:2,rows:rooms.map((r,i)=>({name:r.name,streamerId:r.id,spaceId:r.spaceId,acquiredAt:'2026-10-15T12:06:00Z',source:i?'管理者授予':'自動達成',currentActive:!i}))};
  if(b.view==='candidates'){const rows=Array.from({length:20},(_,i)=>({playerId:'account:'+String((b.page||0)*20+i),name:'player '+i,publicIds:['ID'+i],earned:earned.has('account:'+String((b.page||0)*20+i))}));picks=rows.map(p=>({dataset:{medalPick:p.playerId},checked:false}));return {...common,total:80,rows};}
  throw Error('Unexpected request '+b.op);
 };
 const modal=()=>{elements['#dialog'].open=true;for(const s of ['[data-medal-management-body]','[data-medal-list-panel="recipients"]','[data-medal-list-panel="candidates"]','[data-medal-grant]','[data-medal-grant-status]','[data-medal-selected-count]'])elements[s]=element();elements['[data-medal-grant-reason]']={value:'核對以前達成紀錄'};};
 const controller=createMedalManagement({api,context:()=>c,root,modal,toast:x=>toasts.push(x)});
 const fire=async(type,dataset={},attrs=[],value='')=>{
  const names=new Set(attrs.concat(Object.keys(dataset).map(x=>'data-'+x.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))));
  const target={dataset,value,checked:true,disabled:false,matches:s=>s.split(',').some(x=>names.has(x.match(/\[([^\]]+)\]/)?.[1])),hasAttribute:n=>names.has(n),closest:()=>target};
  for(const fn of events[type]||[])await fn({target,preventDefault(){},stopImmediatePropagation(){}});await tick();return target;
 };
 const open=()=>fire('click',{medalDetail:'0'});
 return {calls,elements,toasts,controller,fire,open,context:()=>c,setContext:x=>c={...c,...x}};
}

test('president recipients expand lazily and cache details; streamer UI never offers cross-room control',async()=>{
 const f=fixture();await f.controller.load();await f.open();assert.equal(f.calls.filter(x=>x.view==='recipientRooms').length,0);
 const key='a'.repeat(32),panel=element();panel.hidden=true;f.elements['[data-medal-rooms="'+key+'"]']=panel;
 await f.fire('click',{medalExpand:key});assert.equal(f.calls.filter(x=>x.view==='recipientRooms').length,1);assert.match(panel.innerHTML,/怕怕/);assert.match(panel.innerHTML,/咪醬/);assert.match(panel.innerHTML,/判定未生效/);
 await f.fire('click',{medalExpand:key});await f.fire('click',{medalExpand:key});assert.equal(f.calls.filter(x=>x.view==='recipientRooms').length,1,'reopening cached detail should not query');
 const host=fixture({superUser:false});await host.controller.load();assert.doesNotMatch(host.elements['#medal-management'].innerHTML,/data-medal-target/);
 await host.fire('change',{},['data-medal-target-room'],'1');assert.equal(host.calls.length,1);
});

test('page selection persists across pages, respects 50 atomically, clears all and confirms exact target/reason before one batch',async()=>{
 const f=fixture();await f.controller.load();await f.fire('change',{},['data-medal-target-room'],'1');
 await f.open();await f.fire('click',{medalList:'candidates',page:'0'});await f.fire('click',{},['data-medal-select-page']);
 await f.fire('click',{medalList:'candidates',page:'1'});await f.fire('click',{},['data-medal-select-page']);assert.match(f.elements['[data-medal-grant]'].textContent,/40 位/);
 await f.fire('click',{medalList:'candidates',page:'2'});await f.fire('click',{},['data-medal-select-page']);assert.match(f.toasts.at(-1),/50 位/);assert.match(f.elements['[data-medal-grant]'].textContent,/40 位/);
 for(let i=40;i<50;i++)await f.fire('change',{medalPick:'account:'+i,name:'player '+i});
 const overflow=await f.fire('change',{medalPick:'account:50',name:'too many'});assert.equal(overflow.checked,false);assert.match(f.elements['[data-medal-grant]'].textContent,/50 位/);
 assert.equal(f.calls.some(x=>x.op==='achievementManualGrantBatch'),false);
 await f.fire('click',{},['data-medal-clear-selection']);assert.match(f.elements['[data-medal-selected-count]'].textContent,/0 位/);
 await f.fire('click',{medalList:'candidates',page:'0'});await f.fire('click',{},['data-medal-select-page']);
 await f.fire('click',{medalList:'candidates',page:'1'});await f.fire('change',{medalPick:'account:20',name:'another'});
 await f.fire('click',{},['data-medal-grant']);assert.equal(f.calls.some(x=>x.op==='achievementManualGrantBatch'),false);
 const summary=f.elements['[data-medal-grant-status]'].textContent;for(const text of ['50首兵郎','咪醬','21 位','核對以前達成紀錄','原達成時間'])assert.ok(summary.includes(text));
 f.elements['[data-medal-grant-reason]'].value='另一次核對依據';await f.fire('click',{},['data-medal-grant']);assert.equal(f.calls.some(x=>x.op==='achievementManualGrantBatch'),false);
 await f.fire('click',{},['data-medal-grant']);const batch=f.calls.filter(x=>x.op==='achievementManualGrantBatch');assert.equal(batch.length,1);assert.equal(batch[0].playerIds.length,21);assert.equal(batch[0].streamer,'mimi');assert.equal(batch[0].spaceId,'space-002');assert.equal(batch[0].reason,'另一次核對依據');
 await f.fire('click',{},['data-medal-grant']);assert.equal(f.calls.filter(x=>x.op==='achievementManualGrantBatch').length,1);
});

test('late lists cannot survive a scope switch; selected-player grants remain bound to their original room',async()=>{
 let resolve;const f=fixture({override:b=>b.view==='candidates'?new Promise(r=>resolve=r):null});
 await f.controller.load();await f.open();await f.fire('click',{medalList:'candidates',page:'0'});
 await f.fire('change',{},['data-medal-target-room'],'1');
 resolve({version:1,scope:{spaceId:'space-001',streamerId:'papa'},total:1,page:0,rows:[{playerId:'old',name:'private old list'}]});await tick();
 assert.doesNotMatch(f.elements['[data-medal-list-panel="candidates"]'].innerHTML,/private old list/);
 f.controller.openPlayer(row,{id:'P1',name:'selected player'});await f.fire('click',{},['data-medal-grant']);await f.fire('click',{},['data-medal-grant']);
 const grant=f.calls.find(x=>x.op==='achievementManualGrant');assert.equal(grant.streamer,'papa');assert.equal(grant.spaceId,'space-001');assert.equal(grant.playerId,'P1');
});

test('evidence is loaded only on expansion, cached and scoped; late detail cannot cross a streamer switch',async()=>{
 let resolve;const f=fixture({superUser:false,override:b=>b.view==='evidence'?new Promise(r=>resolve=r):null});
 await f.controller.load();await f.open();assert.equal(f.calls.some(x=>x.view==='evidence'),false);assert.match(f.elements['[data-medal-list-panel="recipients"]'].innerHTML,/查看判定細項/);
 const token='a'.repeat(32)+':all',panel=element();panel.hidden=true;f.elements['[data-medal-evidence-panel="'+token+'"]']=panel;
 await f.fire('click',{medalEvidence:token});assert.equal(f.calls.filter(x=>x.view==='evidence').length,1);
 resolve({version:1,scope:{spaceId:'space-001',streamerId:'papa'},rows:[{name:'歌單清道夫',evidenceType:'unavailable',songs:[]}],total:1,page:0});await tick();
 assert.match(panel.innerHTML,/不推測/);await f.fire('click',{medalEvidence:token});await f.fire('click',{medalEvidence:token});assert.equal(f.calls.filter(x=>x.view==='evidence').length,1);
 f.setContext({room:'other'});await f.controller.load();assert.equal(f.elements['#dialog'].open,false);
});

test('revoke requires inspected acquisition, reason and second confirmation; changed reason resets confirmation and retry never doubles it',async()=>{
 let revoked=false;const awardKey='c'.repeat(32),f=fixture({superUser:false,override:b=>{
  if(b.op==='achievementRevoke'){revoked=true;return {ok:true,alreadyRevoked:false};}
  if(b.view==='evidence')return {version:1,scope:{spaceId:'space-001',streamerId:'papa'},total:1,page:0,rows:[{awardKey,name:'歌單清道夫',playerName:'玩家甲',streamerName:'怕怕',acquiredAt:'2026-10-15T12:00:00Z',revokedAt:revoked?'2026-10-16T12:00:00Z':null,evidenceType:'candidate',songs:[]}]};
 }});
 await f.controller.load();await f.open();const token='a'.repeat(32)+':all';f.elements['[data-medal-evidence-panel="'+token+'"]']=element();f.elements['[data-medal-evidence-panel="'+token+'"]'].hidden=true;
 await f.fire('click',{medalEvidence:token});const button=element(),status=element(),reason={value:'短'};
 f.elements['[data-medal-revoke="'+awardKey+'"]']=button;f.elements['[data-medal-revoke-status="'+awardKey+'"]']=status;f.elements['[data-medal-revoke-reason="'+awardKey+'"]']=reason;
 await f.fire('click',{medalRevoke:awardKey});assert.match(status.textContent,/4～500/);
 reason.value='核對主播代骰來源';await f.fire('click',{medalRevoke:awardKey});for(const value of ['玩家甲','怕怕','歌單清道夫','核對主播代骰來源'])assert.ok(status.textContent.includes(value));assert.equal(f.calls.some(x=>x.op==='achievementRevoke'),false);
 reason.value='重新核對主播代骰';await f.fire('click',{medalRevoke:awardKey});assert.equal(f.calls.some(x=>x.op==='achievementRevoke'),false);
 await f.fire('click',{medalRevoke:awardKey});assert.equal(f.calls.filter(x=>x.op==='achievementRevoke').length,1);assert.equal(f.calls.find(x=>x.op==='achievementRevoke').streamer,'papa');assert.match(f.elements['[data-medal-evidence-panel="'+token+'"]'].innerHTML,/已摘除/);
 await f.fire('click',{medalRevoke:awardKey});assert.equal(f.calls.filter(x=>x.op==='achievementRevoke').length,1);
});
