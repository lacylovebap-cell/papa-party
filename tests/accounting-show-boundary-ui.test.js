import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {accountingDay,accountingRollover} from '../src/accounting.js';
import {venuePolicySettings,venuePolicyLedgerPool} from '../src/venue-policy.js';

const app=fs.readFileSync('src/app.js','utf8');
const current=app.split(/\r?\n/).find(line=>line.startsWith('function currentAccounting()'));

test('today UI rejects a previous-show aggregate only at Taipei 19:00 without reusing its values',()=>{
 const context=vm.createContext({state:{summary:{day:'2026-10-12',received:5,sung:3,saved:2}},demo:false,draft:null,accountingDay,accountingRollover,isAdmin:()=>false,clock:()=>context.now,now:'2026-10-13T10:59:59Z'});
 vm.runInContext(current,context);
 assert.equal(context.currentAccounting().received,5);
 context.now='2026-10-12T16:00:00Z';
 assert.equal(context.currentAccounting().received,5);
 context.now='2026-10-13T11:00:00Z';
 assert.equal(context.currentAccounting(),null);
 context.state.summary={day:'2026-10-13',received:0,sung:0,saved:2};
 assert.equal(context.currentAccounting().received,0);
 assert.equal(context.currentAccounting().saved,2);
});

test('home uses compact authoritative cards while queue keeps centered plain text without lifetime balances',()=>{
 const code=app.split(/\r?\n/).filter(line=>line.startsWith('function statsHtml(')||line.startsWith('function homeAccounting(')).join('\n');
 const ctx=vm.createContext({state:{summary:{rolloverHour:19}},accountingDay,accountingRollover,h:String,blank:()=>'',clock:()=> '2026-10-12T16:00:00Z'});
 vm.runInContext(code,ctx);let html=ctx.homeAccounting({received:5,stored:2,sung:5,saved:379});
 assert.equal((html.match(/class="home-accounting-item"/g)||[]).length,3);assert.match(html,/收到新歌<\/span><strong>5/);assert.match(html,/存歌<\/span><strong>2/);assert.match(html,/已唱<\/span><strong>5/);
 assert.doesNotMatch(html,/class="stat"|class="card /);
 const queue=ctx.statsHtml({received:5,stored:2,sung:5,saved:379});
 assert.match(queue,/收到新歌 5 首 ｜ 存歌 2 首 ｜ 已唱 5 首/);assert.doesNotMatch(queue,/class="stat"/);
 assert.ok(!html.includes('379'));assert.ok(html.includes('19:00 換場'));
 ctx.state.summary.rolloverHour=0;html=ctx.homeAccounting({received:0,stored:0,sung:0});assert.ok(html.includes('2026-10-13 場'));assert.ok(html.includes('00:00 換場'));
});
test('only voided history is labelled as record-only; ordinary settlements have no technical preservation label',()=>{
 const code=app.split(/\r?\n/).find(line=>line.startsWith('function ledgerRows('));
 const ctx=vm.createContext({state:{settings:{},ledger:[{id:'old',playerId:'p',amount:3,note:'原收歌',at:'2026-10-12T11:00Z',voided_at:'2026-10-12T12:00Z'},{id:'return',playerId:'p',amount:1,note:'取消待播',at:'2026-10-12T11:10Z',queueId:'q',allocationSettlement:'return'}]},venuePolicySettings,venuePolicyLedgerPool,ledgerQuery:'',paginate:rows=>({rows,nav:''}),timeValue:Date.parse,time:x=>x,h:x=>x,playerName:()=>'',venueSwitch:()=>'',button:()=>'',blank:()=>''});
 vm.runInContext(code,ctx);const html=ctx.ledgerRows('p',true);
 assert.equal(html.split('僅保留紀錄').length-1,1);assert.ok(!html.includes('保留原始紀錄'));
});

test('isolated anonymous preview reads the Core summary instead of recomputing from its redacted rows',()=>{
 const ctx=vm.createContext({state:{summary:{received:5,stored:2,sung:5}},demo:true,draft:null,accountingDay,accountingRollover,clock:()=> '2026-10-13T00:00:00Z',isAdmin:()=>false});
 vm.runInContext(current,ctx);assert.equal(ctx.currentAccounting().stored,2);
});
