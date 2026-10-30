import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const lines=source.split(/\r?\n/),line=prefix=>{const found=lines.find(l=>l.startsWith(prefix));assert.ok(found,prefix);return found;};
function ui(subtab){
 const state={settings:{},players:[{playerId:'P1',name:'不不',ids:[],names:[]}],queue:[{id:'Q1',playerId:'P1',title:'小幸運',status:'completed',at:'2026-10-28T12:00:00Z'}],crowns:[],cards:[],wishes:[],
  ledger:[{id:'L1',playerId:'P1',amount:3,note:'一般 3 首',at:'2026-10-27T12:00:00Z'},{id:'L2',playerId:'P1',amount:-1,note:'提歌',queueId:'Q1',at:'2026-10-28T12:00:00Z'},{id:'L3',playerId:'P1',amount:2,note:'誤登',voided_at:'2026-10-29T00:00:00Z',at:'2026-10-29T00:00:00Z'}]};
 const context=vm.createContext({state,subtab,ledgerFilter:'all',historyView:'all',statusName:{completed:'🎤 已完成',cancelled:'已取消'},pages:{},session:{playerId:'P1'},demo:true,draft:null,noticeLanding:null,ledgerQuery:'',inNativeSpace:()=>false,
  h:x=>String(x??''),blank:x=>'<p>'+(x||'空')+'</p>',say:()=>'',time:x=>x,timeValue:x=>Date.parse(x),button:(label,action,id='',cls='',extra='')=>'<button data-act="'+action+'" data-id="'+id+'" class="'+cls+'" '+extra+'>'+label+'</button>',
  venuePolicySettings:()=>({current_space:'shengma',radio_enabled:false}),venuePolicyLedgerPool:()=>'shengma',balance:()=>4,storedBalanceHtml:()=>'4 首',playerName:()=>'不不',
  paginate:rows=>({rows,nav:'<div class="pagination"></div>'}),sortControl:()=>'',queueRows:rows=>rows.map(q=>'<article data-queue-id="'+q.id+'"></article>').join('')+'<div class="pagination"></div>',centerWaitingHtml:()=>'',
  listeningOverviewHtml:()=>'',isSuperAdmin:()=>false,venueSwitch:()=>'',playerArchiveView:{pending:new Set()},favoritesPanelHtml:()=>'',crownsHtml:()=>'冠歌內容',orderedCards:x=>x,photoHtml:()=>'',wishRows:()=>'許願內容'});
 vm.runInContext(['function playerTabs(','function playerCenterNav(','function queueRowOnly(','function playerHistoryHtml(','function ledgerRows(','function ledgerItemHtml(','function playerLedgerItemHtml(','function ledgerSongName('].map(line).join('\n'),context);
 return code=>vm.runInContext(code,context);
}
test('player nav: 總覽｜點歌歷史｜我的最愛｜勳章 then 更多 holding 冠歌、卡片、許願; no player 存歌 tab',()=>{
 const html=ui('overview')('playerTabs("P1")'),nav=html.match(/<nav[\s\S]*<\/nav>/)[0];
 assert.deepEqual([...nav.matchAll(/data-act="subtab" data-id="(\w+)"/g)].map(m=>m[1]),['overview','queue','favorites','achievements','crowns','cards','wishes']);
 assert.match(nav,/<details class="player-more-tabs"><summary[^>]*>更多/);assert.doesNotMatch(nav,/data-id="ledger"/);
 const crowns=ui('crowns')('playerTabs("P1")');assert.match(crowns,/player-more-tabs active"><summary[^>]*>👑 冠歌/);
});
test('streamer view of a player keeps the original tab row including 存歌',()=>{
 const html=ui('overview')('playerTabs("P1",true)');assert.doesNotMatch(html,/player-more-tabs/);assert.match(html,/data-id="ledger"/);assert.doesNotMatch(html,/data-id="favorites"/);
});
test('點歌歷史: balance, then 全部紀錄 timeline, 存歌明細 with ＋／− filter',()=>{
 const run=ui('queue');run("historyView='all'");const all=run('playerTabs("P1")');
 assert.match(all,/目前剩餘存歌<b>4 首<\/b>/);assert.match(all,/全部紀錄[\s\S]*存歌明細/);assert.doesNotMatch(all,/點歌紀錄/);
 const timeline=all.slice(all.indexOf('player-history-all'));assert.deepEqual([...timeline.matchAll(/data-(queue|ledger)-id="(\w+)"/g)].map(m=>m[2]),['L3','Q1','L1']);assert.match(timeline,/data-queue-id="Q1"[^]*?小幸運 <small>· 現點<\/small>[^]*?player-record-amount negative">-1 首<\/span>/);assert.doesNotMatch(timeline,/怕怕|已完成/);
 run("historyView='queue'");assert.match(run('playerTabs("P1")'),/player-history-all/);
 run("historyView='ledger'");const l=run('playerTabs("P1")');assert.equal((l.match(/data-ledger-id=/g)||[]).length,3);assert.doesNotMatch(l,/data-queue-id/);assert.doesNotMatch(l,/💾 存歌/);assert.match(l,/提歌 <small>· 🎵 小幸運<\/small>/);assert.match(l,/僅保留紀錄/);
 assert.deepEqual([...run('ledgerRows("P1",false,"in")').matchAll(/data-ledger-id="(\w+)"/g)].map(m=>m[1]),['L3','L1']);
 assert.deepEqual([...run('ledgerRows("P1",false,"out")').matchAll(/data-ledger-id="(\w+)"/g)].map(m=>m[1]),['L2']);
 assert.doesNotMatch(run('ledgerRows("P1",true)'),/🎵/);
 assert.doesNotMatch(ui('queue')('playerTabs("P1",true)'),/player-history/);
});
test('old player 存歌 links land on 點歌歷史 → 存歌紀錄 and filters restart at page 1',()=>{
 assert.match(source,/function renderCenter\(\)\{const p=me\(\);if\(subtab==='ledger'\)\{subtab='queue';historyView='ledger';ledgerFilter='all';scrollToPlayerLedger=true;/);
 assert.match(source,/case 'ledgerFilter':ledgerFilter=\['in','out'\]\.includes\(id\)\?id:'all';pages\.ledger=1;render\(\);break;/);
 assert.match(source,/case 'myLedger':subtab='ledger';await go\('center'\);/);
});
