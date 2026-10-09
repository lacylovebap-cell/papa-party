import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {balance,reservedCredits,queueConfirmed,queuePrepared,queuePreparation} from '../src/core.js';
import {venuePolicySettings,venuePolicyHistoryVenue,venuePolicyLedgerPool,venuePolicyConsumedPool,venuePolicySavedSnapshot} from '../src/venue-policy.js';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').split(/\r?\n/);
const take=prefix=>{const value=source.find(line=>line.startsWith(prefix));assert.ok(value,prefix);return value;};
const functions=['const venueName=','function venueSelector(','function venueSwitch(','function storedBalanceHtml(','function ledgerRows(','function queueRows(','function updateProxyCredits(','async function requestSong('].map(take).join('\n');
const at='2026-10-09T12:30:00Z';
function harness(settings={}){
 const state={settings:{hourlyLimit:2,...settings},players:[{playerId:'p',name:'玩家'}],songs:[{songId:'s',title:'原本的歌曲',artist:'歌手',creditCost:2}],crowns:[],ledger:[],queue:[]};
 const modals=[],sent=[];
 const ctx=vm.createContext({state,session:{playerId:'p'},balance,reservedCredits,queueConfirmed,queuePrepared,queuePreparation,venuePolicySettings,venuePolicyHistoryVenue,venuePolicyLedgerPool,venuePolicyConsumedPool,venuePolicySavedSnapshot,
  h:x=>String(x??''),button:(label,action,id='',classes='tiny')=>'<button data-act="'+action+'" data-id="'+id+'" class="'+classes+'">'+label+'</button>',
  select:(name,label,options,value)=>'<label>'+label+'<select name="'+name+'">'+options.map(([id,label])=>'<option value="'+id+'" '+(id===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>',
  field:(name,label,value='',type='text',extra='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+value+'" '+extra+'></label>',
  modal:(title,html,submit)=>modals.push({title,html,submit}),dispatch:async(type,data)=>sent.push({type,data:structuredClone(data)}),
  loginDialog:()=>{},song:id=>state.songs.find(s=>s.songId===id),toast:()=>{},crownFor:()=>null,clock:()=>at,shortSongOptions:()=>'',check:()=>'',money:x=>x,say:()=>'',
  paginate:rows=>({rows,nav:''}),time:x=>x,timeValue:Date.parse,playerName:()=> '玩家',selectedQueue:new Set(),statusName:{completed:'已唱',cancelled:'已取消'},blank:()=>'',ledgerQuery:'',playerSearch:()=>[]});
 vm.runInContext(functions,ctx);
 return {state,modals,sent,ctx,run:code=>vm.runInContext(code,ctx)};
}

test('disabled radio leaves the existing controls absent and legacy credits usable',async()=>{
 const u=harness();u.state.ledger.push({playerId:'p',amount:5});
 assert.equal(u.run('venueSwitch()'),'');assert.equal(u.run('venueSelector()'),'');assert.equal(u.run("storedBalanceHtml('p')"),'5 首');
 await u.run("requestSong('s','saved')");assert.match(u.modals[0].title,/確認提歌/);
});

test('enabled controls keep venue distinct from live work status and show both existing pools',()=>{
 const u=harness({radio_enabled:true,current_space:'radio'});u.state.ledger.push({playerId:'p',amount:5},{playerId:'p',amount:1,storage_pool:'radio'});
 const html=u.run('venueSwitch()');assert.match(html,/data-id="radio" class="tiny active"/);assert.match(html,/聲瑪/);assert.doesNotMatch(html,/忙碌|準備|暫停/);
 assert.match(u.run('venueSelector()'),/value="radio" selected/);assert.equal(u.run("storedBalanceHtml('p')"),'聲瑪 5 首 · 電台 1 首');
});

test('player confirmation uses the fallback pool without sending a venue override',async()=>{
 const u=harness({radio_enabled:true,current_space:'radio'});u.state.ledger.push({playerId:'p',amount:5},{playerId:'p',amount:1,storage_pool:'radio'});
 await u.run("requestSong('s','saved')");assert.match(u.modals[0].title,/確認提歌/);assert.match(u.modals[0].html,/扣 2 首存歌/);
 await u.modals[0].submit(new Map());assert.equal(u.sent[0].data.kind,'saved');assert.equal(Object.hasOwn(u.sent[0].data,'venue'),false);assert.equal(Object.hasOwn(u.sent[0].data,'consumed_storage_pool'),false);
});

test('insufficient separate pools keep the live-request fallback instead of combining credits',async()=>{
 const u=harness({radio_enabled:true,current_space:'radio'});u.state.ledger.push({playerId:'p',amount:1},{playerId:'p',amount:1,storage_pool:'radio'});
 await u.run("requestSong('s','saved')");assert.equal(u.modals[0].title,'沒有可提的存歌');assert.match(u.modals[0].html,/前往現點/);assert.equal(u.sent.length,0);
});

test('stored records filter by current pool while song and performance histories remain intact',()=>{
 const u=harness({radio_enabled:true,current_space:'radio'});u.state.ledger.push({playerId:'p',amount:5,note:'聲瑪來源',at},{playerId:'p',amount:2,storage_pool:'radio',note:'電台來源',at});
 assert.match(u.run("ledgerRows('p',false)"),/電台來源/);assert.doesNotMatch(u.run("ledgerRows('p',false)"),/聲瑪來源/);
 u.state.settings.current_space='shengma';assert.match(u.run("ledgerRows('p',false)"),/聲瑪來源/);assert.doesNotMatch(u.run("ledgerRows('p',false)"),/電台來源/);
 assert.equal(u.state.songs.length,1);assert.equal(u.state.ledger.length,2);
});

test('history uses its saved venue and exposes the consumed pool only in details',()=>{
 const u=harness({radio_enabled:true,current_space:'shengma'});u.state.queue.push({id:'q',songId:'s',playerId:'p',title:'原本的歌曲',artist:'歌手',kind:'saved',status:'completed',venue:'radio',consumed_storage_pool:'shengma',at});
 const html=u.run('queueRows(state.queue,true,true)');assert.match(html,/提歌 · .* · 📻 電台/);assert.match(html,/<details class="queue-more">.*扣存歌來源：聲瑪/s);
 delete u.state.queue[0].venue;const legacy=u.run('queueRows(state.queue,true,true)');assert.doesNotMatch(legacy,/提歌 · .* · 📻 電台/);assert.doesNotMatch(legacy,/提歌 · .* · 聲瑪/);
});

test('proxy player hints use available credits after reservations and follow the explicit venue',()=>{
 const u=harness({radio_enabled:true,current_space:'shengma'}),hint={textContent:''},fields={playerId:{value:'p'},kind:{value:'saved'},venue:{value:'shengma'}};
 u.state.ledger.push({playerId:'p',amount:8},{playerId:'p',amount:3,storage_pool:'radio'});
 u.state.queue.push({id:'held',playerId:'p',kind:'saved',status:'waiting',creditCost:2,consumed_storage_pool:'shengma'});
 u.ctx.$=selector=>selector==='#proxy-credits'?hint:fields[selector.match(/name=([^\]]+)/)?.[1]];
 u.run('updateProxyCredits(state.songs[0])');assert.equal(hint.textContent,'可用 6｜保留 2｜本次占 2 首');
 fields.venue.value='radio';u.run('updateProxyCredits(state.songs[0])');assert.match(hint.textContent,/可用 電台 3｜聲瑪 6/);
 fields.kind.value='live';u.run('updateProxyCredits(state.songs[0])');assert.doesNotMatch(hint.textContent,/本次占/);
 fields.playerId.value='';u.run('updateProxyCredits(state.songs[0])');assert.equal(hint.textContent,'');assert.equal(u.sent.length,0);
});
