import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {requestSourceLabel} from '../src/request-source.js';
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const queueRows=app.split(/\r?\n/).find(line=>line.startsWith('function queueRows('));
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(rows,{manager=false,playerId='mine',songs=[],history=false,currentSort='newest',historySort='newest',showSort=true,sortCurrent=!manager}={}){
 const original=structuredClone(rows),context=vm.createContext({listSorts:{queueCurrent:currentSort,queueHistory:historySort},timeValue:value=>Date.parse(value)||0,
  paginate:rows=>({rows,nav:''}),queueConfirmed:()=>true,queuePrepared:()=>true,queuePreparation:()=> '已準備好',clock:()=>'',
  song:id=>songs.find(song=>song.songId===id),h,requestSourceLabel,selectedQueue:new Set(),session:{playerId},playerName:()=> '我的名字',
  statusName:{completed:'🎤 已完成',cancelled:'已取消'},time:value=>h(value),venuePolicyHistoryVenue:()=>false,venueName:()=>'',venuePolicyConsumedPool:()=>'',
  sortControl:()=>'',button:(label,action,id='',classes='')=>`<button class="${classes}" data-act="${action}" data-id="${h(id)}">${label}</button>`});
 vm.runInContext(queueRows,context);const result=context.queueRows(rows,manager,true,history,showSort,sortCurrent);assert.deepEqual(rows,original);return result;
}
const record={id:'q',playerId:'mine',songId:'s',title:'歷史 <歌名>',artist:'',kind:'live',status:'waiting',at:'2026-10-01T00:00:00Z'};

test('cross dice and automatic self sources keep their visible exclusion markers in player and manager records',()=>{
 for(const manager of [false,true]){
  assert.match(render([{...record,selfProvided:true,source:'cross_draw'}],{manager}),/🎲 骰子自帶（不計熱門／常聽）/);
  assert.match(render([{...record,selfProvided:true,source:'cross_self'}],{manager}),/自帶（不計熱門／常聽）/);
  assert.doesNotMatch(render([{...record,selfProvided:false,source:'manual'}],{manager}),/不計熱門／常聽/);
 }
});
test('player records show complete escaped song, artist, status, request time and personal note without management controls',()=>{
 const html=render([{...record,requestNote:'請唱 <script> & 完整備註'}],{songs:[{songId:'s',artist:'原歌手 <A>'}]});
 assert.match(html,/queue-player-view/);assert.match(html,/歷史 &lt;歌名&gt;/);assert.match(html,/原歌手 &lt;A&gt;/);assert.match(html,/已準備好.*現點.*2026-10-01T00:00:00Z/s);
 assert.match(html,/請唱 &lt;script&gt; &amp; 完整備註/);assert.match(html,/queue-own-cancel/);assert.doesNotMatch(html,/queue-controls|data-queue-select|queueOp|我的名字|<script>/);
});
test('completed history uses performed time for ordering and display, preserves snapshot artists and never shows cancel',()=>{
 const html=render([{...record,id:'older',title:'先唱',status:'completed',artist:'原快照歌手',completedAt:'2026-10-10T00:00:00Z'},
  {...record,id:'newer',title:'後唱',status:'completed',effective_at:'2026-10-11T00:00:00Z',items:[{title:'後唱',artist:'配對歌手',performances:2}]}],{history:true,songs:[{songId:'s',artist:'已變更歌手'}]});
 assert.ok(html.indexOf('後唱')<html.indexOf('先唱'));assert.match(html,/後唱 ×2/);assert.match(html,/配對歌手/);assert.match(html,/原快照歌手/);
 assert.match(html,/2026-10-11T00:00:00Z/);assert.match(html,/2026-10-10T00:00:00Z/);assert.doesNotMatch(html,/cancelOwn|queueOp|已變更歌手/);
});
test('another player pending record cannot expose the own cancel action',()=>{
 assert.doesNotMatch(render([{...record,playerId:'someone-else'}]),/cancelOwn|queueOp/);
});
test('manager records retain checkbox, primary completion and separate expandable secondary actions',()=>{
 const html=render([record],{manager:true});assert.match(html,/queue-manager-view/);assert.match(html,/data-queue-select="q"/);
 assert.match(html,/queue-primary.*完成演唱/s);assert.match(html,/<details class="queue-more"><summary>更多<\/summary><div class="queue-more-content">/);
 for(const action of ['editQueue','stage','recordTime','move'])assert.match(html,new RegExp('data-act="'+action+'"'));
 assert.doesNotMatch(html,/cancelOwn/);
});

test('player current and history sorts are independent, and current sorting uses request time',()=>{
 const rows=[{...record,id:'old',title:'較早點歌',at:'2026-10-01T00:00:00Z',effective_at:'2026-10-12T00:00:00Z'},
  {...record,id:'new',title:'較晚點歌',at:'2026-10-11T00:00:00Z',effective_at:'2026-10-02T00:00:00Z'}];
 const newest=render(rows,{historySort:'oldest'});assert.ok(newest.indexOf('較晚點歌')<newest.indexOf('較早點歌'));
 const oldest=render(rows,{currentSort:'oldest',historySort:'newest'});assert.ok(oldest.indexOf('較早點歌')<oldest.indexOf('較晚點歌'));
 const completed=rows.map(row=>({...row,status:'completed'}));
 const history=render(completed,{history:true,currentSort:'oldest'});assert.ok(history.indexOf('較早點歌')<history.indexOf('較晚點歌'));
});

test('manager waiting order stays manual while the selected player profile can sort its current operations',()=>{
 const rows=[{...record,title:'手動第一首',at:'2026-10-01T00:00:00Z'},{...record,id:'second',title:'手動第二首',at:'2026-10-11T00:00:00Z'}];
 const manual=render(rows,{manager:true});assert.ok(manual.indexOf('手動第一首')<manual.indexOf('手動第二首'));
 const profile=render(rows,{manager:true,showSort:false,sortCurrent:true});assert.ok(profile.indexOf('手動第二首')<profile.indexOf('手動第一首'));
});
