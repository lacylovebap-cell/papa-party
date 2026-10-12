import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {timeValue,stamp,queueCrossedHour} from '../src/core.js';
const lines=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').split(/\r?\n/);
function fixture(kind='saved'){
 const start=lines.findIndex(line=>line.startsWith('function completeQueue(')),end=lines.findIndex((line,i)=>i>start&&line==='}');
 const input={value:'2026-10-12T21:10',addEventListener(_,listener){this.change=listener;}},choice={innerHTML:''},sent=[];let captured;
 const state={queue:[{id:'Q',kind,status:'waiting',at:'2026-10-12T12:50:00Z',title:'<Song>'}]};
 const context=vm.createContext({state,Number,timeValue,queueCrossedHour,clock:()=> '2026-10-12T13:10:00Z',dateInput:()=>input.value,field:()=>'<input name="effective_at">',h:x=>x.replaceAll('<','&lt;'),isoInput:x=>x?stamp(timeValue(x)):null,
  $:selector=>selector.includes('effective_at')?input:choice,modal:(title,html,submit)=>captured={title,html,submit},dispatch:async(type,data)=>sent.push({type,data})});
 vm.runInContext(lines.slice(start,end+1).join('\n'),context);vm.runInContext("completeQueue('Q')",context);
 return {input,choice,sent,state,get modal(){return captured;}};
}
test('completion requires an explicit carry choice across an hour and preserves the intended saved/live decision',async()=>{
 for(const kind of ['saved','live'])for(const decision of ['yes','no']){
  const u=fixture(kind);assert.match(u.choice.innerHTML,/要過檔嗎/);assert.match(u.choice.innerHTML,/name="carryOver" value="yes" required/);assert.match(u.modal.html,/&lt;Song>/);
  await assert.rejects(u.modal.submit(new Map([['effective_at',u.input.value]])),/選擇這首是否過檔/);assert.equal(u.sent.length,0);
  await u.modal.submit(new Map([['effective_at',u.input.value],['carryOver',decision]]));
  assert.deepEqual(JSON.parse(JSON.stringify(u.sent)),[{type:'queue',data:{id:'Q',operation:'complete',effective_at:'2026-10-12T13:10:00.000Z',carryOver:decision==='yes'}}]);
 }
});
test('correcting or clearing completion time removes the stale carry choice; same-hour and self requests do not carry',async()=>{
 const u=fixture();u.input.value='';assert.doesNotThrow(()=>u.input.change());assert.equal(u.choice.innerHTML,'');
 u.input.value='2026-10-12T20:55';u.input.change();assert.equal(u.choice.innerHTML,'');
 await u.modal.submit(new Map([['effective_at',u.input.value],['carryOver','yes']]));assert.equal(u.sent[0].data.carryOver,undefined);
 u.input.value='2026-10-12T21:15';u.input.change();assert.match(u.choice.innerHTML,/要過檔嗎/);
 assert.equal(fixture('self').choice.innerHTML,'');
});
