import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {balance,playerSearch} from '../src/core.js';

const lines=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').split(/\r?\n/);
const functions=['function playerManagementPanel(','function playerRowsHtml(','function playerResults(','function loadPlayerManagement('].map(prefix=>lines.find(line=>line.startsWith(prefix))).join('\n');
function harness(){
 const models={stored:{mode:'stored',q:'',page:0,rows:[],total:0,loading:false,error:null},all:{mode:'all',q:'',page:2,rows:[{playerId:'b',name:'Beta',ids:['B'],storedCredits:0}],total:50,loading:false,error:null}};
 let mode='stored',local=false,loads=0;
 const state={settings:{},players:[{playerId:'a',name:'Alpha',ids:['A'],names:[]},{playerId:'b',name:'Beta',ids:['B'],names:[]},{playerId:'c',name:'Gamma',ids:[],names:[]}],ledger:[{playerId:'a',amount:2},{playerId:'b',amount:0},{playerId:'c',amount:-1}],crowns:[],queue:[],cards:[]};
 const ctx=vm.createContext({state,balance,playerSearch,playerInputs:{stored:'Alpha',all:'Beta'},adminQuery:'',h:x=>String(x??''),button:(label,action,id='',classes='',extra='')=>'<button data-act="'+action+'" data-id="'+id+'" class="'+classes+'" '+extra+'>'+label+'</button>',
  blank:text=>'<p>'+text+'</p>',paginate:rows=>({rows,nav:''}),localPlayerManagement:()=>local,
  playerManagement:{state:()=>models[mode],load:async()=>{loads++;}}});
 vm.runInContext(functions,ctx);
 return {state,models,ctx,setMode:value=>mode=value,setLocal:value=>local=value,loads:()=>loads,run:code=>vm.runInContext(code,ctx)};
}

test('each player tab displays its own search and server count/page without local pagination',()=>{
 const u=harness();u.models.stored.rows=[{playerId:'a',name:'Alpha',ids:['A'],storedCredits:6}];u.models.stored.total=1;
 let html=u.run('playerManagementPanel()');assert.match(html,/value="Alpha"/);assert.match(html,/共 1 位/);assert.match(html,/💾 6/);assert.doesNotMatch(html,/Beta<\/b>/);
 u.setMode('all');html=u.run('playerManagementPanel()');assert.match(html,/value="Beta"/);assert.match(html,/第 3 頁 · 共 50 位/);assert.match(html,/Beta<\/b>/);
 u.setMode('stored');html=u.run('playerManagementPanel()');assert.match(html,/value="Alpha"/);assert.match(html,/共 1 位/);
});

test('loading and failure states do not expose stale rows; retry is explicit',()=>{
 const u=harness();u.models.stored.rows=[{playerId:'a',name:'Old Result',ids:[],storedCredits:3}];u.models.stored.loading=true;
 let html=u.run('playerManagementPanel()');assert.match(html,/讀取玩家中/);assert.doesNotMatch(html,/Old Result/);
 u.models.stored.loading=false;u.models.stored.error='讀取失敗';html=u.run('playerManagementPanel()');assert.match(html,/重新讀取/);assert.doesNotMatch(html,/Old Result/);assert.equal(u.loads(),0);
});

test('local preview keeps the original state and filters only positive current-pool balances',()=>{
 const u=harness();u.setLocal(true);u.ctx.playerInputs.stored='';u.ctx.playerInputs.all='';
 let html=u.run('playerManagementPanel()');assert.match(html,/Alpha<\/b>/);assert.doesNotMatch(html,/Beta<\/b>|Gamma<\/b>/);
 u.setMode('all');html=u.run('playerManagementPanel()');assert.match(html,/Alpha<\/b>/);assert.match(html,/Beta<\/b>/);assert.match(html,/Gamma<\/b>/);
 u.run('loadPlayerManagement()');assert.equal(u.loads(),0);assert.equal(u.state.players.length,3);assert.equal(u.state.ledger.length,3);
});
