import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {timeValue,stamp,hourKey,savedQuota} from '../src/core.js';
import {eventDescription} from '../src/catalog-tools.js';
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),lines=app.split(/\r?\n/),line=prefix=>lines.find(x=>x.startsWith(prefix));
function ui(){
 const sent=[],now='2026-10-09T14:30:00Z',state={currentStreamer:{id:'papa'},settings:{hourlyLimit:2},extraQuotas:[{streamer_id:'papa',player_id:'P1',extra_quota:2,enabled:true}],hourBucket:hourKey(now),hourlyPersonal:{used:0,reserved:1,extraQuota:2,personalUsed:0,extraRemaining:2,commonRemaining:1},
  songs:[],ledger:[],crowns:[],cards:[],wishes:[],badges:[],queue:[{id:'Q1',kind:'saved',status:'completed',playerId:'P1',title:'Song',at:'2026-10-09T12:50:00Z',effective_at:'2026-10-09T12:55:00Z',completedAt:'2026-10-09T12:55:00Z'}],
  players:[{playerId:'P1',name:'玩家',ids:[],names:[],quotaRights:[{streamer_id:'papa',streamer_name:'怕怕',extra_quota:2},{streamer_id:'second',streamer_name:'主播B',extra_quota:3}]}]};
 let captured,manager=true;
 const context=vm.createContext({state,sent,draft:null,demo:false,Date,Object,Number,Map,timeValue,stamp,hourKey,savedQuota,offset:0,subtab:'overview',session:{playerId:'P1'},clock:()=>now,isAdmin:()=>manager,hostName:()=> '怕怕',balance:()=>10,me:()=>state.players[0],say:()=>'',blank:()=>'',time:x=>x,
  song:()=>null,button:(label,action)=>'<button data-act="'+action+'">'+label+'</button>',modal:(title,html,submit)=>captured={title,html,submit},dispatch:async(type,data)=>sent.push({type,data})});
 const escapeLine=line('const $=');vm.runInContext('const '+escapeLine.slice(escapeLine.indexOf('h=')),context);
 vm.runInContext(['const field=','const area=','const check=','const dateInput=','const isoInput='].map(line).join('\n')+'\n'+app.slice(app.indexOf('function editExtraQuota('))+'\n'+line('function hour(){')+'\n'+line('function playerTabs('),context);
 return {context,state,sent,run:source=>vm.runInContext(source,context),setManager:value=>manager=value,get modal(){return captured;}};
}
test('history time button opens a real editor and submits business time without credit, song or player edits',async()=>{
 const u=ui();u.run("recordTime('queue','Q1')");assert.equal(u.modal.title,'修改歷史時間');assert.match(u.modal.html,/name="effective_at"/);assert.match(u.modal.html,/value="2026-10-09T20:55"/);assert.match(u.modal.html,/共用與專屬提歌額度/);
 await u.modal.submit(new Map([['effective_at','2026-10-09T21:10'],['note','修正']]));assert.deepEqual(JSON.parse(JSON.stringify(u.sent)),[{type:'recordTime',data:{table:'queue',id:'Q1',times:{effective_at:'2026-10-09T13:10:00.000Z'},note:'修正'}}]);
 u.setManager(false);assert.throws(()=>u.run("recordTime('queue','Q1')"),/登入管理/);
});
test('quota editor keeps variable amounts and disable option; profile crowns are separate text for each room',async()=>{
 const u=ui();u.run("editExtraQuota('P1')");assert.match(u.modal.html,/value="2"/);assert.match(u.modal.html,/每小時額外首數/);assert.match(u.modal.html,/name="enabled" checked/);
 await u.modal.submit(new Map([['extra_quota','3']]));assert.deepEqual(JSON.parse(JSON.stringify(u.sent)),[{type:'extraQuota',data:{player_id:'P1',extra_quota:3,enabled:false}}]);
 const html=u.run("playerTabs('P1')");assert.match(html,/👑 專屬怕怕提歌權 \+2/);assert.match(html,/👑 專屬主播B提歌權 \+3/);assert.match(html,/<p class="exclusive-quota"/);
 u.setManager(false);assert.throws(()=>u.run("editExtraQuota('P1')"),/登入管理/);
});
test('player hourly display adds remaining personal rights and names the common/private split',()=>{
 const u=ui();u.setManager(false);const html=u.run('hour()');assert.match(html,/還可使用 3 首額度/);assert.match(html,/共用 1 ＋ 專屬 2/);assert.doesNotMatch(html,/提滿了/);
});
test('audit summaries describe the real manager and corrected time without claiming a live request consumes quota',()=>{
 const names={playerName:()=> '玩家',roomName:()=> '怕怕'};
 assert.match(eventDescription({entity_kind:'extra_quota',actor_role:'streamer_admin',streamer_id:'papa',after_data:{playerId:'P1',enabled:true,extra_quota:3}},names),/怕怕設定玩家在怕怕的專屬提歌權 \+3/);
 assert.match(eventDescription({entity_kind:'queue',actor_role:'super_admin',action:'recordTime',after_data:{playerId:'P1',title:'Song',kind:'saved'}},names),/重新計算提歌額度/);
 assert.doesNotMatch(eventDescription({entity_kind:'queue',actor_role:'super_admin',action:'recordTime',after_data:{playerId:'P1',title:'Song',kind:'live'}},names),/提歌額度/);
});

test('real quota rights are never silently changed in a local draft',()=>{const u=ui();u.run('draft={state:{}}');assert.throws(()=>u.run("editExtraQuota('P1')"),/退出草稿/);assert.equal(u.sent.length,0);u.run('demo=true');assert.doesNotThrow(()=>u.run("editExtraQuota('P1')"));});
