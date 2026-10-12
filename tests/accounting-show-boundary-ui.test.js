import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {accountingDay} from '../src/accounting.js';

const app=fs.readFileSync('src/app.js','utf8');
const current=app.split(/\r?\n/).find(line=>line.startsWith('function currentAccounting()'));

test('today UI rejects a previous-show aggregate only at Taipei 19:00 without reusing its values',()=>{
 const context=vm.createContext({state:{summary:{day:'2026-10-12',received:5,sung:3,saved:2}},demo:false,draft:null,accountingDay,isAdmin:()=>false,clock:()=>context.now,now:'2026-10-13T10:59:59Z'});
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

test('default and customized home accounting dates keep the existing Taipei 19:00 show captions',()=>{
 const lines=app.split(/\r?\n/).filter(line=>line.includes("card('🌙 今日帳務'"));
 assert.equal(lines.length,2);
 for(const line of lines){
  assert.ok(line.includes("dayLabel(clock())+' · 每天 19:00 換場</small>'"));
  assert.ok(!line.includes('00:00 換日'));
 }
});
