import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {timeValue,queueConfirmed,queuePrepared,queuePreparation} from '../src/core.js';
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),lines=app.split(/\r?\n/);
const line=prefix=>lines.find(row=>row.startsWith(prefix));
const escaping='const '+line('const $=').slice(line('const $=').indexOf('h='));
function harness(){
 let modal;
 const calls=[],settings={livePrice:2990,liveDouble:500},item={songId:'S1',title:'Title',artist:'Artist',creditCost:2};
 const ctx=vm.createContext({session:{playerId:'P1'},state:{settings},demo:false,
  song:()=>item,crownFor:()=>null,clock:()=> '2026-10-09T01:00:00Z',
  venuePolicySavedSnapshot:()=>({}),shortSongOptions:()=>'',check:()=>'<input name="gift">',
  money:value=>value,button:label=>'<button>'+label+'</button>',
  loginDialog:()=>{},toast:()=>{},say:()=>'',
  modal:(title,body,submit)=>modal={title,body,submit},dispatch:async(type,data)=>calls.push({type,data:structuredClone(data)}),
  api:()=>{throw Error('request note must not add queries');}
 });
 vm.runInContext(escaping+'\n'+line('const field=')+'\n'+line('async function requestSong('),ctx);
 return {ctx,calls,get modal(){return modal;},run:code=>vm.runInContext(code,ctx)};
}
test('saved and live confirmation forms include one optional note in the existing request payload',async()=>{
 for(const kind of ['saved','live']){
  const u=harness();await u.run("requestSong('S1','"+kind+"')");
  assert.match(u.modal.body,/想說的話（選填，最多 30 字）/);assert.match(u.modal.body,/name="requestNote"/);
  assert.equal((u.modal.body.match(/name="requestNote"/g)||[]).length,1);
  await u.modal.submit(new Map([['requestNote','今晚想聽這首 ❤️'],['gift','yes']]));
  assert.deepEqual(u.calls,[{type:'request',data:{songId:'S1',kind,selfProvided:false,pairSongId:'',giftConfirmed:true,requestNote:'今晚想聽這首 ❤️'}}]);
 }
});
test('blank optional note keeps the original request route and quote data unchanged',async()=>{
 const u=harness();await u.run("requestSong('S1','saved')");await u.modal.submit(new Map());
 assert.equal(u.calls[0].data.requestNote,'');assert.equal(u.calls[0].data.kind,'saved');assert.equal(u.calls[0].data.songId,'S1');
});
test('manager pending queue displays a request note safely as text within original information layout',()=>{
 const q={id:'Q',playerId:'P1',songId:'S1',title:'Title',artist:'Artist',kind:'saved',status:'waiting',awaitingAcknowledgment:true,at:'2026-10-09T01:00:00Z',requestNote:'<script>alert(1)</script>&',items:[{songId:'S1',title:'Title',performances:1}]};
 const ctx=vm.createContext({timeValue,queueConfirmed,queuePrepared,queuePreparation,
  selectedQueue:new Set(),song:()=>({hasLyrics:false}),clock:()=> '2026-10-09T01:00:00Z',
  paginate:rows=>({rows,nav:''}),session:{playerId:'P1'},playerName:()=> 'Player',statusName:{},time:()=> '時間',
  venuePolicyHistoryVenue:()=>null,venuePolicyConsumedPool:()=> 'shengma',venueName:()=> '',button:label=>'<button>'+label+'</button>'
 });vm.runInContext(escaping+'\n'+line('function queueRows('),ctx);ctx.q=q;
 const html=vm.runInContext('queueRows([q],true,true)',ctx);assert.match(html,/class="queue-request-note"/);assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;/);assert.doesNotMatch(html,/<script>/);
 delete q.requestNote;assert.doesNotMatch(vm.runInContext('queueRows([q],true,true)',ctx),/queue-request-note/);
});
